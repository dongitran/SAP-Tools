// Event Mesh viewer webview. Runs in an editor WebviewPanel created by
// src/eventMeshPanel.ts. The extension host owns the AMQP connection; this script
// only renders state and posts user intents back. CSP forbids inline handlers, so
// all interaction goes through delegated listeners (see the bottom of this file).

const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const appId = (typeof window !== 'undefined' && window.eventMeshAppId) || 'demo-app';

const MAX_MESSAGES = 1000; // ring-buffer cap held in memory
const MAX_DOM_ROWS = 300; // rows actually painted (newest first)
const MAX_BINDING_RESULTS = 12;

let phase = 'loading'; // loading | ready | error
let errorMessage = '';
let startError = '';
let statusLine = '';

let activeTab = 'subscribe'; // 'subscribe' | 'publish'

let bindings = [];
const selectedBindingIndexes = new Set();
const topicsByBinding = new Map();
let activeBindingIndex = null;
let expandedBindingIndex = null;
let addBindingOpen = false;
let bindingSearch = '';
let streaming = false;
let stoppedReason = '';
let paused = false;
let bindingFilterIndex = null;

let publishBindingIndex = null;
let publishTopic = '';
let publishContentType = 'application/json';
let publishPayload = '';
let publishResult = null; // { ok, status, topic, message }
let publishSending = false;

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

