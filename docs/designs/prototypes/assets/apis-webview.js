let apiSelectedEntity = '';
let apiAuthMethod = 'xsuaa-auto';
let apiHttpMethod = 'GET';
let apiHttpBody = '';
let apiParams = {
  $select: '',
  $filter: '',
  $expand: '',
  $top: '5',
  $skip: '0'
};
let apiResultState = 'idle';
let apiResultTime = 0;
let apiResultStatus = '';
let apiResultPayload = null;
let apiActiveView = 'json';

let apiCatalogState = 'loading';
let apiCurrentCatalog = null;

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
      $top: '5',
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

const appElement = document.getElementById('webview-app');

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

    const columns = Object.keys(rows[0]);
    const header = columns.join('\t');
    const body = rows.map(r => columns.map(c => String(r[c] ?? '')).join('\t')).join('\n');
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
  }).catch(err => {
    console.error('Failed to copy: ', err);
  });
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
  if (!rows) return '<p>No grid data available</p>';
  if (rows.length === 0) return '<p>Empty result set</p>';
  
  const columns = Object.keys(rows[0]);
  const headerHtml = columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const rowsHtml = rows.map(r => {
    return '<tr>' + columns.map(c => `<td>${escapeHtml(String(r[c] ?? ''))}</td>`).join('') + '</tr>';
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

function updateResponseSection() {
  const responseBody = document.querySelector('.api-response-body');
  const headerSection = document.querySelector('.api-response-header');
  
  if (!responseBody || !headerSection) return;

  if (apiResultState === 'done') {
    const statusClass = apiResultStatus.startsWith('2') ? 'success' : 'error';
    
    let copyBtnHtml = '';
    if (apiResultPayload) {
      copyBtnHtml = `
        <button type="button" class="api-copy-btn" data-action="api-copy-data" style="background: transparent; color: var(--vscode-textLink-foreground, #3794ff); border: none; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
          <span aria-hidden="true">&#128203;</span> Copy
        </button>
      `;
    }

    headerSection.innerHTML = `
      <div style="display: flex; align-items: center; gap: 16px;">
        <h3 style="margin: 0; line-height: 1;">Response</h3>
        
        <div class="api-view-tabs" style="border-bottom: none; display: flex; align-items: center; gap: 4px; margin-bottom: 0; margin-top: 2px;">
          <button type="button" class="api-view-tab-btn${apiActiveView === 'json' ? ' is-active' : ''}" data-action="api-switch-view" data-view-id="json" style="padding: 2px 8px; font-size: 11px; height: 22px; box-sizing: border-box; display: flex; align-items: center;">JSON</button>
          <button type="button" class="api-view-tab-btn${apiActiveView === 'grid' ? ' is-active' : ''}" data-action="api-switch-view" data-view-id="grid" style="padding: 2px 8px; font-size: 11px; height: 22px; box-sizing: border-box; display: flex; align-items: center;">Grid Data</button>
        </div>
      </div>
      
      <div style="display: flex; align-items: center; gap: 12px; font-size: 12px;">
        ${apiResultPayload ? `
          <button type="button" class="api-copy-btn" data-action="api-copy-response" style="background: transparent; border: 1px solid var(--vscode-button-secondaryBackground, #5f5f5f); color: var(--vscode-foreground); border-radius: 2px; cursor: pointer; padding: 2px 8px; height: 22px; box-sizing: border-box; display: flex; align-items: center;">
            &#128203; Copy
          </button>
        ` : ''}
        <div class="api-status-badge is-${statusClass}">${escapeHtml(apiResultStatus)}</div>
        <div class="api-time-badge">${apiResultTime}ms</div>
      </div>
    `;
  } else {
    headerSection.innerHTML = `<h3 style="margin: 0;">Response</h3>`;
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

  const payloadStr = JSON.stringify(apiResultPayload, null, 2);

  let viewContent = '';
  if (apiActiveView === 'json') {
    viewContent = `<pre class="api-raw-json" style="background: transparent !important; margin: 0; padding: 0;"><code style="background: transparent !important; color: inherit; padding: 0;">${escapeHtml(payloadStr)}</code></pre>`;
  } else {
    viewContent = renderApiGridResult();
  }

  responseBody.innerHTML = `
    <div class="api-results-wrapper" style="margin-top: 0; flex: 1; display: flex; flex-direction: column;">
      <div class="api-view-content" style="flex: 1; overflow: auto; background-color: transparent; padding-top: 2px;">
        ${viewContent}
      </div>
    </div>
  `;
}

function updateWorkbenchSection() {
  const mainPanel = document.querySelector('.api-workbench-panel');
  if (!mainPanel) return;

  if (apiCatalogState === 'loading') {
    mainPanel.innerHTML = `
      <div class="api-placeholder-response" style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <div class="api-loading-spinner-large" style="margin-bottom: 16px;"></div>
        <p>Loading application endpoints...</p>
      </div>
    `;
    return;
  }
  
  const currentCatalog = apiCurrentCatalog || API_MOCK_CATALOG['demo-app'];

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
          <div style="display: flex; gap: 8px; align-items: center;">
            <div class="api-url-bar" style="flex: 1; margin: 0;">
              <select class="api-method-select" data-action="api-select-method" style="background: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, #ffffff); font-weight: bold; border: none; padding: 4px 8px; outline: none; cursor: pointer; -webkit-appearance: none; text-align: center; font-size: 11px;">
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PATCH">PATCH</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
              <input type="text" class="api-url-input" value="" aria-label="API Target URL" style="flex: 1; border: none; background: transparent; outline: none; padding: 4px 8px; color: inherit;" />
            </div>
            
            <div class="api-settings-container" style="position: relative; display: flex; align-items: center; justify-content: center;">
              <button type="button" data-action="api-toggle-auth-settings" style="background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font-size: 16px; opacity: 0.8; padding: 4px; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;" title="Auth Settings" onmouseover="this.style.background='var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31))'" onmouseout="this.style.background='transparent'">&#9881;&#65039;</button>
              <div class="api-auth-popover" style="display: none; position: absolute; right: 0; top: calc(100% + 4px); background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border, #3c3c3c); padding: 8px; z-index: 10; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); width: 200px;">
                <label style="font-size: 11px; margin-bottom: 4px; display: block; opacity: 0.8;">Authentication Method</label>
                <select id="api-auth-select" class="api-auth-select" data-action="api-select-auth" style="width: 100%; border: 1px solid var(--vscode-input-border, #3c3c3c); background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); padding: 4px; outline: none; cursor: pointer; font-family: inherit;">
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
        <section class="api-response-section" aria-label="API Response" style="flex: 1; display: flex; flex-direction: column;">
          <div class="api-response-header" style="display: flex; align-items: center; justify-content: space-between;">
            <h3>Response</h3>
          </div>
          <div class="api-response-body" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"></div>
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

  if (apiCatalogState === 'loading') {
    sidebar.innerHTML = `
      <div style="padding: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; opacity: 0.7;">
        <div class="api-loading-spinner-large" style="margin-bottom: 16px;"></div>
        <div style="font-size: 13px; font-weight: 500; color: var(--vscode-foreground);">Discovering Endpoints...</div>
        <div style="font-size: 11px; margin-top: 8px; color: var(--vscode-descriptionForeground);">Fetching metadata from the deployed application</div>
      </div>
    `;
    return;
  }

  const currentCatalog = apiCurrentCatalog || API_MOCK_CATALOG['demo-app'];
  
  const entityItems = currentCatalog.entities.map(ent => {
    const isSelected = ent.name === apiSelectedEntity;
    return `
      <button type="button" class="api-entity-item${isSelected ? ' is-active' : ''}" data-action="api-select-entity" data-entity-name="${ent.name}">
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
    <div style="padding: 12px 0 0 0; background: var(--vscode-sideBar-background, #252526); z-index: 10;">
      <div class="api-entities-list-title" style="margin-bottom: 8px; padding: 0 12px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8; color: var(--text-color, inherit);">Endpoints (${currentCatalog.entities.length}) ${apiCatalogState === 'syncing' ? '<span class="api-sync-spinner" style="display:inline-block; animation: api-spin 1s linear infinite; margin-left: 4px; font-size: 10px;">&#8635;</span>' : ''}</div>
      <div class="api-search-container" style="padding: 0 12px 12px 12px; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);">
        <div style="position: relative; display: flex; align-items: center; background: var(--vscode-input-background, #3c3c3c); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;">
          <span aria-hidden="true" style="position: absolute; left: 6px; font-size: 14px; color: var(--vscode-input-foreground, #cccccc);">&#128269;</span>
          <input type="search" data-action="api-search-entity" value="${escapeHtml(searchTerm)}" placeholder="Search endpoints" style="width: 100%; padding: 4px 6px 4px 28px; background: transparent; border: none; color: var(--vscode-input-foreground, #cccccc); outline: none; font-family: inherit; font-size: 13px;" />
        </div>
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
}

function initLayout() {
  if (!apiSelectedAppId) {
    appElement.innerHTML = `
      <main class="api-workbench-panel">
        <div class="api-placeholder-response">
          <p>Please select an App Service to view its APIs.</p>
        </div>
      </main>
    `;
    return;
  }

  // Ensure DOM skeleton exists
  if (!document.querySelector('.api-split-layout')) {
    appElement.innerHTML = `
      <div id="api-explorer-root" style="display: flex; height: 100vh; overflow: hidden; font-family: var(--vscode-font-family); color: var(--vscode-foreground);">
        <!-- Sidebar -->
        <aside class="api-webview-sidebar" style="width: 250px; min-width: 150px; border-right: 1px solid var(--vscode-panel-border, #3c3c3c); background-color: var(--vscode-sideBar-background, #252526); display: flex; flex-direction: column; overflow: hidden;"></aside>
        <div class="api-resizer" style="width: 4px; cursor: col-resize; background: transparent; transition: background 0.2s; z-index: 5;"></div>
        <main class="api-workbench-panel" style="flex: 1; display: flex; flex-direction: column; overflow-y: auto;"></main>
      </div>
    `;
  }
}

function renderWebview() {
  initLayout();
  if (apiSelectedAppId) {
    updateSidebarSection();
    updateWorkbenchSection();
  }
}

// Action Handler
appElement.addEventListener('click', (event) => {
  const target = event.target;
  const actionElement = target.closest('[data-action]');
  if (!actionElement) return;

  const action = actionElement.dataset.action;

  if (action === 'api-select-entity') {
    saveEndpointSession();
    apiSelectedEntity = actionElement.dataset.entityName ?? '';
    loadEndpointSession(apiSelectedEntity);
    updateSidebarSection();
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

  if (action === 'api-copy-data') {
    copyResponseData();
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
        apiResultState = 'done';
        apiResultStatus = '200 OK';
        apiResultTime = 345;
        apiResultPayload = API_MOCK_RESPONSES['demo-app']['Users'];
        updateWorkbenchSection();
      }, 1000);
    }
  }
});

// Select
appElement.addEventListener('change', (event) => {
  const target = event.target;
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
});

// Inputs
appElement.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset.action === 'api-input-body') {
    apiHttpBody = target.value;
    return;
  }

  if (!(target instanceof HTMLInputElement)) return;

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
        const currentCatalog = apiCurrentCatalog || API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
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
  const params = new URLSearchParams(window.location.search);
  const appId = params.get('appId') || sessionStorage.getItem('saptools.apis.selectedAppId') || window.vscodeApiSelectedAppId;
  if (appId) {
    apiSelectedAppId = appId;
    
    // Select the first entity automatically if available
    const catalog = API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
    if (catalog && catalog.entities.length > 0) {
      apiSelectedEntity = catalog.entities[0].name;
    } else {
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
    
    apiCatalogState = 'loading';
    apiCurrentCatalog = null;
    
    apiSelectedEntity = '';
    apiHttpMethod = 'GET';
    apiHttpBody = '';
    apiResultState = 'idle';
    apiResultPayload = null;
    apiParams = {
      $select: '',
      $filter: '',
      $expand: '',
      $top: '5',
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
