// cspell:words appname logsloaded logserror fetchlogs appsupdate activeappsupdate logsappend logsstreamstate copylog guid gorouter routererror tenantid correlationid btenantid
const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

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
const CF_LINE_PATTERN = /^\s*(?<timestamp>\d{4}-\d{2}-\d{2}T[^\s]+)\s+\[(?<source>[^\]]+)]\s+(?<stream>OUT|ERR)\s?(?<body>.*)$/;
const CF_CLI_SYSTEM_MESSAGE_PREFIXES = [
  'Retrieving logs for app',
  'Failed to retrieve logs from Log Cache:',
  'Failed to retrieve recent logs from Log Cache:',
  'Server error, status code:',
];
const LOG_LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const MAX_RAW_LOG_TEXT_CHARS = 1_000_000;
const MAX_PARSED_LOG_ROWS = 5_000;
const COPY_TOAST_VISIBLE_MS = 1_600;
const MIN_RAW_LOG_TEXT_CHARS = 120_000;
const RAW_LOG_TEXT_CHARS_PER_LIMIT_ROW = 1_200;
const RTR_REQUEST_PATTERN =
  /"(?<method>[A-Z]+)\s+(?<target>\S+)\s+HTTP\/[\d.]+"\s+(?<status>\d{3}|-)/;
const RTR_HOST_PATTERN = /^(?<host>[^ ]+)\s+-\s+\[/;
const RTR_RESPONSE_TIME_PATTERN = /\bresponse_time:(?<responseTime>-|\d+(?:\.\d+)?)(?=\s|$|,)/;
const RTR_TENANT_ID_PATTERN = /\btenantid:"(?<tenantId>[^"]*)"/;
const RTR_CORRELATION_ID_PATTERN = /\bx_correlationid:"(?<correlationId>[^"]*)"/;
const RTR_VCAP_REQUEST_ID_PATTERN = /\bvcap_request_id:"(?<vcapRequestId>[^"]*)"/;
const RTR_TRUE_CLIENT_IP_PATTERN = /\bx_cf_true_client_ip:"(?<clientIp>[^"]*)"/;
const RTR_LEGACY_TRUE_CLIENT_IP_PATTERN = /\btrue_client_ip:"(?<clientIp>[^"]*)"/;
const RTR_X_FORWARDED_FOR_PATTERN = /\bx_forwarded_for:"(?<forwardedFor>[^"]*)"/;
const MAX_REQUEST_SUMMARY_CHARS = 120;
const GENERIC_JSON_LOGGER_NAMES = new Set(['app', 'application', 'cds', 'node', 'remote', 'source']);

/** All columns in canonical display order. */
const COLUMN_DEFS = [
  { id: 'time',      label: 'Time',      cellClass: 'col-time',      required: true,  defaultOn: true  },
  { id: 'level',     label: 'Level',     cellClass: 'col-level',     required: false, defaultOn: true  },
  { id: 'method',    label: 'Method',    cellClass: 'col-method',    required: false, defaultOn: true  },
  { id: 'request',   label: 'Endpoint / Event', cellClass: 'col-request', required: true, defaultOn: true },
  { id: 'status',    label: 'Status',    cellClass: 'col-status',    required: false, defaultOn: true  },
  { id: 'latency',   label: 'Latency',   cellClass: 'col-latency',   required: false, defaultOn: true  },
  { id: 'tenant',    label: 'Tenant',    cellClass: 'col-tenant',    required: false, defaultOn: false },
  { id: 'clientIp',  label: 'Client IP', cellClass: 'col-client-ip', required: false, defaultOn: false },
  { id: 'requestId', label: 'Request ID', cellClass: 'col-request-id', required: false, defaultOn: false },
  { id: 'logger',    label: 'Logger',    cellClass: 'col-logger',    required: false, defaultOn: false },
  { id: 'source',  label: 'Source',  cellClass: 'col-source',  required: false, defaultOn: false },
  { id: 'stream',  label: 'Stream',  cellClass: 'col-stream',  required: false, defaultOn: false },
  { id: 'message', label: 'Message', cellClass: 'col-message', required: false, defaultOn: false },
];
const DEFAULT_VISIBLE_COLUMNS = COLUMN_DEFS.filter((c) => c.defaultOn).map((c) => c.id);
const FONT_SIZE_PRESETS = ['smaller', 'default', 'large', 'xlarge'];
const DEFAULT_FONT_SIZE_PRESET = 'default';
const LOG_LIMIT_PRESETS = [300, 500, 1000, 3000];
const DEFAULT_LOG_LIMIT = 300;
const DEFAULT_LIMIT_MESSAGE_HEIGHT = false;

function isKnownColumnId(value) {
  return typeof value === 'string' && COLUMN_DEFS.some((column) => column.id === value);
}

function normalizeVisibleColumns(columnIds) {
  const selected = new Set();
  for (const columnId of columnIds) {
    if (isKnownColumnId(columnId)) {
      selected.add(columnId);
    }
  }

  for (const column of COLUMN_DEFS) {
    if (column.required) {
      selected.add(column.id);
    }
  }

  const normalized = [];
  for (const column of COLUMN_DEFS) {
    if (selected.has(column.id)) {
      normalized.push(column.id);
    }
  }

  return normalized.length > 0 ? normalized : [...DEFAULT_VISIBLE_COLUMNS];
}

