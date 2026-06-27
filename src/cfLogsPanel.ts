// cspell:words guid appname logsloaded logsappend logsstreamstate logserror fetchlogs appsupdate copylog gorouter routererror cflogs filelog
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  fetchRecentAppLogsFromTarget,
  prepareCfCliSession,
  spawnAppLogStreamFromTarget,
} from './cfClient';

import {
  CF_LOGS_VIEW_ID,
  SCOPE_UPDATE_MESSAGE_TYPE,
  APPS_UPDATE_MESSAGE_TYPE,
  ACTIVE_APPS_UPDATE_MESSAGE_TYPE,
  LOGS_LOADED_MESSAGE_TYPE,
  LOGS_APPEND_MESSAGE_TYPE,
  LOGS_STREAM_STATE_MESSAGE_TYPE,
  LOGS_ERROR_MESSAGE_TYPE,
  FETCH_LOGS_MESSAGE_TYPE,
  COPY_LOG_MESSAGE_TYPE,
  COPY_LOG_RESULT_MESSAGE_TYPE,
  SAVE_COLUMN_SETTINGS_MESSAGE_TYPE,
  COLUMN_SETTINGS_INIT_MESSAGE_TYPE,
  SAVE_FONT_SIZE_SETTING_MESSAGE_TYPE,
  FONT_SIZE_SETTING_INIT_MESSAGE_TYPE,
  SAVE_LOG_LIMIT_SETTING_MESSAGE_TYPE,
  LOG_LIMIT_SETTING_INIT_MESSAGE_TYPE,
  SAVE_MESSAGE_HEIGHT_LIMIT_SETTING_MESSAGE_TYPE,
  MESSAGE_HEIGHT_LIMIT_SETTING_INIT_MESSAGE_TYPE,
  SAVE_FILE_LOG_SETTING_MESSAGE_TYPE,
  FILE_LOG_SETTING_INIT_MESSAGE_TYPE,
  COLUMN_SETTINGS_GLOBAL_STATE_KEY,
  FONT_SIZE_SETTING_GLOBAL_STATE_KEY,
  LOG_LIMIT_SETTING_GLOBAL_STATE_KEY,
  MESSAGE_HEIGHT_LIMIT_SETTING_GLOBAL_STATE_KEY,
  DEFAULT_VISIBLE_COLUMN_IDS,
  DEFAULT_FONT_SIZE_PRESET,
  DEFAULT_LOG_LIMIT,
  DEFAULT_LIMIT_MESSAGE_HEIGHT,
  STREAM_BATCH_FLUSH_MS,
  STREAM_RETRY_INITIAL_MS,
  STREAM_RETRY_MAX_MS,
  DEFAULT_FILE_LOG_MODE,
  FILE_LOG_CONFIG_SECTION,
  FILE_LOG_DIRECTORY_CONFIG_KEY,
  MAX_PAUSED_BUFFER_LINES,
  SESSION_HEAL_GRACE_MS,
  MAX_SESSION_RECOVERIES,
} from './cfLogsPanel.types';
export { CF_LOGS_VIEW_ID } from "./cfLogsPanel.types";

import type {
  LogSessionParams,
  CfAppEntry,
  PendingAppsUpdate,
  StreamStateStatus,
  FileLogWriter,
  PausedLineBuffer,
  AppStreamRuntime,
  FileLogMode,
} from './cfLogsPanel.types';

import {
  isTestMode,
  isCfSessionNotReadyLine,
  isCfCliFailedMarkerLine,
  shouldRetryPreparedSession,
  splitLinesWithRemainder,
  isRecord,
  extractStringColumns,
  normalizeVisibleColumns,
  isKnownFontSizePreset,
  isKnownFileLogMode,
  expandFileLogDirectory,
  buildUniqueLogFilePath,
  isKnownLogLimit,
  createNonce,
} from './cfLogsPanel.helpers';

