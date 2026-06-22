import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

import { fetchDefaultEnvJsonFromTarget, prepareCfCliSession } from './cfClient';
import { extractEventMeshBindings, type EventMeshBinding, type EventMeshEndpoint } from './eventMeshBindings';
import { EventMeshManagementClient } from './eventMeshClient';
import { DEBUG_QUEUE_SEGMENT } from './eventMeshDebugQueues';
import { EventMeshQueueCleaner } from './eventMeshQueueCleaner';
import {
  EventMeshAmqpListener,
  type NormalizedEventMessage,
} from './eventMeshAmqpListener';
import {
  EventMeshListeningSession,
  isEventMeshStartupStoppedError,
  type EventMeshBindingSummary,
  type EventMeshListenCallbacks,
  type EventMeshListenRequest,
} from './eventMeshListeningSession';
import {
  formatEventMeshPayload,
  toSerializableEventMeshHeaders,
  type EventMeshPayloadEncoding,
} from './eventMeshMessageFormat';
import { publishEventToMesh, publishEventToMeshQueue } from './eventMeshPublishClient';
import { parsePublishEventRequest } from './eventMeshPublishRequest';
import { buildEventMeshWebviewHtml } from './eventMeshWebviewHtml';

const EVENT_MESH_VIEW_TYPE = 'sapTools.eventMeshViewer';

/** Coalesce incoming AMQP messages and post them to the webview at most this often. */
const FLUSH_INTERVAL_MS = 250;
/** Max pending received events kept before they are flushed to the webview. */
export const DEFAULT_EVENT_MESSAGE_BUFFER_LIMIT = 1000;
/** Max payload bytes forwarded to the webview per message. */
const MAX_PAYLOAD_BYTES = 20000;
/** Cap on how many existing queues to inspect when discovering candidate topics. */
const TOPIC_DISCOVERY_QUEUE_CAP = 25;

export interface EventMeshTargetParams {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir: string;
}

type StopReason = 'user' | 'panel-closed' | 'scope-changed' | 'shutdown';

interface OutgoingEventMessage {
  readonly seq: number;
  readonly time: string;
  readonly bindingIndex: number;
  readonly bindingName: string;
  readonly bindingNamespace: string;
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

interface PanelSession {
  readonly panel: vscode.WebviewPanel;
  readonly appId: string;
  readonly targetParams: EventMeshTargetParams | undefined;
  bindings: EventMeshBinding[];
  readonly clientsByBinding: Map<number, EventMeshManagementClient>;
  readonly discoveredByBinding: Map<number, string[]>;
  readonly queuesByBinding: Map<number, string[]>;
  listenSession: EventMeshListeningSession | null;
  starting: boolean;
  disposed: boolean;
  sequence: number;
  buffer: OutgoingEventMessage[];
  flushTimer: ReturnType<typeof setTimeout> | null;
}

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
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string' && t.length > 0) : [];
}

export function trimOutgoingEventBuffer<T>(
  buffer: readonly T[],
  limit = DEFAULT_EVENT_MESSAGE_BUFFER_LIMIT
): T[] {
  if (limit <= 0 || buffer.length <= limit) {
    return [...buffer];
  }
  return buffer.slice(-limit);
}

function buildRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function buildOwnerId(): string {
  return `${String(process.pid)}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function wildcardTopicFor(namespace: string): string {
  return `${namespace}/*`;
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

export class EventMeshPanelManager implements vscode.Disposable {
  private readonly sessions = new Map<string, PanelSession>();
  private readonly ownerId = buildOwnerId();
  private readonly queueCleaner: EventMeshQueueCleaner;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    queueCleaner?: EventMeshQueueCleaner
  ) {
    this.queueCleaner = queueCleaner ?? new EventMeshQueueCleaner(this.ownerId, (message) => {
      this.log(message);
    });
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[EventMesh] ${message}`);
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      void this.stopListening(session, 'shutdown', false);
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  /** Stop every active listener (and delete its debug queue) without closing the panels. */
  stopAllListeners(reason: StopReason): void {
    for (const session of this.sessions.values()) {
      if ((session.listenSession?.hasActiveListeners() ?? false) || session.starting) {
        void this.stopListening(session, reason, true);
      }
    }
  }

  closeEventMeshViewer(appId: string): void {
    const existing = this.sessions.get(appId);
    if (existing === undefined) {
      return;
    }
    existing.panel.dispose();
    if (this.sessions.get(appId) === existing) {
      this.sessions.delete(appId);
    }
  }

  openEventMeshViewer(appId: string, targetParams?: EventMeshTargetParams): void {
    const existing = this.sessions.get(appId);
    if (existing !== undefined) {
      if (areTargetParamsEqual(existing.targetParams, targetParams)) {
        existing.panel.reveal();
        return;
      }
      existing.panel.dispose();
      if (this.sessions.get(appId) === existing) {
        this.sessions.delete(appId);
      }
    }

    this.log(`open Event viewer for app ${appId}`);

    const panel = vscode.window.createWebviewPanel(
      EVENT_MESH_VIEW_TYPE,
      `Event Mesh · ${appId}`,
      { preserveFocus: false, viewColumn: vscode.ViewColumn.Active },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'docs', 'designs', 'prototypes')],
        retainContextWhenHidden: true,
      }
    );

    const session: PanelSession = {
      panel,
      appId,
      targetParams,
      bindings: [],
      clientsByBinding: new Map(),
      discoveredByBinding: new Map(),
      queuesByBinding: new Map(),
      listenSession: null,
      starting: false,
      disposed: false,
      sequence: 0,
      buffer: [],
      flushTimer: null,
    };
    session.listenSession = this.createListenSession(session);
    this.sessions.set(appId, session);

    panel.webview.html = buildEventMeshWebviewHtml(this.extensionUri, panel.webview, appId);

    panel.onDidDispose(() => {
      session.disposed = true;
      if (this.sessions.get(appId) === session) {
        this.sessions.delete(appId);
      }
      void this.stopListening(session, 'panel-closed', false);
    });

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleWebviewMessage(session, raw);
    });
  }

  private async handleWebviewMessage(session: PanelSession, raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const message = raw as Record<string, unknown>;
    const type = message['type'];

    if (type === 'sapTools.events.webviewReady') {
      await this.initSession(session);
      return;
    }
    if (type === 'sapTools.events.selectBinding') {
      const bindingIndex = typeof message['bindingIndex'] === 'number' ? message['bindingIndex'] : 0;
      await this.discoverAndPostTopics(session, bindingIndex);
      return;
    }
    if (type === 'sapTools.events.selectPublishBinding') {
      const bindingIndex = typeof message['bindingIndex'] === 'number' ? message['bindingIndex'] : 0;
      await this.discoverAndPostPublishMetadata(session, bindingIndex);
      return;
    }
    if (type === 'sapTools.events.startListening') {
      await this.startAllListening(session, this.parseBindingRequests(session, message));
      return;
    }
    if (type === 'sapTools.events.startBinding') {
      const idx = typeof message['bindingIndex'] === 'number' ? message['bindingIndex'] : -1;
      const binding = session.bindings.find((b) => b.index === idx);
      if (binding !== undefined) {
        await this.startOneBinding(session, binding, parseTopics(message['topics']));
      }
      return;
    }
    if (type === 'sapTools.events.addTopics') {
      const idx = typeof message['bindingIndex'] === 'number' ? message['bindingIndex'] : -1;
      await this.addTopicsToBinding(session, idx, parseTopics(message['topics']));
      return;
    }
    if (type === 'sapTools.events.publishEvent') {
      await this.handlePublishEvent(session, message);
      return;
    }
    if (type === 'sapTools.events.stopListening') {
      await this.stopListening(session, 'user', true);
    }
  }

  private post(session: PanelSession, type: string, payload: Record<string, unknown>): void {
    if (session.disposed) {
      return;
    }
    void session.panel.webview.postMessage({ type, ...payload });
  }

  private postError(session: PanelSession, scope: 'init' | 'start', message: string): void {
    this.post(session, 'sapTools.events.error', { scope, message });
  }

  private async initSession(session: PanelSession): Promise<void> {
    if (isTestMode()) {
      this.postMockReady(session);
      return;
    }

    const target = session.targetParams;
    if (target === undefined) {
      this.postError(session, 'init', 'Sign in and confirm a region/org/space before listening to events.');
      return;
    }

    try {
      await prepareCfCliSession({
        apiEndpoint: target.apiEndpoint,
        email: target.email,
        password: target.password,
        orgName: target.orgName,
        spaceName: target.spaceName,
        cfHomeDir: target.cfHomeDir,
      });
      const envJson = await fetchDefaultEnvJsonFromTarget({
        appName: session.appId,
        cfHomeDir: target.cfHomeDir,
      });
      const bindings = extractEventMeshBindings(JSON.parse(envJson));
      if (bindings.length === 0) {
        this.postError(
          session,
          'init',
          `No "enterprise-messaging" service is bound to "${session.appId}".`
        );
        return;
      }
      session.bindings = bindings;
      this.log(`Found ${String(bindings.length)} Event Mesh binding(s) for ${session.appId}`);
      await this.queueCleaner.reapForBindings(bindings, (binding) =>
        this.getClient(session, binding)
      );
      this.post(session, 'sapTools.events.ready', {
        appName: session.appId,
        bindings: bindings.map((binding) => ({
          index: binding.index,
          name: binding.name,
          namespace: binding.namespace,
          instanceName: binding.instanceName,
        })),
      });
      await this.discoverAndPostTopics(session, bindings[0]?.index ?? 0);
    } catch (error) {
      this.postError(session, 'init', describeError(error));
    }
  }

  private getClient(session: PanelSession, binding: EventMeshBinding): EventMeshManagementClient {
    const existing = session.clientsByBinding.get(binding.index);
    if (existing !== undefined) {
      return existing;
    }
    const client = new EventMeshManagementClient(binding);
    session.clientsByBinding.set(binding.index, client);
    return client;
  }

  private createListenSession(session: PanelSession): EventMeshListeningSession {
    return new EventMeshListeningSession({
      debugQueueSegment: DEBUG_QUEUE_SEGMENT,
      buildRunId: () => buildRunId(),
      getClient: (binding) => this.getClient(session, binding),
      createListener: (binding, queueName, callbacks) =>
        new EventMeshAmqpListener(binding, queueName, callbacks),
      beforeCreateQueue: async (binding): Promise<void> => {
        await this.queueCleaner.reapForBinding(binding, this.getClient(session, binding));
      },
      onQueueCreated: async (binding, queueName): Promise<void> => {
        await this.queueCleaner.recordQueue(session.appId, binding, queueName);
      },
      onQueueDeleted: async (_binding, queueName): Promise<void> => {
        await this.queueCleaner.removeQueue(queueName);
      },
      onCleanupError: (message): void => {
        this.log(message);
      },
    });
  }

  private async discoverAndPostTopics(session: PanelSession, bindingIndex: number): Promise<void> {
    if (isTestMode()) {
      return;
    }
    const binding = session.bindings.find((entry) => entry.index === bindingIndex);
    if (binding === undefined) {
      return;
    }
    const wildcardTopic = wildcardTopicFor(binding.namespace);

    const cached = session.discoveredByBinding.get(bindingIndex);
    if (cached !== undefined) {
      this.post(session, 'sapTools.events.topics', { bindingIndex, topics: cached, wildcardTopic });
      return;
    }

    try {
      const topics = await this.getClient(session, binding).discoverTopics(TOPIC_DISCOVERY_QUEUE_CAP);
      session.discoveredByBinding.set(bindingIndex, topics);
      this.post(session, 'sapTools.events.topics', { bindingIndex, topics, wildcardTopic });
    } catch (error) {
      this.post(session, 'sapTools.events.topics', {
        bindingIndex,
        topics: [],
        wildcardTopic,
        discoveryError: describeError(error),
      });
    }
  }

  private async discoverAndPostPublishMetadata(
    session: PanelSession,
    bindingIndex: number
  ): Promise<void> {
    if (isTestMode()) {
      this.postMockPublishMetadata(session, bindingIndex);
      return;
    }
    await this.discoverAndPostTopics(session, bindingIndex);
    await this.discoverAndPostQueues(session, bindingIndex);
  }

  private async discoverAndPostQueues(session: PanelSession, bindingIndex: number): Promise<void> {
    const binding = session.bindings.find((entry) => entry.index === bindingIndex);
    if (binding === undefined) {
      return;
    }

    const cached = session.queuesByBinding.get(bindingIndex);
    if (cached !== undefined) {
      this.post(session, 'sapTools.events.queues', { bindingIndex, queues: cached });
      return;
    }

    try {
      const queues = await this.getClient(session, binding).listQueueNames();
      session.queuesByBinding.set(bindingIndex, queues);
      this.post(session, 'sapTools.events.queues', { bindingIndex, queues });
    } catch (error) {
      this.post(session, 'sapTools.events.queues', {
        bindingIndex,
        queues: [],
        discoveryError: describeError(error),
      });
    }
  }

  private parseBindingRequests(session: PanelSession, message: Record<string, unknown>): EventMeshListenRequest[] {
    const raw = Array.isArray(message['bindings']) ? (message['bindings'] as unknown[]) : [];
    return raw.flatMap((b): EventMeshListenRequest[] => {
      if (typeof b !== 'object' || b === null) return [];
      const entry = b as Record<string, unknown>;
      const idx = typeof entry['bindingIndex'] === 'number' ? entry['bindingIndex'] : -1;
      const binding = session.bindings.find((bnd) => bnd.index === idx);
      if (binding === undefined) return [];
      return [{ binding, topics: parseTopics(entry['topics']) }];
    });
  }

  private makeListenCallbacks(session: PanelSession): EventMeshListenCallbacks {
    return {
      onMessage: (binding, queueName, normalized): void => { this.enqueueMessage(session, binding, queueName, normalized); },
      onStatus: (bindingIndex, message): void => { this.post(session, 'sapTools.events.status', { bindingIndex, message }); },
      onConnected: (binding, description): void => { this.log(`AMQP connected for ${session.appId} binding ${binding.name}${description !== '' ? ` (${description})` : ''}`); },
    };
  }

  private async startAllListening(session: PanelSession, requests: EventMeshListenRequest[]): Promise<void> {
    if (isTestMode()) {
      this.postMockListening(session, requests);
      return;
    }
    if (session.starting || session.listenSession === null) return;
    if (requests.length === 0) {
      this.postError(session, 'start', 'Select at least one topic to listen to.');
      return;
    }
    session.starting = true;
    try {
      const summaries = await session.listenSession.startMany(
        requests,
        this.makeListenCallbacks(session),
        {
          onProgress: (progress): void => {
            this.post(session, 'sapTools.events.startProgress', {
              completed: progress.completed,
              total: progress.total,
              percent: progress.percent,
              bindingIndex: progress.bindingIndex,
              bindingName: progress.bindingName,
            });
          },
        }
      );
      this.post(session, 'sapTools.events.listening', { bindings: summaries });
      this.log(`Listening on ${String(summaries.length)} binding(s)`);
    } catch (error) {
      if (!isEventMeshStartupStoppedError(error)) {
        this.postError(session, 'start', describeError(error));
      }
    } finally {
      session.starting = false;
    }
  }

  private async startOneBinding(session: PanelSession, binding: EventMeshBinding, topics: string[]): Promise<void> {
    if (session.listenSession === null) return;
    if (!session.listenSession.hasActiveListeners()) return;
    try {
      const summary = await session.listenSession.startBinding({ binding, topics }, this.makeListenCallbacks(session));
      this.post(session, 'sapTools.events.bindingListening', { ...summary });
    } catch (error) {
      if (!isEventMeshStartupStoppedError(error)) {
        this.post(session, 'sapTools.events.error', { scope: 'topics', bindingIndex: binding.index, message: describeError(error) });
      }
    }
  }

  private async addTopicsToBinding(session: PanelSession, bindingIndex: number, topics: string[]): Promise<void> {
    if (session.listenSession === null) return;
    try {
      const added = await session.listenSession.addTopics(bindingIndex, topics);
      this.post(session, 'sapTools.events.topicsAdded', { bindingIndex, topics: added });
    } catch (error) {
      this.post(session, 'sapTools.events.error', { scope: 'topics', bindingIndex, message: describeError(error) });
    }
  }

  private async handlePublishEvent(session: PanelSession, message: Record<string, unknown>): Promise<void> {
    const request = parsePublishEventRequest(session.bindings, message);
    if (request === null) return;
    if (isTestMode()) {
      setTimeout(() => {
        this.post(session, 'sapTools.events.publishResult', {
          bindingIndex: request.binding.index,
          destinationKind: request.destinationKind,
          destination: request.destination,
          ...(request.destinationKind === 'topic' ? { topic: request.destination } : {}),
          ok: true,
          status: 204,
        });
      }, 400);
      return;
    }

    try {
      const status = request.destinationKind === 'queue'
        ? await publishEventToMeshQueue(request.binding, request.destination, request.payload, request.contentType)
        : await publishEventToMesh(request.binding, request.destination, request.payload, request.contentType);
      this.post(session, 'sapTools.events.publishResult', {
        bindingIndex: request.binding.index,
        destinationKind: request.destinationKind,
        destination: request.destination,
        ...(request.destinationKind === 'topic' ? { topic: request.destination } : {}),
        ok: true,
        status,
      });
    } catch (error) {
      this.post(session, 'sapTools.events.publishResult', {
        bindingIndex: request.binding.index,
        destinationKind: request.destinationKind,
        destination: request.destination,
        ok: false,
        message: describeError(error),
      });
    }
  }
  private enqueueMessage(
    session: PanelSession,
    binding: EventMeshBinding,
    queueName: string,
    normalized: NormalizedEventMessage
  ): void {
    session.sequence += 1;
    const payload = formatEventMeshPayload(normalized.body, normalized.contentType, MAX_PAYLOAD_BYTES);
    session.buffer.push({
      seq: session.sequence,
      time: new Date().toISOString(),
      bindingIndex: binding.index,
      bindingName: binding.name,
      bindingNamespace: binding.namespace,
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
    const overflow = session.buffer.length - DEFAULT_EVENT_MESSAGE_BUFFER_LIMIT;
    if (overflow > 0) {
      session.buffer.splice(0, overflow);
    }
    session.flushTimer ??= setTimeout(() => {
      this.flush(session);
    }, FLUSH_INTERVAL_MS);
  }

  private flush(session: PanelSession): void {
    if (session.flushTimer !== null) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    if (session.buffer.length === 0) {
      return;
    }
    const events = session.buffer;
    session.buffer = [];
    this.post(session, 'sapTools.events.messages', { events });
  }

  private async stopListening(
    session: PanelSession,
    reason: StopReason,
    notifyWebview: boolean
  ): Promise<void> {
    if (session.flushTimer !== null) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    if (notifyWebview) {
      this.flush(session);
    } else {
      session.buffer = [];
    }
    session.starting = false;
    await session.listenSession?.stopAll();
    if (notifyWebview) {
      this.post(session, 'sapTools.events.stopped', { reason });
    }
  }

  private postMockReady(session: PanelSession): void {
    const namespace = 'demo/service/app';
    const oa2 = { clientid: 'mock', clientsecret: 'mock', tokenendpoint: 'https://mock/oauth/token' };
    const ep = (uri: string): EventMeshEndpoint => ({ uri, oa2 });
    session.bindings = [{ index: 0, name: 'demo-service', instanceName: 'demo-service', namespace, management: ep('https://mock'), messaging: ep('https://mock'), amqp: ep('wss://mock/amqp') }];
    this.post(session, 'sapTools.events.ready', { appName: session.appId, bindings: [{ index: 0, name: 'demo-service', namespace, instanceName: 'demo-service' }] });
    this.post(session, 'sapTools.events.topics', { bindingIndex: 0, topics: [`${namespace}/items/created`, `${namespace}/items/updated`], wildcardTopic: wildcardTopicFor(namespace) });
  }

  private postMockPublishMetadata(session: PanelSession, bindingIndex: number): void {
    const binding = session.bindings.find((entry) => entry.index === bindingIndex);
    if (binding === undefined) return;
    this.post(session, 'sapTools.events.topics', {
      bindingIndex,
      topics: [`${binding.namespace}/items/created`, `${binding.namespace}/items/updated`],
      wildcardTopic: wildcardTopicFor(binding.namespace),
    });
    this.post(session, 'sapTools.events.queues', {
      bindingIndex,
      queues: [`${binding.namespace}/q-main`, `${binding.namespace}/q-audit`],
    });
  }

  private postMockListening(session: PanelSession, requests: EventMeshListenRequest[]): void {
    if (requests.length === 0) return;
    const summaries: EventMeshBindingSummary[] = requests.map((r) => ({
      bindingIndex: r.binding.index,
      bindingName: r.binding.name,
      bindingNamespace: r.binding.namespace,
      queueName: `${r.binding.namespace}/saptools-debug/mock`,
      topics: [...r.topics],
    }));
    this.post(session, 'sapTools.events.listening', { bindings: summaries });
    const first = summaries[0];
    if (first === undefined) return;
    this.post(session, 'sapTools.events.messages', {
      events: [
        {
          seq: 1,
          time: new Date().toISOString(),
          bindingIndex: first.bindingIndex,
          bindingName: first.bindingName,
          bindingNamespace: first.bindingNamespace,
          queueName: first.queueName,
          topic: `${first.bindingNamespace}/items/created`,
          contentType: 'application/json',
          messageId: 'mock-1',
          payload: JSON.stringify({ itemId: 'A-1001', status: 'created' }, null, 2),
          encoding: 'json',
          truncated: false,
          size: 42,
          headers: {},
        },
      ],
    });
  }

}
