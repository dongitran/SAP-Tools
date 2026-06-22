import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

// cspell:ignore Semp

import { fetchDefaultEnvJsonFromTarget, prepareCfCliSession } from './cfClient';
import {
  extractAdvancedEventMeshDiscovery,
  type AdvancedEventMeshBinding,
} from './advancedEventMeshBindings';
import {
  AdvancedEventMeshSempClient,
  type AdvancedEventMeshQueueSummary,
  type AdvancedEventMeshTopicSummary,
} from './advancedEventMeshClient';
import { DEBUG_QUEUE_SEGMENT, STALE_DEBUG_QUEUE_MAX_AGE_MS } from './eventMeshDebugQueues';
import type { EventMeshTargetParams } from './eventMeshPanel';
import {
  AdvancedEventMeshSolaceListener,
  type AdvancedEventMeshNormalizedMessage,
} from './advancedEventMeshSolaceListener';
import {
  AdvancedEventMeshListeningSession,
  isAdvancedEventMeshStartupStoppedError,
  type AdvancedEventMeshListenCallbacks,
} from './advancedEventMeshListeningSession';
import {
  formatEventMeshPayload,
  toSerializableEventMeshHeaders,
  type EventMeshPayloadEncoding,
} from './eventMeshMessageFormat';
import {
  buildAdvancedEventMeshWebviewHtml,
  type AdvancedEventMeshProviderTabs,
} from './advancedEventMeshWebviewHtml';

const ADVANCED_EVENT_MESH_VIEW_TYPE = 'sapTools.advancedEventMeshViewer';
const FLUSH_INTERVAL_MS = 250;
const MAX_PAYLOAD_BYTES = 20000;
const DEFAULT_AEM_MESSAGE_BUFFER_LIMIT = 1000;

export interface AdvancedEventMeshPanelOptions {
  readonly classicAvailable: boolean;
  readonly defaultEnv?: Record<string, unknown>;
}

type StopReason = 'user' | 'panel-closed' | 'scope-changed' | 'shutdown';

interface AdvancedEventMeshPanelSession {
  readonly panel: vscode.WebviewPanel;
  readonly appId: string;
  readonly targetParams: EventMeshTargetParams;
  readonly providerTabs: AdvancedEventMeshProviderTabs;
  preloadedDefaultEnv: Record<string, unknown> | null;
  abortController: AbortController | null;
  binding: AdvancedEventMeshBinding | null;
  client: AdvancedEventMeshSempClient | null;
  listenSession: AdvancedEventMeshListeningSession | null;
  starting: boolean;
  sequence: number;
  buffer: AdvancedOutgoingEventMessage[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
}

interface AdvancedEventMeshBindingPayload {
  readonly index: number;
  readonly name: string;
  readonly instanceName: string;
  readonly vpn: string;
  readonly managementHost: string;
  readonly smfHost: string;
}

interface AdvancedEventMeshReadyPayload {
  readonly binding: AdvancedEventMeshBindingPayload;
  readonly queues: readonly AdvancedEventMeshQueueSummary[];
  readonly topics: readonly AdvancedEventMeshTopicSummary[];
  readonly unreadableQueueCount: number;
  readonly providerTabs: AdvancedEventMeshProviderTabs;
}

interface AdvancedOutgoingEventMessage {
  readonly seq: number;
  readonly time: string;
  readonly bindingIndex: number;
  readonly bindingName: string;
  readonly vpn: string;
  readonly queueName: string;
  readonly topic: string | null;
  readonly contentType: string;
  readonly messageId: string | null;
  readonly payload: string;
  readonly encoding: EventMeshPayloadEncoding;
  readonly truncated: boolean;
  readonly size: number;
  readonly headers: unknown;
}

type ClassicEventMeshOpener = (
  appId: string,
  targetParams: EventMeshTargetParams
) => void | Promise<void>;

function isTestMode(): boolean {
  return process.env['SAP_TOOLS_TEST_MODE'] === '1' || process.env['SAP_TOOLS_E2E'] === '1';
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : String(error);
}

function parseTopics(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((topic): topic is string => typeof topic === 'string')
        .map((topic) => topic.trim())
        .filter((topic) => topic.length > 0)
    : [];
}

function hostFromUri(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

function areTargetParamsEqual(
  left: EventMeshTargetParams | undefined,
  right: EventMeshTargetParams | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.apiEndpoint === right.apiEndpoint &&
    left.email === right.email &&
    left.password === right.password &&
    left.orgName === right.orgName &&
    left.spaceName === right.spaceName &&
    left.cfHomeDir === right.cfHomeDir
  );
}

function toBindingPayload(binding: AdvancedEventMeshBinding): AdvancedEventMeshBindingPayload {
  return {
    index: binding.index,
    name: binding.name,
    instanceName: binding.instanceName,
    vpn: binding.vpn,
    managementHost: hostFromUri(binding.managementUri),
    smfHost: hostFromUri(binding.smfUri),
  };
}

function buildRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function sanitizeQueueSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return (cleaned.length > 0 ? cleaned : 'binding').slice(0, 80);
}

