import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { discoverApiEntities } from './apiCatalogDiscovery.js';
import { fetchAppRouteUrlFromTarget, fetchCfOauthTokenFromTarget, fetchXsuaaTokenFromTarget } from './cfClient.js';
import {
  DEFAULT_API_TRACE_PREFERENCES,
  readExecuteRequestPayload,
  readTracePreferencesPayload,
  readTraceStartOptions,
  readUninstallRuntimeHook,
} from './apisExplorerMessages.js';
import { ApiTraceSession } from './apiTraceSession.js';
import type { ApiTraceStopReason } from './apiTraceTypes.js';
import type { ApiTracePreferencesPayload, ExecuteRequestPayload } from './apisExplorerMessages.js';
import type { CacheStore } from './cacheStore.js';

const APIS_EXPLORER_VIEW_TYPE = 'sapTools.apisExplorer';
const API_TRACE_PREFERENCES_KEY = 'sapTools.apis.trace.preferences';

export interface ApisExplorerPanelSession {
  readonly panel: vscode.WebviewPanel;
  readonly appId: string;
  initialLoad: Promise<void>;
  catalogLoadGeneration: number;
  targetParams?: ApisExplorerTargetParams;
  traceSession?: ApiTraceSession;
  disposed: boolean;
}

export interface ApisExplorerTargetParams {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
}

function isTestMode(): boolean {
  return process.env['SAP_TOOLS_TEST_MODE'] === '1' || process.env['SAP_TOOLS_E2E'] === '1';
}

function areTargetParamsEqual(
  left: ApisExplorerTargetParams | undefined,
  right: ApisExplorerTargetParams | undefined
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

interface InitialLoadGate {
  readonly promise: Promise<void>;
  settle(): void;
}

function createInitialLoadGate(): InitialLoadGate {
  let settled = false;
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    settle: (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise();
    },
  };
}

