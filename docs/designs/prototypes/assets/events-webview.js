// Event Mesh viewer webview. Runs in an editor WebviewPanel created by
// src/eventMeshPanel.ts. The extension host owns the AMQP connection; this script
// only renders state and posts user intents back. CSP forbids inline handlers, so
// all interaction goes through delegated listeners (see the bottom of this file).

const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const appId = (typeof window !== 'undefined' && window.eventMeshAppId) || 'demo-app';

const DEFAULT_MESSAGE_BUFFER_LIMIT = 1000;
const MIN_MESSAGE_BUFFER_LIMIT = 100;
const MAX_MESSAGE_BUFFER_LIMIT = 10000;
const MESSAGE_BUFFER_INPUT_DEBOUNCE_MS = 250;
const MAX_DOM_ROWS = 300; // rows actually painted (newest first)
const SIMPLE_GROUP_EXPAND_COOLDOWN_MS = 300;

let phase = 'loading'; // loading | ready | error
let errorMessage = '';
let startError = '';
let statusLine = '';

let activeTab = 'subscribe-simple'; // 'subscribe-simple' | 'subscribe-advance' | 'publish'

let bindings = [];
const selectedBindingIndexes = new Set();
const topicsByBinding = new Map();
const queuesByBinding = new Map();
let activeBindingIndex = null;
let expandedBindingIndex = null;
const simpleExpandedGroupKeys = new Set();
const simpleGroupExpansionTimestamps = new Map();
let addBindingOpen = false;
let bindingSearch = '';
let streaming = false;
let stoppedReason = '';
let paused = false;
let bindingFilterIndex = null;
let messageSearch = '';
let eventSettingsOpen = false;
let messageBufferLimit = DEFAULT_MESSAGE_BUFFER_LIMIT;
let messageBufferLimitTimer = null;

let publishBindingIndex = null;
let publishDestinationKind = 'topic';
let publishTopic = '';
let publishQueue = '';
let publishContentType = 'application/json';
let publishPayload = '';
let publishResult = null; // { ok, status, destinationKind, destination, message }
let publishSending = false;
let publishCandidateDropdown = null;
let stoppingAll = false;

let messages = [];
let totalReceived = 0;
const expandedSeqs = new Set();
let messageRenderScheduled = false;

const REASON_TEXT = {
  user: 'Listening stopped.',
  'panel-closed': 'Panel closed.',
  'scope-changed': 'Listening stopped because the active region/org/space changed.',
  shutdown: 'Listening stopped.',
};

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bindingId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function findBinding(index) {
  return bindings.find((binding) => binding.index === index) || null;
}

function createTopicState() {
  return {
    loading: true,
    discoveredTopics: [],
    wildcardTopic: '',
    discoveryError: '',
    selectedTopics: new Set(),
    liveTopics: new Set(),
    customTopics: [],
    queueName: '',
    status: 'ready',
    statusMessage: '',
  };
}

function topicStateFor(index) {
  let state = topicsByBinding.get(index);
  if (state === undefined) {
    state = createTopicState();
    topicsByBinding.set(index, state);
  }
  return state;
}

function createQueueState() {
  return {
    loading: true,
    queues: [],
    discoveryError: '',
  };
}

function queueStateFor(index) {
  let state = queuesByBinding.get(index);
  if (state === undefined) {
    state = createQueueState();
    queuesByBinding.set(index, state);
  }
  return state;
}

function sortedSelectedBindingIndexes() {
  return [...selectedBindingIndexes].sort((left, right) => left - right);
}

function selectedBindings() {
  return sortedSelectedBindingIndexes()
    .map(findBinding)
    .filter((binding) => binding !== null);
}

function selectSimpleBinding(index) {
  selectedBindingIndexes.add(index);
  activeBindingIndex = index;
}

function simpleBindingTitle(binding) {
  return String(binding?.name || binding?.instanceName || binding?.namespace || 'Binding');
}

function normalizeSimpleBindingGroupName(value) {
  const trimmed = String(value || '').trim();
  const withoutIndex = trimmed.replace(/[\s._-]*\d+$/, '').replace(/[\s._-]+$/, '').trim();
  return withoutIndex.length > 0 ? withoutIndex : trimmed;
}

function simpleWildcardFor(binding) {
  return `${binding.namespace}/*`;
}

function simpleGroupKey(label) {
  return label.toLowerCase();
}

