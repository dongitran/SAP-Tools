// Event Mesh viewer webview. Runs in an editor WebviewPanel created by
// src/eventMeshPanel.ts. The extension host owns the AMQP connection; this script
// only renders state and posts user intents back. CSP forbids inline handlers, so
// all interaction goes through delegated listeners (see the bottom of this file).

const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const appId = (typeof window !== 'undefined' && window.eventMeshAppId) || 'demo-app';

const MAX_MESSAGES = 1000; // ring-buffer cap held in memory
const MAX_DOM_ROWS = 300; // rows actually painted (newest first)

let phase = 'loading'; // loading | config | stream | error
let errorMessage = '';
let startError = '';
let statusLine = '';

let bindings = [];
let selectedBindingIndex = 0;
let topicsLoading = true;
let discoveredTopics = [];
let wildcardTopic = '';
let discoveryError = '';
const selectedTopics = new Set();
const customTopics = [];

let queueName = '';
let streaming = false;
let stoppedReason = '';
let paused = false;

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

function selectedBinding() {
  return bindings.find((b) => b.index === selectedBindingIndex) || bindings[0] || null;
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

// --- Rendering ---------------------------------------------------------------

function render() {
  const root = document.getElementById('event-mesh-app');
  if (!root) return;

  if (phase === 'loading') {
    root.innerHTML = `<div class="event-state">${spinner()}<p>Reading enterprise-messaging binding for <strong>${escapeHtml(appId)}</strong>…</p></div>`;
    return;
  }
  if (phase === 'error') {
    root.innerHTML = `
      <div class="event-state event-state-error">
        <h2>Cannot open Event viewer</h2>
        <p>${escapeHtml(errorMessage)}</p>
        <button type="button" class="event-btn" data-action="em-retry">Try again</button>
      </div>`;
    return;
  }
  if (phase === 'config') {
    root.innerHTML = renderConfig();
    return;
  }
  root.innerHTML = renderStream();
  renderMessages();
}

function spinner() {
  return '<span class="event-spinner" aria-hidden="true"></span>';
}

function renderHeader() {
  const binding = selectedBinding();
  const ns = binding ? binding.namespace : '';
  return `
    <header class="event-header">
      <div class="event-header-main">
        <span class="event-title">Event Mesh</span>
        <span class="event-app">${escapeHtml(appId)}</span>
      </div>
      <div class="event-header-meta">${escapeHtml(ns)}</div>
    </header>`;
}

function renderConfig() {
  const binding = selectedBinding();
  const bindingSelector =
    bindings.length > 1
      ? `<label class="event-field">
           <span class="event-label">Messaging binding</span>
           <select data-role="em-binding-select" class="event-select">
             ${bindings
               .map(
                 (b) =>
                   `<option value="${b.index}"${b.index === selectedBindingIndex ? ' selected' : ''}>${escapeHtml(b.name)} — ${escapeHtml(b.namespace)}</option>`
               )
               .join('')}
           </select>
         </label>`
      : `<div class="event-field"><span class="event-label">Messaging binding</span><div class="event-static">${escapeHtml(binding ? `${binding.name} — ${binding.namespace}` : '')}</div></div>`;
  const bindingGuidance =
    bindings.length > 1
      ? '<p class="event-hint event-binding-hint">One messaging binding is used per debug session. Choose the service namespace to inspect; topic discovery and the temporary queue follow that binding.</p>'
      : '';

  return `
    ${renderHeader()}
    <div class="event-config">
      ${bindingSelector}
      ${bindingGuidance}
      <div class="event-field">
        <span class="event-label">Topics to listen</span>
        ${renderTopicChooser()}
      </div>
      ${startError ? `<p class="event-inline-error">${escapeHtml(startError)}</p>` : ''}
      <div class="event-config-actions">
        <button type="button" class="event-btn event-btn-primary" data-action="em-start"${selectedTopics.size === 0 ? ' disabled' : ''}>Start listening</button>
        <span class="event-hint">A temporary debug queue is created and deleted automatically. Your app's own queues are never touched.</span>
      </div>
    </div>`;
}

function renderTopicChooser() {
  if (topicsLoading) {
    return `<div class="event-topics-loading">${spinner()}<span>Discovering topics from existing queues…</span></div>`;
  }

  const rows = [];
  if (wildcardTopic) {
    rows.push(topicRow(wildcardTopic, `All events under namespace · ${wildcardTopic}`, 'wildcard'));
  }
  for (const topic of discoveredTopics) {
    if (topic === wildcardTopic) continue;
    rows.push(topicRow(topic, topic, 'discovered'));
  }
  for (const topic of customTopics) {
    if (topic === wildcardTopic || discoveredTopics.includes(topic)) continue;
    rows.push(topicRow(topic, topic, 'custom'));
  }

  const discoveryNote = discoveryError
    ? `<p class="event-hint event-hint-warn">Could not auto-discover topics (${escapeHtml(discoveryError)}). Use the wildcard or add a topic manually.</p>`
    : discoveredTopics.length === 0
      ? `<p class="event-hint">No subscriptions found on existing queues. Use the wildcard or add a topic manually.</p>`
      : '';

  return `
    <div class="event-topics">${rows.join('') || '<p class="event-hint">No topics available.</p>'}</div>
    ${discoveryNote}
    <div class="event-custom-topic">
      <input type="text" class="event-input" data-role="em-custom-topic-input" placeholder="Add a topic, e.g. ${escapeHtml(wildcardTopic || 'namespace/topic')}" />
      <button type="button" class="event-btn" data-action="em-add-custom-topic">Add</button>
    </div>`;
}

function topicRow(topic, label, kind) {
  const checked = selectedTopics.has(topic) ? ' checked' : '';
  return `
    <label class="event-topic-row">
      <input type="checkbox" data-role="em-topic-checkbox" data-topic="${escapeHtml(topic)}"${checked} />
      <span class="event-topic-label">${escapeHtml(label)}</span>
      ${kind === 'wildcard' ? '<span class="event-tag">wildcard</span>' : ''}
      ${kind === 'custom' ? '<span class="event-tag">custom</span>' : ''}
    </label>`;
}

function renderStream() {
  const stateClass = streaming ? 'is-live' : 'is-stopped';
  const stateLabel = streaming ? 'Listening' : 'Stopped';
  const banner = !streaming && stoppedReason
    ? `<div class="event-banner">${escapeHtml(REASON_TEXT[stoppedReason] || 'Listening stopped.')}</div>`
    : '';
  return `
    ${renderHeader()}
    <div class="event-toolbar">
      <span class="event-status-pill ${stateClass}">${stateLabel}</span>
      <span class="event-queue" title="${escapeHtml(queueName)}">${escapeHtml(queueName)}</span>
      <span class="event-count" id="event-count"></span>
      <span class="event-toolbar-spacer"></span>
      ${
        streaming
          ? `<button type="button" class="event-btn" data-action="em-pause">${paused ? 'Resume' : 'Pause'}</button>
             <button type="button" class="event-btn" data-action="em-stop">Stop</button>`
          : `<button type="button" class="event-btn event-btn-primary" data-action="em-reconfigure">Back to setup</button>`
      }
      <button type="button" class="event-btn" data-action="em-clear">Clear</button>
    </div>
    ${banner}
    ${statusLine ? `<div class="event-statusline">${escapeHtml(statusLine)}</div>` : ''}
    <div class="event-list" id="event-list"></div>`;
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
  const counter = document.getElementById('event-count');
  if (counter) {
    counter.textContent = `${totalReceived} received${paused ? ' · paused' : ''}`;
  }
}

function renderMessages() {
  const list = document.getElementById('event-list');
  if (!list) return;
  updateCount();

  if (messages.length === 0) {
    list.innerHTML = streaming
      ? '<p class="event-empty">Waiting for messages…</p>'
      : '<p class="event-empty">No messages received.</p>';
    return;
  }

  const visible = messages.slice(-MAX_DOM_ROWS).reverse();
  list.innerHTML = visible.map(renderMessageRow).join('');
}

function renderMessageRow(message) {
  const expanded = expandedSeqs.has(message.seq);
  const topic = message.topic || '(no topic)';
  const meta = [shortTime(message.time), message.encoding, formatBytes(message.size)]
    .filter(Boolean)
    .join(' · ');
  const body = expanded
    ? `<pre class="event-payload">${escapeHtml(message.payload)}${message.truncated ? '\n… (truncated)' : ''}</pre>
       ${message.messageId ? `<div class="event-msgid">message-id: ${escapeHtml(message.messageId)}</div>` : ''}`
    : `<div class="event-preview">${escapeHtml(oneLinePreview(message.payload))}</div>`;
  return `
    <div class="event-item${expanded ? ' is-expanded' : ''}">
      <div class="event-item-head" data-action="em-toggle-expand" data-seq="${message.seq}">
        <span class="event-item-seq">#${message.seq}</span>
        <span class="event-item-topic" title="${escapeHtml(topic)}">${escapeHtml(topic)}</span>
        <span class="event-item-meta">${escapeHtml(meta)}</span>
      </div>
      ${body}
    </div>`;
}

// --- Host -> webview messages ------------------------------------------------

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;

  switch (data.type) {
    case 'sapTools.events.ready': {
      bindings = Array.isArray(data.bindings) ? data.bindings : [];
      selectedBindingIndex = bindings.length > 0 ? bindings[0].index : 0;
      topicsLoading = true;
      discoveredTopics = [];
      discoveryError = '';
      startError = '';
      phase = 'config';
      render();
      break;
    }
    case 'sapTools.events.topics': {
      if (data.bindingIndex !== selectedBindingIndex) break;
      discoveredTopics = Array.isArray(data.topics) ? data.topics : [];
      wildcardTopic = data.wildcardTopic || '';
      discoveryError = data.discoveryError || '';
      topicsLoading = false;
      if (selectedTopics.size === 0 && wildcardTopic) {
        selectedTopics.add(wildcardTopic);
      }
      if (phase === 'config') render();
      break;
    }
    case 'sapTools.events.listening': {
      queueName = data.queueName || '';
      streaming = true;
      paused = false;
      stoppedReason = '';
      statusLine = '';
      messages = [];
      totalReceived = 0;
      expandedSeqs.clear();
      phase = 'stream';
      render();
      break;
    }
    case 'sapTools.events.messages': {
      const events = Array.isArray(data.events) ? data.events : [];
      if (events.length === 0) break;
      totalReceived += events.length;
      messages = messages.concat(events);
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(-MAX_MESSAGES);
      }
      scheduleMessageRender();
      break;
    }
    case 'sapTools.events.status': {
      statusLine = data.message || '';
      const el = document.querySelector('.event-statusline');
      if (el) {
        el.textContent = statusLine;
      } else if (phase === 'stream') {
        render();
      }
      break;
    }
    case 'sapTools.events.stopped': {
      streaming = false;
      paused = false;
      stoppedReason = data.reason || 'user';
      if (phase === 'stream') render();
      break;
    }
    case 'sapTools.events.error': {
      if (data.scope === 'start') {
        startError = data.message || 'Failed to start listening.';
        if (phase === 'config') render();
      } else {
        errorMessage = data.message || 'Unknown error.';
        phase = 'error';
        render();
      }
      break;
    }
    default:
      break;
  }
});