/* cspell:disable */
const PROTOTYPE_SAMPLE_LOG = String.raw`Retrieving logs for app app-demo in org finance-platform / space app as developer@example.com...

2026-04-12T09:14:31.73+0700 [CELL/0] OUT Cell 91130a14 stopping instance 13af001e
2026-04-12T09:14:32.19+0700 [API/2] OUT Restarted app with guid 8a45de1d
2026-04-12T09:14:32.26+0700 [CELL/0] OUT Cell d436706e creating container for instance 6eb35470
2026-04-12T09:14:43.98+0700 [CELL/0] OUT Cell d436706e successfully created container for instance 6eb35470
2026-04-12T09:14:44.55+0700 [APP/PROC/WEB/0] ERR npm warn Unknown project config "always-auth".
2026-04-12T09:14:44.55+0700 [APP/PROC/WEB/0] ERR npm warn Unknown project config "scripts-prepend-node-path".
2026-04-12T09:14:44.73+0700 [APP/PROC/WEB/0] OUT > app-demo@0.0.0 start
2026-04-12T09:14:44.73+0700 [APP/PROC/WEB/0] OUT > cds-serve -p gen/srv
2026-04-12T09:14:45.25+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"NodeCacheStrategy","timestamp":"2026-04-12T02:14:45.255Z","component_name":"app-demo","organization_name":"finance-platform","space_name":"app","msg":"NodeCacheStrategy initialized","type":"log"}
2026-04-12T09:14:45.25+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"CacheService","timestamp":"2026-04-12T02:14:45.256Z","component_name":"app-demo","organization_name":"finance-platform","space_name":"app","msg":"CacheService initialized with strategy: NodeCacheStrategy","type":"log"}
2026-04-12T09:14:47.26+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","timestamp":"2026-04-12T02:14:47.260Z","component_name":"app-demo","organization_name":"finance-platform","space_name":"app","msg":"loaded model from 1 file(s):\\n ","type":"log"}
2026-04-12T09:14:47.26+0700 [APP/PROC/WEB/0] OUT gen/srv/srv/csn.json
2026-04-12T09:14:47.90+0700 [APP/PROC/WEB/0] OUT {"level":"warn","logger":"cds","timestamp":"2026-04-12T02:14:47.904Z","component_name":"app-demo","organization_name":"finance-platform","space_name":"app","msg":"using auth strategy jwt with fallback mode","type":"log"}
2026-04-12T09:14:47.95+0700 [APP/PROC/WEB/0] OUT Server is listening at http://localhost:8080
2026-04-12T09:14:47.95+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","timestamp":"2026-04-12T02:14:47.953Z","component_name":"app-demo","organization_name":"finance-platform","space_name":"app","msg":"server listening on { url: 'http://localhost:8080' }","type":"log"}
2026-04-12T09:14:47.95+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"cds","timestamp":"2026-04-12T02:14:47.953Z","component_name":"app-demo","organization_name":"finance-platform","space_name":"app","msg":"database retry exhausted on startup","type":"log"}
2026-05-11T18:20:17.84+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"SyntheticBatchJob - runSyntheticBatch","correlation_id":"synthetic-correlation-001","remote_user":"sample-user","timestamp":"2026-05-11T11:20:17.839Z","layer":"cds","component_type":"application","container_id":"192.0.2.10","component_id":"00000000-0000-4000-8000-000000000001","component_name":"synthetic-cap-service","component_instance":0,"source_instance":0,"organization_name":"synthetic-org","organization_id":"00000000-0000-4000-8000-000000000002","space_name":"sandbox","space_id":"00000000-0000-4000-8000-000000000003","msg":"{\n refID: 'synthetic-ref-001',\n batchID: 997,\n concurrencyLimit: 5\n}","type":"log"}
2026-05-11T18:22:00.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"SyntheticRemoteService","msg":"{\"statusCode\":502,\"reason\":{\"message\":\"\",\"name\":\"Error\",\"request\":{\"method\":\"POST\",\"url\":\"http://example.test:44300/odata/v1/SyntheticEntities\"},\"response\":{\"status\":503,\"statusText\":\"Service Unavailable\"}}}","type":"log"}
2026-05-11T18:22:01.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"SyntheticValidationRunner","msg":"{\n  name: 'syntheticValidationRun - [Info] Sample validation message',\n  error: Error: Error during request to remote service: synthetic-validation-marker\n      at module.exports.run (/srv/node_modules/@sap/cds/runtime/remote/utils/client.js:196:31),\n    statusCode: 502,\n    code: 'ERR_BAD_REQUEST'\n}","type":"log"}
2026-05-11T18:22:02.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"cds","msg":"400 - Error: Synthetic escaped character in JSON at position 81\n    at SyntheticActionHandler.executeSyntheticAction (/srv/srv/handlers/SyntheticAction.handler.ts:49:18) {\n  code: '400'\n}","type":"log"}
2026-05-13T16:51:41.16+0700 [APP/PROC/WEB/0] OUT {"level":"debug","logger":"remote","tenant_id":"tenant-remote-sample","x_cf_true_client_ip":"192.0.2.44","request_id":"1758b535-a6bc-4eee-5261-bf740494e2e","x_correlation_id":"1758b535-a6bc-4eee-5261-bf740494e2e","msg":"get <srv_process_system>/systemprocessservice/requesttaskeventdata?$top=1&$select=deepdata,reqid,mdglogid&$filter=mdglogid%20eq%20'a1db2b12-16d3-43e5-b73d-35744eb1e2e' {\n  headers: {\n    accept: 'application/json,text/plain',\n    authorization: 'bearer ***'\n  }\n}","type":"log"}
2026-04-12T09:14:48.20+0700 [RTR/0] OUT app-demo.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.200Z] "GET /rtr-health-check HTTP/1.1" 200 42 10 "-" "probe/1.0" "10.0.1.1:1001" "10.0.2.1:2001" x_forwarded_for:"1.2.3.4, 10.0.1.1" x_forwarded_proto:"https" vcap_request_id:"rtr-req-001" response_time:0.001 gorouter_time:0.000010 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_correlationid:"corr-req-001" tenantid:"app-demo" x_cf_true_client_ip:"13.251.40.148" x_b3_traceid:"aabbccdd" x_b3_spanid:"aabbccdd" b3:"aabbccdd-aabbccdd"
2026-04-12T09:14:48.25+0700 [RTR/0] OUT app-demo.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.250Z] "GET /rtr-not-found HTTP/1.1" 404 80 10 "-" "curl/7.88.1" "10.0.1.2:1002" "10.0.2.2:2002" x_forwarded_for:"1.2.3.5, 10.0.1.2" x_forwarded_proto:"https" vcap_request_id:"rtr-req-002" response_time:0.000 gorouter_time:0.000009 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_correlationid:"corr-req-002" tenantid:"app-demo" x_cf_true_client_ip:"13.251.40.148" x_b3_traceid:"bbccddee" x_b3_spanid:"bbccddee" b3:"bbccddee-bbccddee"
2026-04-12T09:14:48.30+0700 [RTR/0] OUT app-demo.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.300Z] "POST /rtr-upstream-fail HTTP/1.1" 500 120 10 "-" "axios/1.0.0" "10.0.1.3:1003" "10.0.2.3:2003" x_forwarded_for:"1.2.3.6, 10.0.1.3" x_forwarded_proto:"https" vcap_request_id:"rtr-req-003" response_time:0.123 gorouter_time:0.000011 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_correlationid:"corr-req-003" tenantid:"app-demo" x_cf_true_client_ip:"13.251.40.148" x_b3_traceid:"ccddeeff" x_b3_spanid:"ccddeeff" b3:"ccddeeff-ccddeeff"
Failed to retrieve logs from Log Cache: unexpected status code 404
Failed to retrieve logs from Log Cache: unexpected status code 404
Failed to retrieve logs from Log Cache: unexpected status code 404`;
/* cspell:enable */

// ── Column visibility state ───────────────────────────────────────────────────
// Restored from webview state (persists within a VS Code session).
// Will be overridden by sapTools.columnSettingsInit once the extension sends it.
{
  const savedState = vscodeApi?.getState();
  const saved = Array.isArray(savedState?.visibleColumns) ? savedState.visibleColumns : null;
  const savedFontSizePreset =
    typeof savedState?.fontSizePreset === 'string' ? savedState.fontSizePreset : '';
  const savedLogLimitCandidate =
    typeof savedState?.logLimit === 'number' ? savedState.logLimit : Number.NaN;
  const savedLimitMessageHeight =
    typeof savedState?.limitMessageHeight === 'boolean'
      ? savedState.limitMessageHeight
      : DEFAULT_LIMIT_MESSAGE_HEIGHT;
  const normalizedSavedColumns =
    saved !== null ? normalizeVisibleColumns(saved) : [...DEFAULT_VISIBLE_COLUMNS];
  // eslint-disable-next-line no-var
  var visibleColumns = normalizedSavedColumns;
  // eslint-disable-next-line no-var
  var fontSizePreset = isKnownFontSizePreset(savedFontSizePreset)
    ? savedFontSizePreset
    : DEFAULT_FONT_SIZE_PRESET;
  // eslint-disable-next-line no-var
  var logLimit = isKnownLogLimit(savedLogLimitCandidate)
    ? savedLogLimitCandidate
    : DEFAULT_LOG_LIMIT;
  // eslint-disable-next-line no-var
  var limitMessageHeight = savedLimitMessageHeight;
}

const elements = getRequiredElements();

// Module-level mutable state.
let allRows = [];
let filteredRows = [];
let selectedRowId = null;
let pendingRequestId = 0;
let emptyStateMessage = 'Select a CF space in the SAP Tools sidebar to load logs.';
let activeAppNames = new Set();
let latestApps = [];
let rawLogTextByApp = new Map();
let parsedRowsByApp = new Map();
let streamStateByApp = new Map();
let scheduledRenderFrame = null;
let hasPendingLevelHydration = false;
let isLogsRequestInFlight = false;
let pendingRequestAppName = '';
let nextCopyRequestId = 0;
/** Maps requestId → callback to invoke when copy result arrives from extension. */
const pendingCopyCallbacks = new Map();
let copyToastTimer = null;

applyFontSizePreset();
applyLogLimitSetting();
applyMessageHeightLimitSetting();

// Build header from current column config before first render.
rebuildTableHeader();

if (vscodeApi === null) {
  // Browser prototype mode: render sample data and populate app selector.
  allRows = trimRowsForMemory(parseCfRecentLog(PROTOTYPE_SAMPLE_LOG));
  rawLogTextByApp.set('app-demo', PROTOTYPE_SAMPLE_LOG);
  parsedRowsByApp.set('app-demo', allRows);
  elements.workspaceScope.textContent = 'za-10 \u2192 data-foundation-prod \u2192 observability';
  rebuildAppSelect([{ name: 'app-demo', runningInstances: 1 }], 'app-demo');
}

hydrateDynamicFilterOptions(allRows);
applyFiltersAndRender();
bindFilterEvents();
bindExtensionMessages();

// ── DOM helpers ──────────────────────────────────────────────────────────────

function getRequiredElements() {
  const tableHead = document.getElementById('log-table-head');
  const tableBody = document.getElementById('log-table-body');
  const tableSummary = document.getElementById('table-summary');
  const workspaceScope = document.getElementById('workspace-scope');
  const filterSearch = document.getElementById('filter-search');
  const filterLevel = document.getElementById('filter-level');
  const filterApp = document.getElementById('filter-app');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsColumnToggles = document.getElementById('settings-column-toggles');
  const settingsFontSize = document.getElementById('settings-font-size');
  const settingsLogLimit = document.getElementById('settings-log-limit');
  const settingsMessageLimit = document.getElementById('settings-message-limit');
  const copyToast = document.getElementById('copy-toast');

  if (!(tableHead instanceof HTMLTableSectionElement)) {
    throw new Error('Missing #log-table-head.');
  }

  if (!(tableBody instanceof HTMLTableSectionElement)) {
    throw new Error('Missing #log-table-body.');
  }

  if (!(tableSummary instanceof HTMLElement)) {
    throw new Error('Missing #table-summary.');
  }

  if (!(workspaceScope instanceof HTMLElement)) {
    throw new Error('Missing #workspace-scope.');
  }

  if (!(filterSearch instanceof HTMLInputElement)) {
    throw new Error('Missing #filter-search.');
  }

  if (!(filterLevel instanceof HTMLSelectElement)) {
    throw new Error('Missing #filter-level.');
  }

  if (!(filterApp instanceof HTMLSelectElement)) {
    throw new Error('Missing #filter-app.');
  }

  if (!(settingsToggle instanceof HTMLButtonElement)) {
    throw new Error('Missing #settings-toggle.');
  }

  if (!(settingsPanel instanceof HTMLElement)) {
    throw new Error('Missing #settings-panel.');
  }

  if (!(settingsColumnToggles instanceof HTMLElement)) {
    throw new Error('Missing #settings-column-toggles.');
  }

  if (!(settingsFontSize instanceof HTMLSelectElement)) {
    throw new Error('Missing #settings-font-size.');
  }

  if (!(settingsLogLimit instanceof HTMLSelectElement)) {
    throw new Error('Missing #settings-log-limit.');
  }

  if (!(settingsMessageLimit instanceof HTMLInputElement)) {
    throw new Error('Missing #settings-message-limit.');
  }

  if (!(copyToast instanceof HTMLElement)) {
    throw new Error('Missing #copy-toast.');
  }

  return {
    tableHead,
    tableBody,
    tableSummary,
    workspaceScope,
    settingsToggle,
    settingsPanel,
    settingsColumnToggles,
    settingsFontSize,
    settingsLogLimit,
    settingsMessageLimit,
    copyToast,
    filters: {
      search: filterSearch,
      level: filterLevel,
      app: filterApp,
    },
  };
}