function buildSimpleBindingTree() {
  const buckets = new Map();
  for (const binding of [...bindings].sort((a, b) => simpleBindingTitle(a).localeCompare(simpleBindingTitle(b)))) {
    const label = normalizeSimpleBindingGroupName(simpleBindingTitle(binding));
    const key = simpleGroupKey(label);
    const bucket = buckets.get(key) || { key, label, bindings: [] };
    bucket.bindings.push(binding);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function isSimpleBindingLocked(binding) {
  const state = topicStateFor(binding.index);
  return state.status === 'listening' || state.status === 'starting';
}

function simpleSelectableBindings(group) {
  return group.bindings.filter((binding) => !isSimpleBindingLocked(binding));
}

function selectedSimpleGroupCount() {
  return buildSimpleBindingTree().filter((group) =>
    group.bindings.some((binding) => selectedBindingIndexes.has(binding.index))
  ).length;
}

function requestTopics(index) {
  const state = topicStateFor(index);
  if (state.loading && vscodeApi) {
    vscodeApi.postMessage({ type: 'sapTools.events.selectBinding', bindingIndex: index });
  }
}

function selectedPublishBindingIndex() {
  if (publishBindingIndex !== null) return publishBindingIndex;
  return bindings[0] !== undefined ? bindings[0].index : null;
}

function requestPublishMetadata(index = selectedPublishBindingIndex()) {
  if (index === null || !vscodeApi) return;
  const topicState = topicStateFor(index);
  const queueState = queueStateFor(index);
  if (!topicState.loading && !queueState.loading) return;
  vscodeApi.postMessage({ type: 'sapTools.events.selectPublishBinding', bindingIndex: index });
}

function addSelectedBinding(index) {
  selectedBindingIndexes.add(index);
  activeBindingIndex = index;
  expandedBindingIndex = index;
  addBindingOpen = false;
  bindingSearch = '';
  requestTopics(index);
}

function removeSelectedBinding(index) {
  selectedBindingIndexes.delete(index);
  if (activeBindingIndex === index) activeBindingIndex = sortedSelectedBindingIndexes()[0] ?? null;
  if (expandedBindingIndex === index) expandedBindingIndex = null;
  if (bindingFilterIndex === index) bindingFilterIndex = null;
}

function formatBytes(size) {
  if (typeof size !== 'number' || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function shortTime(iso) {
  const t = String(iso || '');
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(t);
  return match ? match[1] : t;
}

function oneLinePreview(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

function plural(count, singular, pluralValue) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function normalizeMessageBufferLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MESSAGE_BUFFER_LIMIT;
  return Math.min(MAX_MESSAGE_BUFFER_LIMIT, Math.max(MIN_MESSAGE_BUFFER_LIMIT, Math.round(numeric)));
}

function pruneExpandedMessageState() {
  const liveSeqs = new Set(messages.map((message) => message.seq));
  for (const seq of [...expandedSeqs]) {
    if (!liveSeqs.has(seq)) expandedSeqs.delete(seq);
  }
}

function trimStoredMessages() {
  if (messages.length > messageBufferLimit) {
    messages = messages.slice(-messageBufferLimit);
  }
  pruneExpandedMessageState();
}

function applyMessageBufferLimit(value) {
  if (messageBufferLimitTimer !== null) {
    clearTimeout(messageBufferLimitTimer);
    messageBufferLimitTimer = null;
  }
  messageBufferLimit = normalizeMessageBufferLimit(value);
  trimStoredMessages();
  const input = document.querySelector('[data-role="em-message-buffer-limit"]');
  if (input) input.value = String(messageBufferLimit);
  renderMessages();
}

function scheduleMessageBufferLimitApply(value) {
  const raw = String(value || '').trim();
  if (raw.length === 0 || Number(raw) < MIN_MESSAGE_BUFFER_LIMIT) return;
  if (messageBufferLimitTimer !== null) clearTimeout(messageBufferLimitTimer);
  messageBufferLimitTimer = setTimeout(() => {
    messageBufferLimitTimer = null;
    applyMessageBufferLimit(raw);
  }, MESSAGE_BUFFER_INPUT_DEBOUNCE_MS);
}

function stringifyForSearch(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function messageMatchesSearch(message, query) {
  const haystack = [
    messageBindingName(message),
    message.bindingNamespace,
    message.queueName,
    message.topic,
    message.contentType,
    message.messageId,
    message.encoding,
    message.payload,
    stringifyForSearch(message.headers),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

const JSON_TOKEN_PATTERN = /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;

function highlightJsonPayload(json) {
  return json.replace(JSON_TOKEN_PATTERN, (token, offset, source) => {
    let tokenClass = 'event-json-punctuation';
    if (token.startsWith('"')) {
      const afterToken = source.slice(offset + token.length);
      tokenClass = /^\s*:/.test(afterToken) ? 'event-json-key' : 'event-json-string';
    } else if (/^-?\d/.test(token)) {
      tokenClass = 'event-json-number';
    } else if (token === 'true' || token === 'false' || token === 'null') {
      tokenClass = 'event-json-literal';
    }
    return `<span class="${tokenClass}">${escapeHtml(token)}</span>`;
  });
}

function renderJsonPayload(payload) {
  try {
    const json = JSON.stringify(JSON.parse(payload), null, 2);
    return `<pre class="event-payload is-json">${highlightJsonPayload(json)}</pre>`;
  } catch {
    return null;
  }
}

function renderPayloadBody(message) {
  const payload = String(message.payload ?? '');
  const jsonPayload = renderJsonPayload(payload);
  if (jsonPayload !== null) {
    const note = message.truncated ? '<div class="event-payload-note">… (truncated)</div>' : '';
    return `${jsonPayload}${note}`;
  }
  return `<pre class="event-payload">${escapeHtml(payload)}${message.truncated ? '\n… (truncated)' : ''}</pre>`;
}

// --- Rendering ---------------------------------------------------------------

function render() {
  const root = document.getElementById('event-mesh-app');
  if (!root) return;

  if (phase === 'loading') {
    root.innerHTML = `<div class="event-state">${spinner()}<p>Reading enterprise-messaging bindings for <strong>${escapeHtml(appId)}</strong>…</p></div>`;
    return;
  }
  if (phase === 'error') {
    root.innerHTML = renderError();
    return;
  }
  if (activeTab === 'publish') {
    root.innerHTML = renderPublishView();
    return;
  }
  root.innerHTML = activeTab === 'subscribe-advance'
    ? renderReady()
    : renderSimpleSubscribeView();
  applySimpleIndeterminateState();
  renderMessages();
}

function renderError() {
  return `
    <div class="event-state event-state-error">
      <h2>Cannot Open Event Viewer</h2>
      <p>${escapeHtml(errorMessage)}</p>
      <button type="button" class="event-btn" data-action="em-retry">Try Again</button>
    </div>`;
}

function applySimpleIndeterminateState() {
  for (const input of document.querySelectorAll('[data-indeterminate="true"]')) {
    if (input instanceof HTMLInputElement) {
      input.indeterminate = true;
    }
  }
}

function spinner() {
  return '<span class="event-spinner" aria-hidden="true"></span>';
}

function btnSpinner() {
  return '<span class="event-btn-spinner" aria-hidden="true"></span>';
}

function renderHeader() {
  return `
    <header class="event-header">
      <div class="event-header-main">
        <span class="event-title">Event Mesh</span>
        <span class="event-app">${escapeHtml(appId)}</span>
      </div>
      <div class="event-header-end">
        <div class="event-tabs-row">
          <div class="event-tabs" role="tablist">
            <button type="button" class="event-tab${activeTab === 'subscribe-simple' ? ' is-active' : ''}" role="tab" data-action="em-switch-tab" data-tab="subscribe-simple" aria-selected="${activeTab === 'subscribe-simple'}">Subscribe Simple</button>
            <button type="button" class="event-tab${activeTab === 'subscribe-advance' ? ' is-active' : ''}" role="tab" data-action="em-switch-tab" data-tab="subscribe-advance" aria-selected="${activeTab === 'subscribe-advance'}">Subscribe Advance</button>
            <button type="button" class="event-tab${activeTab === 'publish' ? ' is-active' : ''}" role="tab" data-action="em-switch-tab" data-tab="publish" aria-selected="${activeTab === 'publish'}">Publish</button>
          </div>
          <button
            type="button"
            class="event-settings-toggle${eventSettingsOpen ? ' is-active' : ''}"
            data-action="em-toggle-settings"
            data-role="event-settings-toggle"
            aria-label="Event settings"
            aria-controls="event-settings-panel"
            aria-expanded="${eventSettingsOpen}"
            title="Event settings"
          >⚙</button>
        </div>
      </div>
    </header>
    ${renderEventSettingsPanel()}`;
}

function renderEventSettingsPanel() {
  if (!eventSettingsOpen) return '';
  return `
    <section
      id="event-settings-panel"
      class="event-settings-panel"
      data-role="event-settings-panel"
      aria-label="Event settings"
    >
      <label class="event-settings-field">
        <span class="event-label">Message Buffer</span>
        <input
          type="number"
          class="event-input event-settings-number"
          data-role="em-message-buffer-limit"
          value="${messageBufferLimit}"
          min="${MIN_MESSAGE_BUFFER_LIMIT}"
          max="${MAX_MESSAGE_BUFFER_LIMIT}"
          step="100"
          aria-label="Message buffer limit"
        />
      </label>
      <span class="event-settings-unit">messages</span>
    </section>`;
}

function renderReady() {
  return `
    ${renderHeader()}
    <main class="event-shell">
      <section class="event-setup" aria-label="Event Mesh listener setup">
        ${renderSelectedBindingsSection()}
      </section>
      <section class="event-results" aria-label="Event Mesh results">
        ${renderResults()}
      </section>
    </main>`;
}

function renderSimpleSubscribeView() {
  return `
    ${renderHeader()}
    <main class="event-shell">
      <section class="event-setup" aria-label="Event Mesh simple listener setup">
        ${renderSimpleSubscribeSection()}
      </section>
      <section class="event-results" aria-label="Event Mesh results">
        ${renderResults()}
      </section>
    </main>`;
}

function renderSimpleSubscribeSection() {
  return `
    <div class="event-section-head">
      <h2>Client Binding Groups</h2>
      <span class="event-simple-summary">${escapeHtml(simpleSelectionSummary())}</span>
    </div>
    ${renderSimpleTree()}
    ${startError ? `<p class="event-inline-error" role="alert">${escapeHtml(startError)}</p>` : ''}
    ${renderSimpleActions()}`;
}

function simpleSelectionSummary() {
  const selected = selectedBindingIndexes.size;
  if (selected === 0) {
    return `${bindings.length} bindings available`;
  }
  const groups = selectedSimpleGroupCount();
  return `${plural(selected, 'binding', 'bindings')} selected across ${plural(groups, 'group', 'groups')}`;
}

function renderSimpleTree() {
  const groups = buildSimpleBindingTree();
  if (groups.length === 0) {
    return '<div class="event-selected-empty"><p>No messaging bindings available.</p></div>';
  }
  return `
    <div class="event-simple-tree" role="tree" aria-label="Client Binding Groups">
      ${groups.map(renderSimpleGroup).join('')}
    </div>`;
}

function renderSimpleGroup(group) {
  if (group.bindings.length === 1) {
    return renderSimpleBindingRow(group.bindings[0], 1);
  }
  const selectableBindings = simpleSelectableBindings(group);
  const selectedCount = group.bindings.filter((binding) => selectedBindingIndexes.has(binding.index)).length;
  const expanded = simpleExpandedGroupKeys.has(group.key);
  const checked = selectedCount === group.bindings.length;
  const indeterminate = selectedCount > 0 && selectedCount < group.bindings.length;
  return `
    <div class="event-simple-group" role="treeitem" aria-expanded="${expanded}">
      <div class="event-simple-group-row" data-action="em-expand-simple-group" data-group-key="${escapeHtml(group.key)}">
        <button type="button" class="event-simple-expander" data-action="em-expand-simple-group" data-group-key="${escapeHtml(group.key)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(group.label)}">${expanded ? '▾' : '▸'}</button>
        <label class="event-simple-check" data-action="em-toggle-simple-group" data-group-key="${escapeHtml(group.key)}">
          <input type="checkbox" data-role="em-simple-group-checkbox" ${checked ? 'checked' : ''} ${indeterminate ? 'data-indeterminate="true"' : ''} ${selectableBindings.length === 0 ? 'disabled' : ''} />
          <span class="event-binding-name">${escapeHtml(group.label)}</span>
        </label>
        <span class="event-binding-count">${selectedCount}/${group.bindings.length} selected</span>
      </div>
      ${expanded ? `<div class="event-simple-children" role="group">${group.bindings.map((binding) => renderSimpleBindingRow(binding, 2)).join('')}</div>` : ''}
    </div>`;
}

function renderSimpleBindingRow(binding, level) {
  const state = topicStateFor(binding.index);
  const selected = selectedBindingIndexes.has(binding.index);
  const live = state.status === 'listening';
  const locked = isSimpleBindingLocked(binding);
  return `
    <label class="event-simple-binding event-simple-level-${level}" role="treeitem" data-action="em-toggle-simple-binding" data-binding-index="${binding.index}">
      <input type="checkbox" data-role="em-simple-binding-checkbox" ${selected ? 'checked' : ''} ${locked ? 'disabled' : ''} />
      <span class="event-binding-name">${escapeHtml(binding.name)}</span>
      <span class="event-binding-namespace" title="${escapeHtml(binding.namespace)}">${escapeHtml(binding.namespace)}</span>
      <span class="event-status-pill ${statusClass(state.status)}">${live ? 'Listening' : 'All Topics'}</span>
    </label>`;
}

function renderSimpleActions() {
  const requests = collectSimpleStartRequests();
  const anyStarting = selectedBindings().some((binding) => topicStateFor(binding.index).status === 'starting');
  const labelSuffix = streaming ? ' More' : '';
  const label = requests.length === 1 ? 'Binding' : 'Bindings';
  const hint = streaming
    ? 'Select another group or client binding to add it without clearing received messages.'
    : 'Simple mode subscribes each selected binding to all topics in its namespace.';
  const stopButton = streaming
    ? `<button type="button" class="event-btn" data-action="em-stop" ${stoppingAll ? 'disabled' : ''}>${stoppingAll ? `${btnSpinner()} Stopping…` : 'Stop All'}</button>`
    : '';
  return `
    <div class="event-config-actions">
      <button type="button" class="event-btn event-btn-primary" data-action="em-start-simple" ${requests.length === 0 || anyStarting || stoppingAll ? 'disabled' : ''}>${anyStarting ? `${btnSpinner()} Starting…` : `Start Listening To ${requests.length}${labelSuffix} ${label}`}</button>
      ${stopButton}
      <span class="event-hint">${escapeHtml(hint)}</span>
    </div>`;
}

function renderSimpleStreamingActions() {
  return `
    <div class="event-config-actions">
      <button type="button" class="event-btn" data-action="em-stop" ${stoppingAll ? 'disabled' : ''}>${stoppingAll ? `${btnSpinner()} Stopping…` : 'Stop All'}</button>
      <span class="event-hint">Use Subscribe Advance to add topics or bindings while listening.</span>
    </div>`;
}

function renderPublishView() {
  return `
    ${renderHeader()}
    <main class="event-shell">
      <section class="event-publish" aria-label="Publish Event">
        ${renderPublishForm()}
      </section>
    </main>`;
}

function renderPublishForm() {
  const hasBindings = bindings.length > 0;
  const selectedIdx = selectedPublishBindingIndex() ?? 0;
  const selectedBinding = findBinding(selectedIdx);
  return `
    <div class="event-section-head">
      <h2>Publish Event</h2>
    </div>
    <div class="event-publish-form">
      ${renderPublishDestinationSelector()}
      <label class="event-field">
        <span class="event-label">Messaging Binding</span>
        <select class="event-input event-select" data-role="ep-binding-select">
          ${hasBindings ? bindings.map((b) => `<option value="${b.index}"${b.index === selectedIdx ? ' selected' : ''}>${escapeHtml(b.name)} — ${escapeHtml(b.namespace)}</option>`).join('') : '<option value="">No bindings available</option>'}
        </select>
      </label>
      ${renderPublishDestinationField(selectedBinding)}
      <label class="event-field">
        <span class="event-label">Content-Type</span>
        <select class="event-input event-select" data-role="ep-content-type-select">
          <option value="application/json"${publishContentType === 'application/json' ? ' selected' : ''}>application/json</option>
          <option value="text/plain"${publishContentType === 'text/plain' ? ' selected' : ''}>text/plain</option>
        </select>
      </label>
      <div class="event-field">
        <div class="event-field-head">
          <span class="event-label">Payload</span>
          <button type="button" class="event-btn event-btn-compact" data-action="ep-format-json">Format JSON</button>
        </div>
        <textarea class="event-input event-textarea" data-role="ep-payload-input" rows="8" autocomplete="off" spellcheck="false">${escapeHtml(publishPayload)}</textarea>
      </div>
      ${renderPublishResult()}
      <div class="event-config-actions">
        <button type="button" class="event-btn event-btn-primary" data-action="ep-send" ${publishCanSend() && hasBindings ? '' : 'disabled'}>${publishSending ? `${btnSpinner()} Sending…` : 'Publish Event'}</button>
        <span class="event-hint">${escapeHtml(publishDestinationHint())}</span>
      </div>
    </div>`;
}

function renderPublishDestinationSelector() {
  return `
    <div class="event-publish-destination" role="radiogroup" aria-label="Publish destination">
      <label class="event-segment-option${publishDestinationKind === 'topic' ? ' is-active' : ''}">
        <input type="radio" name="ep-destination-kind" data-role="ep-destination-kind" value="topic" aria-label="Publish to Topic" ${publishDestinationKind === 'topic' ? 'checked' : ''} />
        <span>Topic</span>
      </label>
      <label class="event-segment-option${publishDestinationKind === 'queue' ? ' is-active' : ''}">
        <input type="radio" name="ep-destination-kind" data-role="ep-destination-kind" value="queue" aria-label="Publish to Queue" ${publishDestinationKind === 'queue' ? 'checked' : ''} />
        <span>Queue</span>
      </label>
    </div>`;
}

function renderPublishDestinationField(binding) {
  if (publishDestinationKind === 'queue') {
    return renderPublishQueueField(binding);
  }
  return renderPublishTopicField(binding);
}

function renderPublishTopicField(binding) {
  const index = binding ? binding.index : 0;
  const state = topicStateFor(index);
  const hint = binding ? `e.g. ${escapeHtml(binding.namespace)}/items/created` : 'e.g. namespace/entity/event';
  return `${renderPublishCandidateField({
    kind: 'topic',
    label: 'Topic',
    inputRole: 'ep-topic-input',
    value: publishTopic,
    placeholder: hint,
    candidates: publishTopicCandidates(state),
  })}
  ${renderPublishMetadataHint(state, 'topic')}`;
}

function renderPublishQueueField(binding) {
  const index = binding ? binding.index : 0;
  const state = queueStateFor(index);
  const hint = binding ? `e.g. ${escapeHtml(binding.namespace)}/queue` : 'e.g. namespace/queue';
  return `${renderPublishCandidateField({
    kind: 'queue',
    label: 'Queue',
    inputRole: 'ep-queue-input',
    value: publishQueue,
    placeholder: hint,
    candidates: state.queues,
  })}
  ${renderPublishMetadataHint(state, 'queue')}`;
}

function renderPublishCandidateField({ kind, label, inputRole, value, placeholder, candidates }) {
  const normalizedKind = kind === 'queue' ? 'queue' : 'topic';
  const inputId = `ep-${normalizedKind}-input`;
  const listId = `ep-${normalizedKind}-options`;
  const isOpen = publishCandidateDropdown === normalizedKind;
  const hasCandidates = candidates.length > 0;
  return `
    <div class="event-field">
      <label class="event-label" for="${inputId}">${escapeHtml(label)}</label>
      <div class="event-publish-combobox" data-role="ep-candidate-field" data-kind="${normalizedKind}">
        <input
          id="${inputId}"
          type="text"
          class="event-input event-publish-combobox-input"
          data-role="${inputRole}"
          value="${escapeHtml(value)}"
          placeholder="${placeholder}"
          autocomplete="off"
          aria-autocomplete="list"
          aria-controls="${listId}"
          aria-expanded="${isOpen}"
        />
        <button
          type="button"
          class="event-publish-candidate-toggle"
          data-action="ep-toggle-candidates"
          data-candidate-kind="${normalizedKind}"
          aria-label="Toggle ${escapeHtml(label)} candidates"
          aria-controls="${listId}"
          aria-expanded="${isOpen}"
          ${hasCandidates ? '' : 'disabled'}
        >⌄</button>
        ${isOpen ? renderPublishCandidateOptions(normalizedKind, listId, candidates, value) : ''}
      </div>
    </div>`;
}

function renderPublishCandidateOptions(kind, listId, candidates, value) {
  if (candidates.length === 0) return '';
  return `
    <div class="event-publish-options" id="${listId}" role="listbox" data-role="ep-candidate-options">
      ${candidates
        .map((candidate) => {
          const selected = candidate === value;
          return `
            <button
              type="button"
              class="event-publish-option${selected ? ' is-selected' : ''}"
              data-action="ep-select-candidate"
              data-candidate-kind="${kind}"
              data-value="${escapeHtml(candidate)}"
              role="option"
              aria-selected="${selected}"
            >${escapeHtml(candidate)}</button>`;
        })
        .join('')}
    </div>`;
}

function publishTopicCandidates(state) {
  const topics = [];
  if (state.wildcardTopic) topics.push(state.wildcardTopic);
  for (const topic of state.discoveredTopics) {
    if (!topics.includes(topic)) topics.push(topic);
  }
  return topics;
}

function renderPublishMetadataHint(state, label) {
  if (state.loading) {
    return `<p class="event-hint event-publish-hint">Discovering ${label} candidates for this binding…</p>`;
  }
  if (state.discoveryError) {
    return `<p class="event-hint event-hint-warn event-publish-hint">Could not discover ${label}s (${escapeHtml(state.discoveryError)}). You can still type one manually.</p>`;
  }
  const count = label === 'queue' ? state.queues.length : publishTopicCandidates(state).length;
  if (count === 0) {
    return `<p class="event-hint event-publish-hint">No ${label} candidates found. You can still type one manually.</p>`;
  }
  return `<p class="event-hint event-publish-hint">${escapeHtml(plural(count, label, `${label}s`))} available. Choose one or type a custom value.</p>`;
}

function publishDestinationValue() {
  return publishDestinationKind === 'queue' ? publishQueue.trim() : publishTopic.trim();
}

function publishCanSend() {
  return !publishSending && publishDestinationValue().length > 0;
}

function publishDestinationHint() {
  return publishDestinationKind === 'queue'
    ? 'Event is published directly to the selected queue via the REST Messaging API.'
    : 'Event is published directly to the topic via the REST Messaging API.';
}

function togglePublishCandidateDropdown(kind) {
  const normalizedKind = kind === 'queue' ? 'queue' : 'topic';
  publishCandidateDropdown = publishCandidateDropdown === normalizedKind ? null : normalizedKind;
  render();
}

function closePublishCandidateDropdown() {
  if (publishCandidateDropdown === null) return false;
  publishCandidateDropdown = null;
  return true;
}

function selectPublishCandidate(kind, value) {
  if (kind === 'queue') {
    publishQueue = value;
  } else {
    publishTopic = value;
  }
  publishResult = null;
  closePublishCandidateDropdown();
  render();
}

function renderPublishResult() {
  if (publishResult === null) return '';
  const kind = publishResult.destinationKind === 'queue' ? 'queue' : 'topic';
  const destination = publishResult.destination || publishResult.topic || '';
  if (publishResult.ok) {
    return `<div class="event-publish-result is-ok">✓ Published to ${kind} <code>${escapeHtml(destination)}</code> — HTTP ${publishResult.status ?? ''}</div>`;
  }
  return `<div class="event-publish-result is-error">✗ Failed: ${escapeHtml(publishResult.message || 'Unknown error')}</div>`;
}

function renderSelectedBindingsSection() {
  return `
    <div class="event-section-head">
      <h2>Selected Bindings</h2>
      <button type="button" class="event-btn event-btn-compact" data-action="em-open-add-binding">Add Binding</button>
    </div>
    ${renderBindingPicker()}
    ${renderSelectedBindingRows()}
    ${startError ? `<p class="event-inline-error" role="alert">${escapeHtml(startError)}</p>` : ''}
    ${renderSetupActions()}`;
}

function renderBindingPicker() {
  if (!addBindingOpen) return '';
  const matches = filterAvailableBindings();
  return `
    <section class="event-binding-picker" aria-label="Add Messaging Binding">
      <div class="event-picker-head">
        <span class="event-picker-label">Add Messaging Binding</span>
        <input
          type="search"
          name="event-binding-search"
          autocomplete="off"
          class="event-input event-picker-input"
          data-role="em-binding-search"
          value="${escapeHtml(bindingSearch)}"
          placeholder="Search name, instance, or namespace…"
        />
        <button type="button" class="event-btn event-btn-compact" data-action="em-close-add-binding">Close</button>
      </div>
      <div class="event-binding-results">
        ${matches.length === 0 ? '<p class="event-empty-small">No matching bindings.</p>' : matches.map(renderBindingOption).join('')}
      </div>
    </section>`;
}

function updateBindingPickerResults() {
  const resultsEl = document.querySelector('.event-binding-results');
  if (!resultsEl) return;
  const matches = filterAvailableBindings();
  resultsEl.innerHTML = matches.length === 0
    ? '<p class="event-empty-small">No matching bindings.</p>'
    : matches.map(renderBindingOption).join('');
}

function updatePublishSendButton() {
  const sendBtn = document.querySelector('[data-action="ep-send"]');
  if (!sendBtn) return;
  const hasBindings = bindings.length > 0;
  sendBtn.disabled = !hasBindings || !publishCanSend();
  sendBtn.innerHTML = publishSending ? `${btnSpinner()} Sending…` : 'Publish Event';
}

function filterAvailableBindings() {
  const query = bindingSearch.trim().toLowerCase();
  return bindings
    .filter((binding) => {
      if (selectedBindingIndexes.has(binding.index)) return false;
      if (query.length === 0) return true;
      const haystack = `${binding.name} ${binding.instanceName} ${binding.namespace}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderBindingOption(binding) {
  return `
    <button type="button" class="event-binding-option" data-action="em-add-binding" data-binding-index="${binding.index}">
      <span class="event-binding-name">${escapeHtml(binding.name)}</span>
      <span class="event-binding-namespace">${escapeHtml(binding.namespace)}</span>
    </button>`;
}

function renderSelectedBindingRows() {
  const rows = selectedBindings();
  if (rows.length === 0) {
    return `
      <div class="event-selected-empty">
        <p>No messaging bindings selected.</p>
        <span>Add only the bindings you want to inspect.</span>
      </div>`;
  }
  return `<div class="event-binding-list">${rows.map(renderSelectedBindingRow).join('')}</div>`;
}

function renderSelectedBindingRow(binding) {
  const state = topicStateFor(binding.index);
  const expanded = expandedBindingIndex === binding.index;
  const topicCount = state.liveTopics.size > 0 ? state.liveTopics.size : state.selectedTopics.size;
  const removable = state.status !== 'listening' && !streaming;
  return `
    <article class="event-binding-card${expanded ? ' is-expanded' : ''}${state.status === 'listening' ? ' is-live' : ''}">
      <div class="event-binding-row">
        <button type="button" class="event-binding-main" data-action="em-toggle-binding" data-binding-index="${binding.index}">
          <span class="event-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
          <span class="event-binding-name">${escapeHtml(binding.name)}</span>
          <span class="event-binding-namespace" title="${escapeHtml(binding.namespace)}">${escapeHtml(binding.namespace)}</span>
          <span class="event-binding-count">${escapeHtml(plural(topicCount, 'topic', 'topics'))}</span>
          <span class="event-status-pill ${statusClass(state.status)}">${statusLabel(state.status)}</span>
        </button>
        ${removable ? `<button type="button" class="event-icon-btn" data-action="em-remove-binding" data-binding-index="${binding.index}" aria-label="Remove ${escapeHtml(binding.name)}">×</button>` : ''}
      </div>
      ${state.statusMessage ? `<p class="event-binding-message">${escapeHtml(state.statusMessage)}</p>` : ''}
      ${expanded ? renderTopicPanel(binding, state) : ''}
    </article>`;
}

function statusClass(status) {
  if (status === 'listening') return 'is-live';
  if (status === 'starting' || status === 'adding') return 'is-working';
  if (status === 'error') return 'is-error';
  return 'is-stopped';
}

function statusLabel(status) {
  if (status === 'listening') return 'Listening';
  if (status === 'starting') return 'Starting';
  if (status === 'adding') return 'Adding';
  if (status === 'error') return 'Error';
  return 'Ready';
}

function renderTopicPanel(binding, state) {
  if (state.loading) {
    return `<div class="event-topic-panel">${spinner()}<span>Discovering topics from existing queues…</span></div>`;
  }
  return `
    <div class="event-topic-panel" data-binding-index="${binding.index}">
      ${renderTopicChooser(binding, state)}
      ${renderBindingTopicAction(binding, state)}
    </div>`;
}

function renderTopicChooser(binding, state) {
  const rows = topicRows(binding, state);
  const note = state.discoveryError
    ? `<p class="event-hint event-hint-warn">Could not auto-discover topics (${escapeHtml(state.discoveryError)}). Use the wildcard or add a topic manually.</p>`
    : state.discoveredTopics.length === 0
      ? '<p class="event-hint">No subscriptions found on existing queues. Use the wildcard or add a topic manually.</p>'
      : '';
  return `
    <div class="event-topics">${rows.join('') || '<p class="event-hint">No topics available.</p>'}</div>
    ${note}
    <div class="event-custom-topic">
      <input
        type="text"
        name="event-custom-topic-${binding.index}"
        autocomplete="off"
        class="event-input"
        data-role="em-custom-topic-input"
        data-binding-index="${binding.index}"
        placeholder="Add a topic, e.g. ${escapeHtml(state.wildcardTopic || 'namespace/topic')}…"
      />
      <button type="button" class="event-btn" data-action="em-add-custom-topic" data-binding-index="${binding.index}">Add</button>
    </div>`;
}

function topicRows(binding, state) {
  const rows = [];
  if (state.wildcardTopic) rows.push(topicRow(binding.index, state, state.wildcardTopic, 'wildcard'));
  for (const topic of state.discoveredTopics) {
    if (topic !== state.wildcardTopic) rows.push(topicRow(binding.index, state, topic, 'discovered'));
  }
  for (const topic of state.customTopics) {
    if (topic !== state.wildcardTopic && !state.discoveredTopics.includes(topic)) {
      rows.push(topicRow(binding.index, state, topic, 'custom'));
    }
  }
  return rows;
}

function topicRow(bindingIndex, state, topic, kind) {
  const checked = state.selectedTopics.has(topic) || state.liveTopics.has(topic);
  const live = state.liveTopics.has(topic);
  return `
    <label class="event-topic-row${live ? ' is-live' : ''}">
      <input
        type="checkbox"
        data-role="em-topic-checkbox"
        data-binding-index="${bindingIndex}"
        data-topic="${escapeHtml(topic)}"
        ${checked ? 'checked' : ''}
        ${live ? 'disabled' : ''}
      />
      <span class="event-topic-label">${escapeHtml(kind === 'wildcard' ? `All events under namespace - ${topic}` : topic)}</span>
      ${live ? '<span class="event-tag event-tag-live">Live</span>' : ''}
      ${kind === 'wildcard' ? '<span class="event-tag">Wildcard</span>' : ''}
      ${kind === 'custom' ? '<span class="event-tag">Custom</span>' : ''}
    </label>`;
}

function renderBindingTopicAction(binding, state) {
  if (state.status === 'starting') {
    return `<button type="button" class="event-btn event-btn-primary" disabled>${btnSpinner()} Starting…</button>`;
  }
  if (state.status === 'adding') {
    return `<button type="button" class="event-btn event-btn-primary" disabled>${btnSpinner()} Adding…</button>`;
  }
  if (state.status === 'listening') {
    const count = pendingTopics(state).length;
    return `<button type="button" class="event-btn event-btn-primary" data-action="em-add-topics" data-binding-index="${binding.index}" ${count === 0 ? 'disabled' : ''}>Listen To ${count} New ${count === 1 ? 'Topic' : 'Topics'}</button>`;
  }
  if (streaming) {
    return `<button type="button" class="event-btn event-btn-primary" data-action="em-start-binding" data-binding-index="${binding.index}" ${state.selectedTopics.size === 0 ? 'disabled' : ''}>Start This Binding</button>`;
  }
  return '';
}

function pendingTopics(state) {
  return [...state.selectedTopics].filter((topic) => !state.liveTopics.has(topic));
}

function renderSetupActions() {
  if (selectedBindingIndexes.size === 0) return '';
  if (streaming) {
    if (stoppingAll) {
      return `
        <div class="event-config-actions">
          <button type="button" class="event-btn" disabled>${btnSpinner()} Stopping…</button>
        </div>`;
    }
    return `
      <div class="event-config-actions">
        <button type="button" class="event-btn" data-action="em-stop">Stop All</button>
        <span class="event-hint">Expand a binding to add more topics while listening.</span>
      </div>`;
  }
  const anyStarting = selectedBindings().some((b) => topicStateFor(b.index).status === 'starting');
  if (anyStarting) {
    return `
      <div class="event-config-actions">
        <button type="button" class="event-btn event-btn-primary" disabled>${btnSpinner()} Starting…</button>
        <span class="event-hint">Creating queues and subscribing to topics…</span>
      </div>`;
  }
  const requests = collectStartRequests();
  const disabled = requests.length === 0 || requests.length !== selectedBindingIndexes.size;
  return `
    <div class="event-config-actions">
      <button type="button" class="event-btn event-btn-primary" data-action="em-start" ${disabled ? 'disabled' : ''}>Start Listening To ${requests.length} ${requests.length === 1 ? 'Binding' : 'Bindings'}</button>
      <span class="event-hint">A temporary debug queue is created per binding and deleted automatically.</span>
    </div>`;
}

function collectStartRequests() {
  return selectedBindings()
    .map((binding) => ({ bindingIndex: binding.index, topics: [...topicStateFor(binding.index).selectedTopics] }))
    .filter((entry) => entry.topics.length > 0);
}

function collectSimpleStartRequests() {
  return selectedBindings()
    .filter((binding) => !isSimpleBindingLocked(binding))
    .map((binding) => ({ bindingIndex: binding.index, topics: [simpleWildcardFor(binding)] }));
}

function renderResults() {
  const stateClass = streaming ? 'is-live' : 'is-stopped';
  const stateLabel = streaming ? 'Listening' : 'Stopped';
  const liveBindings = listeningBindings();
  normalizeBindingFilterIndex(liveBindings);
  const banner = !streaming && stoppedReason
    ? `<div class="event-banner">${escapeHtml(REASON_TEXT[stoppedReason] || 'Listening stopped.')}</div>`
    : '';
  return `
    <div class="event-results-head">
      <span class="event-status-pill ${stateClass}">${stateLabel}</span>
      ${renderMessageSearchInput()}
      <span class="event-toolbar-spacer"></span>
      ${renderBindingFilterSelect(liveBindings)}
      <button type="button" class="event-btn event-btn-compact" data-action="em-pause" ${streaming ? '' : 'disabled'}>${paused ? 'Resume' : 'Pause'}</button>
      <button type="button" class="event-btn event-btn-compact" data-action="em-clear">Clear</button>
    </div>
    ${banner}
    ${statusLine ? `<div class="event-statusline">${escapeHtml(statusLine)}</div>` : ''}
    <div class="event-list" id="event-list"></div>`;
}

function renderMessageSearchInput() {
  return `
    <label class="event-result-search search-input-with-icon">
      <span class="search-input-icon" aria-hidden="true">&#128269;</span>
      <input
        type="search"
        class="event-result-search-input"
        data-role="em-message-search"
        value="${escapeHtml(messageSearch)}"
        placeholder="Search messages"
        aria-label="Search received messages"
        autocomplete="off"
      />
    </label>`;
}

function listeningBindings() {
  return selectedBindings().filter((binding) => topicStateFor(binding.index).status === 'listening');
}

function normalizeBindingFilterIndex(liveBindings) {
  if (bindingFilterIndex === null) return;
  if (!liveBindings.some((binding) => binding.index === bindingFilterIndex)) {
    bindingFilterIndex = null;
  }
}

function renderBindingFilterSelect(liveBindings) {
  if (liveBindings.length === 0) return '';
  const options = liveBindings
    .map((binding) => `<option value="${binding.index}" ${bindingFilterIndex === binding.index ? 'selected' : ''}>${escapeHtml(binding.name)}</option>`)
    .join('');
  return `
    <label class="event-result-filter">
      <select class="event-input event-select event-filter-select" data-role="em-binding-filter-select" aria-label="Filter messages by binding">
        <option value="" ${bindingFilterIndex === null ? 'selected' : ''}>All bindings</option>
        ${options}
      </select>
    </label>`;
}

function scheduleMessageRender() {
  if (paused) {
    return;
  }
  if (messageRenderScheduled) return;
  messageRenderScheduled = true;
  const raf =
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
  raf(() => {
    messageRenderScheduled = false;
    renderMessages();
  });
}

function renderMessages() {
  const list = document.getElementById('event-list');
  if (!list) return;
  const visibleMessages = filteredMessages();

  if (visibleMessages.length === 0) {
    list.innerHTML = streaming
      ? '<p class="event-empty">Waiting for messages…</p>'
      : '<p class="event-empty">No messages received.</p>';
    return;
  }

  const visible = visibleMessages.slice(-MAX_DOM_ROWS).reverse();
  list.innerHTML = visible.map(renderMessageRow).join('');
}

function filteredMessages() {
  const query = messageSearch.trim().toLowerCase();
  return messages.filter((message) => {
    if (bindingFilterIndex !== null && message.bindingIndex !== bindingFilterIndex) return false;
    if (query.length === 0) return true;
    return messageMatchesSearch(message, query);
  });
}

function renderMessageRow(message) {
  const expanded = expandedSeqs.has(message.seq);
  const topic = message.topic || '(no topic)';
  const meta = [shortTime(message.time), message.encoding, formatBytes(message.size)]
    .filter(Boolean)
    .join(' - ');
  const body = expanded
    ? `${renderPayloadBody(message)}
       ${message.messageId ? `<div class="event-msgid">message-id: ${escapeHtml(message.messageId)}</div>` : ''}`
    : `<div class="event-preview">${escapeHtml(oneLinePreview(message.payload))}</div>`;
  return `
    <div class="event-item${expanded ? ' is-expanded' : ''}">
      <button type="button" class="event-item-head" data-action="em-toggle-expand" data-seq="${message.seq}">
        <span class="event-item-seq">#${message.seq}</span>
        <span class="event-binding-badge">${escapeHtml(messageBindingName(message))}</span>
        <span class="event-item-topic" title="${escapeHtml(topic)}">${escapeHtml(topic)}</span>
        <span class="event-item-meta">${escapeHtml(meta)}</span>
      </button>
      ${body}
    </div>`;
}

function messageBindingName(message) {
  if (typeof message.bindingName === 'string' && message.bindingName.length > 0) {
    return message.bindingName;
  }
  const binding = typeof message.bindingIndex === 'number' ? findBinding(message.bindingIndex) : null;
  return binding ? binding.name : 'Binding';
}

// --- Host -> webview messages ------------------------------------------------

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;

  if (data.type === 'sapTools.events.ready') {
    handleReady(data);
  } else if (data.type === 'sapTools.events.topics') {
    handleTopics(data);
  } else if (data.type === 'sapTools.events.queues') {
    handleQueues(data);
  } else if (data.type === 'sapTools.events.listening') {
    handleListening(data);
  } else if (data.type === 'sapTools.events.bindingListening') {
    handleBindingListening(data);
  } else if (data.type === 'sapTools.events.topicsAdded') {
    handleTopicsAdded(data);
  } else if (data.type === 'sapTools.events.messages') {
    handleMessages(data);
  } else if (data.type === 'sapTools.events.status') {
    handleStatus(data);
  } else if (data.type === 'sapTools.events.stopped') {
    handleStopped(data);
  } else if (data.type === 'sapTools.events.error') {
    handleError(data);
  } else if (data.type === 'sapTools.events.publishResult') {
    handlePublishResult(data);
  }
});

function handleReady(data) {
  bindings = Array.isArray(data.bindings) ? data.bindings : [];
  selectedBindingIndexes.clear();
  topicsByBinding.clear();
  queuesByBinding.clear();
  activeBindingIndex = null;
  expandedBindingIndex = null;
  simpleExpandedGroupKeys.clear();
  simpleGroupExpansionTimestamps.clear();
  addBindingOpen = bindings.length > 1;
  bindingSearch = '';
  messageSearch = '';
  eventSettingsOpen = false;
  startError = '';
  publishBindingIndex = null;
  publishDestinationKind = 'topic';
  publishTopic = '';
  publishQueue = '';
  publishResult = null;
  publishSending = false;
  publishCandidateDropdown = null;
  stoppingAll = false;
  activeTab = 'subscribe-simple';
  phase = 'ready';
  if (bindings.length === 1) addSelectedBinding(bindings[0].index);
  render();
}

function handlePublishResult(data) {
  publishSending = false;
  publishResult = {
    ok: data.ok === true,
    status: typeof data.status === 'number' ? data.status : undefined,
    destinationKind: data.destinationKind === 'queue' ? 'queue' : 'topic',
    destination: typeof data.destination === 'string' ? data.destination : '',
    topic: typeof data.topic === 'string' ? data.topic : '',
    message: typeof data.message === 'string' ? data.message : '',
  };
  if (phase === 'ready') render();
}

function handleTopics(data) {
  const index = bindingId(data.bindingIndex);
  const state = topicStateFor(index);
  state.discoveredTopics = Array.isArray(data.topics) ? data.topics : [];
  state.wildcardTopic = data.wildcardTopic || '';
  state.discoveryError = data.discoveryError || '';
  state.loading = false;
  if (state.selectedTopics.size === 0 && state.liveTopics.size === 0 && state.wildcardTopic) {
    state.selectedTopics.add(state.wildcardTopic);
  }
  if (phase === 'ready') render();
}

function handleQueues(data) {
  const index = bindingId(data.bindingIndex);
  const state = queueStateFor(index);
  state.queues = Array.isArray(data.queues) ? data.queues : [];
  state.discoveryError = data.discoveryError || '';
  state.loading = false;
  if (phase === 'ready') render();
}

function handleListening(data) {
  streaming = true;
  paused = false;
  stoppedReason = '';
  statusLine = '';
  expandedBindingIndex = null;
  const summaries = Array.isArray(data.bindings) ? data.bindings : [data];
  for (const summary of summaries) applyListeningSummary(summary);
  render();
}

function handleBindingListening(data) {
  streaming = true;
  expandedBindingIndex = null;
  applyListeningSummary(data);
  render();
}

function applyListeningSummary(summary) {
  const index = bindingId(summary.bindingIndex);
  selectedBindingIndexes.add(index);
  const binding = findBinding(index);
  if (binding !== null && activeBindingIndex === null) activeBindingIndex = index;
  const state = topicStateFor(index);
  const topics = Array.isArray(summary.topics) ? summary.topics : [];
  state.queueName = summary.queueName || state.queueName;
  state.status = 'listening';
  state.statusMessage = '';
  state.liveTopics = new Set(topics);
  for (const topic of topics) state.selectedTopics.add(topic);
}

function handleTopicsAdded(data) {
  const index = bindingId(data.bindingIndex);
  const state = topicStateFor(index);
  const topics = Array.isArray(data.topics) ? data.topics : [];
  for (const topic of topics) {
    state.liveTopics.add(topic);
    state.selectedTopics.add(topic);
  }
  state.status = 'listening';
  state.statusMessage = topics.length > 0 ? `${topics.length} topic${topics.length === 1 ? '' : 's'} added.` : '';
  render();
}

function handleMessages(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  if (events.length === 0) return;
  totalReceived += events.length;
  messages = messages.concat(events);
  trimStoredMessages();
  scheduleMessageRender();
}

function handleStatus(data) {
  const index = typeof data.bindingIndex === 'number' ? data.bindingIndex : null;
  if (index === null) {
    statusLine = data.message || '';
  } else {
    topicStateFor(index).statusMessage = data.message || '';
  }
  if (phase === 'ready') render();
}

function handleStopped(data) {
  streaming = false;
  paused = false;
  stoppingAll = false;
  stoppedReason = data.reason || 'user';
  for (const binding of selectedBindings()) {
    const state = topicStateFor(binding.index);
    state.status = 'ready';
    state.queueName = '';
    state.liveTopics.clear();
  }
  if (phase === 'ready') render();
}

function handleError(data) {
  const index = typeof data.bindingIndex === 'number' ? data.bindingIndex : null;
  if (data.scope === 'start' || data.scope === 'topics') {
    if (index === null) {
      startError = data.message || 'Failed to start listening.';
    } else {
      const state = topicStateFor(index);
      state.status = 'error';
      state.statusMessage = data.message || 'Binding action failed.';
    }
    if (phase === 'ready') render();
    return;
  }
  errorMessage = data.message || 'Unknown error.';
  phase = 'error';
  render();
}

// --- Webview -> host intents (delegated) -------------------------------------

function postStartSimple() {
  const requests = collectSimpleStartRequests();
  if (!vscodeApi || requests.length === 0) return;
  startError = '';
  for (const request of requests) {
    const state = topicStateFor(request.bindingIndex);
    state.status = 'starting';
    state.selectedTopics = new Set(request.topics);
  }
  render();
  if (streaming) {
    for (const request of requests) {
      vscodeApi.postMessage({
        type: 'sapTools.events.startBinding',
        bindingIndex: request.bindingIndex,
        topics: request.topics,
      });
    }
    return;
  }
  vscodeApi.postMessage({ type: 'sapTools.events.startListening', bindings: requests });
}

function findSimpleGroup(groupKey) {
  return buildSimpleBindingTree().find((group) => group.key === groupKey) || null;
}

function toggleSimpleBinding(index) {
  const binding = findBinding(index);
  if (binding === null || isSimpleBindingLocked(binding)) return;
  if (selectedBindingIndexes.has(index)) {
    removeSelectedBinding(index);
  } else {
    selectSimpleBinding(index);
  }
  startError = '';
  render();
}

function toggleSimpleGroup(groupKey) {
  const group = findSimpleGroup(groupKey);
  if (group === null) return;
  const selectableBindings = simpleSelectableBindings(group);
  if (selectableBindings.length === 0) return;
  const allSelected = selectableBindings.every((binding) => selectedBindingIndexes.has(binding.index));
  for (const binding of selectableBindings) {
    if (allSelected) removeSelectedBinding(binding.index);
    else selectSimpleBinding(binding.index);
  }
  startError = '';
  render();
}

function canToggleSimpleGroupExpansion(groupKey) {
  const now = Date.now();
  const previous = simpleGroupExpansionTimestamps.get(groupKey) || 0;
  if (now - previous < SIMPLE_GROUP_EXPAND_COOLDOWN_MS) return false;
  simpleGroupExpansionTimestamps.set(groupKey, now);
  return true;
}

function toggleSimpleGroupExpansion(groupKey) {
  const group = findSimpleGroup(groupKey);
  if (group === null || !canToggleSimpleGroupExpansion(groupKey)) return;
  if (simpleExpandedGroupKeys.has(groupKey)) {
    simpleExpandedGroupKeys.delete(groupKey);
  } else {
    simpleExpandedGroupKeys.add(groupKey);
  }
  render();
}

function postStartAll() {
  const requests = collectStartRequests();
  if (!vscodeApi || requests.length === 0 || requests.length !== selectedBindingIndexes.size) return;
  startError = '';
  for (const request of requests) topicStateFor(request.bindingIndex).status = 'starting';
  expandedBindingIndex = null;
  render();
  vscodeApi.postMessage({ type: 'sapTools.events.startListening', bindings: requests });
}

function postStartBinding(index) {
  const state = topicStateFor(index);
  if (!vscodeApi || state.selectedTopics.size === 0) return;
  state.status = 'starting';
  expandedBindingIndex = null;
  render();
  vscodeApi.postMessage({
    type: 'sapTools.events.startBinding',
    bindingIndex: index,
    topics: [...state.selectedTopics],
  });
}

function postAddTopics(index) {
  const state = topicStateFor(index);
  const topics = pendingTopics(state);
  if (!vscodeApi || topics.length === 0) return;
  state.status = 'adding';
  render();
  vscodeApi.postMessage({ type: 'sapTools.events.addTopics', bindingIndex: index, topics });
}

function addCustomTopic(index) {
  const input = document.querySelector(`[data-role="em-custom-topic-input"][data-binding-index="${index}"]`);
  const value = input && input.value ? input.value.trim() : '';
  if (!value) return;
  const state = topicStateFor(index);
  if (!state.customTopics.includes(value) && !state.discoveredTopics.includes(value) && value !== state.wildcardTopic) {
    state.customTopics.push(value);
  }
  state.selectedTopics.add(value);
  if (input) input.value = '';
  render();
}

function postPublishEvent() {
  const idx = selectedPublishBindingIndex() ?? -1;
  const destination = publishDestinationValue();
  if (!vscodeApi || !destination || publishSending) return;
  publishSending = true;
  publishResult = null;
  render();
  const message = {
    type: 'sapTools.events.publishEvent',
    bindingIndex: idx,
    destinationKind: publishDestinationKind,
    destination,
    payload: publishPayload,
    contentType: publishContentType,
  };
  if (publishDestinationKind === 'topic') message.topic = destination;
  else message.queueName = destination;
  vscodeApi.postMessage(message);
}

function formatPublishPayload() {
  try {
    publishPayload = JSON.stringify(JSON.parse(publishPayload), null, 2);
  } catch {
    return;
  }
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const clickedSettings =
    target &&
    target.closest &&
    (target.closest('[data-role="event-settings-panel"]') ||
      target.closest('[data-role="event-settings-toggle"]'));
  const clickedPublishCandidate =
    target &&
    target.closest &&
    target.closest('[data-role="ep-candidate-field"]');
  const actionEl = target && target.closest ? target.closest('[data-action]') : null;
  if (!actionEl) {
    let shouldRender = false;
    if (eventSettingsOpen && !clickedSettings) {
      eventSettingsOpen = false;
      shouldRender = true;
    }
    if (publishCandidateDropdown !== null && !clickedPublishCandidate) {
      closePublishCandidateDropdown();
      shouldRender = true;
    }
    if (shouldRender) render();
    return;
  }
  const action = actionEl.dataset.action;
  const index = bindingId(actionEl.dataset.bindingIndex);
  if (eventSettingsOpen && !clickedSettings && action !== 'em-toggle-settings') {
    eventSettingsOpen = false;
  }
  if (
    publishCandidateDropdown !== null &&
    !clickedPublishCandidate &&
    action !== 'ep-toggle-candidates' &&
    action !== 'ep-select-candidate'
  ) {
    closePublishCandidateDropdown();
  }

  if (action === 'em-switch-tab') {
    activeTab = actionEl.dataset.tab || 'subscribe-simple';
    closePublishCandidateDropdown();
    if (activeTab === 'publish') requestPublishMetadata();
    render();
  } else if (action === 'em-toggle-settings') {
    eventSettingsOpen = !eventSettingsOpen;
    render();
  } else if (action === 'ep-toggle-candidates') {
    togglePublishCandidateDropdown(actionEl.dataset.candidateKind || publishDestinationKind);
  } else if (action === 'ep-select-candidate') {
    selectPublishCandidate(actionEl.dataset.candidateKind || publishDestinationKind, actionEl.dataset.value || '');
  } else if (action === 'ep-send') {
    postPublishEvent();
  } else if (action === 'ep-format-json') {
    formatPublishPayload();
  } else if (action === 'em-retry') {
    phase = 'loading';
    render();
    if (vscodeApi) vscodeApi.postMessage({ type: 'sapTools.events.webviewReady' });
  } else if (action === 'em-open-add-binding') {
    addBindingOpen = true;
    render();
  } else if (action === 'em-close-add-binding') {
    addBindingOpen = false;
    render();
  } else if (action === 'em-add-binding') {
    addSelectedBinding(index);
    render();
  } else if (action === 'em-remove-binding') {
    removeSelectedBinding(index);
    render();
  } else if (action === 'em-toggle-binding') {
    expandedBindingIndex = expandedBindingIndex === index ? null : index;
    activeBindingIndex = index;
    requestTopics(index);
    render();
  } else if (action === 'em-add-custom-topic') {
    addCustomTopic(index);
  } else if (action === 'em-expand-simple-group') {
    toggleSimpleGroupExpansion(actionEl.dataset.groupKey || '');
  } else if (action === 'em-toggle-simple-group') {
    toggleSimpleGroup(actionEl.dataset.groupKey || '');
  } else if (action === 'em-toggle-simple-binding') {
    toggleSimpleBinding(index);
  } else if (action === 'em-start-simple') {
    postStartSimple();
  } else if (action === 'em-start') {
    postStartAll();
  } else if (action === 'em-start-binding') {
    postStartBinding(index);
  } else if (action === 'em-add-topics') {
    postAddTopics(index);
  } else if (action === 'em-stop') {
    stoppingAll = true;
    render();
    if (vscodeApi) vscodeApi.postMessage({ type: 'sapTools.events.stopListening' });
  } else if (action === 'em-pause') {
    paused = !paused;
    render();
    if (!paused) renderMessages();
  } else if (action === 'em-clear') {
    messages = [];
    totalReceived = 0;
    expandedSeqs.clear();
    renderMessages();
  } else if (action === 'em-toggle-expand') {
    const seq = Number(actionEl.dataset.seq);
    if (expandedSeqs.has(seq)) expandedSeqs.delete(seq);
    else expandedSeqs.add(seq);
    renderMessages();
  }
});

document.addEventListener('input', (event) => {
  const el = event.target;
  if (!el || !el.matches) return;
  if (el.matches('[data-role="em-binding-search"]')) {
    bindingSearch = el.value || '';
    updateBindingPickerResults();
  } else if (el.matches('[data-role="em-message-search"]')) {
    messageSearch = el.value || '';
    renderMessages();
  } else if (el.matches('[data-role="em-message-buffer-limit"]')) {
    scheduleMessageBufferLimitApply(el.value);
  } else if (el.matches('[data-role="ep-topic-input"]')) {
    publishTopic = el.value || '';
    updatePublishSendButton();
  } else if (el.matches('[data-role="ep-queue-input"]')) {
    publishQueue = el.value || '';
    updatePublishSendButton();
  } else if (el.matches('[data-role="ep-payload-input"]')) {
    publishPayload = el.value || '';
  }
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (!el || !el.matches) return;
  if (el.matches('[data-role="ep-binding-select"]')) {
    publishBindingIndex = bindingId(el.value);
    publishResult = null;
    closePublishCandidateDropdown();
    requestPublishMetadata(publishBindingIndex);
    render();
  } else if (el.matches('[data-role="ep-destination-kind"]')) {
    publishDestinationKind = el.value === 'queue' ? 'queue' : 'topic';
    publishResult = null;
    closePublishCandidateDropdown();
    requestPublishMetadata();
    render();
  } else if (el.matches('[data-role="ep-content-type-select"]')) {
    publishContentType = el.value || 'application/json';
  } else if (el.matches('[data-role="em-binding-filter-select"]')) {
    bindingFilterIndex = el.value === '' ? null : bindingId(el.value);
    renderMessages();
  } else if (el.matches('[data-role="em-message-buffer-limit"]')) {
    applyMessageBufferLimit(el.value);
  } else if (el.matches('[data-role="em-topic-checkbox"]')) {
    const index = bindingId(el.dataset.bindingIndex);
    const topic = el.dataset.topic;
    if (!topic) return;
    const state = topicStateFor(index);
    if (el.checked) state.selectedTopics.add(topic);
    else state.selectedTopics.delete(topic);
    render();
  }
});

document.addEventListener('keydown', (event) => {
  const el = event.target;
  if (event.key === 'Escape' && publishCandidateDropdown !== null) {
    event.preventDefault();
    closePublishCandidateDropdown();
    render();
    return;
  }
  if (el && el.matches && el.matches('[data-role="em-custom-topic-input"]') && event.key === 'Enter') {
    event.preventDefault();
    addCustomTopic(bindingId(el.dataset.bindingIndex));
  }
});

render();
if (vscodeApi) {
  vscodeApi.postMessage({ type: 'sapTools.events.webviewReady' });
}
