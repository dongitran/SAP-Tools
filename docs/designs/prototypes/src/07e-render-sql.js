function restoreSqlTablesListScrollTop(tablesPanel, scrollTop) {
  const tablesList = tablesPanel.querySelector('[data-role="hana-tables-list"]');
  if (tablesList instanceof HTMLElement && scrollTop > 0) {
    tablesList.scrollTop = scrollTop;
  }
}

function refreshSqlResultPreviewPanel() {
  if (vscodeApi !== null || !isWorkspaceSqlMounted()) {
    return;
  }
  const tabContainer = appElement.querySelector('.workspace-body-sql');
  if (!(tabContainer instanceof HTMLElement)) {
    return;
  }
  const existingPanel = tabContainer.querySelector('[data-role="sql-result-preview-panel"]');
  const markup = renderSqlResultPreviewPanel();
  if (markup.length === 0) {
    existingPanel?.remove();
    return;
  }
  if (existingPanel instanceof HTMLElement) {
    existingPanel.outerHTML = markup;
    return;
  }
  tabContainer.insertAdjacentHTML('beforeend', markup);
}

function updateHanaQueryStatusElement() {
  const statusElement = appElement.querySelector('[data-role="hana-query-status"]');
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }
  const tone = hanaQueryStatusTone === 'error'
    ? 'error'
    : hanaQueryStatusTone === 'success'
      ? 'success'
      : 'info';
  statusElement.className = `hana-query-status is-${tone}`;
  statusElement.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  statusElement.hidden = hanaQueryStatusMessage.length === 0;
  statusElement.textContent = hanaQueryStatusMessage;
}

function buildHanaTableSelectLoadingKey(serviceId, tableName) {
  return `${serviceId}\u0000${tableName}`;
}

function isHanaTableSelectLoading(serviceId, tableName) {
  return hanaTableSelectLoadingKeys.has(buildHanaTableSelectLoadingKey(serviceId, tableName));
}

function setHanaTableSelectLoading(serviceId, tableName, isLoading) {
  const loadingKey = buildHanaTableSelectLoadingKey(serviceId, tableName);
  hanaTableSelectLoadingKeys = new Set(hanaTableSelectLoadingKeys);
  if (isLoading) {
    hanaTableSelectLoadingKeys.add(loadingKey);
  } else {
    hanaTableSelectLoadingKeys.delete(loadingKey);
  }
  updateHanaTableSelectLoadingElement(serviceId, tableName, isLoading);
}

function updateHanaTableSelectLoadingElement(serviceId, tableName, isLoading) {
  const rows = appElement.querySelectorAll('[data-role="hana-table-row"]');
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) {
      continue;
    }
    if (row.dataset.serviceId !== serviceId || row.dataset.tableName !== tableName) {
      continue;
    }
    applyHanaTableSelectLoadingState(row, tableName, isLoading);
    return;
  }
}

function applyHanaTableSelectLoadingState(row, tableName, isLoading) {
  row.classList.toggle('is-select-loading', isLoading);
  const button = row.querySelector('[data-action="run-hana-table-select"]');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  button.classList.toggle('is-loading', isLoading);
  button.disabled = isLoading;
  button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  button.setAttribute(
    'aria-label',
    `${isLoading ? 'Loading' : 'Select'} first 100 rows of ${tableName}`
  );
}


function refreshSqlServiceSearchResults() {
  const workbench = appElement.querySelector('.sql-workbench');
  if (!(workbench instanceof HTMLElement)) {
    refreshWorkspaceSqlView();
    return;
  }

  const serviceList = workbench.querySelector('[data-role="hana-service-list"]');
  if (!(serviceList instanceof HTMLElement)) {
    refreshWorkspaceSqlView();
    return;
  }

  const services = resolveHanaServices();
  const visibleServices = filterHanaServiceRows(services);
  serviceList.innerHTML = renderHanaServiceRows(visibleServices, {
    hasSearchKeyword: sqlAppSearchKeyword.trim().length > 0,
    totalRowCount: services.length,
  });

  const searchInput = workbench.querySelector('[data-role="sql-app-search"]');
  if (searchInput instanceof HTMLInputElement) {
    searchInput.value = sqlAppSearchKeyword;
  }
}

