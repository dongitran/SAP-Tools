const API_DEFAULT_TOP = '100';

let apiSelectedEntity = '';
let apiAuthMethod = 'xsuaa-auto';
let apiHttpMethod = 'GET';
let apiHttpBody = '';
let apiParams = {
  $select: '',
  $filter: '',
  $expand: '',
  $top: API_DEFAULT_TOP,
  $skip: '0'
};
let apiResultState = 'idle';
let apiResultTime = 0;
let apiResultStatus = '';
let apiResultPayload = null;
let apiActiveView = 'json';
let apiActiveMainTab = 'request-runner';

let apiCatalogState = 'loading';
let apiCurrentCatalog = null;

let apiTraceState = 'idle';
let apiTraceStatusMessage = '';
let apiTraceRuntimeHookInstalled = false;
let apiTraceRuntimeHookMayRemain = false;
let apiTraceEvents = [];
let apiTraceSelectedEventId = '';
let apiTraceSelectedUrl = 'all';
let apiTraceMethodFilter = 'all';
let apiTraceStatusFilter = 'all';
let apiTraceSearchText = '';
let apiTraceCaptureHeaders = true;
let apiTraceCaptureRequestBody = true;
let apiTraceCaptureResponseBody = true;
let apiTraceSettingsOpen = false;
let apiTraceDetailTab = 'overview';
let apiTraceReplayInFlightEventId = '';
let apiTraceReplayRequestId = '';

const API_TRACE_EVENT_LIMIT = 1000;
const API_TRACE_PREFERENCES_KEY = 'saptools.apis.trace.preferences';
const TRACE_REPLAY_DISPATCH_DELAY_MS = 500;
const TRACE_REPLAY_OMITTED_HEADERS = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const endpointSessions = new Map();

function saveEndpointSession() {
  if (!apiSelectedEntity) return;
  // Key format: appId::entityName
  const key = `${window.apiSelectedAppId || 'demo-app'}::${apiSelectedEntity}`;
  endpointSessions.set(key, {
    apiAuthMethod,
    apiHttpMethod,
    apiHttpBody,
    apiParams: { ...apiParams },
    apiResultState,
    apiResultTime,
    apiResultStatus,
    apiResultPayload,
    apiActiveView
  });
}

function loadEndpointSession(entityName) {
  const key = `${window.apiSelectedAppId || 'demo-app'}::${entityName}`;
  const session = endpointSessions.get(key);
  if (session) {
    apiAuthMethod = session.apiAuthMethod;
    apiHttpMethod = session.apiHttpMethod;
    apiHttpBody = session.apiHttpBody;
    apiParams = { ...session.apiParams };
    apiResultState = session.apiResultState;
    apiResultTime = session.apiResultTime;
    apiResultStatus = session.apiResultStatus;
    apiResultPayload = session.apiResultPayload;
    apiActiveView = session.apiActiveView;
  } else {
    // defaults
    apiHttpMethod = 'GET';
    apiHttpBody = '';
    apiParams = {
      $select: '',
      $filter: '',
      $expand: '',
      $top: API_DEFAULT_TOP,
      $skip: '0'
    };
    apiResultState = 'idle';
    apiResultTime = 0;
    apiResultStatus = '';
    apiResultPayload = null;
    apiActiveView = 'json';
  }
}

// Global VS Code API reference
const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

function currentApiTracePreferences() {
  return {
    captureHeaders: apiTraceCaptureHeaders,
    captureRequestBody: apiTraceCaptureRequestBody,
    captureResponseBody: apiTraceCaptureResponseBody
  };
}

function applyApiTracePreferences(value) {
  if (!value || typeof value !== 'object') return false;
  apiTraceCaptureHeaders = typeof value.captureHeaders === 'boolean' ? value.captureHeaders : true;
  apiTraceCaptureRequestBody = typeof value.captureRequestBody === 'boolean' ? value.captureRequestBody : true;
  apiTraceCaptureResponseBody = typeof value.captureResponseBody === 'boolean' ? value.captureResponseBody : true;
  return true;
}

