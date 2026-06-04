// cspell:words guid appname logsloaded logsappend logsstreamstate logserror fetchlogs appsupdate copylog gorouter routererror
import * as vscode from 'vscode';
import {
  fetchRecentAppLogsFromTarget,
  prepareCfCliSession,
  spawnAppLogStreamFromTarget,
} from './cfClient';
import type { CfLogStreamHandle } from './cfClient';

export const CF_LOGS_VIEW_ID = 'sapTools.cfLogsView';

const SCOPE_UPDATE_MESSAGE_TYPE = 'sapTools.scopeUpdate';
const APPS_UPDATE_MESSAGE_TYPE = 'sapTools.appsUpdate';
const ACTIVE_APPS_UPDATE_MESSAGE_TYPE = 'sapTools.activeAppsUpdate';
const LOGS_LOADED_MESSAGE_TYPE = 'sapTools.logsLoaded';
const LOGS_APPEND_MESSAGE_TYPE = 'sapTools.logsAppend';
const LOGS_STREAM_STATE_MESSAGE_TYPE = 'sapTools.logsStreamState';
const LOGS_ERROR_MESSAGE_TYPE = 'sapTools.logsError';
const FETCH_LOGS_MESSAGE_TYPE = 'sapTools.fetchLogs';
const COPY_LOG_MESSAGE_TYPE = 'sapTools.copyLogMessage';
const COPY_LOG_RESULT_MESSAGE_TYPE = 'sapTools.copyLogResult';
const SAVE_COLUMN_SETTINGS_MESSAGE_TYPE = 'sapTools.saveColumnSettings';
const COLUMN_SETTINGS_INIT_MESSAGE_TYPE = 'sapTools.columnSettingsInit';
const SAVE_FONT_SIZE_SETTING_MESSAGE_TYPE = 'sapTools.saveFontSizeSetting';
const FONT_SIZE_SETTING_INIT_MESSAGE_TYPE = 'sapTools.fontSizeSettingInit';
const SAVE_LOG_LIMIT_SETTING_MESSAGE_TYPE = 'sapTools.saveLogLimitSetting';
const LOG_LIMIT_SETTING_INIT_MESSAGE_TYPE = 'sapTools.logLimitSettingInit';
const SAVE_MESSAGE_HEIGHT_LIMIT_SETTING_MESSAGE_TYPE = 'sapTools.saveMessageHeightLimitSetting';
const MESSAGE_HEIGHT_LIMIT_SETTING_INIT_MESSAGE_TYPE = 'sapTools.messageHeightLimitSettingInit';

const COLUMN_SETTINGS_GLOBAL_STATE_KEY = 'cfLogsPanel.visibleColumns';
const FONT_SIZE_SETTING_GLOBAL_STATE_KEY = 'cfLogsPanel.fontSizePreset';
const LOG_LIMIT_SETTING_GLOBAL_STATE_KEY = 'cfLogsPanel.logLimit';
const MESSAGE_HEIGHT_LIMIT_SETTING_GLOBAL_STATE_KEY = 'cfLogsPanel.limitMessageHeight';
const ALL_COLUMN_IDS = [
  'time',
  'level',
  'method',
  'request',
  'status',
  'latency',
  'tenant',
  'clientIp',
  'requestId',
  'logger',
  'source',
  'stream',
  'message',
] as const;
const REQUIRED_COLUMN_IDS = ['time', 'request'] as const;
const DEFAULT_VISIBLE_COLUMN_IDS = ['time', 'level', 'method', 'request', 'status', 'latency'] as const;
const FONT_SIZE_PRESETS = ['smaller', 'default', 'large', 'xlarge'] as const;
const DEFAULT_FONT_SIZE_PRESET = 'default';
const LOG_LIMIT_PRESETS = [300, 500, 1000, 3000] as const;
const DEFAULT_LOG_LIMIT = 300;
const DEFAULT_LIMIT_MESSAGE_HEIGHT = false;

const STREAM_BATCH_FLUSH_MS = 150;
const STREAM_RETRY_INITIAL_MS = 1_000;
const STREAM_RETRY_MAX_MS = 20_000;

/**
 * A freshly spawned `cf logs` stream occasionally emits CF CLI "session not
 * ready" errors (No org targeted / Not logged in / app not found) when the
 * shared CF config was still being prepared. Within this grace window — and
 * before the stream has produced any real log output — those lines are
 * suppressed and the session is re-prepared instead of being shown to the user.
 */
const SESSION_HEAL_GRACE_MS = 6_000;
const MAX_SESSION_RECOVERIES = 3;

/** CF CLI messages that mean the shared session/target was not ready yet. */
const CF_SESSION_NOT_READY_PATTERNS: readonly RegExp[] = [
  /no org targeted/i,
  /no org and space targeted/i,
  /no space targeted/i,
  /not logged in/i,
  /use '?cf login'?/i,
  /app '[^']*' not found/i,
  /no api endpoint set/i,
];