function bindingLabel(binding) {
  return binding ? `${binding.name} - ${binding.namespace}` : '';
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

function sortedSelectedBindingIndexes() {
  return [...selectedBindingIndexes].sort((left, right) => left - right);
}

function selectedBindings() {
  return sortedSelectedBindingIndexes()
    .map(findBinding)
    .filter((binding) => binding !== null);
}

function requestTopics(index) {
  const state = topicStateFor(index);
  if (state.loading && vscodeApi) {
    vscodeApi.postMessage({ type: 'sapTools.events.selectBinding', bindingIndex: index });
  }
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

function liveBindingCount() {
  return selectedBindings().filter((binding) => topicStateFor(binding.index).status === 'listening').length;
}

function liveTopicCount() {
  return selectedBindings().reduce((total, binding) => {
    return total + topicStateFor(binding.index).liveTopics.size;
  }, 0);
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
  root.innerHTML = renderReady();
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

function spinner() {
  return '<span class="event-spinner" aria-hidden="true"></span>';
}

function renderHeader() {
  const selectedCount = selectedBindingIndexes.size;
  const meta = selectedCount === 0
    ? `${bindings.length} available bindings`
    : `${plural(selectedCount, 'selected binding', 'selected bindings')}`;
  return `
    <header class="event-header">
      <div class="event-header-main">
        <span class="event-title">Event Mesh</span>
        <span class="event-app">${escapeHtml(appId)}</span>
      </div>
      <div class="event-header-end">
        <div class="event-tabs" role="tablist">
          <button type="button" class="event-tab${activeTab === 'subscribe' ? ' is-active' : ''}" role="tab" data-action="em-switch-tab" data-tab="subscribe" aria-selected="${activeTab === 'subscribe'}">Subscribe</button>
          <button type="button" class="event-tab${activeTab === 'publish' ? ' is-active' : ''}" role="tab" data-action="em-switch-tab" data-tab="publish" aria-selected="${activeTab === 'publish'}">Publish</button>
        </div>
        <div class="event-header-meta">${escapeHtml(meta)}</div>
      </div>
    </header>`;
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
  const selectedIdx = publishBindingIndex !== null ? publishBindingIndex : (bindings[0] !== undefined ? bindings[0].index : 0);
  const selectedBinding = findBinding(selectedIdx);
  const hint = selectedBinding ? `e.g. ${escapeHtml(selectedBinding.namespace)}/items/created` : 'e.g. namespace/entity/event';
  return `
    <div class="event-section-head">
      <h2>Publish Event</h2>
    </div>
    <div class="event-publish-form">
      <label class="event-field">
        <span class="event-label">Messaging Binding</span>
        <select class="event-input event-select" data-role="ep-binding-select">
          ${hasBindings ? bindings.map((b) => `<option value="${b.index}"${b.index === selectedIdx ? ' selected' : ''}>${escapeHtml(b.name)} — ${escapeHtml(b.namespace)}</option>`).join('') : '<option value="">No bindings available</option>'}
        </select>
      </label>
      <label class="event-field">
        <span class="event-label">Topic</span>
        <input type="text" class="event-input" data-role="ep-topic-input" value="${escapeHtml(publishTopic)}" placeholder="${hint}" autocomplete="off" />
      </label>
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
        <button type="button" class="event-btn event-btn-primary" data-action="ep-send" ${publishSending || !hasBindings || publishTopic.trim().length === 0 ? 'disabled' : ''}>${publishSending ? 'Sending…' : 'Publish Event'}</button>
        <span class="event-hint">Event is published directly to the topic via the REST Messaging API.</span>
      </div>
    </div>`;
}

function renderPublishResult() {
  if (publishResult === null) return '';
  if (publishResult.ok) {
    return `<div class="event-publish-result is-ok">✓ Published to <code>${escapeHtml(publishResult.topic)}</code> — HTTP ${publishResult.status ?? ''}</div>`;
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
  const rendered = matches.slice(0, MAX_BINDING_RESULTS);
  const hasOverflow = matches.length > rendered.length;
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
        ${rendered.length === 0 ? '<p class="event-empty-small">No matching bindings.</p>' : rendered.map(renderBindingOption).join('')}
      </div>
      <p class="event-hint event-picker-overflow"${hasOverflow ? '' : ' style="display:none"'}>${hasOverflow ? `${matches.length - rendered.length} more bindings match. Refine the search.` : ''}</p>
    </section>`;
}

function updateBindingPickerResults() {
  const resultsEl = document.querySelector('.event-binding-results');
  if (!resultsEl) return;
  const matches = filterAvailableBindings();
  const rendered = matches.slice(0, MAX_BINDING_RESULTS);
  resultsEl.innerHTML = rendered.length === 0
    ? '<p class="event-empty-small">No matching bindings.</p>'
    : rendered.map(renderBindingOption).join('');
  const overflowEl = document.querySelector('.event-picker-overflow');
  if (overflowEl) {
    const hasOverflow = matches.length > rendered.length;
    overflowEl.style.display = hasOverflow ? '' : 'none';
    overflowEl.textContent = hasOverflow ? `${matches.length - rendered.length} more bindings match. Refine the search.` : '';
  }
}

function filterAvailableBindings() {
  const query = bindingSearch.trim().toLowerCase();
  return bindings.filter((binding) => {
    if (selectedBindingIndexes.has(binding.index)) return false;
    if (query.length === 0) return true;
    const haystack = `${binding.name} ${binding.instanceName} ${binding.namespace}`.toLowerCase();
    return haystack.includes(query);
  });
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
      <div class="event-topic-panel-head">
        <span>Topics For ${escapeHtml(binding.name)}</span>
        ${state.queueName ? `<code title="${escapeHtml(state.queueName)}">${escapeHtml(state.queueName)}</code>` : ''}
      </div>
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
    return `
      <div class="event-config-actions">
        <button type="button" class="event-btn" data-action="em-stop">Stop All</button>
        <span class="event-hint">Topic lists are collapsed while results stream. Expand a binding to add topics.</span>
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

function renderResults() {
  const stateClass = streaming ? 'is-live' : 'is-stopped';
  const stateLabel = streaming ? 'Listening' : 'Stopped';
  const banner = !streaming && stoppedReason
    ? `<div class="event-banner">${escapeHtml(REASON_TEXT[stoppedReason] || 'Listening stopped.')}</div>`
    : '';
  return `
    <div class="event-results-head">
      <span class="event-status-pill ${stateClass}">${stateLabel}</span>
      <span class="event-result-summary">${escapeHtml(resultSummary())}</span>
      <span class="event-toolbar-spacer"></span>
      <button type="button" class="event-btn event-btn-compact" data-action="em-pause" ${streaming ? '' : 'disabled'}>${paused ? 'Resume' : 'Pause'}</button>
      <button type="button" class="event-btn event-btn-compact" data-action="em-clear">Clear</button>
    </div>
    ${renderBindingFilters()}
    ${banner}
    ${statusLine ? `<div class="event-statusline">${escapeHtml(statusLine)}</div>` : ''}
    <div class="event-list" id="event-list"></div>`;
}

function resultSummary() {
  return `${plural(liveBindingCount(), 'binding', 'bindings')} - ${plural(liveTopicCount(), 'topic', 'topics')} - ${totalReceived} received`;
}

function renderBindingFilters() {
  const live = selectedBindings().filter((binding) => topicStateFor(binding.index).status === 'listening');
  if (live.length === 0) return '';
  return `
    <div class="event-filter-row" role="group" aria-label="Filter events by binding">
      <button type="button" class="event-filter${bindingFilterIndex === null ? ' is-active' : ''}" data-action="em-filter-binding" data-binding-index="">All</button>
      ${live.map((binding) => `<button type="button" class="event-filter${bindingFilterIndex === binding.index ? ' is-active' : ''}" data-action="em-filter-binding" data-binding-index="${binding.index}">${escapeHtml(binding.name)}</button>`).join('')}
    </div>`;
}

function scheduleMessageRender() {
  if (paused) {
    updateCount();
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

function updateCount() {
  const summary = document.querySelector('.event-result-summary');
  if (summary) summary.textContent = resultSummary();
}

function renderMessages() {
  const list = document.getElementById('event-list');
  if (!list) return;
  updateCount();
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
  if (bindingFilterIndex === null) return messages;
  return messages.filter((message) => message.bindingIndex === bindingFilterIndex);
}

function renderMessageRow(message) {
  const expanded = expandedSeqs.has(message.seq);
  const topic = message.topic || '(no topic)';
  const meta = [shortTime(message.time), message.encoding, formatBytes(message.size)]
    .filter(Boolean)
    .join(' - ');
  const body = expanded
    ? `<pre class="event-payload">${escapeHtml(message.payload)}${message.truncated ? '\n… (truncated)' : ''}</pre>
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
  activeBindingIndex = null;
  expandedBindingIndex = null;
  addBindingOpen = bindings.length > 1;
  bindingSearch = '';
  startError = '';
  publishBindingIndex = null;
  publishResult = null;
  publishSending = false;
  phase = 'ready';
  if (bindings.length === 1) addSelectedBinding(bindings[0].index);
  render();
}

function handlePublishResult(data) {
  publishSending = false;
  publishResult = {
    ok: data.ok === true,
    status: typeof data.status === 'number' ? data.status : undefined,
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

function handleListening(data) {
  streaming = true;
  paused = false;
  stoppedReason = '';
  statusLine = '';
  messages = [];
  totalReceived = 0;
  expandedSeqs.clear();
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
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
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
  const idx = publishBindingIndex !== null ? publishBindingIndex : (bindings[0] !== undefined ? bindings[0].index : -1);
  const topic = publishTopic.trim();
  if (!vscodeApi || !topic || publishSending) return;
  publishSending = true;
  publishResult = null;
  render();
  vscodeApi.postMessage({ type: 'sapTools.events.publishEvent', bindingIndex: idx, topic, payload: publishPayload, contentType: publishContentType });
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
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const index = bindingId(actionEl.dataset.bindingIndex);

  if (action === 'em-switch-tab') {
    activeTab = actionEl.dataset.tab || 'subscribe';
    render();
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
  } else if (action === 'em-start') {
    postStartAll();
  } else if (action === 'em-start-binding') {
    postStartBinding(index);
  } else if (action === 'em-add-topics') {
    postAddTopics(index);
  } else if (action === 'em-stop') {
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
  } else if (action === 'em-filter-binding') {
    bindingFilterIndex = actionEl.dataset.bindingIndex === '' ? null : index;
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
  } else if (el.matches('[data-role="ep-topic-input"]')) {
    publishTopic = el.value || '';
  } else if (el.matches('[data-role="ep-payload-input"]')) {
    publishPayload = el.value || '';
  }
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (!el || !el.matches) return;
  if (el.matches('[data-role="ep-binding-select"]')) {
    publishBindingIndex = bindingId(el.value);
  } else if (el.matches('[data-role="ep-content-type-select"]')) {
    publishContentType = el.value || 'application/json';
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
  if (el && el.matches && el.matches('[data-role="em-custom-topic-input"]') && event.key === 'Enter') {
    event.preventDefault();
    addCustomTopic(bindingId(el.dataset.bindingIndex));
  }
});

render();
if (vscodeApi) {
  vscodeApi.postMessage({ type: 'sapTools.events.webviewReady' });
}
