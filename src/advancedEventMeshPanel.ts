import * as vscode from 'vscode';

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
import type { EventMeshTargetParams } from './eventMeshPanel';
import {
  buildAdvancedEventMeshWebviewHtml,
  type AdvancedEventMeshProviderTabs,
} from './advancedEventMeshWebviewHtml';

const ADVANCED_EVENT_MESH_VIEW_TYPE = 'sapTools.advancedEventMeshViewer';

export interface AdvancedEventMeshPanelOptions {
  readonly classicAvailable: boolean;
  readonly defaultEnv?: Record<string, unknown>;
}

interface AdvancedEventMeshPanelSession {
  readonly panel: vscode.WebviewPanel;
  readonly appId: string;
  readonly targetParams: EventMeshTargetParams;
  readonly providerTabs: AdvancedEventMeshProviderTabs;
  preloadedDefaultEnv: Record<string, unknown> | null;
  abortController: AbortController | null;
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
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  stopAllListeners(): void {
    // Advanced Event Mesh viewer is read-only in this phase.
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
}