function refreshSqlTableResults() {
  const tablesPanel = appElement.querySelector('[data-role="hana-tables-panel"]');
  if (!(tablesPanel instanceof HTMLElement)) {
    refreshWorkspaceSqlView();
    return;
  }
  const state = resolveSqlTablesPanelState();
  const countElement = tablesPanel.querySelector('[data-role="hana-tables-count"]');
  if (countElement instanceof HTMLElement) {
    countElement.textContent = state.countLabel;
  }
  const tablesList = tablesPanel.querySelector('[data-role="hana-tables-list"]');
  if (tablesList instanceof HTMLElement) {
    tablesList.className = `sql-tables-list${state.listStateClass}`;
    tablesList.innerHTML = state.bodyMarkup;
  }
  queueSqlTableNameTruncation();
}

function queueSqlTableResultsRefresh() {
  if (sqlTableResultsRefreshTimer !== 0) {
    window.clearTimeout(sqlTableResultsRefreshTimer);
  }
  sqlTableResultsRefreshTimer = window.setTimeout(() => {
    sqlTableResultsRefreshTimer = 0;
    refreshSqlTableResults();
  }, 75);
}

function renderPlaceholderTab(tabId) {
  const label = TAB_ITEMS.find((tab) => tab.id === tabId)?.label ?? 'Tab';

  if (tabId === 'settings') {
    return renderSqlWorkbenchTab();
  }

  return `
    <section class="group-card placeholder-tab">
      <h2>${label}</h2>
      <p>This prototype step focuses on the Logs tab. Content for ${label} comes next.</p>
    </section>
  `;
}

function renderSqlWorkbenchTab() {
  const services = resolveHanaServices();
  const visibleServices = filterHanaServiceRows(services);
  const servicesMarkup = renderHanaServiceRows(visibleServices, {
    hasSearchKeyword: sqlAppSearchKeyword.trim().length > 0,
    totalRowCount: services.length,
  });
  const tablesPanelMarkup = renderSqlTablesPanel();

  const tunnelActive = anyHanaTunnelActive();

  return `
    <section class="group-card sql-workbench" aria-label="S/4HANA SQL Workbench">
      <header class="sql-workbench-header">
        <div class="sql-workbench-title-row">
          <h2>S/4HANA SQL Workbench</h2>
          <div class="sql-workbench-title-actions">
            ${renderAppListReloadButton()}
            <span
              class="sql-tunnel-badge"
              data-role="hana-tunnel-indicator"
              title="HANA connections in this workbench are routed through a cf ssh tunnel"
              ${tunnelActive ? '' : 'hidden'}
            >&#128279; Tunnel</span>
          </div>
        </div>
        <label class="sql-app-search-row search-input-with-icon">
          <span class="search-input-icon" aria-hidden="true">&#128269;</span>
          <input
            type="search"
            class="sql-app-search"
            data-role="sql-app-search"
            value="${escapeHtml(sqlAppSearchKeyword)}"
            placeholder="Search apps by name"
            aria-label="Search apps in S/4HANA SQL Workbench"
          />
        </label>
      </header>

      <section class="sql-service-list" data-role="hana-service-list" aria-label="Discovered apps">
        ${servicesMarkup}
      </section>

      ${renderHanaQueryStatus()}
    </section>
    ${tablesPanelMarkup}
    ${renderSqlResultPreviewPanel()}
  `;
}