function readSessionApiTracePreferences() {
  try {
    const raw = sessionStorage.getItem(API_TRACE_PREFERENCES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadApiTracePreferences() {
  const webviewState = vscodeApi && typeof vscodeApi.getState === 'function' ? vscodeApi.getState() : null;
  const statePreferences = webviewState && typeof webviewState === 'object' ? webviewState.apiTracePreferences : null;
  const candidates = [
    statePreferences,
    window.sapToolsApiTracePreferences,
    readSessionApiTracePreferences()
  ];
  for (const candidate of candidates) {
    if (applyApiTracePreferences(candidate)) return;
  }
}

function saveApiTracePreferences() {
  const preferences = currentApiTracePreferences();
  if (vscodeApi && typeof vscodeApi.getState === 'function' && typeof vscodeApi.setState === 'function') {
    const currentState = vscodeApi.getState();
    const nextState = currentState && typeof currentState === 'object' ? { ...currentState } : {};
    nextState.apiTracePreferences = preferences;
    vscodeApi.setState(nextState);
    vscodeApi.postMessage({
      type: 'sapTools.apis.trace.preferencesChanged',
      payload: preferences
    });
    return;
  }
  try {
    sessionStorage.setItem(API_TRACE_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage failures; trace capture defaults remain available in memory.
  }
}

// We just copy the mock data from 07h-render-apis.js for independence in the webview
const API_MOCK_CATALOG = {
  'demo-app': {
    serviceName: 'DemoService',
    servicePath: '/odata/v4/demo',
    entities: [
      { name: 'Users', count: 12 },
      { name: 'Products', count: 48 },
      { name: 'Orders', count: 8 }
    ]
  },
  'api1': {
    serviceName: 'DataService',
    servicePath: '/odata/v4/data',
    entities: [
      { name: 'Records', count: 1420 },
      { name: 'Logs', count: 2110 },
      { name: 'Settings', count: 850 }
    ]
  },
  'api2': {
    serviceName: 'AnalyticsService',
    servicePath: '/odata/v4/analytics',
    entities: [
      { name: 'Metrics', count: 580 },
      { name: 'Dimensions', count: 24 }
    ]
  }
};

const API_MOCK_RESPONSES = {
  'demo-app': {
    'Users': {
      value: [
        { id: 'U001', name: 'Alice', role: 'Admin', active: true },
        { id: 'U002', name: 'Bob', role: 'User', region: 'APAC' },
        { id: 'U003', name: 'Charlie', role: 'User', lastLogin: null }
      ]
    },
    'Products': {
      value: [
        { id: 'P001', title: 'Laptop', price: 999, currency: 'USD' },
        { id: 'P002', title: 'Mouse', price: 29.99, stock: 120 },
        { id: 'P003', title: 'Keyboard', price: 59.5, tags: ['hardware', 'office'] }
      ]
    },
    'Orders': {
      value: [
        { orderId: 'O1001', status: 'Shipped', total: 1028.99 },
        { orderId: 'O1002', status: 'Pending', total: 59.5, priority: true }
      ]
    }
  },
  'api1': {
    'Records': {
      value: [
        { recordID: 'REC001', companyName: 'Demo Company A', code: 'A123', status: 'ACTIVE' },
        { recordID: 'REC002', companyName: 'Demo Company B', code: 'B456', status: 'INACTIVE' }
      ]
    }
  }
};

const API_MOCK_TRACE_EVENTS = [
  {
    id: 'trace-001',
    timestamp: '2026-06-18T07:22:10.120Z',
    appId: 'demo-app',
    instance: '0',
    method: 'GET',
    path: '/odata/v4/products',
    url: 'https://mock.example.com/odata/v4/products?$top=5&access_token=demo-access-token',
    normalizedUrl: '/odata/v4/products?$top=5&access_token=demo-access-token',
    status: 200,
    durationMs: 84,
    requestBytes: 0,
    responseBytes: 1248,
    requestHeaders: {
      accept: 'application/json',
      authorization: 'Bearer demo-access-token',
      'x-saptools-trace-id': 'trace-runner-001'
    },
    responseHeaders: {
      'content-type': 'application/json',
      'set-cookie': 'session=demo-cookie'
    },
    requestBodyPreview: '',
    responseBodyPreview: '{ "value": [{ "ID": "P001", "name": "Notebook" }] }',
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    droppedBeforeEvent: 0,
    source: 'runtime-http',
    traceId: 'trace-001',
    correlationId: 'trace-runner-001'
  },
  {
    id: 'trace-002',
    timestamp: '2026-06-18T07:22:12.340Z',
    appId: 'demo-app',
    instance: '0',
    method: 'POST',
    path: '/odata/v4/orders',
    url: 'https://mock.example.com/odata/v4/orders',
    normalizedUrl: '/odata/v4/orders',
    status: 201,
    durationMs: 133,
    requestBytes: 96,
    responseBytes: 420,
    requestHeaders: {
      authorization: 'Bearer demo-access-token',
      'content-type': 'application/json'
    },
    responseHeaders: {
      'content-type': 'application/json'
    },
    requestBodyPreview: '{ "amount": 1200, "token": "demo-access-token" }',
    responseBodyPreview: '{ "ID": "O1001", "status": "created" }',
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    droppedBeforeEvent: 0,
    source: 'runtime-http',
    traceId: 'trace-002',
    correlationId: null
  },
  {
    id: 'trace-003',
    timestamp: '2026-06-18T07:22:18.900Z',
    appId: 'demo-app',
    instance: '0',
    method: 'PATCH',
    path: '/odata/v4/orders(1)',
    url: 'https://mock.example.com/odata/v4/orders(1)',
    normalizedUrl: '/odata/v4/orders(1)',
    status: 400,
    durationMs: 49,
    requestBytes: 74,
    responseBytes: 292,
    requestHeaders: {
      authorization: 'Bearer demo-access-token',
      'x-csrf-token': 'demo-csrf-token'
    },
    responseHeaders: {
      'content-type': 'application/json'
    },
    requestBodyPreview: '{ "status": "invalid", "client_secret": "demo-client-secret" }',
    responseBodyPreview: '{ "error": { "message": "Validation failed" } }',
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    droppedBeforeEvent: 0,
    source: 'runtime-http',
    traceId: 'trace-003',
    correlationId: null
  }
];

const appElement = document.getElementById('webview-app');

function resolveMockApiCatalog() {
  return API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
}

function resolveApiCatalog() {
  if (apiCurrentCatalog !== null) return apiCurrentCatalog;
  if (apiCatalogState === 'loading') return null;
  if (!vscodeApi) return resolveMockApiCatalog();
  return null;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function buildApiQueryString() {
  const parts = [];
  for (const [key, val] of Object.entries(apiParams)) {
    if (val.trim().length > 0) {
      parts.push(`${key}=${encodeURIComponent(val)}`);
    }
  }
  return parts.length > 0 ? parts.join('&') : '';
}

function extractArrayFromPayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload;
  if (payload.value && Array.isArray(payload.value)) return payload.value;
  if (payload.d && payload.d.results && Array.isArray(payload.d.results)) return payload.d.results;
  return null;
}

function copyResponseData() {
  let contentToCopy = '';
  if (apiActiveView === 'json') {
    contentToCopy = JSON.stringify(apiResultPayload, null, 2);
  } else {
    const rows = extractArrayFromPayload(apiResultPayload);
    if (!rows || rows.length === 0) return;

    const columns = collectApiGridColumns(rows);
    const header = columns.join('\t');
    const body = rows.map(r => columns.map(c => formatApiGridCell(resolveApiGridCell(r, c))).join('\t')).join('\n');
    contentToCopy = `${header}\n${body}`;
  }

  if (!contentToCopy) return;

  navigator.clipboard.writeText(contentToCopy).then(() => {
    const btn = document.querySelector('.api-copy-btn');
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = '&#10003; Copied!';
      setTimeout(() => { btn.innerHTML = originalText; }, 2000);
    }
  }).catch(() => undefined);
}

function renderApiParamRow(paramName, value, placeholder, type = 'text') {
  const inputId = `api-param-${paramName.replace('$', '')}`;
  return `
    <label class="api-param-field" for="${inputId}">
      <span class="api-param-name">${paramName}</span>
      <input
        id="${inputId}"
        type="${type}"
        data-role="api-param-input"
        data-param-name="${paramName}"
        value="${escapeHtml(value)}"
        placeholder="${placeholder}"
        autocomplete="off"
      />
    </label>
  `;
}

function renderApiGridResult() {
  const rows = extractArrayFromPayload(apiResultPayload);
  if (!rows) return '<div class="api-grid-empty">No tabular data in this response.</div>';
  if (rows.length === 0) return '<div class="api-grid-empty">Empty result set.</div>';
  
  const columns = collectApiGridColumns(rows);
  if (columns.length === 0) return '<div class="api-grid-empty">No columns available.</div>';

  const headerHtml = columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const rowsHtml = rows.map(r => {
    return '<tr>' + columns.map(c => `<td>${escapeHtml(formatApiGridCell(resolveApiGridCell(r, c)))}</td>`).join('') + '</tr>';
  }).join('');

  return `
    <div class="api-grid-container">
      <table class="api-grid-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function collectApiGridColumns(rows) {
  const columns = [];
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!columns.includes(key)) columns.push(key);
      }
    } else if (!columns.includes('value')) {
      columns.push('value');
    }
  }
  return columns;
}

function resolveApiGridCell(row, column) {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    return Object.prototype.hasOwnProperty.call(row, column) ? row[column] : '';
  }
  return column === 'value' ? row : '';
}

function formatApiGridCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const API_JSON_TOKEN_PATTERN = /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;

function highlightApiJson(json) {
  return json.replace(API_JSON_TOKEN_PATTERN, (token, offset, source) => {
    let tokenClass = 'api-json-punctuation';
    if (token.startsWith('"')) {
      const afterToken = source.slice(offset + token.length);
      tokenClass = /^\s*:/.test(afterToken) ? 'api-json-key' : 'api-json-string';
    } else if (/^-?\d/.test(token)) {
      tokenClass = 'api-json-number';
    } else if (token === 'true' || token === 'false' || token === 'null') {
      tokenClass = 'api-json-literal';
    }
    return `<span class="api-json-token ${tokenClass}">${escapeHtml(token)}</span>`;
  });
}

function renderApiJsonResult(payload) {
  const json = JSON.stringify(payload, null, 2);
  return `<pre class="api-raw-json is-json" aria-label="API JSON response">${highlightApiJson(json)}</pre>`;
}

const API_TRACE_JSON_TOKEN_PATTERN = /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;

function highlightTraceJson(json) {
  return json.replace(API_TRACE_JSON_TOKEN_PATTERN, (token, offset, source) => {
    let tokenClass = 'api-trace-json-punctuation';
    if (token.startsWith('"')) {
      const afterToken = source.slice(offset + token.length);
      tokenClass = /^\s*:/.test(afterToken) ? 'api-trace-json-key' : 'api-trace-json-string';
    } else if (/^-?\d/.test(token)) {
      tokenClass = 'api-trace-json-number';
    } else if (token === 'true' || token === 'false' || token === 'null') {
      tokenClass = 'api-trace-json-literal';
    }
    return `<span class="api-trace-json-token ${tokenClass}">${escapeHtml(token)}</span>`;
  });
}

function formatTraceJsonPreview(preview) {
  const text = String(preview ?? '').replace(/^\uFEFF/, '').trim();
  if (text.length === 0) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function renderTracePreview(preview, truncated, ariaLabel) {
  const text = String(preview ?? '');
  if (!text) return '<div class="api-trace-empty-detail">No body preview captured.</div>';
  const json = formatTraceJsonPreview(text);
  if (json !== null) {
    return `<pre class="api-trace-preview is-json" aria-label="${escapeHtml(ariaLabel)}">${highlightTraceJson(json)}</pre>`;
  }
  return `<pre class="api-trace-preview" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(text)}</pre>`;
}

function formatTraceClock(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusBucket(status) {
  if (typeof status !== 'number') return 'unknown';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'unknown';
}

function formatTraceStateLabel(state) {
  const labels = {
    idle: 'Idle',
    preparingCli: 'Starting',
    enablingSsh: 'Enabling SSH',
    checkingRuntime: 'Checking runtime',
    openingTunnel: 'Opening tunnel',
    injecting: 'Installing hook',
    streaming: 'Listening',
    paused: 'Paused',
    stopping: 'Stopping',
    stopped: 'Stopped',
    needsInspector: 'Needs Inspector',
    error: 'Error'
  };
  return labels[state] || 'Idle';
}

function formatTraceStateTooltip(state, message) {
  const statusMessage = typeof message === 'string' ? message.trim() : '';
  if (state === 'error' && statusMessage.length > 0) return statusMessage;
  if (state === 'needsInspector' && statusMessage.length > 0) return statusMessage;
  if (statusMessage.length > 0) return statusMessage;
  return formatTraceStateLabel(state);
}

function normalizeTraceUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return '/';
  try {
    const parsed = new URL(rawUrl, 'https://saptools.local');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

function normalizedTraceEvent(event) {
  const normalizedUrl = normalizeTraceUrl(event.normalizedUrl || event.url || event.path);
  const rawUrl = typeof event.url === 'string' && event.url.length > 0 ? event.url : normalizedUrl;
  return {
    id: String(event.id || event.traceId || `${Date.now()}-${Math.random()}`),
    timestamp: String(event.timestamp || new Date().toISOString()),
    appId: String(event.appId || apiSelectedAppId || ''),
    instance: String(event.instance || '0'),
    method: String(event.method || 'GET').toUpperCase(),
    path: String(event.path || normalizedUrl),
    url: rawUrl,
    normalizedUrl,
    status: typeof event.status === 'number' ? event.status : null,
    durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
    requestBytes: typeof event.requestBytes === 'number' ? event.requestBytes : 0,
    responseBytes: typeof event.responseBytes === 'number' ? event.responseBytes : 0,
    requestHeaders: event.requestHeaders && typeof event.requestHeaders === 'object' ? event.requestHeaders : {},
    responseHeaders: event.responseHeaders && typeof event.responseHeaders === 'object' ? event.responseHeaders : {},
    requestBodyPreview: typeof event.requestBodyPreview === 'string' ? event.requestBodyPreview : '',
    responseBodyPreview: typeof event.responseBodyPreview === 'string' ? event.responseBodyPreview : '',
    requestBodyTruncated: event.requestBodyTruncated === true,
    responseBodyTruncated: event.responseBodyTruncated === true,
    droppedBeforeEvent: typeof event.droppedBeforeEvent === 'number' ? event.droppedBeforeEvent : 0,
    source: 'runtime-http',
    traceId: String(event.traceId || event.id || ''),
    correlationId: typeof event.correlationId === 'string' ? event.correlationId : null
  };
}

function appendTraceEvents(events) {
  const normalized = events.map(normalizedTraceEvent);
  apiTraceEvents = [...apiTraceEvents, ...normalized].slice(-API_TRACE_EVENT_LIMIT);
  if (!apiTraceSelectedEventId && apiTraceEvents.length > 0) {
    apiTraceSelectedEventId = apiTraceEvents[apiTraceEvents.length - 1].id;
  }
  renderLiveTracePanel();
}

function buildTraceUrlSummaries() {
  const summaries = new Map();
  for (const event of apiTraceEvents) {
    const key = event.normalizedUrl || normalizeTraceUrl(event.url || event.path);
    const existing = summaries.get(key) || {
      normalizedUrl: key,
      displayUrl: key,
      methods: new Set(),
      totalCount: 0,
      statusCounts: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, unknown: 0 },
      latestStatus: null,
      latestDurationMs: null,
      latestSeenAt: ''
    };
    existing.methods.add(event.method);
    existing.totalCount += 1;
    existing.statusCounts[statusBucket(event.status)] += 1;
    existing.latestStatus = event.status;
    existing.latestDurationMs = event.durationMs;
    existing.latestSeenAt = event.timestamp;
    summaries.set(key, existing);
  }
  return [...summaries.values()]
    .map((summary) => ({ ...summary, methods: [...summary.methods].sort() }))
    .sort((left, right) => right.latestSeenAt.localeCompare(left.latestSeenAt));
}

function eventMatchesTraceFilters(event) {
  if (apiTraceSelectedUrl !== 'all' && event.normalizedUrl !== apiTraceSelectedUrl) return false;
  if (apiTraceMethodFilter !== 'all' && event.method !== apiTraceMethodFilter) return false;
  if (apiTraceStatusFilter !== 'all' && statusBucket(event.status) !== apiTraceStatusFilter) return false;
  const search = apiTraceSearchText.trim().toLowerCase();
  if (!search) return true;
  const haystack = [
    event.traceId,
    event.correlationId || '',
    event.method,
    event.status === null ? '' : String(event.status),
    event.instance,
    event.normalizedUrl,
    event.path,
    event.url,
    JSON.stringify(event.requestHeaders),
    JSON.stringify(event.responseHeaders),
    event.requestBodyPreview,
    event.responseBodyPreview
  ].join(' ').toLowerCase();
  return haystack.includes(search);
}

function filteredTraceEvents() {
  return apiTraceEvents.filter(eventMatchesTraceFilters).slice().reverse();
}

function selectedTraceEvent() {
  const selected = apiTraceEvents.find((event) => event.id === apiTraceSelectedEventId);
  if (selected && eventMatchesTraceFilters(selected)) return selected;
  return filteredTraceEvents()[0] || null;
}

function renderHeaderTable(headers) {
  const entries = Object.entries(headers || {});
  if (entries.length === 0) return '<div class="api-trace-empty-detail">No headers captured.</div>';
  return `
    <dl class="api-trace-header-list">
      ${entries.map(([key, value]) => `
        <dt>${escapeHtml(key)}</dt>
        <dd>${escapeHtml(String(value))}</dd>
      `).join('')}
    </dl>
  `;
}

function renderTraceHeaderSection(title, headers) {
  return `
    <section class="api-trace-subsection">
      <h5>${escapeHtml(title)}</h5>
      ${renderHeaderTable(headers)}
    </section>
  `;
}

function renderTraceBodySection(kind, title, preview, truncated) {
  const hasPreview = typeof preview === 'string' && preview.length > 0;
  return `
    <section class="api-trace-subsection api-trace-body-section is-${escapeHtml(kind)}">
      <div class="api-trace-subsection-head">
        <h5>${escapeHtml(title)}</h5>
        ${hasPreview ? `<button type="button" class="api-trace-copy-body-btn" data-action="api-trace-copy-body" data-body-kind="${escapeHtml(kind)}" aria-label="Copy ${escapeHtml(title)}" title="Copy ${escapeHtml(title)}">&#128203;</button>` : ''}
      </div>
      ${renderTracePreview(preview, truncated, title)}
    </section>
  `;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolveTraceCurlUrl(event) {
  const rawUrl = String(event.url || event.normalizedUrl || event.path || '/');
  try {
    new URL(rawUrl);
    return rawUrl;
  } catch {
    const catalog = resolveApiCatalog();
    const baseUrl = catalog && typeof catalog.baseUrl === 'string' ? catalog.baseUrl.replace(/\/+$/, '') : '';
    if (!baseUrl) return rawUrl;
    return `${baseUrl}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
  }
}

function buildTraceCurlCommand(event) {
  const lines = [`curl -i -X ${event.method} ${shellQuote(resolveTraceCurlUrl(event))}`];
  if (apiTraceCaptureHeaders) {
    for (const [key, value] of Object.entries(event.requestHeaders || {})) {
      lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
    }
  }
  if (apiTraceCaptureRequestBody && event.requestBodyPreview) {
    lines.push(`  --data-raw ${shellQuote(event.requestBodyPreview)}`);
  }
  return lines.join(' \\\n');
}

function copyTraceBodyPreview(kind, button) {
  const event = selectedTraceEvent();
  if (event === null) return;
  const preview = kind === 'response' ? event.responseBodyPreview : event.requestBodyPreview;
  if (!preview || !navigator.clipboard) return;
  navigator.clipboard.writeText(preview).then(() => {
    if (!button) return;
    const previous = button.innerHTML;
    button.innerHTML = '&#10003;';
    window.setTimeout(() => {
      button.innerHTML = previous;
    }, 1200);
  }).catch(() => undefined);
}

function copyTraceCurl(button) {
  const event = selectedTraceEvent();
  if (event === null || !navigator.clipboard) return;
  navigator.clipboard.writeText(buildTraceCurlCommand(event)).then(() => {
    if (!button) return;
    const previous = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1200);
  }).catch(() => undefined);
}