// ── Log parsing ──────────────────────────────────────────────────────────────

function isCfCliSystemMessage(line) {
  return CF_CLI_SYSTEM_MESSAGE_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function parseCfRecentLog(rawText) {
  const rows = [];
  const lines = rawText.split(/\r?\n/);
  let previousRow = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    if (isCfCliSystemMessage(trimmedLine)) {
      continue;
    }

    const parsedRow = safeParseCfLine(trimmedLine, rows.length + 1);

    if (parsedRow !== null) {
      rows.push(parsedRow);
      previousRow = parsedRow;
      continue;
    }

    if (previousRow !== null) {
      appendContinuationLine(previousRow, trimmedLine);
      continue;
    }

    const fallbackRow = buildTextRow({
      id: rows.length + 1,
      timestamp: 'N/A',
      source: 'SYSTEM',
      stream: 'OUT',
      body: trimmedLine,
    });
    rows.push(fallbackRow);
    previousRow = fallbackRow;
  }

  return rows;
}

function appendContinuationLine(previousRow, trimmedLine) {
  const requestTracksMessage =
    previousRow.format === 'text' && previousRow.request === previousRow.message;
  previousRow.message = `${previousRow.message}\n${trimmedLine}`;
  previousRow.rawBody = `${previousRow.rawBody}\n${trimmedLine}`;
  if (requestTracksMessage) {
    previousRow.request = previousRow.message;
    previousRow.requestTitle = previousRow.request;
  }
  previousRow.level = normalizeLevel(
    resolveCandidateLevel(previousRow),
    previousRow.stream,
    previousRow.message,
    previousRow.source,
    previousRow.status
  );
  previousRow.searchableText = buildSearchableText(previousRow);
}

function parseCfLine(line, id) {
  const match = line.match(CF_LINE_PATTERN);
  if (match === null || match.groups === undefined) {
    return null;
  }

  const timestamp = match.groups.timestamp;
  const source = match.groups.source;
  const stream = match.groups.stream === 'ERR' ? 'ERR' : 'OUT';
  const body = match.groups.body.trim();
  const jsonPayload = parseJsonBody(body);

  if (jsonPayload !== null) {
    return buildJsonRow({ id, timestamp, source, stream, body, payload: jsonPayload });
  }

  return buildTextRow({ id, timestamp, source, stream, body });
}

function safeParseCfLine(line, id) {
  try {
    return parseCfLine(line, id);
  } catch {
    return null;
  }
}