function renderSqlResultPreviewPanel() {
  if (vscodeApi !== null || hanaSqlResultPreviewState === null) {
    return '';
  }

  if (hanaSqlResultPreviewState.phase === 'loading') {
    return `
      <section class="group-card sql-result-preview-panel" data-role="sql-result-preview-panel" aria-label="SQL result preview">
        <header class="sql-result-preview-toolbar">
          <span class="sql-result-preview-chip">Table: ${escapeHtml(hanaSqlResultPreviewState.tableName)}</span>
          <span class="sql-result-preview-chip">Started: ${escapeHtml(formatSqlResultPreviewTime(hanaSqlResultPreviewState.startedAt))}</span>
        </header>
        <div class="sql-result-preview-loading" role="status" aria-live="polite">
          <span class="sql-result-preview-spinner" aria-hidden="true"></span>
          <span>Running SQL query…</span>
        </div>
      </section>
    `;
  }

  const state = hanaSqlResultPreviewState;
  if (isPrototypeSqlResultBatchState(state)) {
    return renderSqlBatchResultPreviewPanel(state);
  }

  const menuClass = hanaSqlResultExportMenuOpen ? ' is-open' : '';
  return `
    <section class="group-card sql-result-preview-panel" data-role="sql-result-preview-panel" aria-label="SQL result preview">
      <header class="sql-result-preview-toolbar">
        <span class="sql-result-preview-chip">Table: ${escapeHtml(state.tableName)}</span>
        <span class="sql-result-preview-chip">Rows: ${String(state.rows.length)}</span>
        <span class="sql-result-preview-chip">Elapsed: ${String(state.elapsedMs)} ms</span>
        <div class="sql-result-export-menu${menuClass}">
          <button
            type="button"
            class="sql-result-export-trigger"
            data-action="toggle-sql-result-export-menu"
            aria-haspopup="menu"
            aria-expanded="${hanaSqlResultExportMenuOpen ? 'true' : 'false'}"
          >
            Export result
          </button>
          <div class="sql-result-export-list" role="menu">
            <button type="button" role="menuitem" data-action="copy-sql-result-csv">Copy CSV</button>
            <button type="button" role="menuitem" data-action="copy-sql-result-json">Copy JSON</button>
            <button type="button" role="menuitem" data-action="export-sql-result-csv">Export CSV</button>
            <button type="button" role="menuitem" data-action="export-sql-result-json">Export JSON</button>
          </div>
        </div>
      </header>
      <div class="sql-result-preview-table-wrap">
        ${renderSqlResultPreviewTable(state)}
      </div>
      ${renderSqlResultContextMenu()}
    </section>
  `;
}

function renderSqlBatchResultPreviewPanel(state) {
  return `
    <section class="group-card sql-result-preview-panel sql-result-batch-preview" data-role="sql-result-preview-panel" aria-label="SQL result preview">
      <div class="sql-result-batch-sections">
        ${state.statements.map(renderSqlResultBatchStatementSection).join('')}
      </div>
      ${renderSqlResultContextMenu()}
    </section>
  `;
}

function renderSqlResultBatchStatementSection(statement, index, statements) {
  const tableName = statement.tableName ?? 'SQL statement';
  return `
    <section class="sql-result-statement-section is-${escapeHtml(statement.status)}" data-statement-index="${String(index)}">
      <header class="sql-result-statement-header">
        <span class="sql-result-statement-title">Statement ${String(index + 1)} / ${String(statements.length)}</span>
        ${renderSqlResultStatementStatusChip(statement.status)}
        <span class="sql-result-preview-chip">Table: ${escapeHtml(tableName)}</span>
      </header>
      <div class="sql-result-statement-body">
        ${renderSqlResultBatchStatementBody(statement, index)}
      </div>
    </section>
  `;
}

function renderSqlResultStatementStatusChip(status) {
  if (status === 'success') {
    return '<span class="sql-result-preview-chip is-success">Success</span>';
  }
  if (status === 'error') {
    return '<span class="sql-result-preview-chip is-error">Failed</span>';
  }
  if (status === 'skipped') {
    return '<span class="sql-result-preview-chip is-muted">Skipped</span>';
  }
  return '<span class="sql-result-preview-chip">Pending</span>';
}

