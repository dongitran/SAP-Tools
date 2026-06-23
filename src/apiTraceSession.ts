import { truncatePreview } from './apiTracePreview';
import { buildTraceUrlSummaries } from './apiTraceSummary';
import { ensureCfAppSshEnabled, prepareCfCliSession } from './cfClient';
import { buildApiTraceDrainExpression, buildApiTraceInstallExpression, buildApiTraceStopExpression } from './apiTraceInjectionSource';
import { createApiTraceInspectorClient, type ApiTraceInspectorClient } from './apiTraceInspectorClient';
import { parseApiTraceDrainResult } from './apiTracePayload';
import { tryStartNodeInspector } from './apiTraceInspectorSignal';
import { openApiTraceInspectorTunnel, type ApiTraceTunnelOpenResult } from './apiTraceTunnel';
import type {
  ApiTraceBatchPayload,
  ApiTraceEvent,
  ApiTraceStartOptions,
  ApiTraceStatePayload,
  ApiTraceStopReason,
  ApiTraceUrlSummaryPayload,
} from './apiTraceTypes';

export interface ApiTraceTargetParams {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
}

export interface ApiTraceSessionCallbacks {
  postState(payload: ApiTraceStatePayload): void;
  postBatch(payload: ApiTraceBatchPayload): void;
  postUrlSummary(payload: ApiTraceUrlSummaryPayload): void;
  log(message: string): void;
}

export interface ApiTraceSessionOptions {
  readonly appId: string;
  readonly targetParams: ApiTraceTargetParams | undefined;
  readonly isTestMode: boolean;
  readonly callbacks: ApiTraceSessionCallbacks;
  readonly dependencies?: Partial<ApiTraceSessionDependencies>;
}