function buildTraceReplayHeaders(event) {
  const headers = {};
  if (!event.requestHeaders || typeof event.requestHeaders !== 'object') {
    return headers;
  }
  for (const [rawName, rawValue] of Object.entries(event.requestHeaders)) {
    const name = rawName.trim().toLowerCase();
    if (TRACE_REPLAY_OMITTED_HEADERS.has(name) || rawValue === undefined || rawValue === null) {
      continue;
    }
    headers[name] = String(rawValue);
  }
  return headers;
}

function replayTraceRequest(button) {
  const event = selectedTraceEvent();
  if (event === null || apiTraceReplayInFlightEventId !== '') return;
  apiTraceReplayInFlightEventId = event.id;
  apiTraceReplayRequestId = `trace-replay-${event.id}-${Date.now()}`;
  const replayRequestId = apiTraceReplayRequestId;
  const replayPayload = {
    url: resolveTraceCurlUrl(event),
    method: event.method,
    auth: 'none',
    headers: buildTraceReplayHeaders(event),
    body: event.requestBodyPreview || undefined,
    source: 'traceReplay',
    requestId: replayRequestId
  };
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="api-trace-replay-spinner"></span> Replaying...';
  }
  if (vscodeApi) {
    renderLiveTracePanel();
    window.setTimeout(() => {
      if (apiTraceReplayRequestId !== replayRequestId) return;
      vscodeApi.postMessage({
        type: 'sapTools.apis.executeRequest',
        payload: replayPayload
      });
    }, TRACE_REPLAY_DISPATCH_DELAY_MS);
    return;
  }
  window.setTimeout(() => {
    apiTraceReplayInFlightEventId = '';
    apiTraceReplayRequestId = '';
    renderLiveTracePanel();
  }, 600);
}