function renderSqlResultBatchStatementBody(statement, statementIndex) {
  if (statement.status === 'success' && Array.isArray(statement.rows)) {
    return `<div class="sql-result-preview-table-wrap">${renderSqlResultPreviewTable(statement, statementIndex)}</div>`;
  }
  if (statement.status === 'error') {
    return renderSqlResultStatementState('Execution Error', statement.errorMessage ?? 'Query execution failed.', statement.sql);
  }
  if (statement.status === 'skipped') {
    return renderSqlResultStatementState('Skipped', 'Skipped due to a preceding statement failure. The transaction was rolled back.', statement.sql);
  }
  return '<div class="sql-result-preview-loading is-compact" role="status"><span class="sql-result-preview-spinner" aria-hidden="true"></span><span>Queued...</span></div>';
}

function renderSqlResultStatementState(title, message, sql) {
  return `
    <section class="sql-result-statement-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      <pre>${escapeHtml(sql)}</pre>
    </section>
  `;
}

function renderSqlResultPreviewTable(state, statementIndex = null) {
  const headerCells = [
    '<th class="sql-result-row-number">#</th>',
    ...state.columns.map((column) => `<th>${escapeHtml(column)}</th>`),
  ].join('');
  const statementAttribute = Number.isInteger(statementIndex)
    ? ` data-statement-index="${String(statementIndex)}"`
    : '';
  const bodyRows = state.rows
    .map((row, rowIndex) => {
      const cells = state.columns
        .map((_, columnIndex) => {
          return `<td data-role="sql-result-cell" data-row-index="${String(rowIndex)}" data-column-index="${String(columnIndex)}"${statementAttribute}>${escapeHtml(row[columnIndex] ?? '')}</td>`;
        })
        .join('');
      return `<tr data-role="sql-result-row" data-row-index="${String(rowIndex)}"><td class="sql-result-row-number">${String(rowIndex + 1)}</td>${cells}</tr>`;
    })
    .join('');

  return `
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function renderSqlResultContextMenu() {
  if (hanaSqlResultContextMenuState === null) {
    return '';
  }
  const left = Math.max(8, Math.round(hanaSqlResultContextMenuState.x));
  const top = Math.max(8, Math.round(hanaSqlResultContextMenuState.y));
  return `
    <div
      class="sql-result-context-menu"
      data-role="sql-result-context-menu"
      role="menu"
      style="left: ${String(left)}px; top: ${String(top)}px;"
    >
      <button type="button" role="menuitem" data-action="copy-sql-result-row-object">Copy row object</button>
      <button type="button" role="menuitem" data-action="copy-sql-result-cell-value">Copy cell value</button>
    </div>
  `;
}

function formatSqlResultPreviewTime(value) {
  return value.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

function renderHanaServiceRows(services, options = { hasSearchKeyword: false, totalRowCount: 0 }) {
  if (services.length === 0) {
    if (options.hasSearchKeyword && options.totalRowCount > 0) {
      return '<p class="logs-empty-message">No apps match current search.</p>';
    }
    return '<p class="logs-empty-message">No apps found in current space.</p>';
  }

  return services
    .map((service) => {
      const isSelected = service.id === selectedHanaServiceId;
      return `
        <button
          type="button"
          class="sql-service-row${isSelected ? ' is-selected' : ''}"
          data-action="select-hana-service"
          data-service-id="${escapeHtml(service.id)}"
          aria-pressed="${isSelected}"
        >
          <span class="sql-service-name">${escapeHtml(service.name)}</span>
          <span class="sql-service-open-indicator" aria-hidden="true">&gt;</span>
        </button>
      `;
    })
    .join('');
}

/** Whether any app in the current scope has its HANA connection tunneled. */
function anyHanaTunnelActive() {
  for (const active of hanaTunnelByServiceId.values()) {
    if (active === true) {
      return true;
    }
  }
  return false;
}

/**
 * Reflect tunnel state without a full re-render: toggle the single tunnel badge
 * shown beside the "S/4HANA SQL Workbench" title. Tunnel state no longer affects
 * individual service rows, so the list is not re-rendered here.
 */
function refreshSqlTunnelIndicators() {
  const workbench = appElement.querySelector('.sql-workbench');
  if (!(workbench instanceof HTMLElement)) {
    return;
  }
  const indicator = workbench.querySelector('[data-role="hana-tunnel-indicator"]');
  if (indicator instanceof HTMLElement) {
    indicator.hidden = !anyHanaTunnelActive();
  }
}

function renderHanaQueryStatus() {
  const hidden = hanaQueryStatusMessage.length === 0 ? 'hidden' : '';
  const tone = hanaQueryStatusTone === 'error'
    ? 'error'
    : hanaQueryStatusTone === 'success'
      ? 'success'
      : 'info';
  return `
    <p
      class="hana-query-status is-${tone}"
      data-role="hana-query-status"
      role="${tone === 'error' ? 'alert' : 'status'}"
      aria-live="polite"
      ${hidden}
    >
      ${escapeHtml(hanaQueryStatusMessage)}
    </p>
  `;
}

function renderSqlTablesPanel() {
  const state = resolveSqlTablesPanelState();
  const selectedService = state.selectedService;
  const searchDisabled = selectedService === undefined ? 'disabled' : '';

  return `
    <section
      class="group-card sql-tables-panel"
      data-role="hana-tables-panel"
      data-service-id="${escapeHtml(state.selectedServiceId)}"
      aria-label="Tables for selected app"
    >
      <header class="sql-tables-head">
        <h3>${selectedService === undefined ? 'Tables' : `Tables · ${escapeHtml(selectedService.name)}`}</h3>
        <span class="sql-tables-count" data-role="hana-tables-count">${escapeHtml(state.countLabel)}</span>
        <button
          type="button"
          class="sql-tables-refresh-button"
          data-role="hana-tables-refresh"
          data-action="refresh-hana-tables"
          title="Refresh tables from HANA"
          aria-label="Refresh tables from HANA"
          ${selectedService === undefined ? 'disabled' : ''}
        >&#10227;</button>
      </header>
      <label class="sql-table-search-row search-input-with-icon">
        <span class="search-input-icon" aria-hidden="true">&#128269;</span>
        <input
          type="search"
          class="sql-table-search"
          data-role="sql-table-search"
          value="${escapeHtml(sqlTableSearchKeyword)}"
          placeholder="${selectedService === undefined ? 'Select app to search tables…' : 'Search tables…'}"
          aria-label="Search tables"
          ${searchDisabled}
        />
      </label>
      <div class="sql-tables-list${state.listStateClass}" data-role="hana-tables-list">
        ${state.bodyMarkup}
      </div>
    </section>
  `;
}

function resolveSqlTablesPanelState() {
  const selectedService = resolveSelectedHanaService();
  const selectedServiceId = selectedService?.id ?? '';
  const loadingState =
    selectedService === undefined
      ? 'unselected'
      : hanaTablesLoadingByServiceId.get(selectedService.id) ?? 'idle';
  const tables =
    selectedService === undefined ? [] : hanaTablesByServiceId.get(selectedService.id) ?? [];
  const filteredTables = filterSqlTableRows(tables);
  const hasTableSearch = sqlTableSearchKeyword.trim().length > 0;
  const countLabel =
    hasTableSearch && filteredTables.length !== tables.length
      ? `${String(filteredTables.length)}/${String(tables.length)}`
      : String(tables.length);
  const bodyState = renderSqlTablesBodyState(
    selectedService,
    loadingState,
    tables,
    filteredTables
  );

  return {
    bodyMarkup: bodyState.bodyMarkup,
    countLabel,
    listStateClass: bodyState.listStateClass,
    selectedService,
    selectedServiceId,
  };
}

function renderSqlTablesBodyState(selectedService, loadingState, tables, filteredTables) {
  if (loadingState === 'unselected') {
    return {
      bodyMarkup: `<p class="sql-tables-empty" data-role="hana-tables-empty">Select an app above to load tables.</p>`,
      listStateClass: '',
    };
  }
  if (loadingState === 'loading' || (loadingState === 'idle' && tables.length === 0)) {
    return { bodyMarkup: renderSqlTablesLoadingState(), listStateClass: ' is-loading' };
  }
  if (loadingState === 'error') {
    const errorMessage = hanaTablesErrorByServiceId.get(selectedService.id) ?? '';
    return {
      bodyMarkup: `
        <p class="sql-tables-empty sql-tables-error" data-role="hana-tables-error">
          ${escapeHtml(errorMessage.length > 0 ? errorMessage : 'Failed to load tables.')}
        </p>
      `,
      listStateClass: '',
    };
  }
  if (tables.length === 0) {
    return {
      bodyMarkup: `<p class="sql-tables-empty" data-role="hana-tables-empty">No tables found in current schema.</p>`,
      listStateClass: '',
    };
  }
  if (filteredTables.length === 0) {
    return {
      bodyMarkup: `<p class="sql-tables-empty" data-role="hana-tables-empty">No tables match current search.</p>`,
      listStateClass: '',
    };
  }
  return {
    bodyMarkup: renderHanaTableRows(selectedService.id, filteredTables),
    listStateClass: '',
  };
}

function renderSqlTablesLoadingState() {
  return `
    <div class="sql-tables-loading" data-role="hana-tables-loading" role="status" aria-live="polite">
      <span class="sql-tables-spinner" aria-hidden="true"></span>
      <span>Loading tables…</span>
    </div>
  `;
}

function filterSqlTableRows(tables) {
  const keyword = sqlTableSearchKeyword.trim().toLowerCase();
  if (keyword.length === 0) {
    return tables;
  }
  return tables.filter((tableEntry) => {
    const rawName = tableEntry.name.toLowerCase();
    const displayName = tableEntry.displayName.toLowerCase();
    const compactDisplayName = displayName.replaceAll('_', '').toLowerCase();
    return (
      rawName.includes(keyword) ||
      displayName.includes(keyword) ||
      compactDisplayName.includes(keyword)
    );
  });
}

function renderHanaTableRows(serviceId, tables) {
  return tables
    .map((tableEntry) => {
      const tableName = tableEntry.name;
      const displayName = tableEntry.displayName;
      const displayNameParts = splitSqlTableDisplayName(displayName);
      return `
        <div
          class="sql-table-row${isHanaTableSelectLoading(serviceId, tableName) ? ' is-select-loading' : ''}"
          data-role="hana-table-row"
          data-service-id="${escapeHtml(serviceId)}"
          data-table-name="${escapeHtml(tableName)}"
          data-display-table-name="${escapeHtml(displayName)}"
          data-full-table-name="${escapeHtml(tableName)}"
          title="${escapeHtml(tableName)}"
          aria-label="Table ${escapeHtml(tableName)}"
        >
          <span
            class="sql-table-name"
            data-role="hana-table-name"
            data-full-display-name="${escapeHtml(displayName)}"
            title="${escapeHtml(tableName)}"
          >
            <span class="sql-table-name-full">${escapeHtml(displayName)}</span>
            <span class="sql-table-name-middle" aria-hidden="true">
              <span class="sql-table-name-head">${escapeHtml(displayNameParts.head)}</span>
              <span class="sql-table-name-ellipsis">…</span>
              <span class="sql-table-name-tail">
                <span class="sql-table-name-tail-text">${escapeHtml(displayNameParts.tail)}</span>
              </span>
            </span>
          </span>
          <button
            type="button"
            class="sql-table-select-btn"
            data-action="run-hana-table-select"
            data-service-id="${escapeHtml(serviceId)}"
            data-table-name="${escapeHtml(tableName)}"
            aria-label="${isHanaTableSelectLoading(serviceId, tableName) ? 'Loading' : 'Select'} first 100 rows of ${escapeHtml(tableName)}"
            aria-busy="${isHanaTableSelectLoading(serviceId, tableName) ? 'true' : 'false'}"
            ${isHanaTableSelectLoading(serviceId, tableName) ? 'disabled' : ''}
          >
            <span class="sql-table-select-spinner" aria-hidden="true"></span>
            <span>Select</span>
          </button>
        </div>
      `;
    })
    .join('');
}

function splitSqlTableDisplayName(displayName) {
  const middleIndex = Math.ceil(displayName.length / 2);
  return {
    head: displayName.slice(0, middleIndex),
    tail: displayName.slice(middleIndex),
  };
}

function queueSqlTableNameTruncation() {
  if (sqlTableNameTruncationFrame !== 0) {
    return;
  }

  sqlTableNameTruncationFrame = window.requestAnimationFrame(() => {
    sqlTableNameTruncationFrame = 0;
    refreshSqlTableNameTruncation();
  });
}

function refreshSqlTableNameTruncation() {
  const tablesPanel = appElement.querySelector('[data-role="hana-tables-panel"]');
  const tableNameElements = appElement.querySelectorAll(
    '[data-role="hana-table-name"][data-full-display-name]'
  );
  const nextPanelWidth =
    tablesPanel instanceof HTMLElement
      ? Math.round(tablesPanel.getBoundingClientRect().width)
      : -1;
  const hasUnmeasuredName = Array.from(tableNameElements).some((element) => {
    return element instanceof HTMLElement && element.dataset.fullDisplayWidth === undefined;
  });
  if (nextPanelWidth === sqlTableNamePanelWidth && !hasUnmeasuredName) {
    return;
  }
  sqlTableNamePanelWidth = nextPanelWidth;

  for (const element of tableNameElements) {
    if (element instanceof HTMLElement) {
      refreshSqlTableNameOverflowState(element);
    }
  }
}

function refreshSqlTableNameOverflowState(element) {
  const fullDisplayName = element.dataset.fullDisplayName ?? '';
  if (fullDisplayName.length === 0) {
    return;
  }
  const fullDisplayWidth = resolveSqlTableNameFullWidth(element, fullDisplayName);
  const isOverflowing =
    fullDisplayWidth > element.clientWidth + SQL_TABLE_NAME_WIDTH_TOLERANCE;
  element.classList.toggle('is-middle-truncated', isOverflowing);
}

function resolveSqlTableNameFullWidth(element, fullDisplayName) {
  const cachedWidth = Number.parseFloat(element.dataset.fullDisplayWidth ?? '');
  if (Number.isFinite(cachedWidth) && cachedWidth > 0) {
    return cachedWidth;
  }

  const measureContext = resolveSqlTableNameMeasureContext();
  const fullDisplayWidth =
    measureContext === null
      ? element.scrollWidth
      : measureSqlTableDisplayNameWidth(element, fullDisplayName, measureContext);
  element.dataset.fullDisplayWidth = String(Math.ceil(fullDisplayWidth));
  return fullDisplayWidth;
}

function resolveSqlTableNameMeasureContext() {
  if (sqlTableNameMeasureContext !== null) {
    return sqlTableNameMeasureContext;
  }

  const canvas = document.createElement('canvas');
  sqlTableNameMeasureContext = canvas.getContext('2d');
  return sqlTableNameMeasureContext;
}

function measureSqlTableDisplayNameWidth(element, fullDisplayName, measureContext) {
  const styles = window.getComputedStyle(element);
  measureContext.font =
    styles.font.length > 0
      ? styles.font
      : `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
  return measureContext.measureText(fullDisplayName).width;
}