import { TEST_MODE_SAMPLE_LOGS, buildWebviewHtml } from './cfLogsPanel.html';

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
  // Session-scoped on purpose: file logging always starts disabled so a fresh
  // VS Code session never silently writes log files from a previous choice.
  private fileLogMode: FileLogMode = DEFAULT_FILE_LOG_MODE;
  private readonly fileLogWriters = new Map<string, FileLogWriter>();
  private readonly fileLogFailedApps = new Set<string>();
  private pausedAppNames = new Set<string>();
  private readonly pausedLineBuffers = new Map<string, PausedLineBuffer>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event): void => {
        if (
          event.affectsConfiguration(
            `${FILE_LOG_CONFIG_SECTION}.${FILE_LOG_DIRECTORY_CONFIG_KEY}`
          )
        ) {
          // Keep the dropdown tooltip in sync; writers already open keep their
          // current file — the new folder applies to the next run.
          this.postFileLogSetting();
        }
      })
    );
  }

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
    webviewView.webview.html = buildWebviewHtml(webviewView.webview, nonce, scriptUri, cssUri);

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

    this.postFileLogSetting();

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
    // A reopened webview starts with empty stream-state caches; replay the
    // paused indicator for apps whose display is still frozen extension-side.
    for (const appName of this.pausedAppNames) {
      this.postStreamState(appName, 'paused');
    }
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
    const loggableApps = this.filterLoggableApps(apps);
    this.pendingAppsUpdate = { apps: loggableApps, sessionParams };
    this.availableAppNames = new Set(loggableApps.map((app) => app.name));
    this.pendingActiveAppNames = this.filterActiveAppNames(
      this.pendingActiveAppNames,
      loggableApps
    );
    this.prunePausedStateToActiveApps();
    this.stopAllStreams();
    this.doUpdateApps(loggableApps, sessionParams);
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
    this.prunePausedStateToActiveApps();
    this.doUpdateActiveApps(this.pendingActiveAppNames);
    void this.syncStreamsToActiveApps();
  }

  /**
   * Sync paused logging apps coming from the sidebar workspace. A paused app
   * keeps its `cf logs` session alive and its collected rows visible in the
   * panel; only the live display is frozen. New lines wait in a bounded buffer
   * (and keep flowing into the log file when file logging is on) until the app
   * is resumed or stopped.
   */
  updatePausedApps(appNames: string[]): void {
    const activeNames = new Set(this.pendingActiveAppNames);
    const requested = new Set(
      this.normalizeAppNames(appNames).filter((appName) => activeNames.has(appName))
    );
    const previous = this.pausedAppNames;
    this.pausedAppNames = requested;

    for (const appName of requested) {
      if (!previous.has(appName)) {
        this.pauseStreamOutput(appName);
      }
    }
    for (const appName of previous) {
      if (!requested.has(appName)) {
        this.resumeStreamOutput(appName);
      }
    }
  }

  dispose(): void {
    this.stopAllStreams();
    this.closeAllFileLogWriters();
    this.pausedAppNames.clear();
    this.pausedLineBuffers.clear();
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

  private filterLoggableApps(apps: CfAppEntry[]): CfAppEntry[] {
    return apps.filter(
      (app) => Number.isFinite(app.runningInstances) && app.runningInstances > 0
    );
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

    // File writers follow the logical logging session of an app (start → stop),
    // not the process lifecycle, so reconnects keep appending to the same file.
    for (const appName of [...this.fileLogWriters.keys()]) {
      if (!this.pendingActiveAppNames.includes(appName)) {
        this.closeFileLogWriter(appName);
      }
    }

    for (const appName of this.pendingActiveAppNames) {
      await this.startStreamIfNeeded(appName);
    }
  }

  private prunePausedStateToActiveApps(): void {
    const activeNames = new Set(this.pendingActiveAppNames);
    for (const appName of [...this.pausedAppNames]) {
      if (!activeNames.has(appName)) {
        this.pausedAppNames.delete(appName);
      }
    }
    for (const appName of [...this.pausedLineBuffers.keys()]) {
      if (!activeNames.has(appName)) {
        this.pausedLineBuffers.delete(appName);
      }
    }
  }

  private pauseStreamOutput(appName: string): void {
    const stream = this.runningStreams.get(appName);
    if (stream !== undefined) {
      this.clearStreamTimers(stream);
      if (stream.lineBuffer.length > 0) {
        this.appendPausedLines(appName, stream.lineBuffer);
        stream.lineBuffer = [];
      }
    }
    this.postStreamState(appName, 'paused');
  }

  private resumeStreamOutput(appName: string): void {
    const buffered = this.pausedLineBuffers.get(appName);
    this.pausedLineBuffers.delete(appName);
    const lines = buffered === undefined ? [] : [...buffered.lines];
    if (buffered !== undefined && buffered.droppedLineCount > 0) {
      lines.unshift(
        `[SAP Tools] Skipped ${String(buffered.droppedLineCount)} older line(s) while paused (display buffer limit).`
      );
    }
    this.postAppendedLines(appName, lines);

    if (this.runningStreams.has(appName) || isTestMode()) {
      this.postStreamState(appName, 'streaming');
      return;
    }
    // The stream died while paused — restart it; the start flow posts its own states.
    void this.startStreamIfNeeded(appName);
  }

  private appendPausedLines(appName: string, lines: string[]): void {
    const buffer = this.pausedLineBuffers.get(appName) ?? {
      lines: [],
      droppedLineCount: 0,
    };
    buffer.lines.push(...lines);
    if (buffer.lines.length > MAX_PAUSED_BUFFER_LINES) {
      const overflow = buffer.lines.length - MAX_PAUSED_BUFFER_LINES;
      buffer.lines.splice(0, overflow);
      buffer.droppedLineCount += overflow;
    }
    this.pausedLineBuffers.set(appName, buffer);
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
    if (this.fileLogMode === 'file') {
      this.ensureFileLogWriter(appName);
    }
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
    this.writeStreamLinesToFile(stream.appName, sanitizedLines);

    if (this.pausedAppNames.has(stream.appName)) {
      this.appendPausedLines(stream.appName, sanitizedLines);
      return;
    }

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
      // Complete chunk lines were already written at chunk time; only this
      // trailing partial line still needs to reach the log file.
      const remainderLine = this.sanitizeLineForUi(stream.lineRemainder);
      stream.lineRemainder = '';
      this.writeStreamLinesToFile(stream.appName, [remainderLine]);
      stream.lineBuffer.push(remainderLine);
    }

    if (stream.lineBuffer.length === 0) {
      return;
    }

    const lines = [...stream.lineBuffer];
    stream.lineBuffer = [];
    if (this.pausedAppNames.has(stream.appName)) {
      this.appendPausedLines(stream.appName, lines);
      return;
    }
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
    // While paused the background session keeps reconnecting/streaming; those
    // transient states must not overwrite the panel's paused indicator.
    if (this.pausedAppNames.has(appName) && status !== 'paused') {
      return;
    }
    void this.webviewView?.webview.postMessage({
      type: LOGS_STREAM_STATE_MESSAGE_TYPE,
      appName,
      status,
      message,
    });
  }

  // ── File logging ───────────────────────────────────────────────────────────

  private postFileLogSetting(): void {
    void this.webviewView?.webview.postMessage({
      type: FILE_LOG_SETTING_INIT_MESSAGE_TYPE,
      fileLogMode: this.fileLogMode,
      fileLogDirectory: this.resolveFileLogDirectory(),
    });
  }

  private setFileLogMode(mode: FileLogMode): void {
    if (mode === this.fileLogMode) {
      this.postFileLogSetting();
      return;
    }

    this.fileLogMode = mode;
    this.fileLogFailedApps.clear();
    if (mode === 'file') {
      // Apply mid-run: every live stream starts its own timestamped file now.
      for (const appName of this.runningStreams.keys()) {
        this.ensureFileLogWriter(appName);
      }
    } else {
      this.closeAllFileLogWriters();
    }
    this.postFileLogSetting();
  }

  private resolveFileLogDirectory(): string {
    const configured = vscode.workspace
      .getConfiguration(FILE_LOG_CONFIG_SECTION)
      .get<string>(FILE_LOG_DIRECTORY_CONFIG_KEY);
    const raw = typeof configured === 'string' ? configured.trim() : '';
    if (raw.length === 0) {
      return path.join(os.homedir(), '.saptools', 'cflogs');
    }
    return expandFileLogDirectory(raw);
  }

  private ensureFileLogWriter(appName: string): FileLogWriter | undefined {
    const existing = this.fileLogWriters.get(appName);
    if (existing !== undefined) {
      return existing;
    }
    if (this.fileLogFailedApps.has(appName)) {
      return undefined;
    }

    try {
      const directory = this.resolveFileLogDirectory();
      fs.mkdirSync(directory, { recursive: true });
      const filePath = buildUniqueLogFilePath(directory, appName);
      const writeStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
      writeStream.on('error', (error: Error): void => {
        this.handleFileLogWriteError(appName, error);
      });
      const writer: FileLogWriter = { filePath, stream: writeStream };
      this.fileLogWriters.set(appName, writer);
      writeStream.write(this.buildFileLogHeader(appName));
      return writer;
    } catch (error) {
      this.handleFileLogWriteError(appName, error);
      return undefined;
    }
  }

  private buildFileLogHeader(appName: string): string {
    const params = this.sessionParams;
    const scopeSuffix =
      params === null ? '' : ` — scope: ${params.orgName} / ${params.spaceName}`;
    return `# SAP Tools CF logs — app: ${appName}${scopeSuffix} — started: ${new Date().toISOString()}\n`;
  }

  private writeStreamLinesToFile(appName: string, lines: string[]): void {
    if (this.fileLogMode !== 'file' || lines.length === 0) {
      return;
    }
    const writer = this.ensureFileLogWriter(appName);
    if (writer === undefined) {
      return;
    }
    writer.stream.write(`${lines.join('\n')}\n`);
  }

  private closeFileLogWriter(appName: string): void {
    const writer = this.fileLogWriters.get(appName);
    if (writer === undefined) {
      return;
    }
    this.fileLogWriters.delete(appName);
    writer.stream.end();
  }

  private closeAllFileLogWriters(): void {
    for (const appName of [...this.fileLogWriters.keys()]) {
      this.closeFileLogWriter(appName);
    }
  }

  private handleFileLogWriteError(appName: string, error: unknown): void {
    this.closeFileLogWriter(appName);
    if (this.fileLogFailedApps.has(appName)) {
      return;
    }
    this.fileLogFailedApps.add(appName);
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showWarningMessage(
      `SAP Tools: failed to write CF log file for "${appName}": ${message}`
    );
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

    if (
      message['type'] === SAVE_FILE_LOG_SETTING_MESSAGE_TYPE &&
      typeof message['fileLogMode'] === 'string' &&
      isKnownFileLogMode(message['fileLogMode'])
    ) {
      this.setFileLogMode(message['fileLogMode']);
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

}