function renderTraceUrlOptions(summaries) {
  const options = summaries.map((summary) => {
    const methods = summary.methods.join(',');
    return `<option value="${escapeHtml(summary.normalizedUrl)}">${escapeHtml(methods)} ${escapeHtml(summary.displayUrl)} (${summary.totalCount})</option>`;
  }).join('');
  return `<option value="all">All observed URLs</option>${options}`;
}

function renderTraceEventRows(events) {
  if (events.length === 0) {
    return `
      <div class="api-trace-empty">
        No matching trace events. Start listening, call the app, or relax the filters.
      </div>
    `;
  }
  return events.map((event) => {
    const isSelected = selectedTraceEvent()?.id === event.id;
    const bucket = statusBucket(event.status);
    return `
      <button type="button" class="api-trace-row${isSelected ? ' is-active' : ''}" data-action="api-trace-select-event" data-event-id="${escapeHtml(event.id)}" aria-pressed="${isSelected ? 'true' : 'false'}">
        <span class="api-trace-time">${escapeHtml(formatTraceClock(event.timestamp))}</span>
        <span class="api-trace-method">${escapeHtml(event.method)}</span>
        <span class="api-trace-status is-${bucket}">${event.status === null ? '---' : escapeHtml(String(event.status))}</span>
        <span class="api-trace-path" title="${escapeHtml(event.normalizedUrl)}">${escapeHtml(event.normalizedUrl)}</span>
        <span class="api-trace-duration">${event.durationMs === null ? '-' : `${event.durationMs}ms`}</span>
      </button>
    `;
  }).join('');
}

function renderTraceSelectedUrlRow(event) {
  const displayUrl = event.normalizedUrl || normalizeTraceUrl(event.url || event.path);
  return `
    <section class="api-trace-selected-url-row" aria-label="Selected request URL">
      <span>URL</span>
      <code title="${escapeHtml(displayUrl)}">${escapeHtml(displayUrl)}</code>
    </section>
  `;
}

function renderTraceOverview(event) {
  const totalBytes = event.requestBytes + event.responseBytes;
  const metrics = [
    ['Status', event.status === null ? 'Unknown' : String(event.status)],
    ['Duration', event.durationMs === null ? '-' : `${event.durationMs}ms`],
    ['Instance', event.instance],
    ['Bytes', `${totalBytes} B`],
    ['Trace ID', event.traceId || event.id],
    ['Correlation ID', event.correlationId || '-']
  ];
  return `
    ${renderTraceSelectedUrlRow(event)}
    <section class="api-trace-detail-grid api-trace-overview-grid" aria-label="Trace event overview">
      ${metrics.map(([label, value]) => `
        <div class="api-trace-detail-metric api-trace-metric-row">
          <span>${escapeHtml(label)}</span>
          <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
        </div>
      `).join('')}
    </section>
  `;
}

function renderTraceRequestTab(event) {
  const requestSections = [
    apiTraceCaptureRequestBody ? renderTraceBodySection('request', 'Request Body', event.requestBodyPreview, event.requestBodyTruncated) : '',
    apiTraceCaptureHeaders ? renderTraceHeaderSection('Request Headers', event.requestHeaders) : ''
  ].join('');
  return `
    <section class="api-trace-tab-panel" aria-label="Request details">
      ${requestSections || '<div class="api-trace-empty-detail">Request capture sections are disabled.</div>'}
    </section>
  `;
}

function renderTraceResponseTab(event) {
  const responseSections = [
    apiTraceCaptureResponseBody ? renderTraceBodySection('response', 'Response Body', event.responseBodyPreview, event.responseBodyTruncated) : '',
    apiTraceCaptureHeaders ? renderTraceHeaderSection('Response Headers', event.responseHeaders) : ''
  ].join('');
  return `
    <section class="api-trace-tab-panel" aria-label="Response details">
      ${responseSections || '<div class="api-trace-empty-detail">Response capture sections are disabled.</div>'}
    </section>
  `;
}

function renderTraceDetailContent(event) {
  if (event === null) {
    return '<div class="api-trace-empty-detail">Captured request details will appear here.</div>';
  }
  if (apiTraceDetailTab === 'request') {
    return renderTraceRequestTab(event);
  }
  if (apiTraceDetailTab === 'response') {
    return renderTraceResponseTab(event);
  }
  return renderTraceOverview(event);
}