/* cspell:disable */
const TEST_MODE_SAMPLE_LOGS = `Retrieving logs for app finance-uat-api in org finance-services-prod / space uat as developer@example.com...

2026-04-12T09:14:31.73+0700 [CELL/0] OUT Cell 91130a14 stopping instance 13af001e
2026-04-12T09:14:32.19+0700 [API/2] OUT Restarted app with guid 8a45de1d
2026-04-12T09:14:32.26+0700 [CELL/0] OUT Cell d436706e creating container for instance 6eb35470
2026-04-12T09:14:43.98+0700 [CELL/0] OUT Cell d436706e successfully created container for instance 6eb35470
2026-04-12T09:14:44.55+0700 [APP/PROC/WEB/0] ERR npm warn Unknown project config "always-auth".
2026-04-12T09:14:44.73+0700 [APP/PROC/WEB/0] OUT > finance-uat-api@0.0.0 start
2026-04-12T09:14:44.73+0700 [APP/PROC/WEB/0] OUT > cds-serve -p gen/srv
2026-04-12T09:14:45.25+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"NodeCacheStrategy","timestamp":"2026-04-12T02:14:45.255Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"NodeCacheStrategy initialized","type":"log"}
2026-04-12T09:14:45.25+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"CacheService","timestamp":"2026-04-12T02:14:45.256Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"CacheService initialized with strategy: NodeCacheStrategy","type":"log"}
2026-04-12T09:14:47.26+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","timestamp":"2026-04-12T02:14:47.260Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"loaded model from 1 file(s)","type":"log"}
2026-04-12T09:14:47.90+0700 [APP/PROC/WEB/0] OUT {"level":"warn","logger":"cds","timestamp":"2026-04-12T02:14:47.904Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"using auth strategy jwt with fallback mode","type":"log"}
2026-04-12T09:14:47.95+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","timestamp":"2026-04-12T02:14:47.953Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"server listening on http://localhost:8080","type":"log"}
2026-04-12T09:14:47.95+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"cds","timestamp":"2026-04-12T02:14:47.953Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"database retry exhausted on startup","type":"log"}
2026-05-11T18:20:17.84+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"SyntheticBatchJob - runSyntheticBatch","correlation_id":"synthetic-correlation-001","remote_user":"sample-user","timestamp":"2026-05-11T11:20:17.839Z","layer":"cds","component_type":"application","container_id":"192.0.2.10","component_id":"00000000-0000-4000-8000-000000000001","component_name":"synthetic-cap-service","component_instance":0,"source_instance":0,"organization_name":"synthetic-org","organization_id":"00000000-0000-4000-8000-000000000002","space_name":"sandbox","space_id":"00000000-0000-4000-8000-000000000003","msg":"{\n refID: 'synthetic-ref-001',\n batchID: 997,\n concurrencyLimit: 5\n}","type":"log"}
2026-05-11T18:22:00.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"SyntheticRemoteService","msg":"{\"statusCode\":502,\"reason\":{\"message\":\"\",\"name\":\"Error\",\"request\":{\"method\":\"POST\",\"url\":\"http://example.test:44300/odata/v1/SyntheticEntities\"},\"response\":{\"status\":503,\"statusText\":\"Service Unavailable\"}}}","type":"log"}
2026-05-11T18:22:01.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"SyntheticValidationRunner","msg":"{\n  name: 'syntheticValidationRun - [Info] Sample validation message',\n  error: Error: Error during request to remote service: synthetic-validation-marker\n      at module.exports.run (/srv/node_modules/@sap/cds/runtime/remote/utils/client.js:196:31),\n    statusCode: 502,\n    code: 'ERR_BAD_REQUEST'\n}","type":"log"}
2026-05-11T18:22:02.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"cds","msg":"400 - Error: Synthetic escaped character in JSON at position 81\n    at SyntheticActionHandler.executeSyntheticAction (/srv/srv/handlers/SyntheticAction.handler.ts:49:18) {\n  code: '400'\n}","type":"log"}
2026-05-13T16:51:41.16+0700 [APP/PROC/WEB/0] OUT {"level":"debug","logger":"remote","tenant_id":"tenant-remote-sample","x_cf_true_client_ip":"192.0.2.44","request_id":"1758b535-a6bc-4eee-5261-bf740494e2e","x_correlation_id":"1758b535-a6bc-4eee-5261-bf740494e2e","msg":"get <srv_process_system>/systemprocessservice/requesttaskeventdata?$top=1&$select=deepdata,reqid,mdglogid&$filter=mdglogid%20eq%20'a1db2b12-16d3-43e5-b73d-35744eb1e2e' {\n  headers: {\n    accept: 'application/json,text/plain',\n    authorization: 'bearer ***'\n  }\n}","type":"log"}
2026-04-12T09:14:48.20+0700 [RTR/0] OUT finance-uat-api.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.200Z] "GET /rtr-health-check HTTP/1.1" 200 42 10 "-" "probe/1.0" "10.0.1.1:1001" "10.0.2.1:2001" x_forwarded_for:"1.2.3.4" x_forwarded_proto:"https" vcap_request_id:"rtr-req-001" response_time:0.001 gorouter_time:0.000010 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_b3_traceid:"aabbccdd" x_b3_spanid:"aabbccdd" b3:"aabbccdd-aabbccdd"
2026-04-12T09:14:48.25+0700 [RTR/0] OUT finance-uat-api.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.250Z] "GET /rtr-not-found HTTP/1.1" 404 80 10 "-" "curl/7.88.1" "10.0.1.2:1002" "10.0.2.2:2002" x_forwarded_for:"1.2.3.5" x_forwarded_proto:"https" vcap_request_id:"rtr-req-002" response_time:0.000 gorouter_time:0.000009 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_b3_traceid:"bbccddee" x_b3_spanid:"bbccddee" b3:"bbccddee-bbccddee"
2026-04-12T09:14:48.30+0700 [RTR/0] OUT finance-uat-api.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.300Z] "POST /rtr-upstream-fail HTTP/1.1" 500 120 10 "-" "axios/1.0.0" "10.0.1.3:1003" "10.0.2.3:2003" x_forwarded_for:"1.2.3.6" x_forwarded_proto:"https" vcap_request_id:"rtr-req-003" response_time:0.123 gorouter_time:0.000011 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_b3_traceid:"ccddeeff" x_b3_spanid:"ccddeeff" b3:"ccddeeff-ccddeeff"
Failed to retrieve logs from Log Cache: unexpected status code 404
Failed to retrieve logs from Log Cache: unexpected status code 404
Failed to retrieve logs from Log Cache: unexpected status code 404`;
/* cspell:enable */

