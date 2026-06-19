import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readToolsSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/07g-render-tools.js', import.meta.url),
    'utf8'
  );
}

async function readEventsSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/01-events.js', import.meta.url),
    'utf8'
  );
}

async function readSqlRenderSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/07e-render-sql.js', import.meta.url),
    'utf8'
  );
}

async function readStateSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/00-state.js', import.meta.url),
    'utf8'
  );
}

async function readQuickSelectionSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/05-quick-selection.js', import.meta.url),
    'utf8'
  );
}

async function readWorkspaceRenderSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/07d-render-workspace.js', import.meta.url),
    'utf8'
  );
}

async function readEventStylesSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/styles/09-events.css', import.meta.url),
    'utf8'
  );
}

async function readApiStylesSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/styles/08-apis.css', import.meta.url),
    'utf8'
  );
}

async function readLogsStylesSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/styles/03-logs-panel.css', import.meta.url),
    'utf8'
  );
}

async function readEventWebviewSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/assets/events-webview.js', import.meta.url),
    'utf8'
  );
}

async function readApiWebviewSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/assets/apis-webview.js', import.meta.url),
    'utf8'
  );
}

async function readEventVariantSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/variants/events-webview.html', import.meta.url),
    'utf8'
  );
}

async function readGallerySource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/assets/gallery.js', import.meta.url),
    'utf8'
  );
}

async function readPrototypeIndexSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/index.html', import.meta.url),
    'utf8'
  );
}

describe('prototype Microsoft Graph tools UI', () => {
  it('renders an explicit show/hide toggle for client secret fields', async () => {
    const source = await readToolsSource();

    expect(source).toContain('toggle-client-secret-visibility');
    expect(source).toContain('Show Client Secret');
    expect(source).toContain('Hide Client Secret');
    expect(source).toContain('microsoftGraphClientSecretVisibleByTool');
  });

  it('uses the active tool name as the screen heading without a duplicate inner header', async () => {
    const source = await readToolsSource();

    expect(source).toContain('resolveToolsHeaderTitle');
    expect(source).not.toContain('tool-workbench-head');
  });

  it('routes SVG icon clicks through the nearest action button', async () => {
    const source = await readEventsSource();

    expect(source).toContain("eventTarget.closest('[data-action]')");
  });
});