function renderTraceDetailTabs() {
  const tabs = [
    ['overview', 'Overview'],
    ['request', 'Request'],
    ['response', 'Response']
  ];
  return `
    <div class="api-trace-detail-tabs" role="tablist" aria-label="Trace detail sections">
      ${tabs.map(([id, label]) => `
        <button type="button" class="api-trace-detail-tab-btn${apiTraceDetailTab === id ? ' is-active' : ''}" data-action="api-trace-switch-detail-tab" data-tab-id="${id}" role="tab" aria-selected="${apiTraceDetailTab === id ? 'true' : 'false'}">
          ${escapeHtml(label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderTraceReplayButton(event) {
  const isReplaying = apiTraceReplayInFlightEventId === event.id;
  const content = isReplaying
    ? '<span class="api-trace-replay-spinner"></span> Replaying...'
    : 'Replay Request';
  return `
    <button type="button" class="secondary-action api-trace-replay-btn" data-action="api-trace-replay-request" ${isReplaying ? 'disabled' : ''}>
      ${content}
    </button>
  `;
}

function renderTraceDetail(event) {
  const selectedRequest = event === null
    ? '<div class="api-trace-selected-request is-empty">Captured request details will appear here.</div>'
    : `
      <div class="api-trace-selected-request">
        <span class="api-trace-method">${escapeHtml(event.method)}</span>
      </div>
    `;
  return `
    <aside class="api-trace-detail" aria-label="Trace event details">
      <div class="api-trace-detail-head">
        ${selectedRequest}
        <div class="api-trace-detail-actions">
          ${event === null ? '' : renderTraceDetailTabs()}
          ${event === null ? '' : renderTraceReplayButton(event)}
          ${event === null ? '' : '<button type="button" class="secondary-action api-trace-copy-curl-btn" data-action="api-trace-copy-curl">Copy cURL</button>'}
        </div>
      </div>
      <div class="api-trace-detail-body">
        ${renderTraceDetailContent(event)}
      </div>
    </aside>
  `;
}

function renderTraceActionCluster() {
  const isActive = isTraceActiveState(apiTraceState);
  const canStop = isTraceStoppableState(apiTraceState);
  const isProgress = ['preparingCli', 'enablingSsh', 'checkingRuntime', 'openingTunnel', 'injecting', 'stopping'].includes(apiTraceState);
  const statusClass = apiTraceState === 'error'
    ? 'is-error'
    : isProgress
      ? 'is-progress'
      : isActive
        ? 'is-streaming'
        : 'is-idle';
  const traceToggleAction = canStop ? 'api-trace-stop' : 'api-trace-start';
  const traceToggleLabel = canStop ? 'Stop Listening' : 'Start Listening';
  const traceToggleClass = canStop ? 'secondary-action' : 'primary-action';
  const traceStateLabel = formatTraceStateLabel(apiTraceState);
  const traceStateTooltip = formatTraceStateTooltip(apiTraceState, apiTraceStatusMessage);
  return `
    <span class="api-trace-state-badge ${statusClass}" aria-label="Live Trace state" role="status" aria-live="polite" aria-busy="${isProgress ? 'true' : 'false'}" title="${escapeHtml(traceStateTooltip)}">
      ${isProgress ? '<span class="api-trace-state-spinner" aria-hidden="true"></span>' : ''}
      ${escapeHtml(traceStateLabel)}
      ${apiTraceState === 'error' ? '<span class="api-trace-state-info" aria-hidden="true">i</span>' : ''}
    </span>
    <button type="button" class="${traceToggleClass} api-trace-action-btn" data-action="${traceToggleAction}">${traceToggleLabel}</button>
    <button type="button" class="secondary-action api-trace-action-btn" data-action="api-trace-clear">Clear</button>
    <div class="api-trace-settings-container">
      <button type="button" class="secondary-action api-trace-action-btn api-trace-settings-btn" data-action="api-trace-toggle-settings" aria-label="Trace settings" aria-expanded="${apiTraceSettingsOpen ? 'true' : 'false'}" title="Trace settings">&#9881;&#65039;</button>
      <div class="api-trace-settings-popover${apiTraceSettingsOpen ? ' is-open' : ''}" aria-label="Trace settings">
        <label class="api-trace-check"><input type="checkbox" checked disabled /> Method/path/status/time</label>
        <label class="api-trace-check"><input type="checkbox" data-action="api-trace-capture-headers" ${apiTraceCaptureHeaders ? 'checked' : ''} /> Headers</label>
        <label class="api-trace-check"><input type="checkbox" data-action="api-trace-capture-request-body" ${apiTraceCaptureRequestBody ? 'checked' : ''} /> Request body preview</label>
        <label class="api-trace-check"><input type="checkbox" data-action="api-trace-capture-response-body" ${apiTraceCaptureResponseBody ? 'checked' : ''} /> Response preview</label>
      </div>
    </div>
  `;
}

function updateTraceTopActions() {
  const container = document.querySelector('[data-role="api-main-trace-actions"]');
  if (!container) return;
  const shouldShow = apiActiveMainTab === 'live-trace' && Boolean(apiSelectedAppId);
  container.hidden = !shouldShow;
  container.innerHTML = shouldShow ? renderTraceActionCluster() : '';
  updateTraceRecordIndicator();
}

function updateTraceRecordIndicator() {
  const record = document.querySelector('.api-main-tab-record');
  if (!record) return;
  record.classList.toggle('is-recording', isTraceActiveState(apiTraceState));
}

function renderLiveTracePanel() {
  const panel = document.querySelector('.api-live-trace-panel');
  if (!panel) return;
  const summaries = buildTraceUrlSummaries();
  const events = filteredTraceEvents();
  const selected = selectedTraceEvent();
  panel.innerHTML = `
    <section class="api-trace-shell" aria-label="Live Trace HTTP inspector">
      <div class="api-trace-controls" aria-label="Trace target controls">
        <label class="api-trace-control-field">
          <span>Instance</span>
          <select data-action="api-trace-instance" aria-label="Trace instance">
            <option value="0">Instance 0</option>
          </select>
        </label>
        <label class="api-trace-control-field api-trace-url-filter">
          <span>Observed URL</span>
          <select class="api-trace-url-select" data-action="api-trace-select-url" aria-label="Observed URL">
            ${renderTraceUrlOptions(summaries)}
          </select>
        </label>
      </div>

      <div class="api-trace-filters" aria-label="Live Trace filters">
        <label class="api-trace-control-field">
          <span>Method</span>
          <select data-action="api-trace-filter-method" aria-label="Trace method filter">
            ${['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => `<option value="${method}" ${apiTraceMethodFilter === method ? 'selected' : ''}>${method === 'all' ? 'All' : method}</option>`).join('')}
          </select>
        </label>
        <label class="api-trace-control-field">
          <span>Status</span>
          <select data-action="api-trace-filter-status" aria-label="Trace status filter">
            ${['all', '2xx', '3xx', '4xx', '5xx'].map((status) => `<option value="${status}" ${apiTraceStatusFilter === status ? 'selected' : ''}>${status === 'all' ? 'All' : status}</option>`).join('')}
          </select>
        </label>
        <label class="api-trace-control-field api-trace-search-filter">
          <span>Search trace</span>
          <input type="search" data-action="api-trace-filter-search" value="${escapeHtml(apiTraceSearchText)}" placeholder="path, URL, trace id, header, body" />
        </label>
      </div>

      <div class="api-trace-results">
        <section class="api-trace-stream" aria-label="Trace request stream">
          <div class="api-trace-stream-head">
            <h3>Trace request stream</h3>
          </div>
          <div class="api-trace-list" role="list">
            ${renderTraceEventRows(events)}
          </div>
        </section>
        ${renderTraceDetail(selected)}
      </div>
    </section>
  `;
  const select = panel.querySelector('[data-action="api-trace-select-url"]');
  if (select) select.value = apiTraceSelectedUrl;
  updateTraceTopActions();
}

function updateTraceSelectionDetails() {
  const selected = selectedTraceEvent();
  const rows = document.querySelectorAll('.api-trace-row');
  rows.forEach((row) => {
    const isSelected = selected !== null && row.dataset.eventId === selected.id;
    row.classList.toggle('is-active', isSelected);
    row.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  const detail = document.querySelector('.api-trace-detail');
  if (!detail) {
    renderLiveTracePanel();
    return;
  }
  detail.outerHTML = renderTraceDetail(selected);
}

function updateTraceFilterResults() {
  const events = filteredTraceEvents();
  const selected = selectedTraceEvent();
  const list = document.querySelector('.api-trace-list');
  const detail = document.querySelector('.api-trace-detail');
  if (!list || !detail) {
    renderLiveTracePanel();
    return;
  }

  list.innerHTML = renderTraceEventRows(events);
  detail.outerHTML = renderTraceDetail(selected);
}

function isTraceActiveState(state) {
  return ['preparingCli', 'enablingSsh', 'checkingRuntime', 'openingTunnel', 'injecting', 'streaming', 'paused', 'stopping'].includes(state);
}

function isTraceStoppableState(state) {
  return isTraceActiveState(state) || state === 'needsInspector';
}

function updateResponseSection() {
  const responseBody = document.querySelector('.api-response-body');
  const headerSection = document.querySelector('.api-response-header');
  
  if (!responseBody || !headerSection) return;

  if (apiResultState === 'done') {
    const statusClass = apiResultStatus.startsWith('2') ? 'success' : 'error';
    const hasPayload = apiResultPayload !== null && apiResultPayload !== undefined;

    headerSection.innerHTML = `
      <div class="api-response-title-group">
        <h3>Response</h3>
        
        <div class="api-view-tabs" role="tablist" aria-label="API response views">
          <button type="button" class="api-view-tab-btn${apiActiveView === 'json' ? ' is-active' : ''}" data-action="api-switch-view" data-view-id="json">JSON</button>
          <button type="button" class="api-view-tab-btn${apiActiveView === 'grid' ? ' is-active' : ''}" data-action="api-switch-view" data-view-id="grid">Grid Data</button>
        </div>
      </div>
      
      <div class="api-response-meta">
        ${hasPayload ? `
          <button type="button" class="api-copy-btn" data-action="api-copy-data">
            &#128203; Copy
          </button>
        ` : ''}
        <div class="api-status-badge is-${statusClass}">${escapeHtml(apiResultStatus)}</div>
        <div class="api-time-badge">${apiResultTime}ms</div>
      </div>
    `;
  } else {
    headerSection.innerHTML = `
      <div class="api-response-title-group">
        <h3>Response</h3>
      </div>
    `;
  }

  if (apiResultState === 'idle') {
    responseBody.innerHTML = `
      <div class="api-placeholder-response">
        <span class="api-placeholder-icon" aria-hidden="true">&#9656;</span>
        <p>Press <strong>Execute</strong> to fetch data from the endpoint.</p>
      </div>
    `;
    return;
  }

  if (apiResultState === 'loading') {
    responseBody.innerHTML = `
      <div class="api-placeholder-response">
        <div class="api-loading-spinner-large"></div>
        <p>Executing request...</p>
      </div>
    `;
    return;
  }

  let viewContent = '';
  if (apiActiveView === 'json') {
    viewContent = renderApiJsonResult(apiResultPayload);
  } else {
    viewContent = renderApiGridResult();
  }

  responseBody.innerHTML = `
    <div class="api-results-wrapper">
      <div class="api-view-content">
        ${viewContent}
      </div>
    </div>
  `;
}

function renderApiWorkbenchLoading(mainPanel) {
  mainPanel.innerHTML = `
    <div class="api-placeholder-response" style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <div class="api-loading-spinner-large" style="margin-bottom: 16px;"></div>
      <p>Loading application endpoints...</p>
    </div>
  `;
}

function updateWorkbenchSection() {
  const mainPanel = document.querySelector('.api-workbench-panel');
  if (!mainPanel) return;

  if (apiCatalogState === 'loading') {
    renderApiWorkbenchLoading(mainPanel);
    return;
  }

  const currentCatalog = resolveApiCatalog();
  if (currentCatalog === null) {
    renderApiWorkbenchLoading(mainPanel);
    return;
  }

  if (!apiSelectedEntity && currentCatalog.entities.length > 0) {
    mainPanel.innerHTML = `
      <div class="api-placeholder-response" style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <span class="api-placeholder-icon" aria-hidden="true" style="font-size: 48px; opacity: 0.2;">&#128196;</span>
        <p style="margin-top: 16px;">Please select an Endpoint from the sidebar.</p>
      </div>
    `;
    return;
  }

  // Check if we need to build full UI
  let requestSection = mainPanel.querySelector('.api-request-section');
  if (!requestSection) {
    mainPanel.innerHTML = `
        <!-- Request Section -->
        <section class="api-request-section" aria-label="API Request Builder" style="gap: 8px; padding-top: 12px; padding-bottom: 12px;">
          <div class="api-request-url-row">
            <div class="api-url-bar">
              <select class="api-method-select" data-action="api-select-method" style="background: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, #ffffff); font-weight: bold; border: none; padding: 4px 8px; outline: none; cursor: pointer; -webkit-appearance: none; text-align: center; font-size: 11px;">
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PATCH">PATCH</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
              <input type="text" class="api-url-input" value="" aria-label="API Target URL" style="flex: 1; border: none; background: transparent; outline: none; padding: 4px 8px; color: inherit;" />
            </div>
            
            <div class="api-settings-container">
              <button type="button" class="api-auth-settings-btn" data-action="api-toggle-auth-settings" title="Auth Settings" aria-label="Auth Settings">&#9881;&#65039;</button>
              <div class="api-auth-popover">
                <label for="api-auth-select" class="api-auth-label">Authentication Method</label>
                <select id="api-auth-select" class="api-auth-select" data-action="api-select-auth">
                  <option value="xsuaa-auto">XSUAA Client (Auto)</option>
                  <option value="local">Local Debug (None)</option>
                  <option value="custom">Custom Token</option>
                </select>
              </div>
            </div>
          </div>

          <div class="api-body-section" style="display: none; margin-top: 12px;">
            <div class="api-params-title">Request Body (JSON)</div>
            <textarea class="api-body-input" data-action="api-input-body" style="width: 100%; height: 100px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 8px; font-family: monospace; resize: vertical; box-sizing: border-box;" placeholder='{ "key": "value" }'></textarea>
          </div>
          <div class="api-params-grid"></div>

        </section>

        <!-- Response Section -->
        <section class="api-response-section" aria-label="API Response" style="flex: 1; display: flex; flex-direction: column; padding-bottom: 0 !important;">
          <div class="api-response-header" style="display: flex; align-items: center; justify-content: space-between;">
            <h3>Response</h3>
          </div>
          <div class="api-response-body" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; padding-bottom: 0 !important; margin-bottom: 0 !important;"></div>
        </section>
    `;
    requestSection = mainPanel.querySelector('.api-request-section');
  }

  const routeBase = currentCatalog.baseUrl || `https://demo-env-${apiSelectedAppId}.cfapps.region.hana.ondemand.com`;
  let fullUrl = '';
  
  if (apiSelectedEntity) {
    const selectedEnt = currentCatalog.entities.find(e => e.name === apiSelectedEntity);
    const entPath = selectedEnt && selectedEnt.path ? selectedEnt.path : `${currentCatalog.servicePath || ''}/${apiSelectedEntity}`;
    fullUrl = `${routeBase}${entPath}`;
  } else {
    fullUrl = `${routeBase}/`;
  }
  const qs = buildApiQueryString();
  if (qs) {
    fullUrl += fullUrl.includes('?') ? `&${qs}` : `?${qs}`;
  }

  const urlInput = mainPanel.querySelector('.api-url-input');
  if (urlInput) {
    urlInput.value = fullUrl;
    urlInput.title = fullUrl;
  }

  const methodSelect = mainPanel.querySelector('.api-method-select');
  if (methodSelect) methodSelect.value = apiHttpMethod;

  const bodySection = mainPanel.querySelector('.api-body-section');
  if (bodySection) {
    bodySection.style.display = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(apiHttpMethod) ? 'block' : 'none';
  }
  const bodyInput = mainPanel.querySelector('.api-body-input');
  if (bodyInput) bodyInput.value = apiHttpBody;

  const authSelect = mainPanel.querySelector('.api-auth-select');
  if (authSelect) authSelect.value = apiAuthMethod;

  const paramsGrid = mainPanel.querySelector('.api-params-grid');
  if (paramsGrid) {
    // Only update if not focused to prevent stealing focus while typing
    const activeEl = document.activeElement;
    if (!activeEl || !activeEl.matches('.api-params-grid input')) {
      paramsGrid.innerHTML = `
        ${renderApiParamRow('$select', apiParams.$select, 'Fields to retrieve')}
        <div class="api-params-row-flex">
          ${renderApiParamRow('$filter', apiParams.$filter, 'Filter conditions')}
          ${renderApiParamRow('$expand', apiParams.$expand, 'Expand associations')}
        </div>
        <div class="api-params-row-flex" style="align-items: stretch;">
          ${renderApiParamRow('$top', apiParams.$top, 'Max items', 'number')}
          ${renderApiParamRow('$skip', apiParams.$skip, 'Skip offset', 'number')}
          <div style="flex: 1; display: flex;">
            <button type="button" class="primary-action api-execute-btn" data-action="api-execute-request" style="width: 100%; margin: 0; padding: 0 12px; font-size: 13px; box-sizing: border-box; flex: 1;">
              Execute
            </button>
          </div>
        </div>
      `;
    }
  }

  const execBtn = mainPanel.querySelector('.api-execute-btn');
  if (execBtn) {
    if (apiResultState === 'loading') {
      execBtn.disabled = true;
      execBtn.innerHTML = '<span class="api-spinner"></span> Executing...';
    } else {
      execBtn.disabled = false;
      execBtn.innerHTML = `Execute`;
    }
  }

  updateResponseSection();
}

function updateSidebarSection() {
  const sidebar = document.querySelector('.api-webview-sidebar');
  if (!sidebar) return;
  const listContainer = sidebar.querySelector('.api-entities-list-container');
  const previousScrollTop = listContainer ? listContainer.scrollTop : 0;

  const renderLoading = () => {
    sidebar.innerHTML = `
      <div class="api-sidebar-loading">
        <div class="api-sidebar-loading-content">
          <div class="api-loading-spinner-large"></div>
          <div class="api-sidebar-loading-title">Discovering Endpoints...</div>
          <div class="api-sidebar-loading-subtitle">Fetching metadata from the deployed application</div>
        </div>
      </div>
    `;
  };

  if (apiCatalogState === 'loading') {
    renderLoading();
    return;
  }

  const currentCatalog = resolveApiCatalog();
  if (currentCatalog === null) {
    renderLoading();
    return;
  }
  
  const entityItems = currentCatalog.entities.map(ent => {
    const isSelected = ent.name === apiSelectedEntity;
    return `
      <button type="button" class="api-entity-item${isSelected ? ' is-active' : ''}" data-action="api-select-entity" data-entity-name="${ent.name}" aria-pressed="${isSelected ? 'true' : 'false'}">
        <span class="entity-icon" aria-hidden="true">&#128196;</span>
        <span class="entity-name" title="${escapeHtml(ent.name)}" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; white-space: normal; line-height: 1.2;">${escapeHtml(ent.name)}</span>
        ${ent.count !== undefined ? `<span class="entity-count-badge">${ent.count}</span>` : ''}
      </button>
    `;
  }).join('');

  // Keep search value if already exists
  const searchInput = sidebar.querySelector('input[type="search"]');
  const searchTerm = searchInput ? searchInput.value : '';

  sidebar.innerHTML = `
    <div class="api-sidebar-search-shell">
      <div class="api-search-container">
        <label class="api-endpoint-search search-input-with-icon">
          <span class="search-input-icon" aria-hidden="true">&#128269;</span>
          <input class="api-endpoint-search-input" type="search" data-action="api-search-entity" value="${escapeHtml(searchTerm)}" placeholder="Search endpoints" />
        </label>
      </div>
    </div>
    <div class="api-entities-list-container" style="padding: 0; display: flex; flex-direction: column; flex: 1; overflow-y: auto;">
      ${entityItems}
    </div>
  `;

  // Apply search filter immediately
  if (searchTerm) {
    const term = searchTerm.trim().toLowerCase();
    const items = sidebar.querySelectorAll('.api-entity-item');
    items.forEach((btn) => {
      const text = btn.textContent || '';
      btn.style.display = text.toLowerCase().includes(term) ? 'flex' : 'none';
    });
  }

  const nextListContainer = sidebar.querySelector('.api-entities-list-container');
  if (nextListContainer) {
    nextListContainer.scrollTop = previousScrollTop;
  }
}

function initLayout() {
  if (!apiSelectedAppId) {
    appElement.innerHTML = `
      <main class="api-workbench-panel api-empty-app-panel">
        <div class="api-placeholder-response">
          <p>Please select an App Service to view its APIs.</p>
        </div>
      </main>
    `;
    return;
  }

  // Ensure DOM skeleton exists
  if (!document.querySelector('#api-explorer-root')) {
    appElement.innerHTML = `
      <div id="api-explorer-root" class="api-explorer-root">
        <header class="api-main-tabs-shell">
          <div class="api-main-tabs" role="tablist" aria-label="APIs Explorer modes">
            <button type="button" class="api-main-tab-btn" data-action="api-switch-main-tab" data-tab-id="request-runner" role="tab" aria-controls="api-request-runner-panel">
              Request Runner
            </button>
            <button type="button" class="api-main-tab-btn" data-action="api-switch-main-tab" data-tab-id="live-trace" role="tab" aria-controls="api-live-trace-panel">
              <span class="api-main-tab-record${isTraceActiveState(apiTraceState) ? ' is-recording' : ''}" aria-hidden="true"></span>
              <span>Live Trace</span>
            </button>
          </div>
          <div class="api-main-trace-actions" data-role="api-main-trace-actions" hidden></div>
        </header>
        <section id="api-request-runner-panel" class="api-main-tab-panel api-request-runner-panel" data-role="api-request-runner-panel" role="tabpanel">
          <div class="api-split-layout">
            <aside class="api-webview-sidebar"></aside>
            <div class="api-resizer"></div>
            <main class="api-workbench-panel"></main>
          </div>
        </section>
        <section id="api-live-trace-panel" class="api-main-tab-panel api-live-trace-panel" data-role="api-live-trace-panel" role="tabpanel"></section>
      </div>
    `;
  }
  updateMainTabVisibility();
}

function renderWebview() {
  initLayout();
  if (apiSelectedAppId) {
    updateMainTabVisibility();
    updateSidebarSection();
    updateWorkbenchSection();
    renderLiveTracePanel();
  }
}

function updateMainTabVisibility() {
  const requestPanel = document.querySelector('[data-role="api-request-runner-panel"]');
  const tracePanel = document.querySelector('[data-role="api-live-trace-panel"]');
  const tabs = document.querySelectorAll('.api-main-tab-btn');
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tabId === apiActiveMainTab;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  if (requestPanel) requestPanel.hidden = apiActiveMainTab !== 'request-runner';
  if (tracePanel) tracePanel.hidden = apiActiveMainTab !== 'live-trace';
  updateTraceTopActions();
}

function updateApiEntitySelection() {
  const buttons = document.querySelectorAll('.api-entity-item');
  buttons.forEach((btn) => {
    const isSelected = btn.dataset.entityName === apiSelectedEntity;
    btn.classList.toggle('is-active', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

// Action Handler
appElement.addEventListener('click', (event) => {
  const target = event.target;
  const actionElement = target.closest('[data-action]');
  if (!actionElement) return;

  const action = actionElement.dataset.action;

  if (action === 'api-switch-main-tab') {
    apiActiveMainTab = actionElement.dataset.tabId === 'live-trace' ? 'live-trace' : 'request-runner';
    renderWebview();
    return;
  }

  if (action === 'api-select-entity') {
    saveEndpointSession();
    apiSelectedEntity = actionElement.dataset.entityName ?? '';
    loadEndpointSession(apiSelectedEntity);
    updateApiEntitySelection();
    updateWorkbenchSection();
    return;
  }

  if (action === 'api-toggle-auth-settings') {
    const popover = actionElement.nextElementSibling;
    if (popover && popover.classList.contains('api-auth-popover')) {
      popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
    }
    return;
  }

  if (action === 'api-switch-view') {
    apiActiveView = actionElement.dataset.viewId ?? 'json';
    updateResponseSection();
    return;
  }

  if (action === 'api-copy-data' || action === 'api-copy-response') {
    copyResponseData();
    return;
  }

  if (action === 'api-trace-copy-body') {
    copyTraceBodyPreview(actionElement.dataset.bodyKind ?? 'request', actionElement);
    return;
  }

  if (action === 'api-trace-copy-curl') {
    copyTraceCurl(actionElement);
    return;
  }

  if (action === 'api-trace-replay-request') {
    replayTraceRequest(actionElement);
    return;
  }

  if (action === 'api-trace-switch-detail-tab') {
    const tabId = actionElement.dataset.tabId;
    apiTraceDetailTab = tabId === 'request' || tabId === 'response' ? tabId : 'overview';
    renderLiveTracePanel();
    return;
  }

  if (action === 'api-execute-request') {
    apiResultState = 'loading';
    updateWorkbenchSection();

    const urlInput = document.querySelector('.api-url-input');
    const url = urlInput ? urlInput.value : '';

    if (vscodeApi) {
      vscodeApi.postMessage({
        type: 'sapTools.apis.executeRequest',
        payload: { url, method: apiHttpMethod, auth: apiAuthMethod, body: apiHttpBody }
      });
    } else {
      // Fallback for prototype testing without VS Code extension host
      setTimeout(() => {
        const appResponses = API_MOCK_RESPONSES[apiSelectedAppId] || API_MOCK_RESPONSES['demo-app'];
        apiResultState = 'done';
        apiResultStatus = '200 OK';
        apiResultTime = 345;
        apiResultPayload = appResponses[apiSelectedEntity] || API_MOCK_RESPONSES['demo-app']['Users'];
        updateWorkbenchSection();
      }, 1000);
    }
    return;
  }

  if (action === 'api-trace-toggle-settings') {
    apiTraceSettingsOpen = !apiTraceSettingsOpen;
    renderLiveTracePanel();
    return;
  }

  if (action === 'api-trace-start') {
    apiTraceSettingsOpen = false;
    apiTraceState = 'preparingCli';
    apiTraceStatusMessage = 'Starting runtime HTTP trace session.';
    apiTraceRuntimeHookInstalled = false;
    apiTraceRuntimeHookMayRemain = false;
    renderLiveTracePanel();
    if (vscodeApi) {
      vscodeApi.postMessage({
        type: 'sapTools.apis.trace.start',
        payload: {
          mode: 'runtime-http',
          instanceIndex: 0,
          processName: 'web',
          captureHeaders: apiTraceCaptureHeaders,
          captureRequestBody: apiTraceCaptureRequestBody,
          captureResponseBody: apiTraceCaptureResponseBody,
          maxBodyBytes: 0,
          filters: {
            method: [],
            pathContains: '',
            statusClass: apiTraceStatusFilter
          }
        }
      });
    } else {
      window.setTimeout(() => {
        if (apiTraceState !== 'preparingCli') return;
        apiTraceState = 'streaming';
        apiTraceStatusMessage = 'Streaming prototype HTTP requests for this app.';
        apiTraceRuntimeHookInstalled = true;
        appendTraceEvents(API_MOCK_TRACE_EVENTS);
      }, 350);
    }
    return;
  }

  if (action === 'api-trace-stop') {
    apiTraceSettingsOpen = false;
    apiTraceState = vscodeApi ? 'stopping' : 'stopped';
    apiTraceStatusMessage = vscodeApi
      ? 'Stopping local Inspector polling and tunnel.'
      : 'Local prototype trace is stopped.';
    if (!vscodeApi) {
      apiTraceRuntimeHookInstalled = false;
      apiTraceRuntimeHookMayRemain = false;
    }
    if (vscodeApi) {
      vscodeApi.postMessage({
        type: 'sapTools.apis.trace.stop',
        payload: { uninstallRuntimeHook: true }
      });
    }
    renderLiveTracePanel();
    return;
  }

  if (action === 'api-trace-clear') {
    apiTraceSettingsOpen = false;
    apiTraceEvents = [];
    apiTraceSelectedEventId = '';
    apiTraceDetailTab = 'overview';
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'sapTools.apis.trace.clear' });
    }
    renderLiveTracePanel();
    return;
  }

  if (action === 'api-trace-select-event') {
    apiTraceSelectedEventId = actionElement.dataset.eventId ?? '';
    apiTraceDetailTab = 'overview';
    updateTraceSelectionDetails();
    return;
  }
});

// Select
appElement.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    const action = target.dataset.action;
    if (action === 'api-trace-capture-headers') {
      apiTraceCaptureHeaders = target.checked;
      saveApiTracePreferences();
      renderLiveTracePanel();
      return;
    }
    if (action === 'api-trace-capture-request-body') {
      apiTraceCaptureRequestBody = target.checked;
      saveApiTracePreferences();
      renderLiveTracePanel();
      return;
    }
    if (action === 'api-trace-capture-response-body') {
      apiTraceCaptureResponseBody = target.checked;
      saveApiTracePreferences();
      renderLiveTracePanel();
      return;
    }
  }
  if (!(target instanceof HTMLSelectElement)) return;
  const action = target.dataset.action;
  if (action === 'api-select-auth') {
    apiAuthMethod = target.value;
    const popover = document.querySelector('.api-auth-popover');
    if (popover) popover.style.display = 'none';
  }
  if (action === 'api-select-method') {
    apiHttpMethod = target.value;
    updateWorkbenchSection();
  }
  if (action === 'api-trace-select-url') {
    apiTraceSelectedUrl = target.value;
    renderLiveTracePanel();
  }
  if (action === 'api-trace-filter-method') {
    apiTraceMethodFilter = target.value;
    renderLiveTracePanel();
  }
  if (action === 'api-trace-filter-status') {
    apiTraceStatusFilter = target.value;
    renderLiveTracePanel();
  }
});

// Inputs
appElement.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset.action === 'api-input-body') {
    apiHttpBody = target.value;
    return;
  }

  if (!(target instanceof HTMLInputElement)) return;

  if (target.dataset.action === 'api-trace-filter-search') {
    apiTraceSearchText = target.value;
    updateTraceFilterResults();
    return;
  }

  if (target.dataset.action === 'api-search-entity') {
    const term = target.value.trim().toLowerCase();
    const items = appElement.querySelectorAll('.api-entity-item');
    items.forEach((btn) => {
      const text = btn.textContent || '';
      btn.style.display = text.toLowerCase().includes(term) ? 'flex' : 'none';
    });
    return;
  }

  if (target.dataset.role === 'api-param-input') {
    const paramName = target.dataset.paramName ?? '';
    if (paramName in apiParams) {
      apiParams[paramName] = target.value;
      const urlInput = appElement.querySelector('.api-url-input');
      if (urlInput) {
        const currentCatalog = resolveApiCatalog();
        if (currentCatalog === null) return;
        const routeBase = currentCatalog.baseUrl || `https://demo-env-${apiSelectedAppId}.cfapps.region.hana.ondemand.com`;
        const selectedEnt = currentCatalog.entities.find(e => e.name === apiSelectedEntity);
        const entPath = selectedEnt && selectedEnt.path ? selectedEnt.path : `${currentCatalog.servicePath || ''}/${apiSelectedEntity}`;
        let fullUrl = `${routeBase}${entPath}`;
        const qs = buildApiQueryString();
        if (qs) {
          fullUrl += fullUrl.includes('?') ? `&${qs}` : `?${qs}`;
        }
        urlInput.value = fullUrl;
      }
    }
  }
});

