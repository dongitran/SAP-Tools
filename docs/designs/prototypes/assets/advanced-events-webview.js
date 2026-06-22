// cspell:ignore SEMP demoapp
// Advanced Event Mesh viewer webview. The extension host owns SEMP and Solace access.

const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const appId = (typeof window !== 'undefined' && window.advancedEventMeshAppId) || 'demo-app';
const initialProviderTabs =
  (typeof window !== 'undefined' && window.advancedEventMeshProviderTabs) || {};

const MAX_MESSAGES = 1000;
const MAX_DOM_ROWS = 300;
const JSON_TOKEN_PATTERN = /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;

let phase = 'loading';
let errorMessage = '';
let startError = '';
let statusLine = '';
let binding = null;
let queues = [];
let topics = [];
let topicQuery = '';
let refreshing = false;
let unreadableQueueCount = 0;
let streaming = false;
let starting = false;
let stopping = false;
let customTopicInput = '';
let messageSearch = '';
let paused = false;
let activeQueueName = '';
let messages = [];
let totalReceived = 0;
let bindingExpanded = true;
const selectedTopics = new Set();
const customTopics = [];
const liveTopics = new Set();
const expandedSeqs = new Set();
let providerTabs = {
  classicAvailable: initialProviderTabs.classicAvailable === true,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function spinner() {
  return '<span class="event-spinner" aria-hidden="true"></span>';
}

function btnSpinner() {
  return '<span class="event-btn-spinner" aria-hidden="true"></span>';
}

function plural(count, singular, pluralLabel) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function shortTime(iso) {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(String(iso || ''));
  return match ? match[1] : String(iso || '');
}

function oneLinePreview(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 140)}...` : flat;
}

function filteredTopics() {
  const needle = topicQuery.trim().toLowerCase();
  if (needle.length === 0) return topics;
  return topics.filter((topic) => {
    const queuesText = Array.isArray(topic.queues) ? topic.queues.join(' ') : '';
    return `${topic.topic} ${queuesText}`.toLowerCase().includes(needle);
  });
}

function queueSubscriptionCount(queue) {
  if (Number.isInteger(queue.subscriptionCount) && queue.subscriptionCount >= 0) {
    return queue.subscriptionCount;
  }
  const name = queue.queueName || queue.name || '';
  if (name.length === 0) return 0;
  return topics.filter((topic) => Array.isArray(topic.queues) && topic.queues.includes(name)).length;
}

function topicCandidates() {
  const names = [];
  for (const entry of topics) {
    if (typeof entry.topic === 'string' && !names.includes(entry.topic)) names.push(entry.topic);
  }
  for (const topic of customTopics) {
    if (!names.includes(topic)) names.push(topic);
  }
  return names;
}

function pendingTopics() {
  return [...selectedTopics].filter((topic) => !liveTopics.has(topic));
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
    message.bindingName,
    message.vpn,
    message.queueName,
    message.topic,
    message.contentType,
    message.messageId,
    message.payload,
    stringifyForSearch(message.headers),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function formatJsonPayload(payload) {
  const text = String(payload ?? '').replace(/^\uFEFF/, '').trim();
  if (text.length === 0) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function highlightJsonPayload(json) {
  return json.replace(JSON_TOKEN_PATTERN, (token, offset, source) => {
    let tokenClass = 'event-json-punctuation';
    if (token.startsWith('"')) {
      tokenClass = /^\s*:/.test(source.slice(offset + token.length))
        ? 'event-json-key'
        : 'event-json-string';
    } else if (/^-?\d/.test(token)) {
      tokenClass = 'event-json-number';
    } else if (token === 'true' || token === 'false' || token === 'null') {
      tokenClass = 'event-json-literal';
    }
    return `<span class="event-json-token ${tokenClass}">${escapeHtml(token)}</span>`;
  });
}

function renderPayloadBody(message) {
  const json = formatJsonPayload(message.payload);
  if (json !== null) {
    const note = message.truncated ? '<div class="event-payload-note">... (truncated)</div>' : '';
    return `<pre class="event-payload is-json" aria-label="Received JSON payload">${highlightJsonPayload(json)}</pre>${note}`;
  }
  const suffix = message.truncated ? '\n... (truncated)' : '';
  return `<pre class="event-payload" aria-label="Received message payload">${escapeHtml(message.payload)}${suffix}</pre>`;
}

function renderState() {
  return `
    <div class="event-state">
      ${spinner()}
      <p>Reading Advanced Event Mesh bindings for <strong>${escapeHtml(appId)}</strong>...</p>
    </div>`;
}

function renderError() {
  return `
    <div class="event-state event-state-error">
      <h2>Cannot Open Advanced Event Mesh</h2>
      <p>${escapeHtml(errorMessage)}</p>
      <button type="button" class="event-btn" data-action="aem-retry">Try Again</button>
    </div>`;
}

function renderHeader() {
  return `
    <header class="event-header">
      <div class="event-header-main">
        <span class="event-title">Advanced Event Mesh</span>
        <span class="event-app">${escapeHtml(appId)}</span>
      </div>
      <div class="event-header-end">
        ${renderProviderTabs()}
      </div>
    </header>`;
}

function renderProviderTabs() {
  if (providerTabs.classicAvailable !== true) return '';
  return `
    <div class="event-tabs-row">
      <div class="event-tabs" role="tablist" aria-label="Event provider">
        <button type="button" class="event-tab" role="tab" data-action="aem-open-classic" aria-selected="false">Event Mesh</button>
        <button type="button" class="event-tab is-active" role="tab" aria-selected="true" aria-current="page">Advanced Event Mesh</button>
      </div>
    </div>`;
}

function renderBindingMeta() {
  const brokerName = binding?.name || 'advanced-event-mesh';
  const vpn = binding?.vpn || 'Unknown VPN';
  return `${brokerName} · ${vpn}`;
}

function aemStatusClass() {
  if (streaming) return 'is-live';
  if (starting || stopping) return 'is-working';
  if (startError) return 'is-error';
  return 'is-stopped';
}

function aemStatusLabel() {
  if (streaming) return 'Listening';
  if (starting) return 'Starting';
  if (stopping) return 'Stopping';
  if (startError) return 'Error';
  return 'Ready';
}

function liveOrSelectedTopicCount() {
  return liveTopics.size > 0 ? liveTopics.size : selectedTopics.size;
}

function renderAemListenerSetup() {
  return `
    <div class="event-section-head">
      <h2>Selected Binding</h2>
      <button type="button" class="event-btn event-btn-compact" data-action="aem-refresh" ${refreshing ? 'disabled' : ''}>
        ${refreshing ? `${spinner()} Refreshing` : 'Refresh'}
      </button>
    </div>
    <div class="event-binding-list">
      ${renderAemBindingCard()}
    </div>
    ${startError ? `<p class="event-inline-error" role="alert">${escapeHtml(startError)}</p>` : ''}
    ${renderAemSetupActions()}
    ${renderDiscoveryDetails()}`;
}

function renderAemBindingCard() {
  const brokerName = binding?.name || 'advanced-event-mesh';
  const vpn = binding?.vpn || 'Unknown VPN';
  const expandedClass = bindingExpanded ? ' is-expanded' : '';
  const liveClass = streaming ? ' is-live' : '';
  return `
    <article class="event-binding-card${expandedClass}${liveClass}">
      <div class="event-binding-row">
        <button type="button" class="event-binding-main" data-action="aem-toggle-binding">
          <span class="event-chevron" aria-hidden="true">${bindingExpanded ? '▾' : '▸'}</span>
          <span class="event-binding-name">${escapeHtml(brokerName)}</span>
          <span class="event-binding-namespace" title="${escapeHtml(vpn)}">${escapeHtml(vpn)}</span>
          <span class="event-binding-count">${escapeHtml(plural(liveOrSelectedTopicCount(), 'topic', 'topics'))}</span>
          <span class="event-status-pill ${aemStatusClass()}">${aemStatusLabel()}</span>
        </button>
      </div>
      <p class="event-binding-message">${escapeHtml(renderBindingMeta())}</p>
      ${bindingExpanded ? renderAemTopicPanel() : ''}
    </article>`;
}

function renderAemTopicPanel() {
  return `
    <div class="event-topic-panel">
      ${renderTopicChooser()}
      ${renderBindingTopicAction()}
    </div>`;
}

function renderPartialWarning() {
  if (unreadableQueueCount <= 0) return '';
  return `
    <div class="aem-warning" role="status">
      ${plural(unreadableQueueCount, 'queue was', 'queues were')} skipped while reading subscriptions.
    </div>`;
}

function renderTopicChooser() {
  const rows = topicCandidates().map(renderTopicChoice);
  const empty = '<p class="event-hint">No topic subscriptions found. Add a custom topic to listen.</p>';
  return `
    <div class="event-topics">
      ${rows.join('') || empty}
    </div>
    <p class="event-hint">Discovered from Advanced Event Mesh queue subscriptions. You can also add a topic manually.</p>
    <div class="event-custom-topic">
      <input
        type="text"
        name="aem-custom-topic"
        autocomplete="off"
        class="event-input"
        data-role="aem-custom-topic-input"
        value="${escapeHtml(customTopicInput)}"
        placeholder="Add a topic, e.g. domain/entity/event/>"
      />
      <button type="button" class="event-btn" data-action="aem-add-custom-topic">Add</button>
    </div>`;
}

function renderTopicChoice(topic) {
  const live = liveTopics.has(topic);
  const checked = selectedTopics.has(topic) || live;
  const custom = customTopics.includes(topic) && !topics.some((entry) => entry.topic === topic);
  return `
    <label class="event-topic-row${live ? ' is-live' : ''}">
      <input
        type="checkbox"
        data-role="aem-topic-checkbox"
        data-topic="${escapeHtml(topic)}"
        ${checked ? 'checked' : ''}
        ${live ? 'disabled' : ''}
      />
      <span class="event-topic-label">${escapeHtml(topic)}</span>
      ${live ? '<span class="event-tag event-tag-live">Live</span>' : ''}
      ${custom ? '<span class="event-tag">Custom</span>' : ''}
    </label>`;
}

function renderBindingTopicAction() {
  if (starting) {
    return `<button type="button" class="event-btn event-btn-primary" disabled>${btnSpinner()} Starting...</button>`;
  }
  if (stopping) {
    return `<button type="button" class="event-btn" disabled>${btnSpinner()} Stopping...</button>`;
  }
  if (streaming) {
    const pending = pendingTopics();
    return `<button type="button" class="event-btn event-btn-primary" data-action="aem-add-topics" ${pending.length === 0 ? 'disabled' : ''}>Listen To ${pending.length} New ${pending.length === 1 ? 'Topic' : 'Topics'}</button>`;
  }
  return '';
}

function renderAemSetupActions() {
  if (starting) {
    return `
      <div class="event-config-actions">
        <button type="button" class="event-btn event-btn-primary" disabled>${btnSpinner()} Starting...</button>
        <span class="event-hint">Creating the debug queue and binding Solace consumer...</span>
      </div>`;
  }
  if (stopping) {
    return `
      <div class="event-config-actions">
        <button type="button" class="event-btn" disabled>${btnSpinner()} Stopping...</button>
      </div>`;
  }
  if (streaming) {
    return `
      <div class="event-config-actions">
        <button type="button" class="event-btn" data-action="aem-stop">Stop</button>
        <span class="event-hint">Expand the binding to add more topics while keeping received messages.</span>
      </div>`;
  }
  return `
    <div class="event-config-actions">
      <button type="button" class="event-btn event-btn-primary" data-action="aem-start" ${selectedTopics.size === 0 ? 'disabled' : ''}>Start Listening To 1 Binding</button>
      <span class="event-hint">A temporary debug queue is created for this binding and deleted automatically.</span>
    </div>`;
}

function renderAemResults() {
  const stateClass = streaming ? 'is-live' : 'is-stopped';
  const stateLabel = streaming ? 'Listening' : 'Stopped';
  const banner = !streaming && statusLine
    ? `<div class="event-banner">${escapeHtml(statusLine)}</div>`
    : '';
  return `
    <div class="event-results-head">
      <span class="event-status-pill ${stateClass}">${stateLabel}</span>
      ${renderMessageSearchInput()}
      <span class="event-toolbar-spacer"></span>
      <button type="button" class="event-btn event-btn-compact" data-action="aem-pause" ${streaming ? '' : 'disabled'}>${paused ? 'Resume' : 'Pause'}</button>
      <button type="button" class="event-btn event-btn-compact" data-action="aem-clear">Clear</button>
    </div>
    ${banner}
    ${streaming && statusLine ? `<div class="event-statusline">${escapeHtml(statusLine)}</div>` : ''}
    ${activeQueueName ? `<div class="event-statusline">Debug queue: ${escapeHtml(activeQueueName)}</div>` : ''}
    <div class="event-list">${renderMessageRows()}</div>`;
}

function renderMessageSearchInput() {
  return `
    <label class="event-result-search search-input-with-icon">
      <span class="search-input-icon" aria-hidden="true">⌕</span>
      <input
        type="search"
        class="event-result-search-input"
        data-role="aem-message-search"
        value="${escapeHtml(messageSearch)}"
        placeholder="Search messages"
        aria-label="Search messages"
      />
    </label>`;
}

function renderMessageRows() {
  const needle = messageSearch.trim().toLowerCase();
  const rows = needle.length === 0 ? messages : messages.filter((message) => messageMatchesSearch(message, needle));
  if (rows.length === 0) {
    const text = totalReceived === 0 ? 'No messages received yet.' : 'No messages match the current search.';
    return `<div class="event-empty">${escapeHtml(text)}</div>`;
  }
  return rows.slice(-MAX_DOM_ROWS).reverse().map(renderMessageRow).join('');
}

function renderMessageRow(message) {
  const expanded = expandedSeqs.has(message.seq);
  return `
    <article class="event-item">
      <button type="button" class="event-item-head" data-action="aem-toggle-message" data-seq="${message.seq}">
        <span class="event-item-seq">#${message.seq}</span>
        <span class="event-binding-badge">${escapeHtml(message.bindingName || binding?.name || 'AEM')}</span>
        <span class="event-item-topic" title="${escapeHtml(message.topic || '')}">${escapeHtml(message.topic || '(no topic)')}</span>
        <span class="event-item-meta">${escapeHtml(shortTime(message.time))}</span>
      </button>
      ${expanded ? renderPayloadBody(message) : `<div class="event-preview">${escapeHtml(oneLinePreview(message.payload))}</div>`}
    </article>`;
}

function renderQueues() {
  if (queues.length === 0) {
    return '<p class="event-hint">No queues found for this Message VPN.</p>';
  }
  return `<div class="aem-queue-list">${queues.map(renderQueueRow).join('')}</div>`;
}

function renderQueueRow(queue) {
  const name = queue.queueName || queue.name || '';
  const count = queueSubscriptionCount(queue);
  const ingress = queue.ingressEnabled === true ? 'on' : 'off';
  const egress = queue.egressEnabled === true ? 'on' : 'off';
  return `
    <article class="aem-row">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(queue.permission || 'unknown permission')}</span>
      </div>
      <div class="aem-row-meta">
        <span>${plural(count, 'subscription', 'subscriptions')}</span>
        <span>ingress ${ingress}</span>
        <span>egress ${egress}</span>
      </div>
    </article>`;
}

function renderTopics() {
  const rows = filteredTopics();
  if (rows.length === 0) {
    return '<p class="event-hint">No topic subscriptions match the current filter.</p>';
  }
  return `<div class="aem-topic-list">${rows.map(renderTopicRow).join('')}</div>`;
}

function renderTopicRow(topic) {
  const queueNames = Array.isArray(topic.queues) ? topic.queues : [];
  return `
    <article class="aem-row">
      <div>
        <strong>${escapeHtml(topic.topic || '')}</strong>
        <span>${plural(queueNames.length, 'queue', 'queues')}</span>
      </div>
      <div class="aem-topic-queues">${escapeHtml(queueNames.join(', '))}</div>
    </article>`;
}

function renderDiscoveryGrid() {
  return `
    <section class="aem-grid">
      <section class="aem-panel" aria-label="Advanced Event Mesh queues">
        <div class="event-section-head">
          <h2>Queues</h2>
          <span>${plural(queues.length, 'queue', 'queues')}</span>
        </div>
        ${renderQueues()}
      </section>
      <section class="aem-panel" aria-label="Advanced Event Mesh topics">
        <div class="event-section-head">
          <h2>Topic Subscriptions</h2>
          <span>${plural(filteredTopics().length, 'topic', 'topics')}</span>
        </div>
        ${renderTopics()}
      </section>
    </section>`;
}

function renderDiscoveryDetails() {
  return `
    <details class="aem-discovery-details">
      <summary>Discovery Details · ${plural(queues.length, 'queue', 'queues')} / ${plural(topics.length, 'topic', 'topics')}</summary>
      <div class="aem-toolbar">
        <label class="event-label" for="aem-topic-search">Topic Search</label>
        <input
          id="aem-topic-search"
          class="event-input aem-search"
          type="search"
          value="${escapeHtml(topicQuery)}"
          data-role="aem-topic-search"
          placeholder="Filter topic or queue..."
        />
      </div>
      ${renderDiscoveryGrid()}
    </details>`;
}

function renderReady() {
  return `
    ${renderHeader()}
    <main class="event-shell">
      <section class="event-setup" aria-label="Advanced Event Mesh listener setup">
        ${renderPartialWarning()}
        ${renderAemListenerSetup()}
      </section>
      <section class="event-results" aria-label="Advanced Event Mesh results">
        ${renderAemResults()}
      </section>
    </main>`;
}

function render() {
  const root = document.getElementById('advanced-event-mesh-app');
  if (!root) return;
  if (phase === 'loading') root.innerHTML = renderState();
  else if (phase === 'error') root.innerHTML = renderError();
  else root.innerHTML = renderReady();
}

function requestReady() {
  phase = 'loading';
  errorMessage = '';
  render();
  vscodeApi?.postMessage({ type: 'sapTools.aem.webviewReady' });
}

function requestRefresh() {
  if (refreshing) return;
  refreshing = true;
  render();
  vscodeApi?.postMessage({ type: 'sapTools.aem.refresh' });
}

function addCustomTopic() {
  const topic = customTopicInput.trim();
  if (topic.length === 0) return;
  if (!customTopics.includes(topic)) customTopics.push(topic);
  selectedTopics.add(topic);
  customTopicInput = '';
  startError = '';
  render();
}

function startListening() {
  const topicsToStart = [...selectedTopics];
  if (topicsToStart.length === 0) {
    startError = 'Select at least one topic to listen to.';
    render();
    return;
  }
  starting = true;
  startError = '';
  render();
  vscodeApi?.postMessage({ type: 'sapTools.aem.startListening', topics: topicsToStart });
}

function addTopics() {
  const topicsToAdd = pendingTopics();
  if (topicsToAdd.length === 0) return;
  starting = true;
  startError = '';
  render();
  vscodeApi?.postMessage({ type: 'sapTools.aem.addTopics', topics: topicsToAdd });
}

function stopListening() {
  if (!streaming && !starting) return;
  stopping = true;
  render();
  vscodeApi?.postMessage({ type: 'sapTools.aem.stopListening' });
}

function handleReady(data) {
  phase = 'ready';
  refreshing = false;
  errorMessage = '';
  binding = data.binding || null;
  queues = Array.isArray(data.queues) ? data.queues : [];
  topics = Array.isArray(data.topics) ? data.topics : [];
  unreadableQueueCount =
    Number.isInteger(data.unreadableQueueCount) && data.unreadableQueueCount > 0
      ? data.unreadableQueueCount
      : 0;
  providerTabs = { classicAvailable: data.providerTabs?.classicAvailable === true };
  render();
}

function handleError(data) {
  refreshing = false;
  starting = false;
  stopping = false;
  const message = data.message || 'Unknown Advanced Event Mesh error.';
  if (phase === 'ready') {
    startError = message;
  } else {
    phase = 'error';
    errorMessage = message;
  }
  render();
}

function handleListening(data) {
  const summary = data.binding || {};
  streaming = true;
  starting = false;
  stopping = false;
  activeQueueName = summary.queueName || '';
  for (const topic of Array.isArray(summary.topics) ? summary.topics : []) {
    if (typeof topic === 'string') liveTopics.add(topic);
  }
  statusLine = `Listening on ${liveTopics.size} ${liveTopics.size === 1 ? 'topic' : 'topics'}.`;
  render();
}

function handleTopicsAdded(data) {
  starting = false;
  for (const topic of Array.isArray(data.topics) ? data.topics : []) {
    if (typeof topic === 'string') liveTopics.add(topic);
  }
  statusLine = data.topics?.length > 0 ? `Added ${plural(data.topics.length, 'topic', 'topics')}.` : 'No new topics were added.';
  render();
}

function handleMessages(data) {
  const incoming = Array.isArray(data.events) ? data.events : Array.isArray(data.messages) ? data.messages : [];
  totalReceived += incoming.length;
  if (!paused) {
    messages = messages.concat(incoming).slice(-MAX_MESSAGES);
  }
  render();
}

function handleStopped(data) {
  streaming = false;
  starting = false;
  stopping = false;
  liveTopics.clear();
  activeQueueName = '';
  statusLine = data.reason === 'scope-changed'
    ? 'Listening stopped because the active region/org/space changed.'
    : 'Listening stopped.';
  render();
}

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'sapTools.aem.ready') handleReady(data);
  else if (data.type === 'sapTools.aem.error') handleError(data);
  else if (data.type === 'sapTools.aem.listening') handleListening(data);
  else if (data.type === 'sapTools.aem.topicsAdded') handleTopicsAdded(data);
  else if (data.type === 'sapTools.aem.messages') handleMessages(data);
  else if (data.type === 'sapTools.aem.status') {
    statusLine = data.message || '';
    render();
  } else if (data.type === 'sapTools.aem.stopped') handleStopped(data);
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.role === 'aem-topic-search') {
    topicQuery = target.value;
    render();
  } else if (target.dataset.role === 'aem-custom-topic-input') {
    customTopicInput = target.value;
  } else if (target.dataset.role === 'aem-message-search') {
    messageSearch = target.value;
    render();
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.role !== 'aem-topic-checkbox') return;
  const topic = target.dataset.topic || '';
  if (topic.length === 0) return;
  if (target.checked) selectedTopics.add(topic);
  else selectedTopics.delete(topic);
  startError = '';
  render();
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action || '';
  if (action === 'aem-refresh') requestRefresh();
  else if (action === 'aem-retry') requestReady();
  else if (action === 'aem-open-classic') vscodeApi?.postMessage({ type: 'sapTools.aem.openClassic' });
  else if (action === 'aem-add-custom-topic') addCustomTopic();
  else if (action === 'aem-start') startListening();
  else if (action === 'aem-add-topics') addTopics();
  else if (action === 'aem-stop') stopListening();
  else if (action === 'aem-toggle-binding') {
    bindingExpanded = !bindingExpanded;
    render();
  }
  else if (action === 'aem-pause') {
    paused = !paused;
    render();
  } else if (action === 'aem-clear') {
    messages = [];
    totalReceived = 0;
    expandedSeqs.clear();
    render();
  } else if (action === 'aem-toggle-message') {
    const seq = Number(target.dataset.seq);
    if (expandedSeqs.has(seq)) expandedSeqs.delete(seq);
    else expandedSeqs.add(seq);
    render();
  }
});

requestReady();
