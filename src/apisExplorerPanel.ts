import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { fetchAppRouteUrlFromTarget, fetchCfOauthTokenFromTarget, fetchXsuaaTokenFromTarget, fetchRemoteCdsServicesFromTarget } from './cfClient.js';
import { readExecuteRequestPayload, readTraceStartOptions, readUninstallRuntimeHook } from './apisExplorerMessages.js';
import { ApiTraceSession } from './apiTraceSession.js';
import type { ApiTraceStopReason } from './apiTraceTypes.js';
import type { ExecuteRequestPayload } from './apisExplorerMessages.js';
import type { CacheStore } from './cacheStore.js';

const APIS_EXPLORER_VIEW_TYPE = 'sapTools.apisExplorer';

export interface ApisExplorerPanelSession {
  readonly panel: vscode.WebviewPanel;
  readonly appId: string;
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

export class ApisExplorerPanelManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sessions = new Map<string, ApisExplorerPanelSession>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly cacheStore: CacheStore
  ) {}

  private log(msg: string): void {
    this.outputChannel.appendLine(`[ApisExplorer] ${msg}`);
  }

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    for (const session of this.sessions.values()) {
      this.stopTraceSession(session, 'shutdown', true);
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  stopAllTraces(reason: ApiTraceStopReason): void {
    for (const session of this.sessions.values()) {
      if (session.traceSession?.canStop() ?? false) {
        this.stopTraceSession(session, reason, true);
      }
    }
  }

  openApisExplorer(appId: string, targetParams?: ApisExplorerTargetParams): ApisExplorerPanelSession {
    const existingSession = this.sessions.get(appId);
    if (existingSession !== undefined) {
      const targetChanged = !areTargetParamsEqual(existingSession.targetParams, targetParams);
      if (targetChanged && (existingSession.traceSession?.isRunning() ?? false)) {
        this.stopTraceSession(existingSession, 'target-changed', true);
      }
      if (targetParams === undefined) {
        delete existingSession.targetParams;
      } else {
        existingSession.targetParams = targetParams;
      }
      existingSession.traceSession?.updateTargetParams(targetParams);
      existingSession.panel.reveal();
      if (targetParams !== undefined) {
        void this.loadApiData(appId, targetParams, existingSession.panel);
      }
      return existingSession;
    }

    this.log(`open APIs Explorer for app ${appId}`);

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
      disposed: false,
    };
    if (targetParams !== undefined) {
      session.targetParams = targetParams;
    }
    this.sessions.set(appId, session);

    panel.webview.html = this.buildWebviewHtml(panel.webview, appId);

    const panelDisposables: vscode.Disposable[] = [];

    panel.onDidDispose(() => {
      session.disposed = true;
      this.sessions.delete(appId);
      this.stopTraceSession(session, 'panel-closed', true);
      while (panelDisposables.length > 0) {
        panelDisposables.pop()?.dispose();
      }
    });

    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleWebviewMessage(session, message);
    }, null, panelDisposables);

    return session;
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
        void this.loadApiData(session.appId, session.targetParams, session.panel);
      }
      return;
    }
    if (type === 'sapTools.apis.trace.start') {
      this.startTrace(session, msg['payload']);
      return;
    }
    if (type === 'sapTools.apis.trace.stop') {
      this.stopTraceSession(session, 'user', readUninstallRuntimeHook(msg['payload']));
      return;
    }
    if (type === 'sapTools.apis.trace.clear') {
      session.traceSession?.clear();
    }
  }

  private startTrace(session: ApisExplorerPanelSession, payload: unknown): void {
    const options = readTraceStartOptions(payload);
    if (options === null) {
      this.postTraceState(session, 'error', 'Invalid trace start request.', false, false);
      return;
    }
    const traceSession = this.getTraceSession(session);
    traceSession.start(options);
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

  private stopTraceSession(
    session: ApisExplorerPanelSession,
    reason: ApiTraceStopReason,
    uninstallRuntimeHook: boolean
  ): void {
    const traceSession = session.traceSession;
    if (traceSession === undefined) {
      return;
    }
    traceSession.stop(reason, uninstallRuntimeHook);
  }

  private postTraceState(
    session: ApisExplorerPanelSession,
    state: 'error',
    message: string,
    runtimeHookInstalled: boolean,
    runtimeHookMayRemain: boolean
  ): void {
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

  private async loadApiData(appId: string, targetParams: ApisExplorerTargetParams, panel: vscode.WebviewPanel): Promise<void> {
    if (isTestMode()) {
      // Return a mock catalog immediately for E2E tests to match expected UI flow
      void panel.webview.postMessage({
        type: 'sapTools.apis.catalogLoaded',
        payload: {
          name: appId,
          baseUrl: 'https://mock.example.com',
          entities: [
            { name: 'Users', count: 12, methods: ['GET', 'POST'], path: '/odata/v4/users' },
            { name: 'Products', count: 48, methods: ['GET', 'POST', 'PATCH', 'DELETE'], path: '/odata/v4/products' },
            { name: 'Orders', count: 8, methods: ['GET', 'POST'], path: '/odata/v4/orders' }
          ]
        }
      });
      return;
    }

    try {
      this.log(`Fetching route for app ${appId}...`);
      const routeUrl = await fetchAppRouteUrlFromTarget({ ...targetParams, appName: appId });
      
      if (routeUrl === null || routeUrl === '') {
        this.log(`No route found for app ${appId}.`);
        void panel.webview.postMessage({
          type: 'sapTools.apis.error',
          payload: { message: `No route found for app ${appId}` }
        });
        return;
      }

      // Check Cache (Stale-While-Revalidate)
      const cachedCatalog = await this.cacheStore.getApiCatalog(appId);
      if (cachedCatalog !== null) {
        this.log(`Cache hit for ${appId} API catalog. Sending to Webview, but continuing deep discovery in background.`);
        void panel.webview.postMessage({
          type: 'sapTools.apis.catalogLoaded',
          payload: cachedCatalog
        });
        // We do NOT return here; we continue to fetch fresh data.
      }

      const baseUrl = `https://${routeUrl}`;
      this.log(`Route found: ${baseUrl}`);

      // We will attempt to fetch CAP endpoints from the root `/` URL if it provides JSON.
      // Or fallback to basic entity lists based on typical OData endpoints.
      let entities: { name: string; methods: string[]; schema: unknown; path: string }[] = [];
      let success = false;

      try {
        // For CAP apps, the root metadata endpoint typically expects an XSUAA token if protected.
        const token = await fetchXsuaaTokenFromTarget({ ...targetParams, appName: appId });
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (token !== null && token !== '') {
          headers['Authorization'] = token.startsWith('bearer') || token.startsWith('Bearer') ? token : `Bearer ${token}`;
        }
        
        const res = await fetch(baseUrl + '/', {
          headers,
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data === 'object' && data !== null) {
            const dataObj = data as { endpoints?: { name?: string; path?: string }[]; value?: { name?: string; url?: string }[] };
            
            if (Array.isArray(dataObj.endpoints) && dataObj.endpoints.length > 0) {
              entities = dataObj.endpoints.map(ep => ({
                name: typeof ep.name === 'string' && ep.name !== '' ? ep.name : typeof ep.path === 'string' ? ep.path.replace(/[^a-zA-Z0-9]/g, '') : 'Unknown',
                methods: ['GET', 'POST', 'PATCH', 'DELETE'],
                schema: { type: 'object', properties: {} },
                path: typeof ep.path === 'string' ? ep.path : ''
              }));
              success = true;
            } else if (Array.isArray(dataObj.value) && dataObj.value.length > 0) {
              entities = dataObj.value.map(ep => ({
                name: typeof ep.name === 'string' ? ep.name : 'Unknown',
                methods: ['GET', 'POST', 'PATCH', 'DELETE'],
                schema: { type: 'object', properties: {} },
                path: typeof ep.url === 'string' ? `/${ep.url}` : ''
              }));
              success = true;
            }
          }
        }
      } catch (err) {
        this.log(`Failed to discover APIs from root endpoint: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!success || entities.length === 0) {
        this.log(`Warning: No API entities discovered remotely from root endpoint for ${appId}. Attempting fallback via CF SSH remote .cds scan...`);
        try {
           const remoteCdsContent = await fetchRemoteCdsServicesFromTarget({ ...targetParams, appName: appId });
           if (remoteCdsContent !== null && remoteCdsContent !== '') {
             const regex = /service\s+([A-Za-z0-9_]+)[^{]*?@\(\s*path\s*:\s*['"]([^'"]+)['"]\s*\)/g;
             let match;
             const discovered = new Set<string>();
             while ((match = regex.exec(remoteCdsContent)) !== null) {
               const name = match[1] ?? '';
               const path = match[2] ?? '';
               if (name !== '' && !discovered.has(name)) {
                 discovered.add(name);
                 entities.push({
                   name: name,
                   methods: ['GET', 'POST', 'PATCH', 'DELETE'],
                   schema: { type: 'object', properties: {} },
                   path: path
                 });
               }
             }

             if (entities.length === 0) {
               // Fallback to just name if no explicit @path is defined
               const regexFallback = /service\s+([A-Za-z0-9_]+)/g;
               while ((match = regexFallback.exec(remoteCdsContent)) !== null) {
                 const name = match[1] ?? '';
                 if (name !== '' && !discovered.has(name)) {
                   discovered.add(name);
                   entities.push({
                     name: name,
                     methods: ['GET', 'POST', 'PATCH', 'DELETE'],
                     schema: { type: 'object', properties: {} },
                     path: `/odata/v4/${name.replace(/Service$/, '').toLowerCase()}`
                   });
                 }
               }
             }
             if (entities.length > 0) {
               success = true;
               this.log(`Discovered ${String(entities.length)} entities via remote CF SSH scan.`);
             }
           }
        } catch (sshErr) {
           this.log(`CF SSH fallback failed: ${sshErr instanceof Error ? sshErr.message : String(sshErr)}`);
        }
      }

        // --- Deep Auto-Discovery (Drill-down into OData Services) ---
        if (entities.length > 0) {
          this.log(`Attempting deep discovery on ${String(entities.length)} root endpoints...`);
          // Notify frontend that background sync has started
          void panel.webview.postMessage({ type: 'sapTools.apis.syncStarted' });

          const expandedEntities: { name: string; methods: string[]; schema: unknown; path: string }[] = [];
          
          // Re-use the token we fetched earlier
          const token = await fetchXsuaaTokenFromTarget({ ...targetParams, appName: appId });
          const headers: Record<string, string> = { 'Accept': 'application/json' };
          if (token !== null && token !== '') {
            headers['Authorization'] = token.startsWith('bearer') || token.startsWith('Bearer') ? token : `Bearer ${token}`;
          }

          // Use Promise.allSettled for highly parallel deep discovery
          const fetchPromises = entities.map(async (ep) => {
            if (ep.path === '' || ep.path === '/') {
              return [ep];
            }
            try {
              const epUrl = `${baseUrl}${ep.path.startsWith('/') ? ep.path : '/' + ep.path}`;
              const res = await fetch(epUrl, { headers, signal: AbortSignal.timeout(5000) });
              if (res.ok) {
                const data = await res.json();
                if (typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>)['value'])) {
                  const subEntities = (data as Record<string, unknown>)['value'] as { name?: string; url?: string }[];
                  let foundSub = false;
                  const newEps: typeof entities = [];
                  for (const sub of subEntities) {
                    if (typeof sub.name === 'string' && sub.name !== '') {
                      const subPath = typeof sub.url === 'string' && sub.url !== '' ? sub.url : sub.name;
                      newEps.push({
                        name: `${ep.name} / ${sub.name}`,
                        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
                        schema: { type: 'object', properties: {} },
                        path: `${ep.path}/${subPath}`
                      });
                      foundSub = true;
                    }
                  }
                  if (foundSub) {
                    return newEps;
                  }
                }
              }
            } catch {
              // Fallback to returning the root endpoint on error
            }
            return [ep];
          });

          const results = await Promise.allSettled(fetchPromises);
          for (const res of results) {
            if (res.status === 'fulfilled') {
              expandedEntities.push(...res.value);
            }
          }

          if (expandedEntities.length > 0) {
            entities = expandedEntities;
            this.log(`Deep discovery complete. Found ${String(entities.length)} total endpoints.`);
          }
        }

      const catalog = {
        name: appId,
        baseUrl: baseUrl,
        entities: entities,
        updatedAt: new Date().toISOString()
      };

      // Save to cache
      await this.cacheStore.setApiCatalog(appId, catalog).catch((e: unknown) => {
        this.log(`Failed to cache API catalog: ${e instanceof Error ? e.message : String(e)}`);
      });

      this.log(`Sending catalog to Webview with ${String(entities.length)} entities`);
      void panel.webview.postMessage({
        type: 'sapTools.apis.catalogLoaded',
        payload: {
          ...catalog,
          isBackgroundUpdate: cachedCatalog !== null
        }
      });

    } catch (e) {
      this.log(`Error loading API data for ${appId}: ${String(e)}`);
      void panel.webview.postMessage({
        type: 'sapTools.apis.error',
        payload: { message: e instanceof Error ? e.message : String(e) }
      });
    }
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
              status: '200 OK',
              time: 42,
              data: { value: [{ MockData: "Test success from mock execution" }] }
            }
          });
        }, 100);
        return;
      }

      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };
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

      if (payload.body !== undefined && payload.body.trim().length > 0) {
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