// --- Webview -> host intents (delegated) -------------------------------------

function postStart() {
  if (!vscodeApi || selectedTopics.size === 0) return;
  startError = '';
  vscodeApi.postMessage({
    type: 'sapTools.events.startListening',
    bindingIndex: selectedBindingIndex,
    topics: [...selectedTopics],
  });
}

document.addEventListener('click', (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'em-retry') {
    phase = 'loading';
    render();
    if (vscodeApi) vscodeApi.postMessage({ type: 'sapTools.events.webviewReady' });
    return;
  }
  if (action === 'em-add-custom-topic') {
    const input = document.querySelector('[data-role="em-custom-topic-input"]');
    const value = input && input.value ? input.value.trim() : '';
    if (value) {
      if (!customTopics.includes(value) && !discoveredTopics.includes(value) && value !== wildcardTopic) {
        customTopics.push(value);
      }
      selectedTopics.add(value);
      if (input) input.value = '';
      render();
    }
    return;
  }
  if (action === 'em-start') {
    postStart();
    return;
  }
  if (action === 'em-stop') {
    if (vscodeApi) vscodeApi.postMessage({ type: 'sapTools.events.stopListening' });
    return;
  }
  if (action === 'em-pause') {
    paused = !paused;
    render();
    if (!paused) renderMessages();
    return;
  }
  if (action === 'em-clear') {
    messages = [];
    totalReceived = 0;
    expandedSeqs.clear();
    renderMessages();
    return;
  }
  if (action === 'em-reconfigure') {
    phase = 'config';
    stoppedReason = '';
    render();
    return;
  }
  if (action === 'em-toggle-expand') {
    const seq = Number(actionEl.dataset.seq);
    if (expandedSeqs.has(seq)) expandedSeqs.delete(seq);
    else expandedSeqs.add(seq);
    renderMessages();
    return;
  }
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (!el || !el.matches) return;

  if (el.matches('[data-role="em-binding-select"]')) {
    selectedBindingIndex = Number(el.value);
    selectedTopics.clear();
    customTopics.length = 0;
    discoveredTopics = [];
    discoveryError = '';
    topicsLoading = true;
    render();
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'sapTools.events.selectBinding', bindingIndex: selectedBindingIndex });
    }
    return;
  }

  if (el.matches('[data-role="em-topic-checkbox"]')) {
    const topic = el.dataset.topic;
    if (!topic) return;
    if (el.checked) selectedTopics.add(topic);
    else selectedTopics.delete(topic);
    const startBtn = document.querySelector('[data-action="em-start"]');
    if (startBtn) startBtn.disabled = selectedTopics.size === 0;
  }
});

// Add custom topic on Enter for convenience.
document.addEventListener('keydown', (event) => {
  const el = event.target;
  if (el && el.matches && el.matches('[data-role="em-custom-topic-input"]') && event.key === 'Enter') {
    event.preventDefault();
    const value = el.value ? el.value.trim() : '';
    if (value) {
      if (!customTopics.includes(value) && !discoveredTopics.includes(value) && value !== wildcardTopic) {
        customTopics.push(value);
      }
      selectedTopics.add(value);
      el.value = '';
      render();
    }
  }
});

render();
if (vscodeApi) {
  vscodeApi.postMessage({ type: 'sapTools.events.webviewReady' });
}