function parseJsonBody(body) {
  if (!body.startsWith('{') || !body.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(body);
    if (isObjectRecord(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function buildTextRow({ id, timestamp, source, stream, body }) {
  const formattedTimestamp = formatTimestampToClock(timestamp);
  const message = body.length > 0 ? body : '(empty)';
  const routerInfo = extractRouterAccessInfo(source, message);
  const level = normalizeLevel('', stream, message, source, routerInfo?.statusCode ?? '');
  const row = {
    id,
    timestamp: formattedTimestamp,
    timestampRaw: timestamp,
    source,
    stream,
    format: 'text',
    level,
    logger: deriveLoggerFromSource(source),
    component: '',
    org: '',
    space: '',
    host: routerInfo?.host ?? deriveLoggerFromSource(source),
    method: routerInfo?.method ?? '',
    request: routerInfo?.request ?? message,
    status: routerInfo?.statusCode ?? '',
    latency: routerInfo?.latency ?? '',
    tenant: routerInfo?.tenantId ?? '',
    clientIp: routerInfo?.clientIp ?? '',
    requestId: routerInfo?.requestId ?? '',
    requestTitle: routerInfo?.request ?? message,
    message,
    rawBody: body,
    jsonPayload: null,
    searchableText: '',
  };

  row.searchableText = buildSearchableText(row);
  return row;
}

function buildJsonRow({ id, timestamp, source, stream, body, payload }) {
  const formattedTimestamp = formatTimestampToClock(timestamp);
  const message = readString(payload.msg) || body;
  const innerJson = tryParseInnerJson(message);
  const innerHttpInfo = innerJson !== null ? extractInnerHttpInfo(innerJson) : null;
  const requestSummary = extractEndpointSummary(payload, message, source, innerHttpInfo);
  const status = innerHttpInfo?.statusCode ?? '';
  const level = normalizeLevel(readString(payload.level), stream, message, source, status);
  const row = {
    id,
    timestamp: formattedTimestamp,
    timestampRaw: timestamp,
    source,
    stream,
    format: 'json',
    level,
    logger: readString(payload.logger) || deriveLoggerFromSource(source),
    component: readString(payload.component_name),
    org: readString(payload.organization_name),
    space: readString(payload.space_name),
    host: deriveLoggerFromSource(source),
    method: requestSummary.method,
    request: requestSummary.text,
    status,
    latency: '',
    tenant: resolvePayloadTenant(payload),
    clientIp: resolvePayloadClientIp(payload),
    requestId: resolvePayloadRequestId(payload),
    requestTitle: requestSummary.title,
    message,
    rawBody: body,
    jsonPayload: payload,
    searchableText: '',
  };

  row.searchableText = buildSearchableText(row);
  return row;
}

function extractEndpointSummary(payload, message, source, innerHttpInfo) {
  if (innerHttpInfo !== null && innerHttpInfo.url.length > 0) {
    const method = innerHttpInfo.method.length > 0 ? innerHttpInfo.method : 'HTTP';
    const target = summarizeUrlTarget(innerHttpInfo.url);
    return buildEndpointSummary(buildRequestSummary(method, target), `${method} ${innerHttpInfo.url}`, method);
  }

  if (innerHttpInfo !== null && innerHttpInfo.statusCode.length > 0) {
    const reason = innerHttpInfo.statusText.length > 0 ? innerHttpInfo.statusText : 'status';
    return buildEndpointSummary(`${innerHttpInfo.statusCode} ${reason}`, '');
  }

  const inspectName = extractInspectFieldString(message, 'name');
  if (inspectName.length > 0) {
    return buildEndpointSummary(extractEventNameFromInspectName(inspectName), inspectName);
  }

  const handler = extractHandlerFromStack(message);
  if (handler.length > 0) {
    return buildEndpointSummary(handler, handler);
  }

  const remoteRequestInfo = extractCapRemoteRequestInfo(message);
  if (remoteRequestInfo !== null) {
    return buildEndpointSummary(
      buildRequestSummary(remoteRequestInfo.method, remoteRequestInfo.target),
      `${remoteRequestInfo.method} ${remoteRequestInfo.target}`,
      remoteRequestInfo.method
    );
  }

  const loggerEvent = extractLoggerEvent(payload, source);
  if (loggerEvent.length > 0) {
    return buildEndpointSummary(loggerEvent, loggerEvent);
  }

  return buildEndpointSummary(firstLineSummary(message), '');
}

function buildEndpointSummary(text, title, method = '') {
  const compactText = compactSingleLine(text, MAX_REQUEST_SUMMARY_CHARS);
  const compactTitle = title.length > 0 ? compactSingleLine(title, 500) : compactText;
  return {
    text: compactText,
    title: compactTitle,
    method,
  };
}

function extractCapRemoteRequestInfo(message) {
  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? '';
  const match = firstLine.match(
    /^(?<method>GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?<target>.+?)(?:\s+\{|\s*$)/i
  );
  if (match?.groups === undefined) {
    return null;
  }

  const method = normalizeMethod(match.groups.method);
  const target = decodeRequestTarget(match.groups.target.trim());
  if (method.length === 0 || target.length === 0) {
    return null;
  }

  return { method, target };
}

function tryParseInnerJson(message) {
  const trimmed = message.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractInnerHttpInfo(innerJson) {
  const reason = readObjectProperty(innerJson, 'reason');
  const request = readObjectProperty(innerJson, 'request') ?? readObjectProperty(reason, 'request');
  const response = readObjectProperty(innerJson, 'response') ?? readObjectProperty(reason, 'response');
  const method = normalizeMethod(readString(request?.method) || readString(innerJson.method));
  const url = readString(request?.url) || readString(innerJson.url);
  const statusCode =
    readStatusCode(innerJson.statusCode) ||
    readStatusCode(reason?.statusCode) ||
    readStatusCode(innerJson.status) ||
    readStatusCode(response?.status);
  const statusText = readString(response?.statusText) || readString(reason?.name) || readString(innerJson.name);

  if (method.length === 0 && url.length === 0 && statusCode.length === 0 && statusText.length === 0) {
    return null;
  }

  return { method, url, statusCode, statusText };
}

function readObjectProperty(record, key) {
  if (!isObjectRecord(record)) {
    return null;
  }
  const value = record[key];
  return isObjectRecord(value) ? value : null;
}

function readStatusCode(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 999) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) {
    return value.trim();
  }
  return '';
}

function normalizeMethod(method) {
  const normalized = method.trim().toUpperCase();
  return /^[A-Z]+$/.test(normalized) ? normalized : '';
}

function summarizeUrlTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function extractHandlerFromStack(message) {
  const pattern =
    /(?:^|\n)\s+at\s+(?:async\s+|new\s+)?([A-Za-z_$][\w$<>]*(?:\.[\w$<>]+)*)(?:\s+\[as\s+[^\]]+])?\s*\(([^)]*)\)/g;
  const candidates = [];
  let match = pattern.exec(message);

  while (match !== null) {
    const name = match[1] ?? '';
    const path = match[2] ?? '';
    if (name.length > 0) {
      candidates.push({ name, isNodeModule: /(?:^|[\\/])node_modules(?:[\\/]|$)/.test(path) });
    }
    match = pattern.exec(message);
  }

  const userFrame = candidates.find((candidate) => !candidate.isNodeModule);
  return userFrame?.name ?? candidates[0]?.name ?? '';
}

function extractInspectFieldString(message, fieldName) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(fieldName)}:\\s*(['"\`])([^'"\`\\n]+)`, 'm');
  const match = message.match(pattern);
  return match?.[2]?.trim() ?? '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractEventNameFromInspectName(value) {
  const firstLine = value.split(/\r?\n/)[0]?.trim() ?? '';
  const separatorIndex = firstLine.indexOf(' - ');
  const eventName = separatorIndex >= 0 ? firstLine.slice(0, separatorIndex) : firstLine;
  return compactSingleLine(eventName, MAX_REQUEST_SUMMARY_CHARS);
}

function extractLoggerEvent(payload, source) {
  const logger = readString(payload.logger);
  if (logger.length === 0) {
    return '';
  }

  const separatorIndex = logger.indexOf(' - ');
  if (separatorIndex >= 0) {
    return compactSingleLine(logger.slice(separatorIndex + 3), MAX_REQUEST_SUMMARY_CHARS);
  }

  const normalizedLogger = logger.toLowerCase();
  if (normalizedLogger === deriveLoggerFromSource(source) || GENERIC_JSON_LOGGER_NAMES.has(normalizedLogger)) {
    return '';
  }
  return compactSingleLine(logger, MAX_REQUEST_SUMMARY_CHARS);
}

function firstLineSummary(message) {
  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? '';
  return compactSingleLine(firstLine, MAX_REQUEST_SUMMARY_CHARS);
}

function compactSingleLine(value, maxLength) {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function resolveCandidateLevel(row) {
  if (row.format !== 'json' || row.jsonPayload === null || !isObjectRecord(row.jsonPayload)) {
    return '';
  }

  return readString(row.jsonPayload.level);
}

function readString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function readFirstPayloadString(payload, keys) {
  for (const key of keys) {
    const value = readString(payload[key]);
    if (value.length > 0) {
      return value;
    }
  }
  return '';
}

function resolvePayloadTenant(payload) {
  return readFirstPayloadString(payload, ['tenant_id', 'tenantid', 'tenant']);
}

function resolvePayloadClientIp(payload) {
  const trueClientIp = readFirstPayloadString(payload, [
    'x_cf_true_client_ip',
    'true_client_ip',
    'client_ip',
  ]);
  if (trueClientIp.length > 0) {
    return trueClientIp;
  }

  const forwardedFor = readFirstPayloadString(payload, ['x_forwarded_for']);
  if (forwardedFor.length === 0) {
    return '';
  }

  const firstForwardedIp = forwardedFor.split(',')[0]?.trim() ?? '';
  return normalizeMetadataValue(firstForwardedIp);
}

function resolvePayloadRequestId(payload) {
  return readFirstPayloadString(payload, [
    'x_correlation_id',
    'x_correlationid',
    'correlation_id',
    'request_id',
    'x_vcap_request_id',
  ]);
}

function deriveLoggerFromSource(source) {
  const firstToken = source.split('/')[0];
  return firstToken.length > 0 ? firstToken.toLowerCase() : 'source';
}

function normalizeLevel(candidateLevel, stream, message, source, routerStatusCode = '') {
  const normalizedCandidate = candidateLevel.trim().toLowerCase();

  if (normalizedCandidate === 'warning') {
    return 'warn';
  }

  if (LOG_LEVEL_ORDER.includes(normalizedCandidate)) {
    return normalizedCandidate;
  }

  // RTR (gorouter) access logs contain metadata field names like x_cf_routererror
  // and failed_attempts that would falsely trigger keyword-based level detection.
  // Classify by HTTP status code instead.
  if (typeof source === 'string' && /^rtr\b/i.test(source)) {
    return classifyRtrLog(message, routerStatusCode);
  }

  if (/\bfatal\b/i.test(message)) {
    return 'fatal';
  }

  if (/\b(?:error|exception|failed)\b/i.test(message)) {
    return 'error';
  }

  if (/\bwarn(?:ing)?\b/i.test(message)) {
    return 'warn';
  }

  if (stream === 'ERR') {
    return 'error';
  }

  return 'info';
}

function classifyRtrLog(message, statusCodeCandidate = '') {
  const statusCode = resolveStatusCode(statusCodeCandidate, message);
  if (statusCode === null) {
    return 'info';
  }
  if (statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  return 'info';
}

function resolveStatusCode(statusCodeCandidate, message) {
  if (/^\d{3}$/.test(statusCodeCandidate)) {
    return Number.parseInt(statusCodeCandidate, 10);
  }
  const match = message.match(RTR_REQUEST_PATTERN);
  if (match?.groups === undefined || !/^\d{3}$/.test(match.groups.status)) {
    return null;
  }
  return Number.parseInt(match.groups.status, 10);
}

function extractRouterAccessInfo(source, message) {
  if (!/^rtr\b/i.test(source)) {
    return null;
  }

  const requestMatch = message.match(RTR_REQUEST_PATTERN);
  const method = requestMatch?.groups?.method ?? '';
  const targetRaw = requestMatch?.groups?.target ?? '';
  const target = decodeRequestTarget(targetRaw);
  const statusCode =
    requestMatch?.groups !== undefined && /^\d{3}$/.test(requestMatch.groups.status)
      ? requestMatch.groups.status
      : '';
  const request = buildRequestSummary(method, target);
  const responseTimeRaw = message.match(RTR_RESPONSE_TIME_PATTERN)?.groups?.responseTime ?? '';
  const latency = formatLatency(responseTimeRaw);
  const host = normalizeMetadataValue(message.match(RTR_HOST_PATTERN)?.groups?.host ?? '');
  const tenantId = normalizeMetadataValue(message.match(RTR_TENANT_ID_PATTERN)?.groups?.tenantId ?? '');
  const requestId = resolveRequestId(message);
  const clientIp = resolveClientIp(message);

  return { host, method, request, statusCode, latency, tenantId, clientIp, requestId };
}

function buildRequestSummary(method, target) {
  if (method.length === 0 || target.length === 0) {
    return '';
  }

  const request = `${method} ${target}`;
  if (request.length <= MAX_REQUEST_SUMMARY_CHARS) {
    return request;
  }

  const compactTargetBudget = Math.max(16, MAX_REQUEST_SUMMARY_CHARS - method.length - 6);
  const compactTarget = `${target.slice(0, compactTargetBudget)}...`;
  return `${method} ${compactTarget}`;
}

function decodeRequestTarget(target) {
  if (target.length === 0) {
    return target;
  }

  const questionMarkIndex = target.indexOf('?');
  if (questionMarkIndex < 0) {
    return decodeUriComponentSafely(target);
  }

  const pathPart = target.slice(0, questionMarkIndex);
  const queryPart = target.slice(questionMarkIndex + 1);
  return `${decodeUriComponentSafely(pathPart)}?${decodeUriComponentSafely(queryPart)}`;
}

function decodeUriComponentSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeMetadataValue(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === '-') {
    return '';
  }
  return trimmed;
}

function resolveRequestId(message) {
  const correlationId = normalizeMetadataValue(
    message.match(RTR_CORRELATION_ID_PATTERN)?.groups?.correlationId ?? ''
  );
  if (correlationId.length > 0) {
    return correlationId;
  }

  return normalizeMetadataValue(
    message.match(RTR_VCAP_REQUEST_ID_PATTERN)?.groups?.vcapRequestId ?? ''
  );
}

function resolveClientIp(message) {
  const trueClient = normalizeMetadataValue(
    message.match(RTR_TRUE_CLIENT_IP_PATTERN)?.groups?.clientIp ?? ''
  );
  if (trueClient.length > 0) {
    return trueClient;
  }

  const legacyTrueClient = normalizeMetadataValue(
    message.match(RTR_LEGACY_TRUE_CLIENT_IP_PATTERN)?.groups?.clientIp ?? ''
  );
  if (legacyTrueClient.length > 0) {
    return legacyTrueClient;
  }

  const forwardedFor = normalizeMetadataValue(
    message.match(RTR_X_FORWARDED_FOR_PATTERN)?.groups?.forwardedFor ?? ''
  );
  if (forwardedFor.length === 0) {
    return '';
  }
  const firstForwardedIp = forwardedFor.split(',')[0]?.trim() ?? '';
  return normalizeMetadataValue(firstForwardedIp);
}

function formatLatency(responseTimeRaw) {
  if (responseTimeRaw === '-' || responseTimeRaw.length === 0) {
    return '';
  }

  const seconds = Number.parseFloat(responseTimeRaw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }

  if (seconds < 1) {
    const millis = trimTrailingZeros((seconds * 1000).toFixed(1));
    return `${millis} ms`;
  }

  const secondsText = trimTrailingZeros(seconds.toFixed(3));
  return `${secondsText} s`;
}

function trimTrailingZeros(value) {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function buildSearchableText(row) {
  const tokens = [
    row.timestamp,
    row.timestampRaw,
    row.source,
    row.stream,
    row.format,
    row.level,
    row.logger,
    row.component,
    row.org,
    row.space,
    row.host,
    row.method,
    row.request,
    row.status,
    row.latency,
    row.tenant,
    row.clientIp,
    row.requestId,
    row.rawBody,
    row.message,
  ];
  return tokens.join(' ').toLowerCase();
}

function isObjectRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatTimestampToClock(timestamp) {
  const normalized = timestamp.trim();
  const withDateMatch = normalized.match(
    /T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})/
  );
  if (withDateMatch?.groups !== undefined) {
    const { hour, minute, second } = withDateMatch.groups;
    return `${hour}:${minute}:${second}`;
  }

  const clockOnlyMatch = normalized.match(
    /^(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:[.,]\d+)?$/
  );
  if (clockOnlyMatch?.groups !== undefined) {
    const { hour, minute, second } = clockOnlyMatch.groups;
    return `${hour}:${minute}:${second}`;
  }

  return normalized;
}

// ── Filter controls ──────────────────────────────────────────────────────────

function hydrateDynamicFilterOptions(rows) {
  const levels = collectDistinctValues(rows, (row) => row.level, (value) => {
    const order = LOG_LEVEL_ORDER.indexOf(value);
    return order < 0 ? LOG_LEVEL_ORDER.length : order;
  });

  rebuildSelect(elements.filters.level, levels);
}

function collectDistinctValues(rows, selector, orderSelector) {
  const values = [];
  const seen = new Set();

  for (const row of rows) {
    const value = selector(row);
    if (value.length === 0 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    values.push(value);
  }

  if (orderSelector === undefined) {
    values.sort((left, right) => left.localeCompare(right));
    return values;
  }

  values.sort((left, right) => {
    const leftOrder = orderSelector(left);
    const rightOrder = orderSelector(right);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.localeCompare(right);
  });

  return values;
}

function rebuildSelect(select, values) {
  const previous = select.value;
  select.replaceChildren();

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All';
  select.append(allOption);

  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }

  if (values.includes(previous)) {
    select.value = previous;
    return;
  }

  select.value = 'all';
}

function rebuildAppSelect(apps, selectedApp) {
  elements.filters.app.replaceChildren();

  if (apps.length === 0) {
    const noAppsOption = document.createElement('option');
    noAppsOption.value = '';
    noAppsOption.textContent = '— no active app logging —';
    elements.filters.app.append(noAppsOption);
    elements.filters.app.disabled = true;
    return;
  }

  elements.filters.app.disabled = false;

  for (const app of apps) {
    const name = typeof app.name === 'string' ? app.name : '';
    const instances = typeof app.runningInstances === 'number' ? app.runningInstances : 0;
    const option = document.createElement('option');
    option.value = name;
    option.textContent = `${name} (${String(instances)})`;
    elements.filters.app.append(option);
  }

  const targetApp = typeof selectedApp === 'string' && selectedApp.length > 0 ? selectedApp : '';
  const hasTarget = targetApp.length > 0 && apps.some((a) => a.name === targetApp);
  elements.filters.app.value = hasTarget ? targetApp : (apps[0]?.name ?? '');
}

function bindFilterEvents() {
  elements.filters.search.addEventListener('input', () => {
    runFiltersRenderNow();
  });

  elements.filters.level.addEventListener('change', () => {
    runFiltersRenderNow();
  });

  elements.filters.app.addEventListener('change', () => {
    const selectedApp = elements.filters.app.value;
    if (selectedApp.length > 0) {
      showSelectedAppLogs(selectedApp, true);
    }
  });

  elements.settingsToggle.addEventListener('click', () => {
    toggleSettingsPanel();
  });

  // Column checkbox toggles — delegated from the toggles container.
  elements.settingsColumnToggles.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
      handleColumnToggle(event.target.dataset.columnId ?? '', event.target.checked);
    }
  });

  elements.settingsFontSize.addEventListener('change', () => {
    handleFontSizePresetChange(elements.settingsFontSize.value);
  });

  elements.settingsLogLimit.addEventListener('change', () => {
    handleLogLimitChange(elements.settingsLogLimit.value);
  });

  elements.settingsMessageLimit.addEventListener('change', () => {
    handleMessageHeightLimitChange(elements.settingsMessageLimit.checked);
  });

  // Close settings panel when clicking outside it.
  document.addEventListener('click', (event) => {
    if (
      !elements.settingsPanel.hidden &&
      !elements.settingsPanel.contains(/** @type {Node} */ (event.target)) &&
      !elements.settingsToggle.contains(/** @type {Node} */ (event.target))
    ) {
      closeSettingsPanel();
    }
  });

  buildSettingsPanel();
}

