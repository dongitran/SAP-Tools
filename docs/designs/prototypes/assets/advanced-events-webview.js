// cspell:ignore SEMP simplemdg
// Advanced Event Mesh viewer webview. The extension host owns SEMP access.

const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const appId = (typeof window !== 'undefined' && window.advancedEventMeshAppId) || 'demo-app';
const initialProviderTabs =
  (typeof window !== 'undefined' && window.advancedEventMeshProviderTabs) || {};

let phase = 'loading';
let errorMessage = '';
let binding = null;
let queues = [];
let topics = [];
let query = '';
let refreshing = false;
let unreadableQueueCount = 0;
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

function plural(count, singular, pluralLabel) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function filteredTopics() {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return topics;
  return topics.filter((topic) => {
    const queuesText = Array.isArray(topic.queues) ? topic.queues.join(' ') : '';
    return `${topic.topic} ${queuesText}`.toLowerCase().includes(needle);
  });
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
        <span class="event-status-pill is-live">Read-only</span>
      </div>
    </header>`;
}

function renderProviderTabs() {
  if (providerTabs.classicAvailable !== true) return '';
  return `
    <nav class="aem-provider-tabs" aria-label="Event provider">
      <button type="button" class="aem-provider-tab" data-action="aem-open-classic">Event Mesh</button>
      <button type="button" class="aem-provider-tab is-active" aria-current="page">Advanced Event Mesh</button>
    </nav>`;
}

function renderSummary() {
  const brokerName = binding?.name || 'advanced-event-mesh';
  const vpn = binding?.vpn || 'Unknown VPN';
  const uri = binding?.managementHost || 'Management endpoint ready';
  return `
    <section class="aem-summary" aria-label="Advanced Event Mesh summary">
      <div class="aem-summary-item">
        <span class="aem-summary-label">Binding</span>
        <strong>${escapeHtml(brokerName)}</strong>
      </div>
      <div class="aem-summary-item">
        <span class="aem-summary-label">Message VPN</span>
        <strong>${escapeHtml(vpn)}</strong>
      </div>
      <div class="aem-summary-item">
        <span class="aem-summary-label">Management</span>
        <strong title="${escapeHtml(uri)}">${escapeHtml(uri)}</strong>
      </div>
      <div class="aem-summary-item">
        <span class="aem-summary-label">Discovery</span>
        <strong>${plural(queues.length, 'queue', 'queues')} / ${plural(topics.length, 'topic', 'topics')}</strong>
      </div>
    </section>`;
}

function renderToolbar() {
  return `
    <div class="aem-toolbar">
      <label class="event-label" for="aem-topic-search">Topic Search</label>
      <input
        id="aem-topic-search"
        class="event-input aem-search"
        type="search"
        value="${escapeHtml(query)}"
        data-role="aem-topic-search"
        placeholder="Filter topic or queue..."
      />
      <button type="button" class="event-btn" data-action="aem-refresh" ${refreshing ? 'disabled' : ''}>
        ${refreshing ? `${spinner()} Refreshing` : 'Refresh'}
      </button>
    </div>`;
}

function renderPartialWarning() {
  if (unreadableQueueCount <= 0) return '';
  return `
    <div class="aem-warning" role="status">
      ${plural(unreadableQueueCount, 'queue was', 'queues were')} skipped while reading subscriptions.
    </div>`;
}

function renderQueues() {
  if (queues.length === 0) {
    return '<p class="event-hint">No queues found for this Message VPN.</p>';
  }
  return `
    <div class="aem-queue-list">
      ${queues.map(renderQueueRow).join('')}
    </div>`;
}

function renderQueueRow(queue) {
  const name = queue.queueName || queue.name || '';
  const count = Number.isInteger(queue.subscriptionCount) ? queue.subscriptionCount : 0;
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
  return `
    <div class="aem-topic-list">
      ${rows.map(renderTopicRow).join('')}
    </div>`;
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

function renderReady() {
  return `
    ${renderHeader()}
    <main class="aem-shell">
      ${renderProviderTabs()}
      ${renderSummary()}
      ${renderToolbar()}
      ${renderPartialWarning()}
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
  providerTabs = {
    classicAvailable: data.providerTabs?.classicAvailable === true,
  };
  render();
}

function handleError(data) {
  phase = 'error';
  refreshing = false;
  unreadableQueueCount = 0;
  errorMessage = data.message || 'Unknown Advanced Event Mesh error.';
  render();
}

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'sapTools.aem.ready') handleReady(data);
  else if (data.type === 'sapTools.aem.error') handleError(data);
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.role === 'aem-topic-search') {
    query = target.value;
    render();
  }
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action || '';
  if (action === 'aem-refresh') requestRefresh();
  if (action === 'aem-retry') requestReady();
  if (action === 'aem-open-classic') {
    vscodeApi?.postMessage({ type: 'sapTools.aem.openClassic' });
  }
});

requestReady();