export interface ApiTraceSessionDependencies {
  prepareCfCliSession(targetParams: ApiTraceTargetParams): Promise<void>;
  ensureAppSshEnabled(params: {
    readonly appName: string;
    readonly cfHomeDir?: string;
    readonly instanceIndex: number;
  }): Promise<void>;
  tryStartNodeInspector(params: {
    readonly appName: string;
    readonly cfHomeDir?: string;
    readonly instanceIndex: number;
  }): Promise<boolean>;
  openInspectorTunnel(params: {
    readonly appName: string;
    readonly cfHomeDir?: string;
    readonly instanceIndex: number;
  }): Promise<ApiTraceTunnelOpenResult>;
  createInspectorClient(localPort: number): Promise<ApiTraceInspectorClient | null>;
  setInterval(callback: () => void, ms: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

const TRACE_DRAIN_INTERVAL_MS = 250;
const TRACE_DRAIN_BATCH_SIZE = 50;
const TRACE_RUNTIME_QUEUE_SIZE = 1000;
const TRACE_CONTROL_EVALUATE_TIMEOUT_MS = 5000;
const TRACE_DRAIN_EVALUATE_TIMEOUT_MS = 10000;
const TRACE_DRAIN_TIMEOUT_RETRY_LIMIT = 3;
const TRACE_DRAIN_TRANSPORT_BODY_LIMIT = 20000;

const defaultApiTraceSessionDependencies: ApiTraceSessionDependencies = {
  prepareCfCliSession,
  ensureAppSshEnabled: ensureCfAppSshEnabled,
  tryStartNodeInspector,
  openInspectorTunnel: openApiTraceInspectorTunnel,
  createInspectorClient: createApiTraceInspectorClient,
  setInterval,
  clearInterval,
};

export class ApiTraceSession {
  private readonly appId: string;
  private readonly callbacks: ApiTraceSessionCallbacks;
  private readonly dependencies: ApiTraceSessionDependencies;
  private readonly isTestMode: boolean;
  private events: ApiTraceEvent[] = [];
  private consecutiveDrainTimeouts = 0;
  private disposed = false;
  private drainInFlight = false;
  private inspectorClient: ApiTraceInspectorClient | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private state: ApiTraceStatePayload['state'] = 'idle';
  private stopRequested = false;
  private targetParams: ApiTraceTargetParams | undefined;
  private tunnelHandle: { readonly stop: () => void } | undefined;

  constructor(options: ApiTraceSessionOptions) {
    this.appId = options.appId;
    this.targetParams = options.targetParams;
    this.isTestMode = options.isTestMode;
    this.callbacks = options.callbacks;
    this.dependencies = { ...defaultApiTraceSessionDependencies, ...options.dependencies };
  }

  updateTargetParams(targetParams: ApiTraceTargetParams | undefined): void {
    this.targetParams = targetParams;
  }

  async start(options: ApiTraceStartOptions): Promise<void> {
    if (this.disposed) return;
    if (this.isRunning()) return;
    this.stopRequested = false;
    this.postState('preparingCli', 'Preparing runtime HTTP trace session.', false, false);
    if (this.isTestMode) {
      this.startMockTrace(options.maxBodyBytes);
      return;
    }
    if (this.targetParams === undefined) {
      this.postState('error', 'Sign in and confirm a region/org/space before tracing APIs.', false, false);
      return;
    }
    await this.startRuntimeTrace(options, this.targetParams);
  }

  async stop(reason: ApiTraceStopReason, uninstallRuntimeHook: boolean): Promise<void> {
    this.stopRequested = true;
    if (this.disposed && reason !== 'shutdown') return;
    if (!this.isRunning() && this.state !== 'needsInspector') {
      this.postState('stopped', `Trace stopped (${reason}).`, false, false);
      return;
    }
    const hadRuntimeHook = this.inspectorClient !== undefined;
    this.postState('stopping', `Stopping trace (${reason}).`, hadRuntimeHook, hadRuntimeHook);
    const uninstalled = await this.stopRuntimeTrace(uninstallRuntimeHook);
    this.postState('stopped', `Trace stopped (${reason}).`, false, hadRuntimeHook && !uninstalled);
  }

  clear(): void {
    this.events = [];
    this.callbacks.postUrlSummary({ urls: [], selectedUrl: 'all' });
  }

  isRunning(): boolean {
    return (
      this.state === 'preparingCli' ||
      this.state === 'enablingSsh' ||
      this.state === 'checkingRuntime' ||
      this.state === 'openingTunnel' ||
      this.state === 'injecting' ||
      this.state === 'streaming' ||
      this.state === 'paused' ||
      this.state === 'stopping'
    );
  }

  canStop(): boolean {
    return this.isRunning() || this.state === 'needsInspector';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.stop('shutdown', true);
  }

  private async startRuntimeTrace(
    options: ApiTraceStartOptions,
    targetParams: ApiTraceTargetParams
  ): Promise<void> {
    const instanceIndex = resolveInstanceIndex(options.instanceIndex);
    try {
      await this.dependencies.prepareCfCliSession(targetParams);
      if (this.isStopRequested()) return;
      const runtimeTarget = buildRuntimeTarget(this.appId, targetParams, instanceIndex);
      this.postState('enablingSsh', 'Ensuring CF SSH access before starting Live Trace.', false, false);
      await this.dependencies.ensureAppSshEnabled(runtimeTarget);
      if (this.isStopRequested()) return;
      this.postState('checkingRuntime', 'Checking Node runtime and requesting Inspector startup.', false, false);
      await this.dependencies.tryStartNodeInspector(runtimeTarget);
      if (this.isStopRequested()) return;
      this.postState('openingTunnel', 'Opening Node Inspector tunnel.', false, false);
      const tunnel = await this.dependencies.openInspectorTunnel(runtimeTarget);
      if (this.isStopRequested()) {
        stopLateTunnel(tunnel);
        return;
      }
      await this.attachInspectorClient(tunnel, options, instanceIndex);
    } catch (error) {
      this.logError('startup', error);
      await this.stopRuntimeTrace(false);
      if (this.isStopRequested()) return;
      this.postState('error', 'Runtime HTTP trace could not be started.', false, false);
    }
  }

  private async attachInspectorClient(
    tunnel: ApiTraceTunnelOpenResult,
    options: ApiTraceStartOptions,
    instanceIndex: number
  ): Promise<void> {
    if (this.isStopRequested()) {
      stopLateTunnel(tunnel);
      return;
    }
    if (tunnel.status !== 'ready') {
      this.postState('needsInspector', buildNeedsInspectorMessage(), false, false);
      return;
    }
    this.tunnelHandle = tunnel.handle;
    const client = await this.dependencies.createInspectorClient(tunnel.handle.localPort);
    if (this.isStopRequested()) {
      if (client !== null) {
        client.close();
      }
      this.tunnelHandle.stop();
      this.tunnelHandle = undefined;
      return;
    }
    if (client === null) {
      await this.stopRuntimeTrace(false);
      this.postState('needsInspector', buildNeedsInspectorMessage(), false, false);
      return;
    }
    this.inspectorClient = client;
    this.postState('injecting', 'Installing runtime HTTP trace hook.', false, false);
    await client.evaluate(buildApiTraceInstallExpression({
      appId: this.appId,
      instance: String(instanceIndex),
      captureHeaders: options.captureHeaders,
      captureRequestBody: options.captureRequestBody,
      captureResponseBody: options.captureResponseBody,
      maxBodyBytes: options.maxBodyBytes,
      maxEvents: TRACE_RUNTIME_QUEUE_SIZE,
    }), TRACE_CONTROL_EVALUATE_TIMEOUT_MS);
    if (this.isStopRequested()) {
      await this.stopRuntimeTrace(true);
      return;
    }
    this.startPolling(options.maxBodyBytes);
    if (this.isStopRequested()) {
      await this.stopRuntimeTrace(true);
      return;
    }
    this.postState('streaming', 'Streaming runtime HTTP trace events.', true, false);
  }

  private isStopRequested(): boolean {
    return this.stopRequested || this.disposed;
  }

  private startPolling(maxBodyBytes: number): void {
    this.stopPolling();
    this.consecutiveDrainTimeouts = 0;
    this.pollTimer = this.dependencies.setInterval(() => {
      void this.drainTraceEvents(maxBodyBytes);
    }, TRACE_DRAIN_INTERVAL_MS);
  }

  private async drainTraceEvents(maxBodyBytes: number): Promise<void> {
    if (this.drainInFlight || this.inspectorClient === undefined || this.state !== 'streaming') return;
    this.drainInFlight = true;
    try {
      const payload = await this.inspectorClient.evaluate(
        buildApiTraceDrainExpression(
          TRACE_DRAIN_BATCH_SIZE,
          resolveDrainTransportBodyLimit(maxBodyBytes)
        ),
        TRACE_DRAIN_EVALUATE_TIMEOUT_MS
      );
      this.consecutiveDrainTimeouts = 0;
      this.publishDrainedEvents(payload, maxBodyBytes);
    } catch (error) {
      await this.handleDrainFailure(error);
    } finally {
      this.drainInFlight = false;
    }
  }

  private publishDrainedEvents(payload: unknown, maxBodyBytes: number): void {
    const drained = parseApiTraceDrainResult(payload, { appId: this.appId, maxBodyBytes });
    if (drained.events.length === 0) return;
    this.events = [...this.events, ...drained.events].slice(-TRACE_RUNTIME_QUEUE_SIZE);
    this.callbacks.postBatch({ events: drained.events });
    this.callbacks.postUrlSummary({
      urls: buildTraceUrlSummaries(this.events),
      selectedUrl: 'all',
    });
  }

  private async handleDrainFailure(error: unknown): Promise<void> {
    if (isInspectorEvaluateTimeout(error)) {
      this.consecutiveDrainTimeouts += 1;
      if (this.consecutiveDrainTimeouts < TRACE_DRAIN_TIMEOUT_RETRY_LIMIT) {
        this.callbacks.log(
          `Live Trace drain timed out for ${this.appId}; retrying (${String(this.consecutiveDrainTimeouts)}/${String(TRACE_DRAIN_TIMEOUT_RETRY_LIMIT)}).`
        );
        return;
      }
    }
    this.logError('stream', error);
    await this.stopRuntimeTrace(false);
    this.postState('error', 'Runtime HTTP trace connection was lost.', false, true);
  }

  private async stopRuntimeTrace(uninstallRuntimeHook: boolean): Promise<boolean> {
    this.stopPolling();
    this.consecutiveDrainTimeouts = 0;
    const uninstalled = await this.stopInspectorHook(uninstallRuntimeHook);
    this.inspectorClient?.close();
    this.inspectorClient = undefined;
    this.tunnelHandle?.stop();
    this.tunnelHandle = undefined;
    return uninstalled;
  }

  private async stopInspectorHook(uninstallRuntimeHook: boolean): Promise<boolean> {
    if (this.inspectorClient === undefined) return true;
    try {
      await this.inspectorClient.evaluate(
        buildApiTraceStopExpression(uninstallRuntimeHook),
        TRACE_CONTROL_EVALUATE_TIMEOUT_MS
      );
      return uninstallRuntimeHook;
    } catch (error) {
      this.logError('cleanup', error);
      return false;
    }
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return;
    this.dependencies.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private startMockTrace(maxBodyBytes: number): void {
    const events = createMockTraceEvents(this.appId).map((event) =>
      applyBodyPreviewLimit(event, maxBodyBytes)
    );
    this.events = [...this.events, ...events];
    this.postState('streaming', 'Streaming runtime HTTP trace events in test mode.', true, false);
    this.callbacks.postBatch({ events });
    this.callbacks.postUrlSummary({
      urls: buildTraceUrlSummaries(this.events),
      selectedUrl: 'all',
    });
  }

  private postState(
    state: ApiTraceStatePayload['state'],
    message: string,
    runtimeHookInstalled: boolean,
    runtimeHookMayRemain: boolean
  ): void {
    this.state = state;
    this.callbacks.postState({
      state,
      appId: this.appId,
      mode: 'runtime-http',
      message,
      runtimeHookInstalled,
      runtimeHookMayRemain,
    });
  }

  private logError(phase: 'startup' | 'stream' | 'cleanup', error: unknown): void {
    this.callbacks.log(`Live Trace ${phase} failed for ${this.appId}: ${formatTraceError(error)}`);
  }
}

function resolveInstanceIndex(instanceIndex: ApiTraceStartOptions['instanceIndex']): number {
  return instanceIndex === 'all' ? 0 : instanceIndex;
}

function stopLateTunnel(tunnel: ApiTraceTunnelOpenResult): void {
  if (tunnel.status === 'ready') {
    tunnel.handle.stop();
  }
}

function buildRuntimeTarget(
  appName: string,
  targetParams: ApiTraceTargetParams,
  instanceIndex: number
): { readonly appName: string; readonly cfHomeDir?: string; readonly instanceIndex: number } {
  const base = { appName, instanceIndex };
  return targetParams.cfHomeDir === undefined ? base : { ...base, cfHomeDir: targetParams.cfHomeDir };
}

function buildNeedsInspectorMessage(): string {
  return 'Runtime HTTP Trace needs Node Inspector on 127.0.0.1:9229 for this app. Start the app with --inspect or allow the signal-based Inspector startup, then try again.';
}

function resolveDrainTransportBodyLimit(maxBodyBytes: number): number {
  return maxBodyBytes > 0
    ? Math.min(maxBodyBytes, TRACE_DRAIN_TRANSPORT_BODY_LIMIT)
    : TRACE_DRAIN_TRANSPORT_BODY_LIMIT;
}

function isInspectorEvaluateTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Runtime.evaluate timed out');
}

function formatTraceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.trim();
  return redactTraceError(trimmed.length > 0 ? trimmed : 'Unknown error');
}

function redactTraceError(message: string): string {
  return message
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1<redacted>')
    .replace(/(access_token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(client_secret=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, '$1<redacted>');
}

function createMockTraceEvents(appId: string): ApiTraceEvent[] {
  return [
    createMockEvent(appId, 'trace-001', 'GET', '/odata/v4/products?$top=5', 200, 84),
    {
      ...createMockEvent(appId, 'trace-002', 'POST', '/odata/v4/orders', 201, 133),
      requestBytes: 96,
      requestBodyPreview: '{"amount":1200,"token":"demo-access-token"}',
      responseBodyPreview: '{"ID":"O1001","status":"created"}',
    },
    {
      ...createMockEvent(appId, 'trace-003', 'PATCH', '/odata/v4/orders(1)', 400, 49),
      requestBytes: 74,
      requestBodyPreview: '{"status":"invalid","client_secret":"demo-client-secret"}',
      responseBodyPreview: '{"error":{"message":"Validation failed"}}',
    },
  ];
}

function createMockEvent(
  appId: string,
  id: string,
  method: string,
  normalizedUrl: string,
  status: number,
  durationMs: number
): ApiTraceEvent {
  const querySeparator = normalizedUrl.includes('?') ? '&' : '?';
  return {
    id,
    timestamp: `2026-06-18T07:22:${id.endsWith('1') ? '10' : id.endsWith('2') ? '12' : '18'}.120Z`,
    appId,
    instance: '0',
    method,
    path: normalizedUrl.split('?')[0] ?? normalizedUrl,
    url: `https://mock.example.com${normalizedUrl}${querySeparator}access_token=demo-access-token`,
    normalizedUrl,
    status,
    durationMs,
    requestBytes: 0,
    responseBytes: 1024,
    requestHeaders: {
      authorization: 'Bearer demo-access-token',
      accept: 'application/json',
    },
    responseHeaders: {
      'content-type': 'application/json',
      'set-cookie': 'session=demo-cookie',
    },
    requestBodyPreview: '',
    responseBodyPreview: '{"value":[{"ID":"P001","token":"demo-access-token"}]}',
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    droppedBeforeEvent: 0,
    source: 'runtime-http',
    traceId: id,
    correlationId: null,
  };
}

function applyBodyPreviewLimit(event: ApiTraceEvent, maxBodyChars: number): ApiTraceEvent {
  if (maxBodyChars <= 0) {
    return event;
  }
  const requestBody = truncatePreview(event.requestBodyPreview, maxBodyChars);
  const responseBody = truncatePreview(event.responseBodyPreview, maxBodyChars);
  return {
    ...event,
    requestBodyPreview: requestBody.preview,
    responseBodyPreview: responseBody.preview,
    requestBodyTruncated: event.requestBodyTruncated || requestBody.truncated,
    responseBodyTruncated: event.responseBodyTruncated || responseBody.truncated,
  };
}