const HANA_TABLE_ACRONYMS = new Set([
  'API',
  'CAP',
  'CDS',
  'FI',
  'GL',
  'HANA',
  'I',
  'ID',
  'M',
  'SAP',
  'S4HANA',
  'UAT',
  'UUID',
]);

const HANA_TABLE_SEGMENT_OVERRIDES = new Map([
  ['DEMO', 'Demo'],
  ['PURCHASEORDERITEMMAPPING', 'PurchaseOrderItemMapping'],
  ['BUSINESSPARTNERBANK', 'BusinessPartnerBank'],
  ['DRAFTADMINISTRATIVEDATA', 'DraftAdministrativeData'],
  ['GENERALLEDGERACCOUNTINGDOCUMENTITEM', 'GeneralLedgerAccountingDocumentItem'],
  ['SUPPLIERINVOICEPAYMENTBLOCKREASON', 'SupplierInvoicePaymentBlockReason'],
]);

const HANA_TABLE_WORDS = [
  'administrative',
  'allocation',
  'accounting',
  'business',
  'customer',
  'document',
  'supplier',
  'projection',
  'reconciliation',
  'namespace',
  'order',
  'purchase',
  'partner',
  'payment',
  'service',
  'general',
  'history',
  'invoice',
  'mapping',
  'nested',
  'reason',
  'ledger',
  'entity',
  'input',
  'block',
  'draft',
  'table',
  'tables',
  'orders',
  'items',
  'audit',
  'test',
  'dummy',
  'data',
  'demo',
  'app',
  'bank',
  'item',
  'very',
  'long',
  'with',
  'for',
  'to',
  'com',
].sort((left, right) => right.length - left.length);