// ── Extension messaging ──────────────────────────────────────────────────────

function requestLogsForApp(appName, force) {
  if (vscodeApi !== null) {
    const shouldForce = force === true;
    if (!shouldForce && isLogsRequestInFlight) {
      return;
    }

    if (isLogsRequestInFlight && pendingRequestAppName === appName) {
      return;
    }

    isLogsRequestInFlight = true;
    pendingRequestId += 1;
    pendingRequestAppName = appName;
    vscodeApi.postMessage({ type: 'sapTools.fetchLogs', appName, requestId: pendingRequestId });
  }
}

function handleAppsUpdate(apps, selectedApp) {
  latestApps = normalizeAppsCatalog(apps);
  activeAppNames = filterActiveNamesByCatalog(activeAppNames, latestApps);
  refreshAppSelectorAndLogs(selectedApp);
}

function handleActiveAppsUpdate(appNames) {
  activeAppNames = normalizeActiveAppNames(appNames);
  refreshAppSelectorAndLogs(elements.filters.app.value);
}

function handleLogsLoaded(appName, logText, requestId) {
  // Discard stale responses (cross-scope same-app-name or quick app switching).
  if (requestId !== pendingRequestId) {
    return;
  }
  isLogsRequestInFlight = false;
  pendingRequestAppName = '';
  rawLogTextByApp.set(appName, logText);
  parsedRowsByApp.set(appName, trimRowsForMemory(parseCfRecentLog(logText)));
  showSelectedAppLogs(elements.filters.app.value, false);
}

function handleLogsError(appName, message, requestId) {
  // Discard stale responses (cross-scope same-app-name or quick app switching).
  if (requestId !== pendingRequestId) {
    return;
  }
  isLogsRequestInFlight = false;
  pendingRequestAppName = '';
  allRows = [];
  filteredRows = [];
  selectedRowId = null;
  emptyStateMessage = `Failed to load logs for ${appName}: ${message}`;
  // Reset level filter so stale options from a previous successful load are cleared.
  hydrateDynamicFilterOptions([]);
  runFiltersRenderNow();
}

function handleLogsAppend(appName, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return;
  }

  const textLines = lines
    .filter((line) => typeof line === 'string')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (textLines.length === 0) {
    return;
  }

  const currentRaw = rawLogTextByApp.get(appName) ?? '';
  const updatedRaw = appendRawLogText(currentRaw, textLines.join('\n'));
  rawLogTextByApp.set(appName, updatedRaw);

  if (elements.filters.app.value === appName) {
    const parsedRows = appendParsedLinesForApp(appName, textLines);
    showRowsForSelectedApp(appName, parsedRows, true);
    return;
  }

  // Keep parsed cache warm for faster service switching from the app dropdown.
  appendParsedLinesForApp(appName, textLines);
}