describe('prototype Log-API-Event workspace', () => {
  it('renames the first workspace tab without keeping the old label', async () => {
    const source = await readStateSource();

    expect(source).toContain("label: 'Log-API-Event'");
    expect(source).not.toContain("label: 'Logs/APIs'");
  });

  it('shows APIs and Event actions without the idle Ready badge', async () => {
    const source = await readWorkspaceRenderSource();

    expect(source).toContain('data-action="open-app-apis"');
    expect(source).toContain('data-action="open-app-events"');
    expect(source).not.toContain('app-log-state is-idle');
    expect(source).not.toContain('>Ready<');
  });

  it('routes the Event action to the Event viewer prototype', async () => {
    const source = await readQuickSelectionSource();

    expect(source).toContain('saptools.openEventMesh');
    expect(source).toContain('./variants/events-webview.html');
  });

  it('keeps app rows fixed while making APIs and Event hover targets taller', async () => {
    const source = await readLogsStylesSource();

    expect(source).toMatch(/\.app-log-item\s*\{[\s\S]*?padding:\s*8px 10px;/);
    expect(source).toMatch(/\.app-log-apis-btn\s*\{[\s\S]*?min-height:\s*20px;/);
    expect(source).toMatch(/\.app-log-apis-btn\s*\{[\s\S]*?line-height:\s*1\.2;/);
    expect(source).toMatch(/\.app-log-apis-btn\s*\{[\s\S]*?box-sizing:\s*border-box;/);
  });

  it('uses multi-binding state for the Event viewer (Add Binding workflow)', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain('selectedBindingIndexes');
    expect(source).toContain('topicsByBinding');
    expect(source).toContain('em-add-binding');
    expect(source).toContain("'sapTools.events.addTopics'");
  });

  it('sends multi-binding start requests with per-binding topics', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain("'sapTools.events.startListening'");
    expect(source).toContain('bindings: requests');
  });

  it('renders results inline below setup instead of replacing the screen', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain('event-setup');
    expect(source).toContain('event-results');
    expect(source).toContain('renderReady');
  });

  it('prototype fixture handles multiple bindings for search-based Add Binding workflow', async () => {
    const source = await readEventVariantSource();

    expect(source).toContain('length: 100');
    expect(source).toContain("'sapTools.events.startListening'");
    expect(source).toContain("'sapTools.events.addTopics'");
  });

  it('has a standalone Event viewer variant for Playwright prototype checks', async () => {
    const source = await readEventVariantSource();

    expect(source).toContain('id="event-mesh-app"');
    expect(source).toContain('../assets/prototype.css');
    expect(source).toContain('../assets/events-webview.js');
  });

  it('does not add non-zero letter spacing to the Event viewer styles', async () => {
    const source = await readEventStylesSource();
    const values = Array.from(source.matchAll(/letter-spacing:\s*([^;]+);/g)).map((match) =>
      match[1]?.trim()
    );

    expect(values).toEqual(values.map(() => '0'));
  });

  it('uses a visibly larger Simple group expander than the compact default icon size', async () => {
    const source = await readEventStylesSource();

    expect(source).toMatch(/\.event-simple-group-row\s*\{[\s\S]*?grid-template-columns:\s*38px minmax\(140px, 1fr\) max-content;/);
    expect(source).toMatch(/\.event-simple-expander\s*\{[\s\S]*?width:\s*32px;/);
    expect(source).toMatch(/\.event-simple-expander\s*\{[\s\S]*?height:\s*32px;/);
    expect(source).toMatch(/\.event-simple-expander\s*\{[\s\S]*?font-size:\s*18px;/);
  });

  it('includes Simple, Advance, and Publish tabs with Simple as the default', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain("activeTab = 'subscribe-simple'");
    expect(source).toContain('em-switch-tab');
    expect(source).toContain('activeTab');
    expect(source).toContain('Subscribe Simple');
    expect(source).toContain('Subscribe Advance');
    expect(source).toContain('data-tab="publish"');
    expect(source).toContain('data-tab="subscribe-simple"');
    expect(source).toContain('data-tab="subscribe-advance"');
  });

  it('does not duplicate the binding count below the Event viewer tabs', async () => {
    const source = await readEventWebviewSource();

    expect(source).not.toContain('event-header-meta');
  });

  it('renders a grouped Simple subscribe tree with one-click group and child selection', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain('normalizeSimpleBindingGroupName');
    expect(source).toContain('buildSimpleBindingTree');
    expect(source).toContain('renderSimpleSubscribeView');
    expect(source).toContain('collectSimpleStartRequests');
    expect(source).toContain('em-toggle-simple-group');
    expect(source).toContain('em-toggle-simple-binding');
    expect(source).toContain('Client Binding Groups');
  });

  it('expands Simple groups from the group row while keeping checkbox selection separate', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain('class="event-simple-group-row" data-action="em-expand-simple-group"');
    expect(source).toContain('class="event-simple-check" data-action="em-toggle-simple-group"');
  });

  it('guards Simple group expand/collapse against rapid double toggles', async () => {
    const source = await readEventWebviewSource();
    const toggleMatch = /function toggleSimpleGroupExpansion\(groupKey\) \{([\s\S]*?)\n\}/.exec(source);
    const readyMatch = /function handleReady\(data\) \{([\s\S]*?)\n\}/.exec(source);

    expect(source).toContain('const SIMPLE_GROUP_EXPAND_COOLDOWN_MS = 300;');
    expect(source).toContain('const simpleGroupExpansionTimestamps = new Map();');
    expect(source).toContain('function canToggleSimpleGroupExpansion(groupKey)');
    expect(toggleMatch).not.toBeNull();
    expect(toggleMatch?.[1] ?? '').toContain('canToggleSimpleGroupExpansion(groupKey)');
    expect(readyMatch).not.toBeNull();
    expect(readyMatch?.[1] ?? '').toContain('simpleGroupExpansionTimestamps.clear()');
  });

  it('keeps Client Binding Groups from becoming a nested scroll region at low panel heights', async () => {
    const styles = await readEventStylesSource();
    const shellMatch = /\.event-shell\s*\{([\s\S]*?)\n\}/.exec(styles);
    const setupMatch = /\.event-setup\s*\{([\s\S]*?)\n\}/.exec(styles);
    const treeMatch = /\.event-simple-tree\s*\{([\s\S]*?)\n\}/.exec(styles);

    expect(shellMatch).not.toBeNull();
    expect(shellMatch?.[1] ?? '').toContain('overflow-y: auto');
    expect(shellMatch?.[1] ?? '').not.toContain('overflow: hidden');

    expect(setupMatch).not.toBeNull();
    expect(setupMatch?.[1] ?? '').not.toContain('overflow-y');
    expect(setupMatch?.[1] ?? '').not.toContain('max-height');

    expect(treeMatch).not.toBeNull();
    expect(treeMatch?.[1] ?? '').not.toContain('overflow-y');
    expect(treeMatch?.[1] ?? '').not.toContain('max-height');
  });

  it('keeps the received message list usable when the whole panel scrolls at low heights', async () => {
    const styles = await readEventStylesSource();
    const resultsMatch = /\.event-results\s*\{([\s\S]*?)\n\}/.exec(styles);
    const listMatch = /\.event-list\s*\{([\s\S]*?)\n\}/.exec(styles);

    expect(resultsMatch).not.toBeNull();
    expect(resultsMatch?.[1] ?? '').toContain('flex: 1 0 auto');

    expect(listMatch).not.toBeNull();
    expect(listMatch?.[1] ?? '').toContain('min-height: 180px');
    expect(listMatch?.[1] ?? '').toContain('overflow: auto');
  });

  it('keeps blank group-row space available for expand/collapse instead of selection', async () => {
    const styles = await readEventStylesSource();
    const checkMatch = /\.event-simple-check\s*\{([\s\S]*?)\n\}/.exec(styles);

    expect(checkMatch).not.toBeNull();
    const body = checkMatch?.[1] ?? '';
    expect(body).toContain('justify-self: start');
    expect(body).toContain('max-width: 100%');
  });

  it('keeps Simple subscribe interactive while streaming and adds bindings without resetting results', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain("state.status === 'listening' || state.status === 'starting'");
    expect(source).toContain('const selectableBindings = simpleSelectableBindings(group);');
    expect(source).not.toContain("return streaming || topicStateFor(binding.index).status === 'listening';");
    expect(source).not.toContain('if (group === null || streaming) return;');
    expect(source).toContain("type: 'sapTools.events.startBinding'");
    expect(source).toContain("type: 'sapTools.events.startListening', bindings: requests");
    expect(source).toContain("const labelSuffix = streaming ? ' More' : '';");
  });

  it('uses a compact result binding dropdown instead of one filter tab per live binding', async () => {
    const source = await readEventWebviewSource();
    const styles = await readEventStylesSource();

    expect(source).toContain('renderBindingFilterSelect(liveBindings)');
    expect(source).toContain('data-role="em-binding-filter-select"');
    expect(source).toContain('All bindings');
    expect(source).not.toContain('renderBindingFilters()');
    expect(source).not.toContain('data-action="em-filter-binding"');
    expect(source).not.toContain('class="event-filter-row" role="group"');
    const spacerIndex = source.indexOf('<span class="event-toolbar-spacer"></span>');
    const filterIndex = source.indexOf('${renderBindingFilterSelect(liveBindings)}');
    const pauseIndex = source.indexOf('data-action="em-pause"');
    expect(spacerIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeGreaterThan(spacerIndex);
    expect(pauseIndex).toBeGreaterThan(filterIndex);
    expect(styles).toMatch(/\.event-result-filter\s*\{[\s\S]*?max-width:\s*280px;/);
    expect(styles).toMatch(/\.event-result-filter\s*\{[\s\S]*?margin-right:\s*2px;/);
    expect(styles).toMatch(/\.event-filter-select\s*\{[\s\S]*?width:\s*100%;/);
    expect(styles).not.toContain('.event-filter-row');
  });

  it('renders an Event settings gear next to Publish outside the tab list', async () => {
    const source = await readEventWebviewSource();
    const styles = await readEventStylesSource();

    expect(source).toContain('data-action="em-toggle-settings"');
    expect(source).toContain('aria-controls="event-settings-panel"');
    expect(source).toContain('renderEventSettingsPanel()');
    const publishTabIndex = source.indexOf('data-tab="publish"');
    const tabsCloseIndex = source.indexOf('</div>', publishTabIndex);
    const gearIndex = source.indexOf('data-action="em-toggle-settings"');
    expect(publishTabIndex).toBeGreaterThan(-1);
    expect(tabsCloseIndex).toBeGreaterThan(publishTabIndex);
    expect(gearIndex).toBeGreaterThan(tabsCloseIndex);
    expect(styles).toContain('.event-settings-toggle');
    expect(styles).toContain('.event-settings-panel');
  });

  it('configures the received message buffer cap from Event settings', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain('const DEFAULT_MESSAGE_BUFFER_LIMIT = 1000;');
    expect(source).toContain('const MIN_MESSAGE_BUFFER_LIMIT = 100;');
    expect(source).toContain('const MAX_MESSAGE_BUFFER_LIMIT = 10000;');
    expect(source).toContain('let messageBufferLimit = DEFAULT_MESSAGE_BUFFER_LIMIT;');
    expect(source).toContain('data-role="em-message-buffer-limit"');
    expect(source).toContain('normalizeMessageBufferLimit');
    expect(source).toContain('applyMessageBufferLimit');
    expect(source).toContain('scheduleMessageBufferLimitApply');
    expect(source).toContain('trimStoredMessages');
    expect(source).toContain('const MESSAGE_BUFFER_INPUT_DEBOUNCE_MS = 250;');
    expect(source).toContain('if (messages.length > messageBufferLimit)');
    expect(source).toContain("el.matches('[data-role=\"em-message-buffer-limit\"]')");
    expect(source).not.toContain('if (messages.length > MAX_MESSAGES)');
  });

  it('replaces the result summary text with a searchable message input', async () => {
    const source = await readEventWebviewSource();
    const styles = await readEventStylesSource();

    expect(source).toContain('let messageSearch =');
    expect(source).toContain('renderMessageSearchInput()');
    expect(source).toContain('data-role="em-message-search"');
    expect(source).toContain('class="event-result-search search-input-with-icon"');
    expect(source).toContain('class="search-input-icon"');
    expect(source).toContain('messageMatchesSearch');
    expect(source).not.toContain('event-result-summary');
    expect(source).not.toContain('function resultSummary()');
    expect(styles).toContain('.event-result-search');
    expect(styles).toContain('.event-result-search-input');
    expect(styles).not.toContain('.event-result-summary');
  });

  it('preserves received messages when a new startListening batch succeeds', async () => {
    const source = await readEventWebviewSource();
    const match = /function handleListening\(data\) \{([\s\S]*?)\n\}/.exec(source);

    expect(match).not.toBeNull();
    const body = match?.[1] ?? '';
    expect(body).not.toContain('messages = []');
    expect(body).not.toContain('totalReceived = 0');
    expect(body).not.toContain('expandedSeqs.clear()');
    expect(source).toContain("} else if (action === 'em-clear') {");
    expect(source).toContain('messages = []');
    expect(source).toContain('totalReceived = 0');
  });

  it('does not cap or truncate binding badges in received message rows', async () => {
    const styles = await readEventStylesSource();
    const match = /\.event-binding-badge\s*\{([\s\S]*?)\n\}/.exec(styles);

    expect(match).not.toBeNull();
    const body = match?.[1] ?? '';
    expect(body).not.toContain('max-width');
    expect(body).not.toContain('overflow: hidden');
    expect(body).not.toContain('text-overflow');
    expect(body).toContain('white-space: nowrap');
  });

  it('syntax-highlights JSON payloads in expanded Event Mesh messages', async () => {
    const source = await readEventWebviewSource();
    const styles = await readEventStylesSource();

    expect(source).toContain('function renderPayloadBody(message)');
    expect(source).toContain('function formatJsonPayload(payload)');
    expect(source).toContain('function renderJsonPayload(payload)');
    expect(source).toContain('function highlightJsonPayload(json)');
    expect(source).toContain('JSON.stringify(parsed, null, 2)');
    expect(source).toContain('class="event-payload is-json"');
    expect(source).toContain('class="event-json-token ${tokenClass}"');
    expect(source).toContain("'event-json-key'");
    expect(source).toContain("'event-json-string'");
    expect(source).toContain("'event-json-number'");
    expect(source).toContain("'event-json-literal'");
    expect(source).toContain("'event-json-punctuation'");
    expect(source).toContain('renderPayloadBody(message)');
    expect(source).not.toContain('<pre class="event-payload">${escapeHtml(message.payload)}');
    expect(source).not.toContain('class="event-preview is-json"');
    expect(source).not.toContain('<code>${highlightJsonPayload(json)}</code>');

    expect(styles).toContain('.event-payload.is-json');
    expect(styles).toMatch(/\.event-payload\.is-json\s*\{[\s\S]*?background:\s*transparent;/);
    expect(styles).toContain('--event-json-key:');
    expect(styles).toContain('--event-json-string:');
    expect(styles).toContain('--event-json-number:');
    expect(styles).toContain('--event-json-literal:');
    expect(styles).toContain('--event-json-punctuation:');
    expect(styles).toContain('.event-json-token');
    expect(styles).toMatch(/\.event-json-token\s*\{[\s\S]*?background:\s*transparent;/);
    expect(styles).toContain('color: var(--event-json-key);');
    expect(styles).toContain('color: var(--event-json-string);');
    expect(styles).toContain('color: var(--event-json-number);');
    expect(styles).toContain('color: var(--event-json-literal);');
    expect(styles).toContain('color: var(--event-json-punctuation);');
    expect(styles).not.toContain('color: var(--vscode-symbolIcon-propertyForeground');
  });

  it('prototype fixture includes repeated client binding groups for Simple subscribe', async () => {
    const source = await readEventVariantSource();

    expect(source).toContain("name: 'orders-client'");
    expect(source).toContain("name: 'billing-client'");
    expect(source).toContain("name: 'inventory-client'");
    expect(source).toContain("padStart(2, '0')");
    expect(source).toContain('bindingName = `${group.name}-${suffix}`');
  });

  it('exposes the Event Mesh viewer variant from the prototype gallery index', async () => {
    const gallery = await readGallerySource();
    const index = await readPrototypeIndexSource();

    expect(index).toContain('value="event-mesh"');
    expect(gallery).toContain("id: 'event-mesh'");
    expect(gallery).toContain('./variants/events-webview.html');
  });

  it('syntax-highlights JSON responses after executing APIs requests', async () => {
    const source = await readApiWebviewSource();
    const styles = await readApiStylesSource();

    expect(source).toContain('const API_JSON_TOKEN_PATTERN');
    expect(source).toContain('function highlightApiJson(json)');
    expect(source).toContain('function renderApiJsonResult(payload)');
    expect(source).toContain('JSON.stringify(payload, null, 2)');
    expect(source).toContain('class="api-raw-json is-json" aria-label="API JSON response"');
    expect(source).toContain('class="api-json-token ${tokenClass}"');
    expect(source).toContain("'api-json-key'");
    expect(source).toContain("'api-json-string'");
    expect(source).toContain("'api-json-number'");
    expect(source).toContain("'api-json-literal'");
    expect(source).toContain("'api-json-punctuation'");
    expect(source).not.toContain('<code>${highlightApiJson(json)}</code>');
    expect(source).not.toContain('<pre class="api-raw-json" style=');

    expect(styles).toContain('.api-raw-json.is-json');
    expect(styles).toContain('--api-json-key');
    expect(styles).toContain('--api-json-string');
    expect(styles).toContain('--api-json-number');
    expect(styles).toContain('--api-json-literal');
    expect(styles).toContain('--api-json-punctuation');
    expect(styles).toContain('.api-json-token');
    expect(styles).toContain('.api-json-key');
    expect(styles).toContain('.api-json-string');
    expect(styles).toContain('.api-json-number');
    expect(styles).toContain('.api-json-literal');
    expect(styles).toContain('.api-json-punctuation');
    expect(styles).toContain('background-color: transparent;');
    expect(styles).not.toContain('background-color: var(--vscode-textCodeBlock-background');
    expect(styles).not.toContain('.api-raw-json code');
  });

  it('renders APIs response controls with reusable classes and complete grid columns', async () => {
    const source = await readApiWebviewSource();
    const styles = await readApiStylesSource();

    expect(source).toContain('function collectApiGridColumns(rows)');
    expect(source).toContain('const columns = collectApiGridColumns(rows);');
    expect(source).toContain('class="api-response-title-group"');
    expect(source).toContain('class="api-response-meta"');
    expect(source).toContain('class="api-view-content"');
    expect(source).not.toContain('class="api-view-content" style=');
    expect(source).not.toContain('class="api-copy-btn" data-action="api-copy-response" style=');

    expect(styles).toContain('.api-response-title-group');
    expect(styles).toContain('.api-response-meta');
    expect(styles).toContain('.api-copy-btn');
    expect(styles).toContain('.api-grid-container');
    expect(styles).toContain('.api-grid-empty');
  });

  it('adds a professional main tab shell for Request Runner and Live Trace', async () => {
    const source = await readApiWebviewSource();
    const styles = await readApiStylesSource();

    expect(source).toContain("apiActiveMainTab = 'request-runner'");
    expect(source).toContain('data-action="api-switch-main-tab"');
    expect(source).toContain('Request Runner');
    expect(source).toContain('Live Trace');
    expect(source).toContain('role="tablist" aria-label="APIs Explorer modes"');
    expect(source).toContain('class="api-split-layout"');
    expect(source).toContain('data-role="api-main-trace-actions"');

    expect(styles).toContain('.api-main-tabs');
    expect(styles).toContain('.api-main-trace-actions');
    expect(styles).toContain('.api-main-tab-btn');
    expect(styles).toContain('.api-main-tab-panel');
  });

  it('keeps Request Runner discovery, search, URL controls, and defaults aligned', async () => {
    const source = await readApiWebviewSource();
    const styles = await readApiStylesSource();

    expect(source).toContain("const API_DEFAULT_TOP = '100';");
    expect(source).toContain('$top: API_DEFAULT_TOP');
    expect(source).toContain('class="api-sidebar-loading"');
    expect(source).toContain('class="api-endpoint-search search-input-with-icon"');
    expect(source).toContain('class="search-input-icon"');
    expect(source).toContain('class="api-endpoint-search-input"');
    expect(source).toContain('class="api-request-url-row"');
    expect(source).not.toContain('api-entities-list-title');
    expect(source).not.toContain('Endpoints (${currentCatalog.entities.length})');

    expect(styles).toContain('.api-sidebar-loading');
    expect(styles).toContain('.api-endpoint-search');
    expect(styles).toContain('.api-endpoint-search-input');
    expect(styles).toContain('.api-request-url-row');
  });

  it('renders Live Trace as a request/response inspector with URL aggregation controls', async () => {
    const source = await readApiWebviewSource();
    const styles = await readApiStylesSource();

    expect(source).toContain('function renderLiveTracePanel()');
    expect(source).toContain('Start Listening');
    expect(source).toContain('Stop Listening');
    expect(source).toContain('Observed URL');
    expect(source).toContain('Path or URL contains');
    expect(source).toContain('Trace request stream');
    expect(source).toContain('Trace event details');
    expect(source).toContain('apiTraceDetailTab');
    expect(source).toContain("apiTraceDetailTab = 'overview'");
    expect(source).toContain('data-action="api-trace-switch-detail-tab"');
    expect(source).toContain('Overview');
    expect(source).toContain('Request');
    expect(source).toContain('Response');
    expect(source).toContain('data-action="api-trace-copy-curl"');
    expect(source).toContain('Copy cURL');
    expect(source).toContain('function buildTraceCurlCommand(event)');
    expect(source).toContain('function copyTraceCurl(button)');
    expect(source).toContain('Request Headers');
    expect(source).toContain('Response Headers');
    expect(source).toContain('Request Body');
    expect(source).toContain('Response Body');
    expect(source).toContain('api-trace-detail-grid');
    expect(source).toContain('api-trace-overview-grid');
    expect(source).toContain('api-trace-detail-tabs');
    expect(source).toContain('api-trace-selected-request');
    expect(source).toContain('authorization');
    expect(source).toContain('sapTools.apis.trace.start');
    expect(source).toContain('sapTools.apis.trace.stop');
    expect(source).toContain('sapTools.apis.trace.clear');
    expect(source).toContain('apiTraceCaptureHeaders');
    expect(source).toContain('captureHeaders: apiTraceCaptureHeaders');
    expect(source).toContain("traceToggleLabel = canStop ? 'Stop Listening' : 'Start Listening'");
    expect(source).toContain('data-action="${traceToggleAction}"');
    expect(source).toContain('data-action="api-trace-toggle-settings"');
    expect(source).toContain('class="api-trace-settings-popover${apiTraceSettingsOpen');
    expect(source).toContain('class="api-trace-stream-toggle secondary-action"');
    expect(source).toContain('if (apiTracePaused) return;');
    expect(source).toContain("apiTraceState = 'preparingCli'");
    expect(source).toContain('function renderTraceActionCluster()');
    expect(source).toContain('function updateTraceTopActions()');
    expect(source).toContain('class="api-trace-state-badge ${statusClass}"');
    expect(source).toContain('formatTraceStateLabel(apiTraceState)');
    expect(source).not.toContain('<h2>Live Trace</h2>');
    expect(source).not.toContain('class="api-trace-toolbar"');
    expect(source).not.toContain('Ready to listen for runtime HTTP traffic.');
    expect(source).not.toContain('State: ${escapeHtml(apiTraceState)}');
    expect(source).not.toContain('No request selected');
    expect(source).not.toContain('<h3>Request/Response detail</h3>');
    expect(source).not.toContain('api-trace-status-line');
    expect(source).not.toContain('<legend>Trace target</legend>');
    expect(source).not.toContain('<legend>Capture</legend>');
    expect(source).not.toContain('data-action="api-trace-start" ${isActive ?');
    expect(source).not.toContain('data-action="api-trace-stop" ${canStop ?');
    expect(source).not.toContain('Trace detail views');
    expect(source).not.toContain('data-action="api-trace-switch-detail"');
    expect(source).not.toContain('Runtime HTTP Trace · Hook');
    expect(source).not.toContain('${event.requestBytes} req / ${event.responseBytes} res');

    expect(styles).toContain('.api-trace-shell');
    expect(styles).toContain('.api-trace-stream');
    expect(styles).toContain('.api-trace-detail');
    expect(styles).toContain('.api-trace-action-btn');
    expect(styles).toContain('.api-trace-detail-grid');
    expect(styles).toContain('.api-trace-overview-grid');
    expect(styles).toContain('.api-trace-detail-tabs');
    expect(styles).toContain('.api-trace-detail-tab-btn');
    expect(styles).toContain('.api-trace-copy-curl-btn');
    expect(styles).toContain('.api-trace-selected-request');
    expect(styles).toContain('.api-trace-tab-panel');
    expect(styles).toContain('.api-trace-url-select');
    expect(styles).toContain('.api-trace-state-badge');
    expect(styles).toContain('.api-trace-settings-container');
    expect(styles).toContain('.api-trace-settings-popover');
    expect(styles).toContain('.api-trace-stream-toggle');
    expect(styles).not.toContain('.api-trace-detail-columns');
  });

  it('persists Live Trace capture preferences with rich conditional body rendering', async () => {
    const source = await readApiWebviewSource();
    const styles = await readApiStylesSource();

    expect(source).toContain('let apiTraceCaptureHeaders = true;');
    expect(source).toContain('let apiTraceCaptureRequestBody = true;');
    expect(source).toContain('let apiTraceCaptureResponseBody = true;');
    expect(source).toContain('const API_TRACE_PREFERENCES_KEY');
    expect(source).toContain('function loadApiTracePreferences()');
    expect(source).toContain('function saveApiTracePreferences()');
    expect(source).toContain('vscodeApi.getState');
    expect(source).toContain('vscodeApi.setState');
    expect(source).toContain('sessionStorage.getItem(API_TRACE_PREFERENCES_KEY)');
    expect(source).toContain('renderTraceHeaderSection');
    expect(source).toContain('renderTraceBodySection');
    expect(source).toContain('class="api-trace-subsection api-trace-body-section is-${escapeHtml(kind)}"');
    expect(source).toContain('apiTraceCaptureHeaders ? renderTraceHeaderSection');
    expect(source).toContain('apiTraceCaptureRequestBody ? renderTraceBodySection');
    expect(source).toContain('apiTraceCaptureResponseBody ? renderTraceBodySection');
    expect(source).toContain('renderTraceRequestTab(event)');
    expect(source).toContain('renderTraceResponseTab(event)');
    expect(source).toContain('renderTraceOverview(event)');
    expect(source).toContain('const API_TRACE_JSON_TOKEN_PATTERN');
    expect(source).toContain('function formatTraceJsonPreview(preview)');
    expect(source).toContain('function highlightTraceJson(json)');
    expect(source).toContain('api-trace-json-token');
    expect(source).toContain('data-action="api-trace-copy-body"');
    expect(source).toContain('function copyTraceBodyPreview');
    expect(source).toContain('maxBodyBytes: 0');
    expect(source).not.toContain('[truncated]');

    expect(styles).toContain('.api-trace-control-field');
    expect(styles).toContain('.api-trace-metric-row');
    expect(styles).toContain('.api-trace-copy-body-btn');
    expect(styles).toContain('.api-trace-preview.is-json');
    expect(styles).toContain('.api-trace-json-token');
    expect(styles).toMatch(/\.api-trace-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(styles).toMatch(/\.api-trace-preview\s*\{[\s\S]*?max-height:\s*260px;/);
    expect(styles).toMatch(/\.api-trace-body-section\.is-request\s+\.api-trace-preview\s*\{[\s\S]*?max-height:\s*338px;/);
    expect(styles).toMatch(/\.api-trace-preview\s*\{[\s\S]*?overflow:\s*auto;/);
  });

  it('keeps Live Trace UI free of inline event handlers and new inline trace styles', async () => {
    const source = await readApiWebviewSource();

    expect(source).not.toContain('onmouseover=');
    expect(source).not.toContain('onmouseout=');
    expect(source).not.toContain('api-trace-shell" style=');
    expect(source).not.toContain('api-trace-stream" style=');
    expect(source).not.toContain('api-trace-detail" style=');
  });

  it('loads the standalone APIs prototype with mock catalog data outside VS Code', async () => {
    const source = await readApiWebviewSource();

    expect(source).toContain('if (!vscodeApi) {');
    expect(source).toContain("apiCatalogState = 'loaded';");
    expect(source).toContain("apiCurrentCatalog = API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];");
  });

  it('keeps APIs discovery loading from falling back to demo endpoints inside VS Code', async () => {
    const source = await readApiWebviewSource();
    const selectEntityBlock = /if \(action === 'api-select-entity'\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] ?? '';

    expect(source).toContain('function resolveApiCatalog()');
    expect(source).toContain('if (!vscodeApi) return resolveMockApiCatalog();');
    expect(source).toContain('if (currentCatalog === null) {');
    expect(source).toContain("apiSelectedEntity = '';");
    expect(source).toContain('function updateApiEntitySelection()');
    expect(source).toContain("btn.classList.toggle('is-active', isSelected);");
    expect(source).toContain("btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');");
    expect(source).toContain('const previousScrollTop = listContainer ? listContainer.scrollTop : 0;');
    expect(selectEntityBlock).toContain('updateApiEntitySelection();');
    expect(selectEntityBlock).not.toContain('updateSidebarSection();');
  });

  it('sends sapTools.events.publishEvent message and handles publishResult response', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain("'sapTools.events.publishEvent'");
    expect(source).toContain("'sapTools.events.publishResult'");
    expect(source).toContain('postPublishEvent');
  });

  it('prototype fixture handles publishEvent message with mock result', async () => {
    const source = await readEventVariantSource();

    expect(source).toContain("'sapTools.events.publishEvent'");
    expect(source).toContain("'sapTools.events.publishResult'");
    expect(source).toContain('destinationKind: message.destinationKind');
    expect(source).toContain('destination: message.destination');
    expect(source).toContain('status: 204');
  });

  it('makes the Publish form controls fill the available panel width', async () => {
    const styles = await readEventStylesSource();
    const inputMatch = /\.event-input\s*\{([\s\S]*?)\n\}/.exec(styles);
    const formMatch = /\.event-publish-form\s*\{([\s\S]*?)\n\}/.exec(styles);

    expect(inputMatch).not.toBeNull();
    expect(inputMatch?.[1] ?? '').toContain('box-sizing: border-box');
    expect(inputMatch?.[1] ?? '').toContain('width: 100%');

    expect(formMatch).not.toBeNull();
    expect(formMatch?.[1] ?? '').toContain('width: 100%');
    expect(formMatch?.[1] ?? '').toContain('max-width: none');
    expect(formMatch?.[1] ?? '').not.toContain('max-width: 640px');
  });

  it('lets Publish choose discovered topics with a custom picker while preserving free-form topic entry', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain('renderPublishTopicField');
    expect(source).toContain('renderPublishCandidateField');
    expect(source).toContain('renderPublishCandidateOptions');
    expect(source).toContain('publishTopicCandidates');
    expect(source).toContain('data-role="ep-topic-input"');
    expect(source).toContain('data-action="ep-toggle-candidates"');
    expect(source).toContain('data-action="ep-select-candidate"');
    expect(source).toContain('requestPublishMetadata');
    expect(source).toContain("'sapTools.events.selectPublishBinding'");
    expect(source).not.toContain('publishTopic = state.discoveredTopics');
    expect(source).not.toContain('<datalist');
  });

  it('bounds the Publish candidate dropdown and toggles it closed from its button', async () => {
    const source = await readEventWebviewSource();
    const styles = await readEventStylesSource();

    expect(source).toContain('let publishCandidateDropdown = null;');
    expect(source).toContain('function togglePublishCandidateDropdown(kind)');
    expect(source).toContain('function closePublishCandidateDropdown()');
    expect(source).toContain('publishCandidateDropdown === normalizedKind ? null : normalizedKind');
    expect(source).toContain("target.closest('[data-role=\"ep-candidate-field\"]')");
    expect(source).toContain("closePublishCandidateDropdown();");

    expect(styles).toMatch(/\.event-publish-options\s*\{[\s\S]*?max-height:\s*220px;/);
    expect(styles).toMatch(/\.event-publish-options\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toMatch(/\.event-publish-options\s*\{[\s\S]*?z-index:\s*20;/);
  });

  it('adds Queue as a Publish destination with discovered queue candidates and manual entry', async () => {
    const source = await readEventWebviewSource();
    const styles = await readEventStylesSource();
    const fixture = await readEventVariantSource();

    expect(source).toContain("let publishDestinationKind = 'topic';");
    expect(source).toContain('let publishQueue =');
    expect(source).toContain('const queuesByBinding = new Map();');
    expect(source).toContain('function queueStateFor(index)');
    expect(source).toContain('function handleQueues(data)');
    expect(source).toContain("'sapTools.events.queues'");
    expect(source).toContain('data-role="ep-destination-kind" value="queue"');
    expect(source).toContain('data-role="ep-queue-input"');
    expect(source).toContain('renderPublishCandidateField');
    expect(source).toContain('renderPublishCandidateOptions');
    expect(source).toContain("message.queueName = destination");
    expect(source).toContain("destinationKind: publishDestinationKind");
    expect(source).toContain('destination,');
    expect(styles).toContain('.event-publish-destination');
    expect(styles).toMatch(/\.event-segment-option input\s*\{[\s\S]*?inset:\s*0;/);
    expect(styles).toMatch(/\.event-segment-option input\s*\{[\s\S]*?width:\s*100%;/);
    expect(fixture).toContain("'sapTools.events.selectPublishBinding'");
    expect(fixture).toContain("'sapTools.events.queues'");
    expect(fixture).toContain('postPrototypeQueues');
  });
});

describe('prototype S/4HANA SQL Workbench table refresh', () => {
  it('treats refresh-hana-tables as an in-place SQL-only action so the service list is not re-rendered', async () => {
    const topology = await readFile(
      new URL('../docs/designs/prototypes/src/02-topology.js', import.meta.url),
      'utf8'
    );
    // Must be in the SQL-only set, otherwise the click falls through to a full
    // renderPrototype() that rebuilds the service list and resets its scroll.
    expect(topology).toMatch(/isSqlOnlyAction[\s\S]*?'refresh-hana-tables'/);

    const events = await readEventsSource();
    // Pin refresh-hana-tables INTO the in-place branch (alongside
    // select-hana-service → refreshMountedSqlWorkbench), not merely present
    // somewhere — otherwise routing it to the else branch would still pass.
    expect(events).toMatch(
      /action === 'select-hana-service' \|\| action === 'refresh-hana-tables'\)[\s\S]*?refreshMountedSqlWorkbench\(\)/
    );
  });
});

describe('prototype S/4HANA SQL Workbench tunnel indicator', () => {
  it('shows a single tunnel badge beside the workbench title, not a per-row badge or count', async () => {
    const source = await readSqlRenderSource();

    // One presence badge in the header.
    expect(source).toContain('data-role="hana-tunnel-indicator"');
    expect(source).toContain('anyHanaTunnelActive');
    // No per-row badge, no count label.
    expect(source).not.toContain('hana-service-tunnel-badge');
    expect(source).not.toContain('hana-tunnel-count');
    expect(source).not.toContain('countActiveHanaTunnels');
    expect(source).not.toContain('formatHanaTunnelCountLabel');
  });
});