function normalizeHanaTableEntries(entries) {
  return entries
    .map((entry) => normalizeHanaTableEntry(entry))
    .filter((entry) => entry !== null);
}

function normalizeHanaTableEntry(entry) {
  if (typeof entry === 'string') {
    return {
      displayName: formatReadableHanaTableName(entry),
      name: entry,
    };
  }
  if (!isRecord(entry) || typeof entry.name !== 'string') {
    return null;
  }
  const name = entry.name.trim();
  if (name.length === 0) {
    return null;
  }
  const displayName =
    typeof entry.displayName === 'string' && entry.displayName.trim().length > 0
      ? entry.displayName.trim()
      : formatReadableHanaTableName(name);
  return { displayName, name };
}

function formatReadableHanaTableName(tableName) {
  const cachedName = hanaTableDisplayNameCache.get(tableName);
  if (cachedName !== undefined) {
    return cachedName;
  }
  const displayName = tableName
    .split('_')
    .map((segment) => formatReadableHanaTableSegment(segment))
    .join('_');
  hanaTableDisplayNameCache.set(tableName, displayName);
  return displayName;
}

function formatReadableHanaTableSegment(segment) {
  const normalizedSegment = segment.trim();
  if (normalizedSegment.length === 0 || /^\d+$/.test(normalizedSegment)) {
    return normalizedSegment;
  }
  const upperSegment = normalizedSegment.toUpperCase();
  if (HANA_TABLE_ACRONYMS.has(upperSegment)) {
    return upperSegment;
  }
  const overriddenSegment = HANA_TABLE_SEGMENT_OVERRIDES.get(upperSegment);
  if (overriddenSegment !== undefined) {
    return overriddenSegment;
  }
  if (/\d/.test(normalizedSegment)) {
    return normalizedSegment;
  }
  const words = splitReadableHanaTableWords(normalizedSegment.toLowerCase());
  if (!shouldUseReadableHanaTableWords(normalizedSegment, words)) {
    return `${normalizedSegment.charAt(0).toUpperCase()}${normalizedSegment.slice(1).toLowerCase()}`;
  }
  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join('');
}

function splitReadableHanaTableWords(lowerSegment) {
  const words = [];
  let cursor = 0;
  while (cursor < lowerSegment.length) {
    const matchedWord = HANA_TABLE_WORDS.find((word) => lowerSegment.startsWith(word, cursor));
    if (matchedWord === undefined) {
      words.push(lowerSegment.slice(cursor));
      break;
    }
    words.push(matchedWord);
    cursor += matchedWord.length;
  }
  return words;
}

function shouldUseReadableHanaTableWords(segment, words) {
  if (words.length === 0) {
    return false;
  }
  if (words.join('') !== segment.toLowerCase()) {
    return false;
  }
  return !words.every((word) => word.length === 1);
}