function handleLogsStreamState(appName, status, message) {
  streamStateByApp.set(appName, { status, message: typeof message === 'string' ? message : '' });
  if (elements.filters.app.value === appName) {
    runFiltersRenderNow();
  }
}

function handleCopyLogResult(requestId, success) {
  const callback = pendingCopyCallbacks.get(requestId);
  pendingCopyCallbacks.delete(requestId);
  if (typeof callback === 'function') {
    callback(success);
  }
}

/**
 * Listen for messages from the VS Code extension host.
 */
function bindExtensionMessages() {
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (typeof msg !== 'object' || msg === null) {
      return;
    }

    if (msg.type === 'sapTools.scopeUpdate' && typeof msg.scope === 'string') {
      elements.workspaceScope.textContent = msg.scope;
    }

    if (msg.type === 'sapTools.appsUpdate' && Array.isArray(msg.apps)) {
      const selectedApp = typeof msg.selectedApp === 'string' ? msg.selectedApp : '';
      handleAppsUpdate(msg.apps, selectedApp);
    }

    if (msg.type === 'sapTools.activeAppsUpdate' && Array.isArray(msg.appNames)) {
      handleActiveAppsUpdate(msg.appNames);
    }

    if (
      msg.type === 'sapTools.logsLoaded' &&
      typeof msg.appName === 'string' &&
      typeof msg.logText === 'string'
    ) {
      const requestId = typeof msg.requestId === 'number' ? msg.requestId : -1;
      handleLogsLoaded(msg.appName, msg.logText, requestId);
    }

    if (msg.type === 'sapTools.logsAppend' && typeof msg.appName === 'string') {
      handleLogsAppend(msg.appName, msg.lines);
    }

    if (
      msg.type === 'sapTools.logsStreamState' &&
      typeof msg.appName === 'string' &&
      typeof msg.status === 'string'
    ) {
      handleLogsStreamState(msg.appName, msg.status, msg.message);
    }

    if (msg.type === 'sapTools.logsError' && typeof msg.appName === 'string') {
      const errorMsg = typeof msg.message === 'string' ? msg.message : 'Unknown error.';
      const requestId = typeof msg.requestId === 'number' ? msg.requestId : -1;
      handleLogsError(msg.appName, errorMsg, requestId);
    }

    if (
      msg.type === COPY_LOG_RESULT_MESSAGE_TYPE &&
      typeof msg.requestId === 'number' &&
      typeof msg.success === 'boolean'
    ) {
      handleCopyLogResult(msg.requestId, msg.success);
    }

    if (
      msg.type === COLUMN_SETTINGS_INIT_MESSAGE_TYPE &&
      Array.isArray(msg.visibleColumns)
    ) {
      const incoming = msg.visibleColumns.filter(
        (id) => typeof id === 'string'
      );
      visibleColumns = normalizeVisibleColumns(incoming);
      syncColumnSettingsToState();
      rebuildTableHeader();
      buildSettingsPanel();
      applyFiltersAndRender();
    }

    if (msg.type === FONT_SIZE_SETTING_INIT_MESSAGE_TYPE && typeof msg.fontSizePreset === 'string') {
      if (!isKnownFontSizePreset(msg.fontSizePreset)) {
        return;
      }
      fontSizePreset = msg.fontSizePreset;
      applyFontSizePreset();
      syncFontSizeSettingToState();
    }

    if (msg.type === LOG_LIMIT_SETTING_INIT_MESSAGE_TYPE && typeof msg.logLimit === 'number') {
      if (!isKnownLogLimit(msg.logLimit)) {
        return;
      }
      logLimit = msg.logLimit;
      applyLogLimitSetting();
      syncLogLimitSettingToState();
      reconcileRowsToCurrentLogLimit();
    }

    if (
      msg.type === MESSAGE_HEIGHT_LIMIT_SETTING_INIT_MESSAGE_TYPE &&
      typeof msg.limitMessageHeight === 'boolean'
    ) {
      limitMessageHeight = msg.limitMessageHeight;
      applyMessageHeightLimitSetting();
      syncMessageHeightLimitSettingToState();
    }
  });
}

function normalizeActiveAppNames(appNames) {
  const nextSet = new Set();
  for (const appName of appNames) {
    if (typeof appName !== 'string') {
      continue;
    }
    const normalized = appName.trim();
    if (normalized.length === 0) {
      continue;
    }
    nextSet.add(normalized);
  }
  return nextSet;
}

function normalizeAppsCatalog(apps) {
  const normalized = [];
  for (const app of apps) {
    if (typeof app !== 'object' || app === null) {
      continue;
    }

    const name = typeof app.name === 'string' ? app.name.trim() : '';
    if (name.length === 0) {
      continue;
    }

    const runningInstances =
      typeof app.runningInstances === 'number' && Number.isFinite(app.runningInstances)
        ? app.runningInstances
        : 0;

    normalized.push({
      name,
      runningInstances,
    });
  }

  return normalized;
}

function filterActiveNamesByCatalog(activeNames, appsCatalog) {
  if (appsCatalog.length === 0) {
    return new Set();
  }

  const catalogNameSet = new Set(appsCatalog.map((app) => app.name));
  const filtered = new Set();
  for (const name of activeNames) {
    if (catalogNameSet.has(name)) {
      filtered.add(name);
    }
  }
  return filtered;
}

function resolveActiveCatalogApps(appsCatalog, activeNames) {
  if (appsCatalog.length === 0 || activeNames.size === 0) {
    return [];
  }

  return appsCatalog.filter((app) => activeNames.has(app.name));
}

function clearTableToMessage(message) {
  allRows = [];
  filteredRows = [];
  selectedRowId = null;
  pendingRequestId += 1;
  isLogsRequestInFlight = false;
  pendingRequestAppName = '';
  emptyStateMessage = message;
  hydrateDynamicFilterOptions([]);
  runFiltersRenderNow();
}

function refreshAppSelectorAndLogs(preferredAppName) {
  if (latestApps.length === 0) {
    pruneAppCaches(new Set());
    rebuildAppSelect([], '');
    clearTableToMessage('No running apps found in the selected space.');
    return;
  }

  const activeApps = resolveActiveCatalogApps(latestApps, activeAppNames);
  const activeNameSet = new Set(activeApps.map((app) => app.name));
  pruneAppCaches(activeNameSet);

  if (activeApps.length === 0) {
    rebuildAppSelect([], '');
    clearTableToMessage('Start App Logging in the SAP Tools sidebar to stream logs.');
    return;
  }

  rebuildAppSelect(activeApps, preferredAppName);
  const selectedApp = elements.filters.app.value;
  if (selectedApp.length > 0) {
    showSelectedAppLogs(selectedApp, true);
  }
}

function showSelectedAppLogs(appName, requestSnapshotIfMissing) {
  const parsedRows = resolveParsedRowsForApp(appName);
  if (Array.isArray(parsedRows) && parsedRows.length > 0) {
    showRowsForSelectedApp(appName, parsedRows);
    return;
  }

  if (Array.isArray(parsedRows) && parsedRows.length === 0) {
    showRowsForSelectedApp(appName, parsedRows);
    return;
  }

  clearTableToMessage(`Loading logs for ${appName}\u2026`);
  if (requestSnapshotIfMissing) {
    requestLogsForApp(appName, true);
  }
}

function appendRawLogText(existingText, appendedText) {
  const mergedText = existingText.length > 0 ? `${existingText}\n${appendedText}` : appendedText;
  const charCap = resolveRawLogTextCharCap();
  if (mergedText.length <= charCap) {
    return mergedText;
  }

  return mergedText.slice(mergedText.length - charCap);
}

function showRowsForSelectedApp(appName, rows, deferRender = false) {
  allRows = rows.slice();
  filteredRows = [];
  // Preserve selection during streaming appends so the user's chosen row stays
  // highlighted when new lines arrive. Only reset on a full reload (deferRender=false).
  if (!deferRender) {
    selectedRowId = null;
  }
  emptyStateMessage = `No log entries found for ${appName}.`;
  if (deferRender) {
    hasPendingLevelHydration = true;
    scheduleFiltersRender();
    return;
  }
  hydrateDynamicFilterOptions(allRows);
  runFiltersRenderNow();
}

function resolveParsedRowsForApp(appName) {
  const cachedRows = parsedRowsByApp.get(appName);
  if (Array.isArray(cachedRows)) {
    return cachedRows;
  }

  const rawLogText = rawLogTextByApp.get(appName);
  if (typeof rawLogText !== 'string') {
    return null;
  }

  const parsedRows = trimRowsForMemory(parseCfRecentLog(rawLogText));
  parsedRowsByApp.set(appName, parsedRows);
  return parsedRows;
}