function queueNamespaceFor(binding: AdvancedEventMeshBinding): string {
  return `saptools/aem/${sanitizeQueueSegment(binding.vpn)}`;
}

function buildDebugQueueName(binding: AdvancedEventMeshBinding): string {
  return `${queueNamespaceFor(binding)}/${DEBUG_QUEUE_SEGMENT}/${buildRunId()}`;
}

function isStaleDebugQueue(queueName: string, binding: AdvancedEventMeshBinding, nowMs: number): boolean {
  const prefix = `${queueNamespaceFor(binding)}/${DEBUG_QUEUE_SEGMENT}/`;
  if (!queueName.startsWith(prefix)) {
    return false;
  }
  const runId = queueName.slice(prefix.length).split('/')[0] ?? '';
  const timestampPart = runId.split('-')[0] ?? '';
  if (timestampPart.length < 8 || !/^[0-9a-z]+$/iu.test(timestampPart)) {
    return false;
  }
  const createdAt = Number.parseInt(timestampPart, 36);
  return Number.isFinite(createdAt) && nowMs - createdAt > STALE_DEBUG_QUEUE_MAX_AGE_MS;
}

export class AdvancedEventMeshPanelManager implements vscode.Disposable {
  private readonly sessions = new Map<string, AdvancedEventMeshPanelSession>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly openClassicEventMeshViewer?: ClassicEventMeshOpener
  ) {}

  private log(message: string): void {
    this.outputChannel.appendLine(`[AdvancedEventMesh] ${message}`);
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      void this.stopListening(session, 'shutdown', false);
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  stopAllListeners(reason: StopReason): void {
    for (const session of this.sessions.values()) {
      if ((session.listenSession?.hasActiveListener() ?? false) || session.starting) {
        void this.stopListening(session, reason, true);
      }
    }
  }

  openAdvancedEventMeshViewer(
    appId: string,
    targetParams: EventMeshTargetParams,
    options: AdvancedEventMeshPanelOptions
  ): void {
    const providerTabs = { classicAvailable: options.classicAvailable };
    const existing = this.sessions.get(appId);
    if (existing !== undefined) {
      if (
        areTargetParamsEqual(existing.targetParams, targetParams) &&
        existing.providerTabs.classicAvailable === providerTabs.classicAvailable
      ) {
        existing.panel.reveal();
        return;
      }
      existing.panel.dispose();
      if (this.sessions.get(appId) === existing) {
        this.sessions.delete(appId);
      }
    }

    this.log(`open Advanced Event Mesh viewer for app ${appId}`);
    const panel = this.createPanel(appId);
    const session: AdvancedEventMeshPanelSession = {
      panel,
      appId,
      targetParams,
      providerTabs,
      preloadedDefaultEnv: options.defaultEnv ?? null,
      abortController: null,
      binding: null,
      client: null,
      listenSession: null,
      starting: false,
      sequence: 0,
      buffer: [],
      flushTimer: null,
      disposed: false,
    };
    this.sessions.set(appId, session);
    panel.webview.html = buildAdvancedEventMeshWebviewHtml(
      this.extensionUri,
      panel.webview,
      appId,
      providerTabs
    );
    this.bindPanelLifecycle(session);
  }

  private createPanel(appId: string): vscode.WebviewPanel {
    return vscode.window.createWebviewPanel(
      ADVANCED_EVENT_MESH_VIEW_TYPE,
      `Advanced Event Mesh · ${appId}`,
      { preserveFocus: false, viewColumn: vscode.ViewColumn.Active },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'docs', 'designs', 'prototypes')],
        retainContextWhenHidden: true,
      }
    );
  }

  private bindPanelLifecycle(session: AdvancedEventMeshPanelSession): void {
    session.panel.onDidDispose(() => {
      session.disposed = true;
      session.abortController?.abort();
      void this.stopListening(session, 'panel-closed', false);
      if (this.sessions.get(session.appId) === session) {
        this.sessions.delete(session.appId);
      }
    });
    session.panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleWebviewMessage(session, raw);
    });
  }

  private async handleWebviewMessage(
    session: AdvancedEventMeshPanelSession,
    raw: unknown
  ): Promise<void> {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const type = (raw as Record<string, unknown>)['type'];
    if (type === 'sapTools.aem.webviewReady' || type === 'sapTools.aem.refresh') {
      await this.initSession(session);
      return;
    }
    if (type === 'sapTools.aem.openClassic' && this.openClassicEventMeshViewer !== undefined) {
      await this.openClassicEventMeshViewer(session.appId, session.targetParams);
      return;
    }
    if (type === 'sapTools.aem.startListening') {
      await this.startListening(session, parseTopics((raw as Record<string, unknown>)['topics']));
      return;
    }
    if (type === 'sapTools.aem.addTopics') {
      await this.addTopics(session, parseTopics((raw as Record<string, unknown>)['topics']));
      return;
    }
    if (type === 'sapTools.aem.stopListening') {
      await this.stopListening(session, 'user', true);
    }
  }

  private post(session: AdvancedEventMeshPanelSession, type: string, payload: Record<string, unknown>): void {
    if (session.disposed) {
      return;
    }
    void session.panel.webview.postMessage({ type, ...payload });
  }

  private postReady(
    session: AdvancedEventMeshPanelSession,
    payload: AdvancedEventMeshReadyPayload
  ): void {
    this.post(session, 'sapTools.aem.ready', {
      appName: session.appId,
      binding: payload.binding,
      queues: payload.queues,
      topics: payload.topics,
      unreadableQueueCount: payload.unreadableQueueCount,
      providerTabs: payload.providerTabs,
    });
  }

  private postError(session: AdvancedEventMeshPanelSession, message: string): void {
    this.post(session, 'sapTools.aem.error', { message });
  }

  private async initSession(session: AdvancedEventMeshPanelSession): Promise<void> {
    if (isTestMode()) {
      this.postMockReady(session);
      return;
    }
    session.abortController?.abort();
    const controller = new AbortController();
    session.abortController = controller;
    try {
      const preloadedDefaultEnv = session.preloadedDefaultEnv;
      session.preloadedDefaultEnv = null;
      if (preloadedDefaultEnv !== null) {
        await this.readAndPostDiscovery(session, preloadedDefaultEnv, controller.signal);
        return;
      }
      await prepareCfCliSession(session.targetParams);
      const envJson = await fetchDefaultEnvJsonFromTarget({
        appName: session.appId,
        cfHomeDir: session.targetParams.cfHomeDir,
      });
      await this.readAndPostDiscovery(session, JSON.parse(envJson) as unknown, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.postError(session, describeError(error));
      }
    } finally {
      if (session.abortController === controller) {
        session.abortController = null;
      }
    }
  }

  private async readAndPostDiscovery(
    session: AdvancedEventMeshPanelSession,
    defaultEnv: unknown,
    signal?: AbortSignal
  ): Promise<void> {
    const bindings = extractAdvancedEventMeshDiscovery(defaultEnv).brokerBindings;
    const binding = bindings[0];
    if (binding === undefined) {
      this.postError(session, `No "advanced-event-mesh" user-provided service is bound to "${session.appId}".`);
      return;
    }
    this.log(`Found ${String(bindings.length)} Advanced Event Mesh binding(s) for ${session.appId}`);
    const client = new AdvancedEventMeshSempClient(binding);
    if (session.binding !== null && session.binding.index !== binding.index) {
      await this.stopListening(session, 'scope-changed', true);
    }
    session.binding = binding;
    if (!(session.listenSession?.hasActiveListener() ?? false) && !session.starting) {
      session.client = client;
      session.listenSession = this.createListenSession(session);
    } else {
      session.client ??= client;
    }
    const discovery = await client.discoverQueueSubscriptions(signal);
    if (signal?.aborted === true) {
      return;
    }
    this.postReady(session, {
      binding: toBindingPayload(binding),
      queues: discovery.queues,
      topics: discovery.topics,
      unreadableQueueCount: discovery.unreadableQueueCount,
      providerTabs: session.providerTabs,
    });
  }

  private createListenSession(session: AdvancedEventMeshPanelSession): AdvancedEventMeshListeningSession {
    return new AdvancedEventMeshListeningSession({
      buildQueueName: (binding) => buildDebugQueueName(binding),
      getClient: (): AdvancedEventMeshSempClient => {
        if (session.client === null) {
          throw new Error('Advanced Event Mesh management client is not ready.');
        }
        return session.client;
      },
      createListener: (binding, queueName, callbacks) =>
        new AdvancedEventMeshSolaceListener(binding, queueName, callbacks),
      onCleanupError: (message): void => { this.log(message); },
    });
  }

  private makeListenCallbacks(session: AdvancedEventMeshPanelSession): AdvancedEventMeshListenCallbacks {
    return {
      onMessage: (binding, queueName, normalized): void => { this.enqueueMessage(session, binding, queueName, normalized); },
      onStatus: (bindingIndex, message): void => { this.post(session, 'sapTools.aem.status', { bindingIndex, message }); },
      onConnected: (binding, description): void => {
        this.log(`Solace connected for ${session.appId} binding ${binding.name}${description !== '' ? ` (${description})` : ''}`);
      },
    };
  }

  private async startListening(
    session: AdvancedEventMeshPanelSession,
    topics: readonly string[]
  ): Promise<void> {
    if (isTestMode()) {
      this.postMockListening(session, topics);
      return;
    }
    if (session.starting || session.listenSession === null || session.binding === null) {
      return;
    }
    if (topics.length === 0) {
      this.postError(session, 'Select at least one Advanced Event Mesh topic to listen to.');
      return;
    }
    session.starting = true;
    try {
      await this.reapStaleDebugQueues(session.binding, session.client);
      const binding = await session.listenSession.startBinding(
        { binding: session.binding, topics },
        this.makeListenCallbacks(session)
      );
      this.post(session, 'sapTools.aem.listening', { binding });
    } catch (error) {
      if (!isAdvancedEventMeshStartupStoppedError(error)) {
        this.postError(session, describeError(error));
      }
    } finally {
      session.starting = false;
    }
  }

  private async addTopics(
    session: AdvancedEventMeshPanelSession,
    topics: readonly string[]
  ): Promise<void> {
    if (session.listenSession === null || session.binding === null) {
      return;
    }
    try {
      const added = await session.listenSession.addTopics(session.binding.index, topics);
      this.post(session, 'sapTools.aem.topicsAdded', {
        bindingIndex: session.binding.index,
        topics: added,
      });
    } catch (error) {
      this.postError(session, describeError(error));
    }
  }

  private async reapStaleDebugQueues(
    binding: AdvancedEventMeshBinding,
    client: AdvancedEventMeshSempClient | null
  ): Promise<void> {
    if (client === null) {
      return;
    }
    try {
      const queues = await client.listQueues();
      for (const queue of queues) {
        if (isStaleDebugQueue(queue.queueName, binding, Date.now())) {
          await client.deleteQueue(queue.queueName);
        }
      }
    } catch {
      // Best-effort cleanup must not block a new listener from starting.
    }
  }

  private enqueueMessage(
    session: AdvancedEventMeshPanelSession,
    binding: AdvancedEventMeshBinding,
    queueName: string,
    normalized: AdvancedEventMeshNormalizedMessage
  ): void {
    session.sequence += 1;
    const payload = formatEventMeshPayload(normalized.body, normalized.contentType, MAX_PAYLOAD_BYTES);
    session.buffer.push({
      seq: session.sequence,
      time: new Date().toISOString(),
      bindingIndex: binding.index,
      bindingName: binding.name,
      vpn: binding.vpn,
      queueName,
      topic: normalized.topic,
      contentType: normalized.contentType,
      messageId: normalized.messageId,
      payload: payload.value,
      encoding: payload.encoding,
      truncated: payload.truncated,
      size: payload.size,
      headers: toSerializableEventMeshHeaders(normalized.headers),
    });
    const overflow = session.buffer.length - DEFAULT_AEM_MESSAGE_BUFFER_LIMIT;
    if (overflow > 0) {
      session.buffer.splice(0, overflow);
    }
    session.flushTimer ??= setTimeout(() => { this.flush(session); }, FLUSH_INTERVAL_MS);
  }

  private flush(session: AdvancedEventMeshPanelSession): void {
    if (session.flushTimer !== null) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    if (session.buffer.length === 0) {
      return;
    }
    const events = session.buffer;
    session.buffer = [];
    this.post(session, 'sapTools.aem.messages', { events });
  }

  private async stopListening(
    session: AdvancedEventMeshPanelSession,
    reason: StopReason,
    notifyWebview: boolean
  ): Promise<void> {
    if (notifyWebview) {
      this.flush(session);
    } else {
      session.buffer = [];
    }
    session.starting = false;
    await session.listenSession?.stopAll();
    if (notifyWebview) {
      this.post(session, 'sapTools.aem.stopped', { reason });
    }
  }

  private postMockReady(session: AdvancedEventMeshPanelSession): void {
    this.postReady(session, {
      binding: {
        index: 0,
        name: 'advanced-event-mesh',
        instanceName: 'advanced-event-mesh',
        vpn: 'mock-aem',
        managementHost: 'broker.example.com:943',
        smfHost: 'broker.example.com:443',
      },
      queues: [
        {
          queueName: 'mock/events',
          permission: 'consume',
          ingressEnabled: true,
          egressEnabled: true,
          subscriptionCount: 2,
        },
      ],
      topics: [{ topic: 'mock/topic/created', queues: ['mock/events'] }],
      unreadableQueueCount: 0,
      providerTabs: session.providerTabs,
    });
  }

  private postMockListening(
    session: AdvancedEventMeshPanelSession,
    topics: readonly string[]
  ): void {
    const selectedTopics = topics.length > 0 ? [...topics] : ['mock/topic/created'];
    this.post(session, 'sapTools.aem.listening', {
      binding: {
        bindingIndex: 0,
        bindingName: 'advanced-event-mesh',
        vpn: 'mock-aem',
        queueName: 'saptools/aem/mock-aem/saptools-debug/mock',
        topics: selectedTopics,
      },
    });
    this.post(session, 'sapTools.aem.messages', {
      events: [
        {
          seq: 1,
          time: new Date().toISOString(),
          bindingIndex: 0,
          bindingName: 'advanced-event-mesh',
          vpn: 'mock-aem',
          queueName: 'saptools/aem/mock-aem/saptools-debug/mock',
          topic: selectedTopics[0] ?? 'mock/topic/created',
          contentType: 'application/json',
          messageId: 'mock-aem-1',
          payload: JSON.stringify({ source: 'advanced-event-mesh', ok: true }, null, 2),
          encoding: 'json',
          truncated: false,
          size: 43,
          headers: {},
        },
      ],
    });
  }
}
