import { truncatePreview } from './apiTracePreview';
import { buildTraceUrlSummaries } from './apiTraceSummary';
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
}

export class ApiTraceSession {
  private readonly appId: string;
  private readonly callbacks: ApiTraceSessionCallbacks;
  private readonly isTestMode: boolean;
  private events: ApiTraceEvent[] = [];
  private disposed = false;
  private state: ApiTraceStatePayload['state'] = 'idle';
  private targetParams: ApiTraceTargetParams | undefined;

  constructor(options: ApiTraceSessionOptions) {
    this.appId = options.appId;
    this.targetParams = options.targetParams;
    this.isTestMode = options.isTestMode;
    this.callbacks = options.callbacks;
  }

  updateTargetParams(targetParams: ApiTraceTargetParams | undefined): void {
    this.targetParams = targetParams;
  }

  start(options: ApiTraceStartOptions): void {
    if (this.disposed) return;
    if (this.isRunning()) return;
    this.postState('preparingCli', 'Preparing runtime HTTP trace session.', false, false);
    if (this.isTestMode) {
      this.startMockTrace(options.maxBodyBytes);
      return;
    }
    if (this.targetParams === undefined) {
      this.postState('error', 'Sign in and confirm a region/org/space before tracing APIs.', false, false);
      return;
    }
    this.postState(
      'needsInspector',
      'Runtime HTTP Trace needs a reachable Node Inspector tunnel for this app.',
      false,
      false
    );
  }

  stop(reason: ApiTraceStopReason, uninstallRuntimeHook: boolean): void {
    if (this.disposed && reason !== 'shutdown') return;
    if (!this.isRunning() && this.state !== 'needsInspector') {
      this.postState('stopped', `Trace stopped (${reason}).`, false, false);
      return;
    }
    const hookMayRemain = !uninstallRuntimeHook && this.state === 'streaming';
    this.postState('stopping', `Stopping trace (${reason}).`, this.state === 'streaming', hookMayRemain);
    this.postState('stopped', `Trace stopped (${reason}).`, false, hookMayRemain);
  }

  clear(): void {
    this.events = [];
    this.callbacks.postUrlSummary({ urls: [], selectedUrl: 'all' });
  }

  isRunning(): boolean {
    return (
      this.state === 'preparingCli' ||
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
    this.stop('shutdown', true);
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