function appendParsedLinesForApp(appName, textLines) {
  const cachedRows = resolveParsedRowsForApp(appName);
  let nextRows = Array.isArray(cachedRows) ? cachedRows.slice() : [];
  let previousRow = nextRows.length > 0 ? nextRows[nextRows.length - 1] : null;
  let nextId =
    previousRow !== null && typeof previousRow.id === 'number' ? previousRow.id + 1 : 1;

  for (const line of textLines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    if (isCfCliSystemMessage(trimmedLine)) {
      continue;
    }

    const parsedRow = safeParseCfLine(trimmedLine, nextId);
    if (parsedRow !== null) {
      nextRows.push(parsedRow);
      previousRow = parsedRow;
      nextId += 1;
      continue;
    }

    if (previousRow !== null) {
      appendContinuationLine(previousRow, trimmedLine);
      continue;
    }

    const fallbackRow = buildTextRow({
      id: nextId,
      timestamp: 'N/A',
      source: 'SYSTEM',
      stream: 'OUT',
      body: trimmedLine,
    });
    nextRows.push(fallbackRow);
    previousRow = fallbackRow;
    nextId += 1;
  }

  nextRows = trimRowsForMemory(nextRows);
  parsedRowsByApp.set(appName, nextRows);
  return nextRows;
}

function pruneAppCaches(allowedAppNames) {
  pruneMapByKeys(rawLogTextByApp, allowedAppNames);
  pruneMapByKeys(parsedRowsByApp, allowedAppNames);
  pruneMapByKeys(streamStateByApp, allowedAppNames);
}

function pruneMapByKeys(map, allowedKeys) {
  for (const key of Array.from(map.keys())) {
    if (!allowedKeys.has(key)) {
      map.delete(key);
    }
  }
}

function trimRowsForMemory(rows) {
  const maxRows = Math.min(logLimit, MAX_PARSED_LOG_ROWS);
  if (rows.length <= maxRows) {
    return rows;
  }
  // Keep only the newest rows. Do not renumber IDs — stable IDs are required so
  // that selectedRowId remains valid across trims.
  return rows.slice(rows.length - maxRows);
}

function reconcileRowsToCurrentLogLimit() {
  const charCap = resolveRawLogTextCharCap();
  for (const [appName, rawLogText] of rawLogTextByApp.entries()) {
    const normalizedRaw =
      rawLogText.length > charCap ? rawLogText.slice(rawLogText.length - charCap) : rawLogText;
    if (normalizedRaw !== rawLogText) {
      rawLogTextByApp.set(appName, normalizedRaw);
    }
    parsedRowsByApp.set(appName, trimRowsForMemory(parseCfRecentLog(normalizedRaw)));
  }

  const selectedApp = elements.filters.app.value;
  if (selectedApp.length > 0) {
    const selectedRows = resolveParsedRowsForApp(selectedApp);
    if (Array.isArray(selectedRows)) {
      showRowsForSelectedApp(selectedApp, selectedRows);
      return;
    }
  }

  allRows = trimRowsForMemory(allRows.slice());
  runFiltersRenderNow();
}


// ── Render ───────────────────────────────────────────────────────────────────

function scheduleFiltersRender() {
  if (scheduledRenderFrame !== null) {
    return;
  }

  scheduledRenderFrame = window.requestAnimationFrame(() => {
    scheduledRenderFrame = null;
    if (hasPendingLevelHydration) {
      hydrateDynamicFilterOptions(allRows);
      hasPendingLevelHydration = false;
    }
    applyFiltersAndRender();
  });
}

function runFiltersRenderNow() {
  if (scheduledRenderFrame !== null) {
    window.cancelAnimationFrame(scheduledRenderFrame);
    scheduledRenderFrame = null;
  }

  if (hasPendingLevelHydration) {
    hydrateDynamicFilterOptions(allRows);
    hasPendingLevelHydration = false;
  }

  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  const searchTerm = elements.filters.search.value.trim().toLowerCase();
  const levelValue = elements.filters.level.value;

  const matchingRows = allRows.filter((row) => {
    if (levelValue !== 'all' && row.level !== levelValue) {
      return false;
    }

    if (searchTerm.length > 0 && !row.searchableText.includes(searchTerm)) {
      return false;
    }

    return true;
  });

  // Newest log lines should appear first in the table.
  filteredRows = matchingRows.slice().reverse();

  // Clear stale selection when the selected row is no longer in the filtered view.
  // Never auto-select a row — only explicit user clicks should establish a selection.
  if (selectedRowId !== null && !filteredRows.some((row) => row.id === selectedRowId)) {
    selectedRowId = null;
  }

  renderTable(filteredRows);
  renderSummary(filteredRows, allRows);
}

function renderTable(rows) {
  elements.tableBody.replaceChildren();
  pendingCopyCallbacks.clear();

  if (rows.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = visibleColumns.length;
    emptyCell.className = 'empty-row';
    emptyCell.textContent =
      allRows.length > 0 ? 'No rows match the current filters.' : emptyStateMessage;
    emptyRow.append(emptyCell);
    elements.tableBody.append(emptyRow);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');

    if (row.id === selectedRowId) {
      tr.classList.add('is-selected');
    }

    tr.addEventListener('click', () => {
      selectedRowId = row.id;
      renderTable(filteredRows);
      copyRowMessage(resolveRowMessageText(row));
    });

    for (const colId of visibleColumns) {
      const colDef = COLUMN_DEFS.find((c) => c.id === colId);
      if (colDef === undefined) {
        continue;
      }

      switch (colId) {
        case 'time':
          tr.append(createTextCell(row.timestamp, colDef.cellClass));
          break;
        case 'source':
          tr.append(createTextCell(row.source, colDef.cellClass));
          break;
        case 'stream':
          tr.append(createTextCell(row.stream, colDef.cellClass));
          break;
        case 'level':
          tr.append(createBadgeCell(row.level, `badge badge-level-${row.level}`, colDef.cellClass));
          break;
        case 'method':
          tr.append(createMethodCell(row.method, colDef.cellClass));
          break;
        case 'logger':
          tr.append(createTextCell(row.logger, `cell-logger ${colDef.cellClass}`));
          break;
        case 'request':
          tr.append(createRequestCell(row.request, colDef.cellClass, row.requestTitle));
          break;
        case 'status':
          tr.append(createStatusCell(row.status, colDef.cellClass));
          break;
        case 'latency':
          tr.append(createLatencyCell(row.latency, colDef.cellClass));
          break;
        case 'tenant':
          tr.append(createTextCell(row.tenant, `cell-tenant ${colDef.cellClass}`));
          break;
        case 'clientIp':
          tr.append(createTextCell(row.clientIp, `cell-client-ip ${colDef.cellClass}`));
          break;
        case 'requestId':
          tr.append(createTextCell(row.requestId, `cell-request-id ${colDef.cellClass}`));
          break;
        case 'message':
          tr.append(createMessageCell(row));
          break;
        default:
          break;
      }
    }

    elements.tableBody.append(tr);
  }
}

function createTextCell(value, className) {
  const td = document.createElement('td');
  if (className !== undefined) {
    td.className = className;
  }
  td.textContent = value.length > 0 ? value : '-';
  return td;
}

function createBadgeCell(value, badgeClass, cellClass) {
  const td = document.createElement('td');
  if (cellClass !== undefined) {
    td.className = cellClass;
  }
  const badge = document.createElement('span');
  badge.className = badgeClass;
  badge.textContent = value.toUpperCase();
  td.append(badge);
  return td;
}

function createMethodCell(method, cellClass) {
  const td = document.createElement('td');
  td.className = `cell-method ${cellClass}`;
  td.textContent = method.length > 0 ? method : '-';
  return td;
}

function createMessageCell(row) {
  const td = document.createElement('td');
  td.className = 'cell-message col-message';
  const textValue = resolveRowMessageText(row);
  const messageText = document.createElement('div');
  messageText.className = 'cell-message-text';
  messageText.textContent = textValue;
  td.append(messageText);
  return td;
}

function resolveRowMessageText(row) {
  if (typeof row.rawBody === 'string' && row.rawBody.length > 0) {
    return row.rawBody;
  }
  return row.message.length > 0 ? row.message : '-';
}

function createRequestCell(request, cellClass, requestTitle) {
  const td = document.createElement('td');
  td.className = `cell-request ${cellClass}`;
  const textValue = request.length > 0 ? request : '-';
  const titleValue =
    typeof requestTitle === 'string' && requestTitle.length > 0 ? requestTitle : textValue;
  td.title = titleValue;
  const requestText = document.createElement('div');
  requestText.className = 'cell-request-text';
  requestText.textContent = textValue;
  td.append(requestText);
  return td;
}

function createStatusCell(status, cellClass) {
  const td = document.createElement('td');
  td.className = `cell-status ${cellClass}`;
  if (!/^\d{3}$/.test(status)) {
    return td;
  }

  const badge = document.createElement('span');
  badge.className = `badge ${resolveStatusBadgeClass(status)}`;
  badge.textContent = status;
  td.append(badge);
  return td;
}