/**
 * CF session context needed by the logs panel to fetch real logs via CF CLI.
 */
export interface LogSessionParams {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir: string;
}

interface CfAppEntry {
  readonly id: string;
  readonly name: string;
  readonly runningInstances: number;
}

interface PendingAppsUpdate {
  readonly apps: CfAppEntry[];
  readonly sessionParams: LogSessionParams | null;
}

type StreamStateStatus = 'starting' | 'streaming' | 'reconnecting' | 'stopped' | 'error';

interface AppStreamRuntime {
  readonly appName: string;
  readonly token: number;
  readonly handle: CfLogStreamHandle;
  readonly startedAt: number;
  lineRemainder: string;
  lineBuffer: string[];
  flushTimer: NodeJS.Timeout | null;
  stoppedByRequest: boolean;
  healthy: boolean;
  sawSessionError: boolean;
}

export class CfLogsPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private sessionParams: LogSessionParams | null = null;
  private pendingAppsUpdate: PendingAppsUpdate | null = null;
  private pendingScope: string | null = null;
  private pendingActiveAppNames: string[] = [];
  private availableAppNames = new Set<string>();
  private readonly runningStreams = new Map<string, AppStreamRuntime>();
  private readonly pendingStarts = new Set<string>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly reconnectDelays = new Map<string, number>();
  private readonly sessionRecoveryCounts = new Map<string, number>();
  private preparedFetchToken = -1;
  private preparingFetchToken: number | null = null;
  private prepareSessionPromise: Promise<void> | null = null;
  private fetchToken = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    const assetsRoot = vscode.Uri.joinPath(
      this.extensionContext.extensionUri,
      'docs',
      'designs',
      'prototypes',
      'assets'
    );

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [assetsRoot],
    };

    const nonce = createNonce();
    const scriptUri = vscode.Uri.joinPath(assetsRoot, 'cf-logs-panel.js');
    const cssUri = vscode.Uri.joinPath(assetsRoot, 'cf-logs-panel.css');
    webviewView.webview.html = this.buildWebviewHtml(webviewView.webview, nonce, scriptUri, cssUri);

    // Listen for messages from the webview (e.g. fetch-logs requests).
    const messageSubscription = webviewView.webview.onDidReceiveMessage(
      (message: unknown): void => {
        void this.handleWebviewMessage(message);
      }
    );
    this.disposables.push(messageSubscription);

    const savedColumns = this.extensionContext.globalState.get<unknown>(
      COLUMN_SETTINGS_GLOBAL_STATE_KEY
    );
    const normalizedColumns = Array.isArray(savedColumns)
      ? normalizeVisibleColumns(extractStringColumns(savedColumns))
      : [...DEFAULT_VISIBLE_COLUMN_IDS];
    void webviewView.webview.postMessage({
      type: COLUMN_SETTINGS_INIT_MESSAGE_TYPE,
      visibleColumns: normalizedColumns,
    });

    const savedFontSizePreset = this.extensionContext.globalState.get<unknown>(
      FONT_SIZE_SETTING_GLOBAL_STATE_KEY
    );
    const normalizedFontSizePreset =
      typeof savedFontSizePreset === 'string' && isKnownFontSizePreset(savedFontSizePreset)
        ? savedFontSizePreset
        : DEFAULT_FONT_SIZE_PRESET;
    void webviewView.webview.postMessage({
      type: FONT_SIZE_SETTING_INIT_MESSAGE_TYPE,
      fontSizePreset: normalizedFontSizePreset,
    });

    const savedLogLimit = this.extensionContext.globalState.get<unknown>(
      LOG_LIMIT_SETTING_GLOBAL_STATE_KEY
    );
    const normalizedLogLimit =
      typeof savedLogLimit === 'number' && isKnownLogLimit(savedLogLimit)
        ? savedLogLimit
        : DEFAULT_LOG_LIMIT;
    void webviewView.webview.postMessage({
      type: LOG_LIMIT_SETTING_INIT_MESSAGE_TYPE,
      logLimit: normalizedLogLimit,
    });

    const savedLimitMessageHeight = this.extensionContext.globalState.get<unknown>(
      MESSAGE_HEIGHT_LIMIT_SETTING_GLOBAL_STATE_KEY
    );
    const normalizedLimitMessageHeight =
      typeof savedLimitMessageHeight === 'boolean'
        ? savedLimitMessageHeight
        : DEFAULT_LIMIT_MESSAGE_HEIGHT;
    void webviewView.webview.postMessage({
      type: MESSAGE_HEIGHT_LIMIT_SETTING_INIT_MESSAGE_TYPE,
      limitMessageHeight: normalizedLimitMessageHeight,
    });

    // Replay scope and apps that arrived before this view was initialized.
    if (this.pendingScope !== null) {
      void webviewView.webview.postMessage({
        type: SCOPE_UPDATE_MESSAGE_TYPE,
        scope: this.pendingScope,
      });
    }
    if (this.pendingAppsUpdate !== null) {
      const { apps, sessionParams } = this.pendingAppsUpdate;
      this.doUpdateApps(apps, sessionParams);
    }
    this.doUpdateActiveApps(this.pendingActiveAppNames);
  }

  /**
   * Focus the CF logs panel in the bottom VSCode panel area.
   */
  focus(): void {
    void vscode.commands.executeCommand(`${CF_LOGS_VIEW_ID}.focus`);
  }

  /**
   * Send a scope label to the panel webview so it can update its header.
   * Stored for replay when the view is opened after the scope has been set.
   * Format: "region-code → org-name → space-name"
   */
  updateScope(scopeLabel: string): void {
    this.pendingScope = scopeLabel;
    void this.webviewView?.webview.postMessage({
      type: SCOPE_UPDATE_MESSAGE_TYPE,
      scope: scopeLabel,
    });
  }

  /**
   * Notify the panel of the available apps and store the session context
   * needed for log fetching. Replays automatically when the view is opened
   * later (i.e. if the panel was closed during space selection).
   */
  updateApps(apps: CfAppEntry[], sessionParams: LogSessionParams | null): void {
    this.pendingAppsUpdate = { apps, sessionParams };
    this.availableAppNames = new Set(apps.map((app) => app.name));
    this.pendingActiveAppNames = this.filterActiveAppNames(this.pendingActiveAppNames, apps);
    this.stopAllStreams();
    this.doUpdateApps(apps, sessionParams);
    this.doUpdateActiveApps(this.pendingActiveAppNames);
    void this.syncStreamsToActiveApps();
  }

  /**
   * Sync active logging apps coming from the sidebar workspace.
   * The list is normalized and filtered against currently available app names.
   */
  updateActiveApps(appNames: string[]): void {
    const normalized = this.normalizeAppNames(appNames);
    const availableApps = this.pendingAppsUpdate?.apps ?? null;
    this.pendingActiveAppNames = this.filterActiveAppNames(normalized, availableApps);
    this.doUpdateActiveApps(this.pendingActiveAppNames);
    void this.syncStreamsToActiveApps();
  }

  dispose(): void {
    this.stopAllStreams();
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private doUpdateApps(apps: CfAppEntry[], sessionParams: LogSessionParams | null): void {
    this.fetchToken += 1;
    this.sessionParams = sessionParams;
    // Invalidate the prepared session for the new scope, but keep any in-flight
    // prepare referenced: a concurrent `ensureCliPrepared` then chains behind it
    // instead of launching a second `prepareCfCliSession` that would race on the
    // shared CF config. The stale prepare simply won't mark the new token ready.
    this.preparedFetchToken = -1;
    const selectedApp = this.resolvePreferredSelectedApp(apps);
    void this.webviewView?.webview.postMessage({
      type: APPS_UPDATE_MESSAGE_TYPE,
      apps,
      selectedApp,
    });
  }

  private doUpdateActiveApps(appNames: string[]): void {
    void this.webviewView?.webview.postMessage({
      type: ACTIVE_APPS_UPDATE_MESSAGE_TYPE,
      appNames,
    });
  }

  private resolvePreferredSelectedApp(apps: CfAppEntry[]): string {
    const appNameSet = new Set(apps.map((app) => app.name));
    for (const appName of this.pendingActiveAppNames) {
      if (appNameSet.has(appName)) {
        return appName;
      }
    }
    return apps[0]?.name ?? '';
  }

  private normalizeAppNames(appNames: string[]): string[] {
    const uniqueNames = new Set<string>();
    const normalizedNames: string[] = [];

    for (const appName of appNames) {
      const normalized = appName.trim();
      if (normalized.length === 0 || normalized.length > 128 || uniqueNames.has(normalized)) {
        continue;
      }
      uniqueNames.add(normalized);
      normalizedNames.push(normalized);
    }

    return normalizedNames;
  }

  private filterActiveAppNames(
    appNames: string[],
    availableApps: CfAppEntry[] | null
  ): string[] {
    if (availableApps === null) {
      return appNames;
    }

    if (availableApps.length === 0) {
      return [];
    }

    const availableNameSet = new Set(availableApps.map((app) => app.name));
    return appNames.filter((appName) => availableNameSet.has(appName));
  }

  private async syncStreamsToActiveApps(): Promise<void> {
    for (const appName of this.reconnectTimers.keys()) {
      if (!this.pendingActiveAppNames.includes(appName)) {
        this.clearReconnectTimer(appName);
        this.reconnectDelays.delete(appName);
      }
    }

    for (const [appName] of this.runningStreams) {
      if (!this.pendingActiveAppNames.includes(appName)) {
        this.stopStream(appName, true);
      }
    }

    for (const appName of this.pendingActiveAppNames) {
      await this.startStreamIfNeeded(appName);
    }
  }

  private async startStreamIfNeeded(appName: string): Promise<void> {
    if (!this.availableAppNames.has(appName)) {
      return;
    }
    if (this.runningStreams.has(appName) || this.pendingStarts.has(appName)) {
      return;
    }
    const params = this.sessionParams;
    const expectedFetchToken = this.fetchToken;
    if (params === null || isTestMode()) {
      return;
    }

    this.clearReconnectTimer(appName);
    this.pendingStarts.add(appName);
    this.postStreamState(appName, 'starting');

    try {
      await this.ensureCliPrepared(params, expectedFetchToken);
      if (!this.pendingActiveAppNames.includes(appName)) {
        this.postStreamState(appName, 'stopped');
        return;
      }
      if (this.fetchToken !== expectedFetchToken) {
        return;
      }
      this.createAndStartStream(appName, params, expectedFetchToken);
      this.reconnectDelays.delete(appName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start log stream.';
      this.postStreamState(appName, 'error', message);
      this.scheduleStreamReconnect(appName, this.getNextReconnectDelay(appName));
    } finally {
      this.pendingStarts.delete(appName);
    }
  }

  private async ensureCliPrepared(
    params: LogSessionParams,
    expectedFetchToken: number
  ): Promise<void> {
    if (this.preparedFetchToken === expectedFetchToken) {
      return;
    }
    if (
      this.prepareSessionPromise !== null &&
      this.preparingFetchToken === expectedFetchToken
    ) {
      await this.prepareSessionPromise;
      return;
    }

    if (this.prepareSessionPromise !== null) {
      await this.prepareSessionPromise.catch(() => undefined);
      if (this.preparedFetchToken === expectedFetchToken) {
        return;
      }
    }

    const preparePromise = prepareCfCliSession({
      apiEndpoint: params.apiEndpoint,
      email: params.email,
      password: params.password,
      orgName: params.orgName,
      spaceName: params.spaceName,
      cfHomeDir: params.cfHomeDir,
    });
    this.prepareSessionPromise = preparePromise;
    this.preparingFetchToken = expectedFetchToken;

    try {
      await preparePromise;
      if (this.fetchToken === expectedFetchToken) {
        this.preparedFetchToken = expectedFetchToken;
      }
    } finally {
      if (this.prepareSessionPromise === preparePromise) {
        this.prepareSessionPromise = null;
        this.preparingFetchToken = null;
      }
    }

    if (this.preparedFetchToken !== expectedFetchToken) {
      throw new Error('CF scope changed while preparing stream session.');
    }
  }

  private createAndStartStream(
    appName: string,
    params: LogSessionParams,
    expectedFetchToken: number
  ): void {
    const handle = spawnAppLogStreamFromTarget({
      appName,
      cfHomeDir: params.cfHomeDir,
    });

    const stream: AppStreamRuntime = {
      appName,
      token: expectedFetchToken,
      handle,
      startedAt: Date.now(),
      lineRemainder: '',
      lineBuffer: [],
      flushTimer: null,
      stoppedByRequest: false,
      healthy: false,
      sawSessionError: false,
    };
    this.runningStreams.set(appName, stream);
    this.attachStreamListeners(stream);
    this.postStreamState(appName, 'streaming');
  }

  private attachStreamListeners(stream: AppStreamRuntime): void {
    stream.handle.process.stdout.on('data', (chunk: Buffer): void => {
      this.handleStreamChunk(stream, chunk.toString('utf8'));
    });

    stream.handle.process.stderr.on('data', (chunk: Buffer): void => {
      this.handleStreamChunk(stream, chunk.toString('utf8'));
    });

    stream.handle.process.on('exit', (code: number | null, signal: NodeJS.Signals | null): void => {
      this.handleStreamExit(stream, code, signal);
    });

    stream.handle.process.on('error', (error: Error): void => {
      this.handleStreamError(stream, error);
    });
  }

  private handleStreamChunk(stream: AppStreamRuntime, chunkText: string): void {
    const { lines, remainder } = splitLinesWithRemainder(stream.lineRemainder, chunkText);
    stream.lineRemainder = remainder;
    if (lines.length === 0) {
      return;
    }

    const visibleLines = this.filterSessionNotReadyLines(stream, lines);
    if (visibleLines.length === 0) {
      return;
    }

    const sanitizedLines = visibleLines.map((line) => this.sanitizeLineForUi(line));
    stream.lineBuffer.push(...sanitizedLines);

    if (stream.flushTimer !== null) {
      return;
    }

    stream.flushTimer = setTimeout(() => {
      this.flushStreamLines(stream.appName);
    }, STREAM_BATCH_FLUSH_MS);
  }

  /**
   * Suppress the CF CLI "session not ready" lines that a just-started stream can
   * emit before the shared CF config is fully prepared. Once a real log line
   * arrives (or the grace window elapses) the stream is considered healthy and
   * every line passes through untouched. After the recovery budget is spent the
   * lines are shown so a genuine problem (e.g. a deleted app) still surfaces.
   */
  private filterSessionNotReadyLines(stream: AppStreamRuntime, lines: string[]): string[] {
    if (stream.healthy || this.sessionHealAttemptsExhausted(stream.appName)) {
      return lines;
    }
    if (Date.now() - stream.startedAt > SESSION_HEAL_GRACE_MS) {
      this.markStreamHealthy(stream);
      return lines;
    }

    const visible: string[] = [];
    for (const line of lines) {
      if (isCfSessionNotReadyLine(line)) {
        stream.sawSessionError = true;
        continue;
      }
      if (stream.sawSessionError && isCfCliFailedMarkerLine(line)) {
        continue;
      }
      if (line.trim().length > 0 && !isCfCliFailedMarkerLine(line)) {
        this.markStreamHealthy(stream);
      }
      visible.push(line);
    }
    return visible;
  }

  private markStreamHealthy(stream: AppStreamRuntime): void {
    stream.healthy = true;
    this.sessionRecoveryCounts.delete(stream.appName);
  }

  private sessionHealAttemptsExhausted(appName: string): boolean {
    return (this.sessionRecoveryCounts.get(appName) ?? 0) >= MAX_SESSION_RECOVERIES;
  }

  /**
   * When a stream exited without ever producing real output but did emit CF
   * session errors, the shared config was not ready. Invalidate the prepared
   * token so the reconnect re-runs `cf auth`/`cf target` first. Bounded so a
   * persistently failing app eventually surfaces its error instead of looping.
   */
  private maybeRecoverSessionBeforeReconnect(stream: AppStreamRuntime): boolean {
    if (stream.healthy || !stream.sawSessionError) {
      return false;
    }
    const attempts = this.sessionRecoveryCounts.get(stream.appName) ?? 0;
    if (attempts >= MAX_SESSION_RECOVERIES) {
      return false;
    }
    this.sessionRecoveryCounts.set(stream.appName, attempts + 1);
    this.preparedFetchToken = -1;
    return true;
  }

  private flushStreamLines(appName: string): void {
    const stream = this.runningStreams.get(appName);
    if (stream === undefined) {
      return;
    }
    this.flushStreamBuffer(stream);
  }

  private handleStreamExit(
    stream: AppStreamRuntime,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const active = this.runningStreams.get(stream.appName);
    if (active !== stream) {
      return;
    }

    this.flushStreamBuffer(stream);
    this.clearStreamTimers(stream);
    this.runningStreams.delete(stream.appName);

    const shouldReconnect =
      !stream.stoppedByRequest &&
      this.pendingActiveAppNames.includes(stream.appName) &&
      stream.token === this.fetchToken;

    if (!shouldReconnect) {
      this.postStreamState(stream.appName, 'stopped');
      return;
    }

    if (this.maybeRecoverSessionBeforeReconnect(stream)) {
      this.postStreamState(stream.appName, 'reconnecting', 'Preparing CF session…');
      this.scheduleStreamReconnect(stream.appName, STREAM_RETRY_INITIAL_MS);
      return;
    }

    const reason = `Stream exited (${String(code ?? '')}${signal !== null ? ` ${signal}` : ''}).`;
    this.postStreamState(stream.appName, 'reconnecting', reason);
    this.scheduleStreamReconnect(stream.appName, this.getNextReconnectDelay(stream.appName));
  }

  private handleStreamError(stream: AppStreamRuntime, error: Error): void {
    const active = this.runningStreams.get(stream.appName);
    if (active !== stream) {
      return;
    }

    this.flushStreamBuffer(stream);
    this.clearStreamTimers(stream);
    this.runningStreams.delete(stream.appName);

    const shouldReconnect =
      !stream.stoppedByRequest &&
      this.pendingActiveAppNames.includes(stream.appName) &&
      stream.token === this.fetchToken;

    if (!shouldReconnect) {
      this.postStreamState(stream.appName, 'stopped');
      return;
    }

    const reason = error.message.trim().length > 0 ? error.message.trim() : 'Stream process error.';
    this.postStreamState(stream.appName, 'error', reason);
    this.scheduleStreamReconnect(stream.appName, this.getNextReconnectDelay(stream.appName));
  }

  private scheduleStreamReconnect(appName: string, delayMs: number): void {
    if (!this.pendingActiveAppNames.includes(appName)) {
      return;
    }
    if (this.runningStreams.has(appName)) {
      return;
    }
    if (this.reconnectTimers.has(appName)) {
      return;
    }

    const delay = Math.min(Math.max(delayMs, STREAM_RETRY_INITIAL_MS), STREAM_RETRY_MAX_MS);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(appName);
      void this.startStreamIfNeeded(appName);
    }, delay);
    this.reconnectTimers.set(appName, timer);
    this.postStreamState(appName, 'reconnecting', `Retrying in ${String(delay)} ms.`);
  }

  private stopAllStreams(notify = false): void {
    for (const [appName] of this.runningStreams) {
      this.stopStream(appName, notify);
    }
    for (const appName of this.reconnectTimers.keys()) {
      this.clearReconnectTimer(appName);
    }
    this.reconnectDelays.clear();
    this.pendingStarts.clear();
    this.sessionRecoveryCounts.clear();
  }

  private stopStream(appName: string, notify: boolean): void {
    const stream = this.runningStreams.get(appName);
    if (stream === undefined) {
      return;
    }

    stream.stoppedByRequest = true;
    this.clearStreamTimers(stream);
    this.clearReconnectTimer(appName);
    this.reconnectDelays.delete(appName);
    this.sessionRecoveryCounts.delete(appName);
    this.detachStreamListeners(stream);
    stream.handle.stop();
    this.runningStreams.delete(appName);

    if (notify) {
      this.postStreamState(appName, 'stopped');
    }
  }

  private detachStreamListeners(stream: AppStreamRuntime): void {
    stream.handle.process.stdout.removeAllListeners('data');
    stream.handle.process.stderr.removeAllListeners('data');
    stream.handle.process.removeAllListeners();
  }

  private clearStreamTimers(stream: AppStreamRuntime): void {
    if (stream.flushTimer !== null) {
      clearTimeout(stream.flushTimer);
      stream.flushTimer = null;
    }
  }

  private clearReconnectTimer(appName: string): void {
    const timer = this.reconnectTimers.get(appName);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.reconnectTimers.delete(appName);
    }
  }

  private getNextReconnectDelay(appName: string): number {
    const current = this.reconnectDelays.get(appName) ?? STREAM_RETRY_INITIAL_MS;
    const next = Math.min(current * 2, STREAM_RETRY_MAX_MS);
    this.reconnectDelays.set(appName, next);
    return current;
  }

  private flushStreamBuffer(stream: AppStreamRuntime): void {
    if (stream.flushTimer !== null) {
      clearTimeout(stream.flushTimer);
      stream.flushTimer = null;
    }

    if (stream.lineRemainder.length > 0) {
      stream.lineBuffer.push(this.sanitizeLineForUi(stream.lineRemainder));
      stream.lineRemainder = '';
    }

    if (stream.lineBuffer.length === 0) {
      return;
    }

    const lines = [...stream.lineBuffer];
    stream.lineBuffer = [];
    this.postAppendedLines(stream.appName, lines);
  }

  private sanitizeLineForUi(line: string): string {
    const params = this.sessionParams;
    if (params === null) {
      return line;
    }

    let output = line;
    if (params.password.length > 0) {
      output = output.split(params.password).join('***');
    }
    if (params.email.length > 0) {
      output = output.split(params.email).join('***');
    }
    return output;
  }

  private postAppendedLines(appName: string, lines: string[]): void {
    if (lines.length === 0) {
      return;
    }

    void this.webviewView?.webview.postMessage({
      type: LOGS_APPEND_MESSAGE_TYPE,
      appName,
      lines,
    });
  }

  private postStreamState(appName: string, status: StreamStateStatus, message?: string): void {
    void this.webviewView?.webview.postMessage({
      type: LOGS_STREAM_STATE_MESSAGE_TYPE,
      appName,
      status,
      message,
    });
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isRecord(message)) {
      return;
    }

    if (
      message['type'] === COPY_LOG_MESSAGE_TYPE &&
      typeof message['requestId'] === 'number' &&
      Number.isInteger(message['requestId']) &&
      message['requestId'] > 0 &&
      typeof message['text'] === 'string' &&
      message['text'].length > 0 &&
      message['text'].length <= 500_000
    ) {
      await this.copyLogMessageToClipboard(message['requestId'], message['text']);
      return;
    }

    if (
      message['type'] === FETCH_LOGS_MESSAGE_TYPE &&
      typeof message['appName'] === 'string' &&
      message['appName'].trim().length > 0 &&
      message['appName'].trim().length <= 128 &&
      typeof message['requestId'] === 'number'
    ) {
      await this.fetchAndSendLogs(message['appName'].trim(), message['requestId']);
      return;
    }

    if (
      message['type'] === SAVE_COLUMN_SETTINGS_MESSAGE_TYPE &&
      Array.isArray(message['visibleColumns'])
    ) {
      const columns = extractStringColumns(message['visibleColumns']);
      const normalizedColumns = normalizeVisibleColumns(columns);
      await this.extensionContext.globalState.update(
        COLUMN_SETTINGS_GLOBAL_STATE_KEY,
        normalizedColumns
      );
      return;
    }

    if (
      message['type'] === SAVE_FONT_SIZE_SETTING_MESSAGE_TYPE &&
      typeof message['fontSizePreset'] === 'string' &&
      isKnownFontSizePreset(message['fontSizePreset'])
    ) {
      await this.extensionContext.globalState.update(
        FONT_SIZE_SETTING_GLOBAL_STATE_KEY,
        message['fontSizePreset']
      );
      return;
    }

    if (
      message['type'] === SAVE_LOG_LIMIT_SETTING_MESSAGE_TYPE &&
      typeof message['logLimit'] === 'number' &&
      isKnownLogLimit(message['logLimit'])
    ) {
      await this.extensionContext.globalState.update(
        LOG_LIMIT_SETTING_GLOBAL_STATE_KEY,
        message['logLimit']
      );
    }

    if (
      message['type'] === SAVE_MESSAGE_HEIGHT_LIMIT_SETTING_MESSAGE_TYPE &&
      typeof message['limitMessageHeight'] === 'boolean'
    ) {
      await this.extensionContext.globalState.update(
        MESSAGE_HEIGHT_LIMIT_SETTING_GLOBAL_STATE_KEY,
        message['limitMessageHeight']
      );
    }
  }

  private async copyLogMessageToClipboard(requestId: number, text: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
      this.postCopyLogResult(requestId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy log message.';
      this.postCopyLogResult(requestId, false, message);
    }
  }

  private postCopyLogResult(requestId: number, success: boolean, message?: string): void {
    void this.webviewView?.webview.postMessage({
      type: COPY_LOG_RESULT_MESSAGE_TYPE,
      requestId,
      success,
      message,
    });
  }

  private async fetchAndSendLogs(appName: string, requestId: number): Promise<void> {
    // Capture token at the start; if doUpdateApps increments it before we respond,
    // the scope has changed and this response must be discarded.
    const myToken = this.fetchToken;

    if (isTestMode()) {
      void this.webviewView?.webview.postMessage({
        type: LOGS_LOADED_MESSAGE_TYPE,
        appName,
        requestId,
        logText: TEST_MODE_SAMPLE_LOGS,
      });
      return;
    }

    if (this.sessionParams === null) {
      if (this.fetchToken !== myToken) {
        return;
      }
      void this.webviewView?.webview.postMessage({
        type: LOGS_ERROR_MESSAGE_TYPE,
        appName,
        requestId,
        message: 'No CF session available. Select a space in the SAP Tools sidebar first.',
      });
      return;
    }

    const params = this.sessionParams;

    try {
      const logText = await this.fetchLogsWithPreparedSession(params, appName, myToken);

      // Discard if a scope change arrived while this fetch was in flight.
      if (this.fetchToken !== myToken) {
        return;
      }

      void this.webviewView?.webview.postMessage({
        type: LOGS_LOADED_MESSAGE_TYPE,
        appName,
        requestId,
        logText,
      });
    } catch (error) {
      if (this.fetchToken !== myToken) {
        return;
      }
      const msg = error instanceof Error ? error.message : 'Failed to fetch logs.';
      void this.webviewView?.webview.postMessage({
        type: LOGS_ERROR_MESSAGE_TYPE,
        appName,
        requestId,
        message: msg,
      });
    }
  }

  private async fetchLogsWithPreparedSession(
    params: LogSessionParams,
    appName: string,
    expectedFetchToken: number
  ): Promise<string> {
    await this.ensureCliPrepared(params, expectedFetchToken);

    try {
      return await fetchRecentAppLogsFromTarget({
        appName,
        cfHomeDir: params.cfHomeDir,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!shouldRetryPreparedSession(message)) {
        throw error;
      }

      this.preparedFetchToken = -1;
      await this.ensureCliPrepared(params, expectedFetchToken);
      return fetchRecentAppLogsFromTarget({
        appName,
        cfHomeDir: params.cfHomeDir,
      });
    }
  }

  private buildWebviewHtml(
    webview: vscode.Webview,
    nonce: string,
    scriptUri: vscode.Uri,
    cssUri: vscode.Uri
  ): string {
    const scriptSrc = webview.asWebviewUri(scriptUri).toString();
    const cssSrc = webview.asWebviewUri(cssUri).toString();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join('; ');

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>CF Logs</title>
    <link rel="stylesheet" href="${cssSrc}" />
  </head>
  <body
    class="cf-logs-panel-page"
    style="margin:0;padding:0;height:100vh;min-height:100vh;display:flex;flex-direction:column;overflow:hidden;"
  >
    <section
      class="cf-logs-panel"
      aria-label="CFLogs panel content"
      style="flex:1 1 auto;min-height:0;height:100%;"
    >
      <p id="workspace-scope" class="workspace-scope" hidden></p>

      <section class="filter-inline" aria-label="CF log filters">
        <div class="filter-item filter-item-app">
          <select id="filter-app" aria-label="Select app">
            <option value="">— no apps loaded —</option>
          </select>
        </div>
        <div class="filter-item filter-item-search">
          <input
            id="filter-search"
            type="search"
            placeholder="message, logger"
            aria-label="Search logs"
          />
        </div>
        <div class="filter-item filter-item-level">
          <select id="filter-level" aria-label="Filter by level">
            <option value="all">All</option>
          </select>
        </div>
        <button
          type="button"
          class="gear-button"
          id="settings-toggle"
          aria-label="Column settings"
          aria-controls="settings-panel"
          aria-expanded="false"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3.25"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1 .33H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1 .33 1.65 1.65 0 0 0-.6 1z"></path>
          </svg>
        </button>
      </section>

      <div
        class="settings-panel"
        id="settings-panel"
        aria-hidden="true"
        hidden
      >
        <div class="settings-row">
          <span class="settings-panel-label">Columns</span>
          <div class="settings-column-toggles" id="settings-column-toggles">
          </div>
        </div>
        <div class="settings-row settings-row-font">
          <label for="settings-font-size" class="settings-panel-label">Font Size</label>
          <select id="settings-font-size" class="settings-font-size-select" aria-label="Log table font size">
            <option value="smaller">Smaller</option>
            <option value="default" selected>Default</option>
            <option value="large">Large</option>
            <option value="xlarge">Extra Large</option>
          </select>
        </div>
        <div class="settings-row settings-row-limit">
          <label for="settings-log-limit" class="settings-panel-label">Log Limit</label>
          <select
            id="settings-log-limit"
            class="settings-font-size-select settings-log-limit-select"
            aria-label="Log row limit"
          >
            <option value="300" selected>300</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
            <option value="3000">3000</option>
          </select>
        </div>
        <div class="settings-row settings-row-message-limit">
          <span class="settings-panel-label">Message</span>
          <label class="settings-column-item settings-message-limit-item" for="settings-message-limit">
            <input
              id="settings-message-limit"
              type="checkbox"
              aria-label="Limit message height"
            />
            Limit height and scroll long messages
          </label>
        </div>
      </div>

      <div
        class="table-shell"
        role="region"
        aria-label="Filtered logs table"
        style="flex:1 1 auto;min-height:0;"
      >
        <table class="cf-log-table" aria-describedby="table-summary">
          <thead id="log-table-head"><tr></tr></thead>
          <tbody id="log-table-body"></tbody>
        </table>
      </div>

      <p id="table-summary" class="table-summary" role="status" aria-live="polite"></p>
    </section>

    <div class="copy-toast" id="copy-toast" role="status" aria-live="polite" aria-atomic="true">Copied!</div>

    <script nonce="${nonce}" type="module" src="${scriptSrc}"></script>
  </body>
</html>`;
  }
}

function isTestMode(): boolean {
  return process.env['SAP_TOOLS_TEST_MODE'] === '1';
}

function isCfSessionNotReadyLine(line: string): boolean {
  return CF_SESSION_NOT_READY_PATTERNS.some((pattern) => pattern.test(line));
}

function isCfCliFailedMarkerLine(line: string): boolean {
  return line.trim().toUpperCase() === 'FAILED';
}

function shouldRetryPreparedSession(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes('not logged in') ||
    normalized.includes('cf login') ||
    normalized.includes('no org and space targeted') ||
    normalized.includes('not targeted')
  );
}

function splitLinesWithRemainder(
  existingRemainder: string,
  incomingChunk: string
): { lines: string[]; remainder: string } {
  const combined = `${existingRemainder}${incomingChunk}`;
  const parts = combined.split(/\r?\n/);
  const remainder = parts.pop() ?? '';
  const lines = parts.filter((line) => line.length > 0);
  return { lines, remainder };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractStringColumns(values: readonly unknown[]): string[] {
  return values.filter(
    (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 32
  );
}

function normalizeVisibleColumns(columnIds: readonly string[]): string[] {
  const selected = new Set<string>();

  for (const columnId of columnIds) {
    if (isKnownColumnId(columnId)) {
      selected.add(columnId);
    }
  }

  for (const requiredColumnId of REQUIRED_COLUMN_IDS) {
    selected.add(requiredColumnId);
  }

  return ALL_COLUMN_IDS.filter((columnId) => selected.has(columnId));
}

function isKnownColumnId(value: string): value is (typeof ALL_COLUMN_IDS)[number] {
  return (ALL_COLUMN_IDS as readonly string[]).includes(value);
}

function isKnownFontSizePreset(value: string): value is (typeof FONT_SIZE_PRESETS)[number] {
  return (FONT_SIZE_PRESETS as readonly string[]).includes(value);
}

function isKnownLogLimit(value: number): value is (typeof LOG_LIMIT_PRESETS)[number] {
  return (LOG_LIMIT_PRESETS as readonly number[]).includes(value);
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 24; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    nonce += alphabet[randomIndex] ?? 'A';
  }
  return nonce;
}
