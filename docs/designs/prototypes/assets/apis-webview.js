let apiSelectedAppId = '';
let apiSelectedEntity = '';
let apiAuthMethod = 'xsuaa-auto';
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

const API_MOCK_RESPONSES = {
  'demo-app': {
    'Users': {
      value: [
        { id: 'U001', name: 'Alice', role: 'Admin' },
        { id: 'U002', name: 'Bob', role: 'User' },
        { id: 'U003', name: 'Charlie', role: 'User' }
      ]
    },
    'Products': {
      value: [
        { id: 'P001', title: 'Laptop', price: 999.00 },
        { id: 'P002', title: 'Mouse', price: 29.99 },
        { id: 'P003', title: 'Keyboard', price: 59.50 }
      ]
    },
    'Orders': {
      value: [
        { orderId: 'O1001', status: 'Shipped', total: 1028.99 },
        { orderId: 'O1002', status: 'Pending', total: 59.50 }
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
  return parts.length > 0 ? `?${parts.join('&')}` : '';
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
  if (!apiResultPayload || !Array.isArray(apiResultPayload.value)) return '<p>No grid data available</p>';
  const rows = apiResultPayload.value;
  if (rows.length === 0) return '<p>Empty result set</p>';
  
  const columns = Object.keys(rows[0]);
  const headerHtml = columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const rowsHtml = rows.map(r => {
    return '<tr>' + columns.map(c => `<td>${escapeHtml(String(r[c]))}</td>`).join('') + '</tr>';
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

function renderApiResponseBody() {
  if (apiResultState === 'idle') {
    return `
      <div class="api-placeholder-response">
        <span class="api-placeholder-icon" aria-hidden="true">&#9656;</span>
        <p>Press <strong>Execute GET</strong> to fetch data from the endpoint.</p>
      </div>
    `;
  }

  if (apiResultState === 'loading') {
    return `
      <div class="api-placeholder-response">
        <div class="api-loading-spinner-large"></div>
        <p>Resolving XSUAA credentials & fetching metadata...</p>
      </div>
    `;
  }

  const payloadStr = JSON.stringify(apiResultPayload, null, 2);

  let viewContent = '';
  if (apiActiveView === 'json') {
    viewContent = `<pre class="api-raw-json"><code>${escapeHtml(payloadStr)}</code></pre>`;
  } else {
    viewContent = renderApiGridResult();
  }

  return `
    <div class="api-results-wrapper">
      <div class="api-view-tabs">
        <button type="button" class="api-view-tab-btn${apiActiveView === 'json' ? ' is-active' : ''}" data-action="api-switch-view" data-view-id="json">JSON</button>
        <button type="button" class="api-view-tab-btn${apiActiveView === 'grid' ? ' is-active' : ''}" data-action="api-switch-view" data-view-id="grid">Grid Data</button>
      </div>
      <div class="api-view-content">
        ${viewContent}
      </div>
    </div>
  `;
}

function renderWebview() {
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

  const currentCatalog = API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
  
  // Render Left Sidebar (Endpoints)
  const entityItems = currentCatalog.entities.map(ent => {
    const isSelected = ent.name === apiSelectedEntity;
    return `
      <button type="button" class="api-entity-item${isSelected ? ' is-active' : ''}" data-action="api-select-entity" data-entity-name="${ent.name}">
        <span class="entity-icon" aria-hidden="true">&#128196;</span>
        <span class="entity-name">${ent.name}</span>
        <span class="entity-count-badge">${ent.count}</span>
      </button>
    `;
  }).join('');

  const sidebarHtml = `
    <aside class="api-webview-sidebar" style="width: 250px; min-width: 250px; border-right: 1px solid var(--vscode-panel-border, #3c3c3c); background-color: var(--vscode-sideBarSectionHeader-background, #1e1e1e); display: flex; flex-direction: column; overflow-y: auto;">
      <div style="padding: 12px 0 0 0;">
        <div class="api-entities-list-title" style="margin-bottom: 8px; padding: 0 12px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;">Endpoints (${currentCatalog.entities.length})</div>
        <div class="api-search-container" style="padding: 0 12px 12px 12px;">
          <div style="position: relative; display: flex; align-items: center; background: var(--vscode-input-background, #3c3c3c); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;">
            <span aria-hidden="true" style="position: absolute; left: 6px; font-size: 14px; color: var(--vscode-input-foreground, #cccccc);">&#128269;</span>
            <input type="search" data-action="api-search-entity" placeholder="Search endpoints" style="width: 100%; padding: 4px 6px 4px 24px; background: transparent; border: none; color: var(--vscode-input-foreground, #cccccc); outline: none; font-family: inherit; font-size: 13px;" />
          </div>
        </div>
      </div>
      <div class="api-entities-list-container" style="padding: 0; display: flex; flex-direction: column;">
        ${entityItems}
      </div>
    </aside>
  `;

  // Render Right Content
  let workbenchHtml = '';
  if (!apiSelectedEntity) {
    workbenchHtml = `
      <main class="api-workbench-panel" style="flex: 1;">
        <div class="api-placeholder-response">
          <p>Please select an Endpoint from the sidebar.</p>
        </div>
      </main>
    `;
  } else {
    const routeBase = currentCatalog.baseUrl || `https://demo-env-${apiSelectedAppId}.cfapps.region.hana.ondemand.com`;
    const fullUrl = `${routeBase}${currentCatalog.servicePath}/${apiSelectedEntity}${buildApiQueryString()}`;

    workbenchHtml = `
      <main class="api-workbench-panel" style="flex: 1; border-left: none;">
        <!-- Request Section -->
        <section class="api-request-section" aria-label="API Request Builder">
          <div class="api-url-bar">
            <span class="api-method-badge">GET</span>
            <input type="text" class="api-url-input" value="${fullUrl}" readonly aria-label="API Target URL" />
          </div>

          <div class="api-config-row" style="margin-top: 12px;">
            <label class="api-url-bar" style="width: 300px; cursor: pointer; display: flex; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-input-background, #3c3c3c); border-radius: 2px;" for="api-auth-select">
              <span class="api-method-badge" style="background-color: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, #ffffff); font-weight: bold; padding: 4px 8px;">Auth</span>
              <select id="api-auth-select" class="api-url-input api-auth-select" data-action="api-select-auth" style="flex: 1; border: none; background: transparent; color: var(--vscode-input-foreground, #cccccc); padding: 4px 8px; outline: none; cursor: pointer;">
                <option value="xsuaa-auto" ${apiAuthMethod === 'xsuaa-auto' ? 'selected' : ''}>XSUAA Client (Auto)</option>
                <option value="local" ${apiAuthMethod === 'local' ? 'selected' : ''}>Local Debug (None)</option>
                <option value="custom" ${apiAuthMethod === 'custom' ? 'selected' : ''}>Custom Token</option>
              </select>
            </label>
          </div>

          <div class="api-params-title">OData Query Parameters</div>
          <div class="api-params-grid">
            ${renderApiParamRow('$select', apiParams.$select, 'Fields to retrieve')}
            ${renderApiParamRow('$filter', apiParams.$filter, 'Filter conditions')}
            ${renderApiParamRow('$expand', apiParams.$expand, 'Expand associations')}
            <div class="api-params-row-flex">
              ${renderApiParamRow('$top', apiParams.$top, 'Max items', 'number')}
              ${renderApiParamRow('$skip', apiParams.$skip, 'Skip offset', 'number')}
            </div>
          </div>

          <div class="api-execute-row">
            <button type="button" class="primary-action api-execute-btn" data-action="api-execute-request" ${apiResultState === 'loading' ? 'disabled' : ''}>
              ${apiResultState === 'loading' ? '<span class="api-spinner"></span> Executing...' : 'Execute GET'}
            </button>
          </div>
        </section>

        <!-- Response Section -->
        <section class="api-response-section" aria-label="API Response">
          <div class="api-response-header">
            <h3>Response</h3>
            ${apiResultState === 'done' ? `
              <div class="api-status-badge is-${apiResultStatus.startsWith('2') ? 'success' : 'error'}">
                ${apiResultStatus}
              </div>
              <div class="api-time-badge">${apiResultTime}ms</div>
            ` : ''}
          </div>

          <div class="api-response-body">
            ${renderApiResponseBody()}
          </div>
        </section>
      </main>
    `;
  }

  appElement.innerHTML = `
    <div class="api-split-layout" style="display: flex; flex-direction: row; height: 100vh; overflow: hidden; margin: 0; padding: 0;">
      ${sidebarHtml}
      ${workbenchHtml}
    </div>
  `;
}

// Action Handler
appElement.addEventListener('click', (event) => {
  const target = event.target;
  const actionElement = target.closest('[data-action]');
  if (!actionElement) return;

  const action = actionElement.dataset.action;

  if (action === 'api-select-entity') {
    apiSelectedEntity = actionElement.dataset.entityName ?? '';
    apiResultState = 'idle';
    apiResultPayload = null;
    renderWebview();
    return;
  }

  if (action === 'api-switch-view') {
    apiActiveView = actionElement.dataset.viewId ?? 'json';
    renderWebview();
    return;
  }

  if (action === 'api-execute-request') {
    apiResultState = 'loading';
    renderWebview();

    const entityName = apiSelectedEntity;
    const methodBadge = document.querySelector('.api-method-badge');
    const method = methodBadge ? methodBadge.textContent.trim() : 'GET';
    const urlInput = document.querySelector('.api-url-display input') || document.querySelector('.api-url-input');
    const url = urlInput ? urlInput.value : '';


    if (vscodeApi) {
      document.body.insertAdjacentHTML('beforeend', '<div id="debug-flag">POST MESSAGE CALLED: ' + method + ' ' + url + '</div>');
      vscodeApi.postMessage({
        type: 'sapTools.apis.executeRequest',
        payload: { url, method, auth: apiAuthMethod }
      });
    } else {
      // Fallback for prototype testing without VS Code extension host
      apiResultState = 'done';
      apiResultStatus = 'Error';
      apiResultPayload = { error: "VS Code API is not available in prototype mode." };
      renderWebview();
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
    renderWebview();
  }
});

// Inputs
appElement.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.dataset.action === 'api-search-entity') {
    const term = target.value.trim().toLowerCase();
    const items = appElement.querySelectorAll('.api-entity-item');
    items.forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
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
      if (urlInput instanceof HTMLInputElement) {
        const currentCatalog = API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
        const routeBase = currentCatalog.baseUrl || `https://demo-env-${apiSelectedAppId}.cfapps.region.hana.ondemand.com`;
        const fullUrl = `${routeBase}${currentCatalog.servicePath}/${apiSelectedEntity}${buildApiQueryString()}`;
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

// Listen to messages from gallery.js for subsequent updates
window.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'sapTools.apis.catalogLoaded') {
    const catalog = event.data.payload;
    if (catalog) {
      // Overwrite the mock catalog with the real data from the backend
      API_MOCK_CATALOG[catalog.name] = {
        name: catalog.name,
        baseUrl: catalog.baseUrl,
        servicePath: '',
        entities: catalog.entities
      };
      
      // If this is the currently selected app, refresh UI
      if (apiSelectedAppId === catalog.name) {
        if (catalog.entities.length > 0) {
          apiSelectedEntity = catalog.entities[0].name;
        } else {
          apiSelectedEntity = '';
        }
        apiResultState = 'idle';
        apiResultPayload = null;
        renderWebview();
      }
    }
  }

  if (event.data.type === 'sapTools.apis.executeResponse') {
    const payload = event.data.payload;
    apiResultState = 'done';
    apiResultTime = payload.time;
    apiResultStatus = payload.status;
    apiResultPayload = payload.data;
    renderWebview();
  }

  if (event.data.type === 'saptools.prototype.apis.appSelected') {
    apiSelectedAppId = event.data.payload.appId;
    
    // Select the first entity automatically if available
    const catalog = API_MOCK_CATALOG[apiSelectedAppId] || API_MOCK_CATALOG['demo-app'];
    if (catalog && catalog.entities.length > 0) {
      apiSelectedEntity = catalog.entities[0].name;
    } else {
      apiSelectedEntity = '';
    }
    
    // Reset state on change
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