function createLatencyCell(latency, cellClass) {
  const td = document.createElement('td');
  td.className = `cell-latency ${cellClass}`;
  td.textContent = latency;
  return td;
}

function resolveStatusBadgeClass(status) {
  if (status.startsWith('5')) {
    return 'badge-http-5xx';
  }
  if (status.startsWith('4')) {
    return 'badge-http-4xx';
  }
  if (status.startsWith('3')) {
    return 'badge-http-3xx';
  }
  return 'badge-http-2xx';
}

function copyRowMessage(value) {
  if (vscodeApi !== null) {
    nextCopyRequestId += 1;
    const requestId = nextCopyRequestId;
    pendingCopyCallbacks.set(requestId, (success) => {
      if (success) {
        showCopyToast();
      }
    });
    vscodeApi.postMessage({
      type: COPY_LOG_MESSAGE_TYPE,
      requestId,
      text: value,
    });
    return;
  }

  void writeTextToClipboard(value).finally(() => {
    showCopyToast();
  });
}

function showCopyToast() {
  elements.copyToast.classList.add('is-visible');
  if (copyToastTimer !== null) {
    clearTimeout(copyToastTimer);
  }
  copyToastTimer = window.setTimeout(() => {
    elements.copyToast.classList.remove('is-visible');
    copyToastTimer = null;
  }, COPY_TOAST_VISIBLE_MS);
}

async function writeTextToClipboard(value) {
  if (
    typeof navigator === 'object' &&
    navigator !== null &&
    typeof navigator.clipboard?.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Continue with fallback below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

// ── Column settings ───────────────────────────────────────────────────────────

function isKnownFontSizePreset(value) {
  return FONT_SIZE_PRESETS.includes(value);
}

function isKnownLogLimit(value) {
  return Number.isInteger(value) && LOG_LIMIT_PRESETS.includes(value);
}

function resolveRawLogTextCharCap() {
  const capByLimit = logLimit * RAW_LOG_TEXT_CHARS_PER_LIMIT_ROW;
  return Math.min(MAX_RAW_LOG_TEXT_CHARS, Math.max(MIN_RAW_LOG_TEXT_CHARS, capByLimit));
}

function applyFontSizePreset() {
  document.body.classList.remove(
    'cf-log-font-smaller',
    'cf-log-font-default',
    'cf-log-font-large',
    'cf-log-font-xlarge'
  );
  document.body.classList.add(`cf-log-font-${fontSizePreset}`);
  elements.settingsFontSize.value = fontSizePreset;
}

function handleFontSizePresetChange(nextPreset) {
  if (!isKnownFontSizePreset(nextPreset) || nextPreset === fontSizePreset) {
    return;
  }

  fontSizePreset = nextPreset;
  applyFontSizePreset();
  syncFontSizeSettingToState();
  saveFontSizeSetting();
}

function applyLogLimitSetting() {
  elements.settingsLogLimit.value = String(logLimit);
}

function handleLogLimitChange(nextLimitRaw) {
  const nextLimit = Number.parseInt(nextLimitRaw, 10);
  if (!isKnownLogLimit(nextLimit) || nextLimit === logLimit) {
    applyLogLimitSetting();
    return;
  }

  logLimit = nextLimit;
  applyLogLimitSetting();
  syncLogLimitSettingToState();
  saveLogLimitSetting();
  reconcileRowsToCurrentLogLimit();
}

function applyMessageHeightLimitSetting() {
  document.body.classList.toggle('cf-log-message-limited', limitMessageHeight);
  elements.settingsMessageLimit.checked = limitMessageHeight;
}

function handleMessageHeightLimitChange(nextLimitMessageHeight) {
  if (nextLimitMessageHeight === limitMessageHeight) {
    applyMessageHeightLimitSetting();
    return;
  }

  limitMessageHeight = nextLimitMessageHeight;
  applyMessageHeightLimitSetting();
  syncMessageHeightLimitSettingToState();
  saveMessageHeightLimitSetting();
}

/**
 * Rebuild the <thead> row to match the current visibleColumns list.
 */
function rebuildTableHeader() {
  const tr = elements.tableHead.rows[0] ?? elements.tableHead.insertRow();
  tr.replaceChildren();

  for (const colId of visibleColumns) {
    const colDef = COLUMN_DEFS.find((c) => c.id === colId);
    if (colDef === undefined) {
      continue;
    }
    const th = document.createElement('th');
    th.className = colDef.cellClass;
    th.textContent = colDef.label;
    tr.append(th);
  }
}

/**
 * Populate the settings panel checkboxes based on COLUMN_DEFS and visibleColumns.
 */
function buildSettingsPanel() {
  elements.settingsColumnToggles.replaceChildren();
  elements.settingsFontSize.value = fontSizePreset;
  elements.settingsLogLimit.value = String(logLimit);
  elements.settingsMessageLimit.checked = limitMessageHeight;

  for (const colDef of COLUMN_DEFS) {
    const label = document.createElement('label');
    label.className = 'settings-column-item' + (colDef.required ? ' is-required' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.columnId = colDef.id;
    checkbox.checked = visibleColumns.includes(colDef.id);
    checkbox.disabled = colDef.required;

    const span = document.createElement('span');
    span.textContent = colDef.label;

    label.append(checkbox, span);
    elements.settingsColumnToggles.append(label);
  }
}

function openSettingsPanel() {
  elements.settingsPanel.hidden = false;
  elements.settingsPanel.setAttribute('aria-hidden', 'false');
  elements.settingsToggle.classList.add('is-active');
  elements.settingsToggle.setAttribute('aria-expanded', 'true');
}

function closeSettingsPanel() {
  elements.settingsPanel.hidden = true;
  elements.settingsPanel.setAttribute('aria-hidden', 'true');
  elements.settingsToggle.classList.remove('is-active');
  elements.settingsToggle.setAttribute('aria-expanded', 'false');
}

function toggleSettingsPanel() {
  if (elements.settingsPanel.hidden) {
    openSettingsPanel();
  } else {
    closeSettingsPanel();
  }
}

/**
 * Called when a column checkbox changes. Updates visibleColumns, persists, and re-renders.
 * @param {string} colId
 * @param {boolean} checked
 */
function handleColumnToggle(colId, checked) {
  const colDef = COLUMN_DEFS.find((c) => c.id === colId);
  if (colDef === undefined || colDef.required) {
    return;
  }

  if (checked && !visibleColumns.includes(colId)) {
    visibleColumns = normalizeVisibleColumns([...visibleColumns, colId]);
  } else if (!checked) {
    visibleColumns = normalizeVisibleColumns(
      visibleColumns.filter((id) => id !== colId)
    );
  }

  syncColumnSettingsToState();
  saveColumnSettings();
  rebuildTableHeader();
  applyFiltersAndRender();
}

/**
 * Persist visibleColumns to vscode webview state (fast, session-scoped cache).
 */
function syncColumnSettingsToState() {
  if (vscodeApi !== null) {
    const existing = vscodeApi.getState() ?? {};
    vscodeApi.setState({ ...existing, visibleColumns });
  }
}

function syncFontSizeSettingToState() {
  if (vscodeApi !== null) {
    const existing = vscodeApi.getState() ?? {};
    vscodeApi.setState({ ...existing, fontSizePreset });
  }
}

function syncLogLimitSettingToState() {
  if (vscodeApi !== null) {
    const existing = vscodeApi.getState() ?? {};
    vscodeApi.setState({ ...existing, logLimit });
  }
}

function syncMessageHeightLimitSettingToState() {
  if (vscodeApi !== null) {
    const existing = vscodeApi.getState() ?? {};
    vscodeApi.setState({ ...existing, limitMessageHeight });
  }
}

/**
 * Send visibleColumns to the extension host for cross-session persistence (globalState).
 */
function saveColumnSettings() {
  if (vscodeApi !== null) {
    vscodeApi.postMessage({
      type: SAVE_COLUMN_SETTINGS_MESSAGE_TYPE,
      visibleColumns,
    });
  }
}

function saveFontSizeSetting() {
  if (vscodeApi !== null) {
    vscodeApi.postMessage({
      type: SAVE_FONT_SIZE_SETTING_MESSAGE_TYPE,
      fontSizePreset,
    });
  }
}

function saveLogLimitSetting() {
  if (vscodeApi !== null) {
    vscodeApi.postMessage({
      type: SAVE_LOG_LIMIT_SETTING_MESSAGE_TYPE,
      logLimit,
    });
  }
}

function saveMessageHeightLimitSetting() {
  if (vscodeApi !== null) {
    vscodeApi.postMessage({
      type: SAVE_MESSAGE_HEIGHT_LIMIT_SETTING_MESSAGE_TYPE,
      limitMessageHeight,
    });
  }
}

function renderSummary(rows, all) {
  elements.tableSummary.textContent = `${rows.length} of ${all.length} rows`;
}
