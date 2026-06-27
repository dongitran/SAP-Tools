import type { CfLogStreamHandle } from './cfClient';
import type * as fs from 'node:fs';

export const CF_LOGS_VIEW_ID = 'sapTools.cfLogsView';

export const SCOPE_UPDATE_MESSAGE_TYPE = 'sapTools.scopeUpdate';
export const APPS_UPDATE_MESSAGE_TYPE = 'sapTools.appsUpdate';
export const ACTIVE_APPS_UPDATE_MESSAGE_TYPE = 'sapTools.activeAppsUpdate';
export const LOGS_LOADED_MESSAGE_TYPE = 'sapTools.logsLoaded';
export const LOGS_APPEND_MESSAGE_TYPE = 'sapTools.logsAppend';
export const LOGS_STREAM_STATE_MESSAGE_TYPE = 'sapTools.logsStreamState';
export const LOGS_ERROR_MESSAGE_TYPE = 'sapTools.logsError';
export const FETCH_LOGS_MESSAGE_TYPE = 'sapTools.fetchLogs';
export const COPY_LOG_MESSAGE_TYPE = 'sapTools.copyLogMessage';
export const COPY_LOG_RESULT_MESSAGE_TYPE = 'sapTools.copyLogResult';
export const SAVE_COLUMN_SETTINGS_MESSAGE_TYPE = 'sapTools.saveColumnSettings';
export const COLUMN_SETTINGS_INIT_MESSAGE_TYPE = 'sapTools.columnSettingsInit';
export const SAVE_FONT_SIZE_SETTING_MESSAGE_TYPE = 'sapTools.saveFontSizeSetting';
export const FONT_SIZE_SETTING_INIT_MESSAGE_TYPE = 'sapTools.fontSizeSettingInit';
export const SAVE_LOG_LIMIT_SETTING_MESSAGE_TYPE = 'sapTools.saveLogLimitSetting';
export const LOG_LIMIT_SETTING_INIT_MESSAGE_TYPE = 'sapTools.logLimitSettingInit';
export const SAVE_MESSAGE_HEIGHT_LIMIT_SETTING_MESSAGE_TYPE = 'sapTools.saveMessageHeightLimitSetting';
export const MESSAGE_HEIGHT_LIMIT_SETTING_INIT_MESSAGE_TYPE = 'sapTools.messageHeightLimitSettingInit';
export const SAVE_FILE_LOG_SETTING_MESSAGE_TYPE = 'sapTools.saveFileLogSetting';
export const FILE_LOG_SETTING_INIT_MESSAGE_TYPE = 'sapTools.fileLogSettingInit';

export const COLUMN_SETTINGS_GLOBAL_STATE_KEY = 'cfLogsPanel.visibleColumns';
export const FONT_SIZE_SETTING_GLOBAL_STATE_KEY = 'cfLogsPanel.fontSizePreset';
export const LOG_LIMIT_SETTING_GLOBAL_STATE_KEY = 'cfLogsPanel.logLimit';
export const MESSAGE_HEIGHT_LIMIT_SETTING_GLOBAL_STATE_KEY = 'cfLogsPanel.limitMessageHeight';
export const ALL_COLUMN_IDS = [
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
export const REQUIRED_COLUMN_IDS = ['time', 'request'] as const;
export const DEFAULT_VISIBLE_COLUMN_IDS = ['time', 'level', 'method', 'request', 'status', 'latency'] as const;
export const FONT_SIZE_PRESETS = ['smaller', 'default', 'large', 'xlarge'] as const;
export const DEFAULT_FONT_SIZE_PRESET = 'default';
export const LOG_LIMIT_PRESETS = [300, 500, 1000, 3000] as const;
export const DEFAULT_LOG_LIMIT = 300;
export const DEFAULT_LIMIT_MESSAGE_HEIGHT = false;

export const STREAM_BATCH_FLUSH_MS = 150;
export const STREAM_RETRY_INITIAL_MS = 1_000;
export const STREAM_RETRY_MAX_MS = 20_000;

export const FILE_LOG_MODES = ['off', 'file'] as const;
export type FileLogMode = (typeof FILE_LOG_MODES)[number];
export const DEFAULT_FILE_LOG_MODE: FileLogMode = 'off';
export const FILE_LOG_CONFIG_SECTION = 'sapTools.cfLogs';
export const FILE_LOG_DIRECTORY_CONFIG_KEY = 'fileLogDirectory';

/**
 * While an app's display is paused, freshly streamed lines wait in a per-app
 * buffer so the resume flush replays everything that happened meanwhile.
 * Bounded because the panel itself caps rendering at a few thousand rows; once
 * exceeded the oldest lines are dropped and the flush prepends a skip marker.
 */
export const MAX_PAUSED_BUFFER_LINES = 4_000;

/**
 * A freshly spawned `cf logs` stream occasionally emits CF CLI "session not
 * ready" errors (No org targeted / Not logged in / app not found) when the
 * shared CF config was still being prepared. Within this grace window — and
 * before the stream has produced any real log output — those lines are
 * suppressed and the session is re-prepared instead of being shown to the user.
 */
export const SESSION_HEAL_GRACE_MS = 6_000;
export const MAX_SESSION_RECOVERIES = 3;

/** CF CLI messages that mean the shared session/target was not ready yet. */
export const CF_SESSION_NOT_READY_PATTERNS: readonly RegExp[] = [
  /no org targeted/i,
  /no org and space targeted/i,
  /no space targeted/i,
  /not logged in/i,
  /use '?cf login'?/i,
  /app '[^']*' not found/i,
  /no api endpoint set/i,
];

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

export interface CfAppEntry {
  readonly id: string;
  readonly name: string;
  readonly runningInstances: number;
}

export interface PendingAppsUpdate {
  readonly apps: CfAppEntry[];
  readonly sessionParams: LogSessionParams | null;
}

export type StreamStateStatus =
  | 'starting'
  | 'streaming'
  | 'paused'
  | 'reconnecting'
  | 'stopped'
  | 'error';

export interface FileLogWriter {
  readonly filePath: string;
  readonly stream: fs.WriteStream;
}

export interface PausedLineBuffer {
  lines: string[];
  droppedLineCount: number;
}

export interface AppStreamRuntime {
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