function initWebview() {
  loadApiTracePreferences();
  const params = new URLSearchParams(window.location.search);
  const appId = params.get('appId') || sessionStorage.getItem('saptools.apis.selectedAppId') || window.vscodeApiSelectedAppId;
  if (appId) {
    apiSelectedAppId = appId;
    if (!vscodeApi) {
      apiCatalogState = 'loaded';
      apiCurrentCatalog = API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
      const catalog = resolveApiCatalog();
      if (catalog && catalog.entities.length > 0) {
        apiSelectedEntity = catalog.entities[0].name;
      } else {
        apiSelectedEntity = '';
      }
    } else {
      apiCatalogState = 'loading';
      apiCurrentCatalog = null;
      apiSelectedEntity = '';
    }
  }
  renderWebview();
}

// Listen to messages from extension
// Hide popover if clicking outside
document.addEventListener('click', (e) => {
  const popover = document.querySelector('.api-auth-popover');
  if (popover && popover.style.display === 'block') {
    const gearBtn = document.querySelector('[data-action="api-toggle-auth-settings"]');
    if (!popover.contains(e.target) && (!gearBtn || !gearBtn.contains(e.target))) {
      popover.style.display = 'none';
    }
  }
});

// Sidebar Resizer Logic
let isResizing = false;
document.addEventListener('mousedown', (e) => {
  if (e.target.classList && e.target.classList.contains('api-resizer')) {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none'; // Prevent text selection while dragging
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const sidebar = document.querySelector('.api-webview-sidebar');
  if (sidebar) {
    const newWidth = Math.max(150, Math.min(e.clientX, 800)); // Min 150px, Max 800px
    sidebar.style.width = `${newWidth}px`;
    sidebar.style.minWidth = `${newWidth}px`;
    sidebar.style.flex = `0 0 ${newWidth}px`;
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

document.addEventListener('mouseleave', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

window.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'sapTools.apis.catalogLoading') {
    apiCatalogState = 'loading';
    apiCurrentCatalog = null;
    apiSelectedEntity = '';
    apiHttpMethod = 'GET';
    apiHttpBody = '';
    apiParams = {
      $select: '',
      $filter: '',
      $expand: '',
      $top: API_DEFAULT_TOP,
      $skip: '0'
    };
    apiResultState = 'idle';
    apiResultTime = 0;
    apiResultStatus = '';
    apiResultPayload = null;
    apiActiveView = 'json';
    endpointSessions.clear();
    renderWebview();
    return;
  }

  if (event.data.type === 'sapTools.apis.syncStarted') {
    apiCatalogState = 'syncing';
    if (apiSelectedAppId) {
      updateSidebarSection();
    }
  }

  if (event.data.type === 'sapTools.apis.catalogLoaded') {
    const catalog = event.data.payload;
    const isBackgroundUpdate = catalog.isBackgroundUpdate === true;
    if (catalog) {
      const prevSelectedEntity = apiSelectedEntity;
      apiCurrentCatalog = {
        name: catalog.name,
        baseUrl: catalog.baseUrl,
        servicePath: '',
        entities: catalog.entities
      };
      
      // If this is the currently selected app, refresh UI
      if (apiSelectedAppId === catalog.name) {
        if (catalog.entities.length > 0) {
          if (!prevSelectedEntity || !catalog.entities.some(e => e.name === prevSelectedEntity)) {
             apiSelectedEntity = catalog.entities[0].name;
          } else {
             apiSelectedEntity = prevSelectedEntity;
          }
        } else {
          apiSelectedEntity = '';
        }
        
        // If we previously loaded data, treat ANY subsequent catalog load as a background update 
        // to prevent wiping the user's unsaved input/state.
        const shouldSoftUpdate = isBackgroundUpdate || apiCatalogState === 'loaded';
        apiCatalogState = 'loaded';

        if (!shouldSoftUpdate) {
          loadEndpointSession(apiSelectedEntity);
          renderWebview();
        } else {
          // Just update sidebar softly to remove spinner and show new entities

          updateSidebarSection();
        }
      }
    }
  }

  if (event.data.type === 'sapTools.apis.executeResponse') {
    const payload = event.data.payload;
    if (payload.source === 'traceReplay' && payload.requestId === apiTraceReplayRequestId) {
      apiTraceReplayInFlightEventId = '';
      apiTraceReplayRequestId = '';
      renderLiveTracePanel();
      return;
    }
    apiResultState = 'done';
    apiResultTime = payload.time;
    apiResultStatus = payload.status;
    apiResultPayload = payload.data;
    saveEndpointSession();
    updateResponseSection();
    
    // Also update Execute button back to normal
    const execBtn = document.querySelector('.api-execute-btn');
    if (execBtn) {
      execBtn.disabled = false;
      execBtn.innerHTML = `Execute`;
    }
  }

  if (event.data.type === 'sapTools.apis.trace.state') {
    const payload = event.data.payload || {};
    apiTraceState = payload.state || apiTraceState;
    apiTraceStatusMessage = typeof payload.message === 'string' ? payload.message : apiTraceStatusMessage;
    apiTraceRuntimeHookInstalled = payload.runtimeHookInstalled === true;
    apiTraceRuntimeHookMayRemain = payload.runtimeHookMayRemain === true;
    renderLiveTracePanel();
    return;
  }

  if (event.data.type === 'sapTools.apis.trace.event') {
    if (event.data.payload) {
      appendTraceEvents([event.data.payload]);
    }
    return;
  }

  if (event.data.type === 'sapTools.apis.trace.batch') {
    const payload = event.data.payload || {};
    if (Array.isArray(payload.events)) {
      appendTraceEvents(payload.events);
    }
    return;
  }

  if (event.data.type === 'sapTools.apis.error') {
    apiCatalogState = 'error'; // Reset state so next load does a full render
    const errorMsg = event.data.payload?.message || 'An unknown error occurred.';
    document.getElementById('webview-app').innerHTML = `
      <div style="padding: 20px; color: var(--vscode-errorForeground);">
        <h2>Error Loading APIs</h2>
        <p>${escapeHtml(errorMsg)}</p>
      </div>
    `;
    return;
  }

  if (event.data.type === 'saptools.prototype.apis.appSelected') {
    apiSelectedAppId = event.data.payload.appId;
    
    apiCatalogState = vscodeApi ? 'loading' : 'loaded';
    apiCurrentCatalog = vscodeApi ? null : API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
    
    apiSelectedEntity = '';
    if (!vscodeApi) {
      const catalog = resolveApiCatalog();
      if (catalog && catalog.entities.length > 0) {
        apiSelectedEntity = catalog.entities[0].name;
      }
    }
    apiHttpMethod = 'GET';
    apiHttpBody = '';
    apiResultState = 'idle';
    apiResultPayload = null;
    apiActiveMainTab = 'request-runner';
    apiTraceState = 'idle';
    apiTraceStatusMessage = '';
    apiTraceEvents = [];
    apiTraceSelectedEventId = '';
    apiTraceSelectedUrl = 'all';
    apiTraceMethodFilter = 'all';
    apiTraceStatusFilter = 'all';
    apiTraceSearchText = '';
    apiTraceSettingsOpen = false;
    apiTraceDetailTab = 'overview';
    apiParams = {
      $select: '',
      $filter: '',
      $expand: '',
      $top: API_DEFAULT_TOP,
      $skip: '0'
    };
    
    renderWebview();
  }
});

// Initial render
initWebview();

if (vscodeApi) {
  vscodeApi.postMessage({ type: 'sapTools.apis.webviewReady' });
}