export class ApisExplorerPanelManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sessions = new Map<string, ApisExplorerPanelSession>();
  private readonly initialLoadGates = new WeakMap<ApisExplorerPanelSession, InitialLoadGate>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly cacheStore: CacheStore,
    private readonly tracePreferenceStore?: vscode.Memento
  ) {}

  private log(msg: string): void {
    this.outputChannel.appendLine(`[ApisExplorer] ${msg}`);
  }

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    for (const session of this.sessions.values()) {
      void this.stopTraceSession(session, 'shutdown', true);
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  async stopAllTraces(reason: ApiTraceStopReason): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        if (session.traceSession?.canStop() ?? false) {
          await this.stopTraceSession(session, reason, true);
        }
      })
    );
  }

  openApisExplorer(appId: string, targetParams?: ApisExplorerTargetParams): ApisExplorerPanelSession {
    const existingSession = this.sessions.get(appId);
    if (existingSession !== undefined) {
      return this.reopenApisExplorer(existingSession, targetParams);
    }

    this.log(`open APIs Explorer for app ${appId}`);
    return this.createApisExplorerSession(appId, targetParams);
  }

  private reopenApisExplorer(
    session: ApisExplorerPanelSession,
    targetParams?: ApisExplorerTargetParams
  ): ApisExplorerPanelSession {
    const targetChanged = !areTargetParamsEqual(session.targetParams, targetParams);
    if (targetChanged && (session.traceSession?.isRunning() ?? false)) {
      void this.stopTraceSession(session, 'target-changed', true);
    }
    if (targetParams === undefined) {
      delete session.targetParams;
    } else {
      session.targetParams = targetParams;
    }
    session.traceSession?.updateTargetParams(targetParams);
    session.panel.reveal();
    this.startApisLoadForSession(session, targetParams, targetChanged);
    return session;
  }

  private startApisLoadForSession(
    session: ApisExplorerPanelSession,
    targetParams: ApisExplorerTargetParams | undefined,
    targetChanged: boolean
  ): void {
    if (targetParams === undefined) {
      this.settleInitialLoad(session);
      return;
    }
    if (targetChanged) {
      this.resetInitialLoad(session);
    }
    this.startApiDataLoad(session, targetParams, targetChanged);
  }

  private createApisExplorerSession(
    appId: string,
    targetParams?: ApisExplorerTargetParams
  ): ApisExplorerPanelSession {
    const panel = vscode.window.createWebviewPanel(
      APIS_EXPLORER_VIEW_TYPE,
      `APIs Explorer · ${appId}`,
      { preserveFocus: false, viewColumn: vscode.ViewColumn.Active },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'docs', 'designs', 'prototypes')],
        retainContextWhenHidden: true
      }
    );

    const session: ApisExplorerPanelSession = {
      panel,
      appId,
      initialLoad: Promise.resolve(),
      catalogLoadGeneration: 0,
      disposed: false,
    };
    this.resetInitialLoad(session);
    if (targetParams === undefined) {
      this.settleInitialLoad(session);
    }
    if (targetParams !== undefined) {
      session.targetParams = targetParams;
    }
    this.sessions.set(appId, session);

    panel.webview.html = this.buildWebviewHtml(panel.webview, appId);
    this.bindPanelLifecycle(session);
    return session;
  }

  private bindPanelLifecycle(session: ApisExplorerPanelSession): void {
    const panelDisposables: vscode.Disposable[] = [];
    session.panel.onDidDispose(() => {
      session.disposed = true;
      this.settleInitialLoad(session);
      this.sessions.delete(session.appId);
      void this.stopTraceSession(session, 'panel-closed', true);
      while (panelDisposables.length > 0) {
        panelDisposables.pop()?.dispose();
      }
    });
    session.panel.webview.onDidReceiveMessage(
      (message: unknown) => this.handleWebviewMessage(session, message),
      null,
      panelDisposables
    );
  }

  private resetInitialLoad(session: ApisExplorerPanelSession): void {
    this.initialLoadGates.get(session)?.settle();
    const gate = createInitialLoadGate();
    this.initialLoadGates.set(session, gate);
    session.initialLoad = gate.promise;
  }

  private settleInitialLoad(session: ApisExplorerPanelSession): void {
    this.initialLoadGates.get(session)?.settle();
  }

  private async handleWebviewMessage(
    session: ApisExplorerPanelSession,
    message: unknown
  ): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const msg = message as Record<string, unknown>;
    const type = msg['type'];

    if (type === 'sapTools.apis.executeRequest') {
      const payload = readExecuteRequestPayload(msg['payload']);
      if (payload !== null) {
        await this.handleExecuteRequest(session, payload);
      }
      return;
    }
    if (type === 'sapTools.apis.webviewReady') {
      if (session.targetParams !== undefined) {
        this.startApiDataLoad(session, session.targetParams, false);
      }
      return;
    }
    if (type === 'sapTools.apis.trace.start') {
      this.startTrace(session, msg['payload']);
      return;
    }
    if (type === 'sapTools.apis.trace.stop') {
      await this.stopTraceSession(session, 'user', readUninstallRuntimeHook(msg['payload']));
      return;
    }
    if (type === 'sapTools.apis.trace.preferencesChanged') {
      await this.saveTracePreferences(msg['payload']);
      return;
    }
    if (type === 'sapTools.apis.trace.clear') {
      session.traceSession?.clear();
    }
  }

  private async saveTracePreferences(payload: unknown): Promise<void> {
    const preferences = readTracePreferencesPayload(payload);
    if (preferences === null) {
      return;
    }
    await this.tracePreferenceStore?.update(API_TRACE_PREFERENCES_KEY, preferences);
  }

  private readTracePreferences(): ApiTracePreferencesPayload {
    const stored = this.tracePreferenceStore?.get<unknown>(API_TRACE_PREFERENCES_KEY);
    return readTracePreferencesPayload(stored) ?? DEFAULT_API_TRACE_PREFERENCES;
  }

  private startTrace(session: ApisExplorerPanelSession, payload: unknown): void {
    const options = readTraceStartOptions(payload);
    if (options === null) {
      this.postTraceState(session, 'error', 'Invalid trace start request.', false, false);
      return;
    }
    const traceSession = this.getTraceSession(session);
    void traceSession.start(options);
  }

  private getTraceSession(session: ApisExplorerPanelSession): ApiTraceSession {
    session.traceSession ??= new ApiTraceSession({
      appId: session.appId,
      targetParams: session.targetParams,
      isTestMode: isTestMode(),
      callbacks: {
        postState: (payload): void => {
          this.post(session, { type: 'sapTools.apis.trace.state', payload });
        },
        postBatch: (payload): void => {
          this.post(session, { type: 'sapTools.apis.trace.batch', payload });
        },
        postUrlSummary: (payload): void => {
          this.post(session, { type: 'sapTools.apis.trace.urlSummary', payload });
        },
        log: (message): void => {
          this.log(message);
        },
      },
    });
    session.traceSession.updateTargetParams(session.targetParams);
    return session.traceSession;
  }

  private async stopTraceSession(
    session: ApisExplorerPanelSession,
    reason: ApiTraceStopReason,
    uninstallRuntimeHook: boolean
  ): Promise<void> {
    const traceSession = session.traceSession;
    if (traceSession === undefined) {
      return;
    }
    await traceSession.stop(reason, uninstallRuntimeHook);
  }

  private postTraceState(
    session: ApisExplorerPanelSession,
    state: 'error',
    message: string,
    runtimeHookInstalled: boolean,
    runtimeHookMayRemain: boolean
  ): void {
    this.log(`Live Trace error for ${session.appId}: ${message}`);
    this.post(session, {
      type: 'sapTools.apis.trace.state',
      payload: {
        state,
        appId: session.appId,
        mode: 'runtime-http',
        message,
        runtimeHookInstalled,
        runtimeHookMayRemain,
      },
    });
  }

  private post(session: ApisExplorerPanelSession, message: Record<string, unknown>): void {
    if (session.disposed) {
      return;
    }
    void session.panel.webview.postMessage(message);
  }

  private startApiDataLoad(
    session: ApisExplorerPanelSession,
    targetParams: ApisExplorerTargetParams,
    resetCatalog: boolean
  ): void {
    session.catalogLoadGeneration += 1;
    if (resetCatalog) {
      this.post(session, { type: 'sapTools.apis.catalogLoading' });
    }
    void this.loadApiData(session, targetParams, session.catalogLoadGeneration);
  }

  private isCurrentApiDataLoad(session: ApisExplorerPanelSession, generation: number): boolean {
    return !session.disposed && session.catalogLoadGeneration === generation;
  }

  private async loadApiData(
    session: ApisExplorerPanelSession,
    targetParams: ApisExplorerTargetParams,
    generation: number
  ): Promise<void> {
    if (isTestMode()) {
      this.postMockApiCatalog(session);
      this.settleInitialLoad(session);
      return;
    }
    try {
      await this.loadLiveApiData(session, targetParams, generation);
    } catch (error) {
      if (!this.isCurrentApiDataLoad(session, generation)) return;
      this.log(`Error loading API data for ${session.appId}: ${String(error)}`);
      this.post(session, {
        type: 'sapTools.apis.error',
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
      this.settleInitialLoad(session);
    }
  }

  private postMockApiCatalog(session: ApisExplorerPanelSession): void {
    this.post(session, {
      type: 'sapTools.apis.catalogLoaded',
      payload: {
        name: session.appId,
        baseUrl: 'https://mock.example.com',
        entities: [
          { name: 'Users', count: 12, methods: ['GET', 'POST'], path: '/odata/v4/users' },
          { name: 'Products', count: 48, methods: ['GET', 'POST', 'PATCH', 'DELETE'], path: '/odata/v4/products' },
          { name: 'Orders', count: 8, methods: ['GET', 'POST'], path: '/odata/v4/orders' },
        ],
      },
    });
  }

  private async loadLiveApiData(
    session: ApisExplorerPanelSession,
    targetParams: ApisExplorerTargetParams,
    generation: number
  ): Promise<void> {
    this.log(`Fetching route for app ${session.appId}...`);
    const routeUrl = await fetchAppRouteUrlFromTarget({ ...targetParams, appName: session.appId });
    if (!this.isCurrentApiDataLoad(session, generation)) return;
    if (routeUrl === null || routeUrl === '') {
      this.log(`No route found for app ${session.appId}.`);
      this.post(session, {
        type: 'sapTools.apis.error',
        payload: { message: `No route found for app ${session.appId}` },
      });
      this.settleInitialLoad(session);
      return;
    }
    const cacheKey = JSON.stringify([
      targetParams.apiEndpoint.trim().toLowerCase().replace(/\/+$/, ''),
      targetParams.orgName.trim(),
      targetParams.spaceName.trim(),
      session.appId.trim(),
    ]);
    const cachedCatalog = await this.cacheStore.getApiCatalog(cacheKey);
    if (!this.isCurrentApiDataLoad(session, generation)) return;
    if (cachedCatalog !== null) {
      this.log(`Cache hit for ${session.appId} API catalog; refreshing in background.`);
      this.post(session, { type: 'sapTools.apis.catalogLoaded', payload: cachedCatalog });
      this.settleInitialLoad(session);
    }
    await this.refreshApiCatalog(session, targetParams, generation, routeUrl, cacheKey, cachedCatalog !== null);
  }

  private async refreshApiCatalog(
    session: ApisExplorerPanelSession,
    targetParams: ApisExplorerTargetParams,
    generation: number,
    routeUrl: string,
    cacheKey: string,
    isBackgroundUpdate: boolean
  ): Promise<void> {
    const baseUrl = `https://${routeUrl}`;
    this.log(`Route found: ${baseUrl}`);
    const entities = await discoverApiEntities({
      appId: session.appId,
      baseUrl,
      targetParams,
      log: (message) => {
        this.log(message);
      },
      onDeepDiscoveryStart: () => {
        if (this.isCurrentApiDataLoad(session, generation)) {
          this.post(session, { type: 'sapTools.apis.syncStarted' });
        }
      },
    });
    if (!this.isCurrentApiDataLoad(session, generation)) return;
    const catalog = {
      name: session.appId,
      baseUrl,
      entities,
      updatedAt: new Date().toISOString(),
    };
    await this.cacheStore.setApiCatalog(cacheKey, catalog).catch((error: unknown) => {
      this.log(`Failed to cache API catalog: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!this.isCurrentApiDataLoad(session, generation)) return;
    this.log(`Sending catalog to Webview with ${String(entities.length)} entities`);
    this.post(session, {
      type: 'sapTools.apis.catalogLoaded',
      payload: { ...catalog, isBackgroundUpdate },
    });
    this.settleInitialLoad(session);
  }

  private async handleExecuteRequest(
    session: ApisExplorerPanelSession,
    payload: ExecuteRequestPayload
  ): Promise<void> {
    try {
      this.log(`Executing ${payload.method} ${formatUrlForLog(payload.url)} with auth ${payload.auth}`);

      if (isTestMode()) {
        // Return a mock successful response immediately for E2E tests
        setTimeout(() => {
          void session.panel.webview.postMessage({
            type: 'sapTools.apis.executeResponse',
            payload: {
              ...executeResponseMetadata(payload),
              status: '200 OK',
              time: 42,
              data: { value: [{ MockData: "Test success from mock execution" }] }
            }
          });
        }, 100);
        return;
      }

      const headers: Record<string, string> = { ...(payload.headers ?? {}) };
      if (!hasHeader(headers, 'accept')) {
        headers['Accept'] = 'application/json';
      }
      const targetParams = session.targetParams;

      if (payload.auth === 'CF Token' && targetParams !== undefined) {
        const token = await fetchCfOauthTokenFromTarget(targetParams);
        if (token !== null) {
          headers['Authorization'] = token;
        }
      } else if (payload.auth === 'xsuaa-auto' && targetParams !== undefined) {
        const token = await fetchXsuaaTokenFromTarget({ ...targetParams, appName: session.appId });
        if (token !== null) {
          headers['Authorization'] = token;
        }
      }

      if (session.traceSession?.isRunning() ?? false) {
        headers['x-saptools-trace-id'] = randomBytes(12).toString('hex');
      }

      if (
        payload.body !== undefined &&
        payload.body.trim().length > 0 &&
        !hasHeader(headers, 'content-type')
      ) {
        headers['Content-Type'] = 'application/json';
      }

      const startTime = Date.now();
      const fetchOptions: RequestInit = {
        method: payload.method,
        headers,
        signal: AbortSignal.timeout(10000)
      };
      if (payload.body !== undefined && payload.body.trim().length > 0) {
        fetchOptions.body = payload.body;
      }
      const res = await fetch(payload.url, fetchOptions);
      const elapsedTime = Date.now() - startTime;

      
      let responsePayload: unknown;
      const text = await res.text();
      try {
        responsePayload = JSON.parse(text);
      } catch {
        responsePayload = { value: [{ info: "Response is not JSON", text }] };
      }

      void session.panel.webview.postMessage({
        type: 'sapTools.apis.executeResponse',
        payload: {
          ...executeResponseMetadata(payload),
          status: `${String(res.status)} ${res.statusText}`,
          time: elapsedTime,
          data: responsePayload
        }
      });
    } catch (e) {
      this.log(`Error executing request for ${session.appId}: ${String(e)}`);
      void session.panel.webview.postMessage({
        type: 'sapTools.apis.executeResponse',
        payload: {
          ...executeResponseMetadata(payload),
          status: 'Error',
          time: 0,
          data: { error: e instanceof Error ? e.message : String(e) }
        }
      });
    }
  }

  private buildWebviewHtml(webview: vscode.Webview, appId: string): string {
    const prototypesUri = vscode.Uri.joinPath(this.extensionUri, 'docs', 'designs', 'prototypes');
    const apisWebviewJsUri = webview.asWebviewUri(vscode.Uri.joinPath(prototypesUri, 'assets', 'apis-webview.js'));
    const prototypeCssUri = webview.asWebviewUri(vscode.Uri.joinPath(prototypesUri, 'assets', 'prototype.css'));
    // cspell:ignore wght
    const fontUri = webview.asWebviewUri(vscode.Uri.joinPath(prototypesUri, 'assets', 'Outfit-VariableFont_wght.ttf'));
    const fontUriStr = fontUri.toString();
    const prototypeCssUriStr = prototypeCssUri.with({ query: `t=${Date.now().toString()}` }).toString();
    const apisWebviewJsUriStr = apisWebviewJsUri.with({ query: `t=${Date.now().toString()}` }).toString();
    const tracePreferences = this.readTracePreferences();

    const nonce = randomBytes(16).toString('base64url');
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>APIs Explorer</title>
  <style nonce="${nonce}">
    @font-face {
      font-family: 'Outfit';
      src: url('${fontUriStr}') format('truetype');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      height: 100vh;
      overflow: hidden;
    }
    #webview-app {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  </style>
  <link rel="stylesheet" href="${prototypeCssUriStr}" />
</head>
<body class="vscode-dark">
  <!-- Root App Container -->
  <div id="webview-app"></div>

  <!-- Pass appId via a script tag so the JS can read it -->
  <script nonce="${nonce}">
    window.vscodeApiSelectedAppId = ${JSON.stringify(appId)};
    window.sapToolsApiTracePreferences = ${JSON.stringify(tracePreferences)};
  </script>
  <!-- Load the main UI logic -->
  <script nonce="${nonce}" src="${apisWebviewJsUriStr}"></script>
</body>
</html>`;
  }

}

function formatUrlForLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}${parsed.search.length > 0 ? '?<query omitted>' : ''}`;
  } catch {
    return '<invalid-url>';
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((headerName) => headerName.toLowerCase() === normalized);
}

function executeResponseMetadata(
  payload: ExecuteRequestPayload
): { readonly source: 'traceReplay'; readonly requestId: string } | Record<string, never> {
  return payload.source === 'traceReplay' && payload.requestId !== undefined
    ? { source: 'traceReplay', requestId: payload.requestId }
    : {};
}
