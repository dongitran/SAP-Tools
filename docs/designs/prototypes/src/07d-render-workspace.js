function renderWorkspaceScreen() {
  const selectedRegion = resolveSelectedRegion();
  const selectedSpace = selectedSpaceId.length > 0 ? selectedSpaceId : 'No space selected';
  const regionCode = selectedRegion?.code ?? 'no-region';
  const orgLabel = resolveSelectedOrgName() || 'No org selected';
  const workspaceSummary = `Region: ${regionCode}. Org: ${orgLabel}. Space: ${selectedSpace}`;
  const workspaceBodyClass =
    activeTabId === 'settings' ? 'workspace-body workspace-body-sql' : 'workspace-body';

  return `
    <header class="shell-header workspace-header">
      <div class="shell-header-row">
        <h1>Monitoring Workspace</h1>
        <div class="workspace-header-actions">
          <button
            type="button"
            class="secondary-action workspace-change-region"
            data-action="change-region"
          >
            Change Region
          </button>
          <button
            type="button"
            class="header-icon-button"
            data-action="open-settings"
            aria-label="Open Settings"
            title="Settings"
          >
            &#9881;
          </button>
        </div>
      </div>
      <p class="workspace-context">${workspaceSummary}</p>
    </header>

    ${renderWorkspaceTabs()}

    <section class="${workspaceBodyClass}">
      ${renderWorkspaceTabContent()}
    </section>

    <footer class="workspace-footer">
      <span data-role="workspace-last-sync">Last sync: ${lastSyncLabel}</span>
    </footer>
  `;
}

function renderWorkspaceTabs() {
  const tabsMarkup = TAB_ITEMS.map((tab) => {
    const isActive = tab.id === activeTabId;
    return `
      <button
        type="button"
        class="tab-button${isActive ? ' is-active' : ''}"
        data-action="switch-tab"
        data-tab-id="${tab.id}"
        role="tab"
        aria-selected="${isActive}"
      >
        ${tab.label}
      </button>
    `;
  }).join('');

  return `<nav class="workspace-tabs" role="tablist">${tabsMarkup}</nav>`;
}

function renderWorkspaceTabContent() {
  if (activeTabId === 'logs') {
    return renderLogsTab();
  }

  if (activeTabId === 'apps') {
    return renderServiceExportTab();
  }

  return renderPlaceholderTab(activeTabId);
}

function renderLogsTab() {
  const availableApps = resolveCurrentSpaceApps();
  const visibleApps = filterLoggableCatalogApps(filterAppCatalogRows(availableApps));
  const selectedApps = new Set(selectedAppLogIds);
  const activeApps = new Set(activeAppLogIds);
  const startableSelectionCount = getStartableSelectionCount(activeApps);
  const spaceLabel = selectedSpaceId.length > 0 ? selectedSpaceId : 'current-space';
  const catalogMarkup = renderCatalogByState(visibleApps, selectedApps, activeApps);
  const activeAppsMarkup = renderActiveAppsLogList(availableApps, activeApps);
  const statusMarkup =
    statusMessage.length === 0
      ? '<p class="status-note" data-role="app-log-status" hidden></p>'
      : `<p class="status-note" data-role="app-log-status">${escapeHtml(statusMessage)}</p>`;

  return `
    <section class="group-card logs-panel app-logs-panel">
      <section class="active-apps-log" aria-label="Active apps log">
        <h3>Active Apps Log</h3>
        <div data-role="active-app-log-list">${activeAppsMarkup}</div>
      </section>
      <h2>Apps Log Control</h2>
      <p class="logs-intro">Select app(s) in <strong>${escapeHtml(spaceLabel)}</strong> to stream logs.</p>
      <label class="app-log-search-row search-input-with-icon">
        <span class="search-input-icon" aria-hidden="true">&#128269;</span>
        <input
          type="search"
          class="app-log-search"
          data-role="app-log-search"
          value="${escapeHtml(appCatalogSearchKeyword)}"
          placeholder="Search services by name"
          aria-label="Search services in Apps Log Control"
        />
      </label>
      <section class="app-log-catalog" aria-label="Apps in selected space" data-role="app-log-catalog">
        ${catalogMarkup}
      </section>
      <div class="toolbar-row" role="group" aria-label="App log actions">
        <button
          type="button"
          class="primary-action app-log-start"
          data-action="start-app-logging"
          ${startableSelectionCount === 0 || !isAppsCatalogReady() ? 'disabled' : ''}
        >
          Start App Logging
        </button>
      </div>
      ${statusMarkup}
    </section>
  `;
}

function renderServiceExportTab() {
  const availableApps = resolveCurrentSpaceApps();
  const mappingRows = resolveServiceExportRows(availableApps);
  const filteredMappingRows = filterServiceExportRows(mappingRows);
  const selectedMapping = mappingRows.find(
    (mapping) => mapping.appId === selectedServiceExportAppId && mapping.isMapped
  );
  const selectedSpaceLabel =
    selectedSpaceId.length > 0 ? selectedSpaceId : 'Select a space first';
  const selectedServiceLabel =
    selectedMapping === undefined ? 'No service selected' : selectedMapping.appName;
  const canExport = selectedMapping !== undefined && !serviceExportInProgress;
  const hasSearchKeyword = serviceExportSearchKeyword.trim().length > 0;

  return `
    <section class="group-card service-export-tab" aria-label="Service artifact export">
      <header class="service-export-header">
        <h2>
          Services & Packages
          ${renderRegistryBadge()}
        </h2>
      </header>

      <section class="service-export-root-row">
        <p
          class="service-export-path"
          data-role="service-export-path"
          title="${escapeHtml(localServiceRootFolderPath)}"
        >
          Root: ${escapeHtml(localServiceRootFolderPath.length > 0 ? localServiceRootFolderPath : 'Not selected')}
        </p>
        <button
          type="button"
          class="secondary-action service-export-select-root"
          data-action="select-local-root-folder"
          ${serviceExportInProgress ? 'disabled' : ''}
        >
          Select Root Folder
        </button>
      </section>

      <label class="service-export-search-row search-input-with-icon">
        <span class="search-input-icon" aria-hidden="true">&#128269;</span>
        <input
          type="search"
          class="service-export-search"
          data-role="service-export-search"
          value="${escapeHtml(serviceExportSearchKeyword)}"
          placeholder="Search services or mapped paths"
          aria-label="Search services in Services & Packages"
        />
      </label>

      <section
        class="service-mapping-list"
        data-role="service-mapping-list"
        aria-label="Service folder mappings"
      >
        ${
          serviceFolderScanInProgress
            ? '<p class="stage-loading" aria-live="polite">Scanning local folders&#8230;</p>'
            : renderServiceExportMappingRows(filteredMappingRows, {
              hasSearchKeyword,
              totalRowCount: mappingRows.length,
            })
        }
      </section>

      ${renderDetectedPackagesList()}

      <div class="toolbar-row service-export-actions" role="group" aria-label="Service export actions">
        <button
          type="button"
          class="primary-action service-export-button"
          data-action="export-service-artifacts"
          ${canExport ? '' : 'disabled'}
        >
          Export Artifacts
        </button>
      </div>

      ${renderServiceExportStatus()}
    </section>
  `;
}

function renderRegistryBadge() {
  if (localRegistryInstalling) {
    return `<span class="registry-badge is-installing" data-role="registry-badge" aria-label="Registry installing">Installing…</span>`;
  }
  if (localRegistryRunning) {
    return `<span class="registry-badge is-running" data-role="registry-badge" title="${escapeHtml(localRegistryUrl)}" aria-label="Registry running">● Registry</span>`;
  }
  return '';
}

function renderDetectedPackagesList() {
  if (localServiceRootFolderPath.length === 0) {
    return '';
  }
  return `
    <section class="detected-packages" data-role="detected-packages" aria-label="Detected npm packages">
      ${renderDetectedPackagesInner()}
    </section>
  `;
}

function updateSinglePackageBuildUI(pkgName) {
  const li = document.querySelector(`li[data-pkg-name="${CSS.escape(pkgName)}"]`);
  if (li) {
    const isBuilding = buildingPackageName === pkgName;
    const hasResult = buildResultPackageName === pkgName;
    const pkg = detectedPackages.find((p) => p.name === pkgName);
    
    let actionCell;
    if (hasResult) {
      if (buildResultSuccess) {
        actionCell = `<span class="detected-pkg-result is-success" title="${escapeHtml(buildResultMessage)}">✓ Published</span>`;
      } else {
        actionCell = `<button
          type="button"
          class="detected-pkg-error-icon"
          data-action="copy-build-error"
          data-error="${escapeHtml(buildResultMessage)}"
          title="${escapeHtml(buildResultMessage)}"
          aria-label="Build error – click to copy"
        >⚠</button>`;
      }
    } else if (isBuilding) {
      actionCell = `<span class="detected-pkg-state is-building" aria-busy="true"><span class="detected-pkg-spinner" aria-hidden="true"></span>Building…</span>`;
    } else {
      actionCell = `<button
        type="button"
        class="small-action detected-pkg-single-build"
        data-action="build-single-package"
        data-package="${escapeHtml(pkgName)}"
        title="Build & publish ${escapeHtml(pkgName)}"
      >Build</button>`;
    }
    
    li.className = 'detected-pkg' + (isBuilding ? ' is-building' : '') + (hasResult ? ' is-result' : '');
    
    if (li.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const roundLabel = pkg && typeof pkg.round === 'number' ? `${String(pkg.round + 1)}` : '—';
    li.innerHTML = `
      <span class="detected-pkg-order" title="Build order">#${escapeHtml(roundLabel)}</span>
      <span class="detected-pkg-name" title="${escapeHtml(pkgName)}">${escapeHtml(pkgName)}</span>
      ${actionCell}
    `;
  }
  
  const buildAllBtn = document.querySelector('.detected-packages-build');
  if (buildAllBtn instanceof HTMLButtonElement) {
    if (buildPublishInProgress) {
      buildAllBtn.disabled = true;
      const total = detectedPackages.length;
      const pct = total > 0 ? Math.round((buildPublishCompletedCount / total) * 100) : 0;
      buildAllBtn.innerHTML = `<span class="detected-pkg-spinner" aria-hidden="true" style="width:10px;height:10px;border-width:2px;flex-shrink:0"></span>Build All – ${String(pct)}%`;
    } else {
      buildAllBtn.disabled = false;
      buildAllBtn.textContent = 'Build All';
    }
  }
}

function renderDetectedPackagesInner() {
  const loadingIndicator = detectedPackagesLoading
    ? '<span class="sql-tables-spinner" aria-hidden="true" title="Scanning..."></span>'
    : '';

  const configureButton = `
    <button
      type="button"
      class="small-action detected-packages-config"
      data-action="open-local-packages-settings"
      title="Configure local packages settings"
      ${detectedPackagesLoading ? 'disabled' : ''}
    >Configure</button>`;

  if (!detectedPackagesConfigured) {
    return `
      <div class="detected-packages-head">
        <span class="detected-packages-title">
          Packages
          ${loadingIndicator}
        </span>
        <span class="detected-packages-actions">${configureButton}</span>
      </div>
      <p class="detected-packages-empty">Set a detection regex (<code>sapTools.localPackages.namePatterns</code>) to list packages here.</p>
    `;
  }

  const count = detectedPackages.length;
  let body;
  if (detectedPackagesError.length > 0) {
    body = `<p class="detected-packages-empty is-error">${escapeHtml(detectedPackagesError)}</p>`;
  } else if (count === 0) {
    // If loading and empty, just let the title spinner indicate progress, no need for "Scanning..." text.
    body = '<p class="detected-packages-empty">No packages matched the regex under the root folder.</p>';
  } else {
    const rows = detectedPackages
      .slice()
      .sort(
        (left, right) =>
          roundOrInfinity(left) - roundOrInfinity(right) ||
          left.name.localeCompare(right.name)
      )
      .map((pkg) => {
        const roundLabel = typeof pkg.round === 'number' ? `${String(pkg.round + 1)}` : '—';
        const isBuilding = buildingPackageName === pkg.name;
        const hasResult = buildResultPackageName === pkg.name;

        let actionCell;
        if (hasResult) {
          if (buildResultSuccess) {
            actionCell = `<span class="detected-pkg-result is-success" title="${escapeHtml(buildResultMessage)}">✓ Published</span>`;
          } else {
            actionCell = `<button
              type="button"
              class="detected-pkg-error-icon"
              data-action="copy-build-error"
              data-error="${escapeHtml(buildResultMessage)}"
              title="${escapeHtml(buildResultMessage)}"
              aria-label="Build error – click to copy"
            >⚠</button>`;
          }
        } else if (isBuilding) {
          actionCell = `<span class="detected-pkg-state is-building" aria-busy="true"><span class="detected-pkg-spinner" aria-hidden="true"></span>Building…</span>`;
        } else {
          actionCell = `<button
            type="button"
            class="small-action detected-pkg-single-build"
            data-action="build-single-package"
            data-package="${escapeHtml(pkg.name)}"
            title="Build & publish ${escapeHtml(pkg.name)}"
          >Build</button>`;
        }

        const rowClass =
          'detected-pkg' +
          (isBuilding ? ' is-building' : '') +
          (hasResult ? ' is-result' : '');
        return `
          <li class="${rowClass}" data-pkg-name="${escapeHtml(pkg.name)}">
            <span class="detected-pkg-order" title="Build order">#${escapeHtml(roundLabel)}</span>
            <span class="detected-pkg-name" title="${escapeHtml(pkg.name)}">${escapeHtml(pkg.name)}</span>
            ${actionCell}
          </li>`;
      })
      .join('');
    body = `<ol class="detected-pkg-list">${rows}</ol>`;
  }

  const buildAllButton =
    count > 0
      ? (() => {
          if (buildPublishInProgress) {
            const total = count;
            const pct = total > 0 ? Math.round((buildPublishCompletedCount / total) * 100) : 0;
            return `<button
                type="button"
                class="small-action detected-packages-build"
                data-action="build-publish-all"
                title="Build &amp; publish all detected packages to the local registry, in dependency order"
                disabled
              ><span class="detected-pkg-spinner" aria-hidden="true" style="width:10px;height:10px;border-width:2px;flex-shrink:0"></span>Build All – ${String(pct)}%</button>`;
          }
          return `<button
              type="button"
              class="small-action detected-packages-build"
              data-action="build-publish-all"
              title="Build &amp; publish all detected packages to the local registry, in dependency order"
            >Build All</button>`;
        })()
      : '';

  // Build All keeps a compact result line inside the package list (the old
  // "Build & Publish" panel below Export Artifacts was removed). Per-package
  // single builds report inline on their own row instead.
  const buildAllResult =
    buildResultPackageName.length === 0 && buildPublishResultMessage.length > 0
      ? `<p class="detected-packages-result tone-${escapeHtml(buildPublishResultTone)}">${escapeHtml(buildPublishResultMessage)}</p>`
      : '';

  return `
    <div class="detected-packages-head">
      <span class="detected-packages-title">
        Packages (${String(count)})
        ${loadingIndicator}
      </span>
      <span class="detected-packages-actions">
        ${buildAllButton}
        ${configureButton}
      </span>
    </div>
    ${body}
    ${buildAllResult}
  `;
}

function roundOrInfinity(pkg) {
  return typeof pkg.round === 'number' ? pkg.round : Number.MAX_SAFE_INTEGER;
}

function renderServiceExportMappingRows(
  mappingRows,
  options = { hasSearchKeyword: false, totalRowCount: 0 }
) {
  if (mappingRows.length === 0) {
    if (options.hasSearchKeyword && options.totalRowCount > 0) {
      return '<p class="logs-empty-message">No services match current search.</p>';
    }
    if (!isAppsCatalogReady()) {
      return '<p class="stage-loading" aria-live="polite">Loading apps&#8230;</p>';
    }
    if (selectedSpaceId.length === 0) {
      return '<p class="logs-empty-message">Choose a space first to load services.</p>';
    }
    return '<p class="logs-empty-message">No running services available in this space.</p>';
  }

  const mappedRows = mappingRows.map((mapping) => {
    const isSelected = selectedServiceExportAppId === mapping.appId;

    if (mapping.hasConflict) {
      const optionsMarkup = [
        '<option value="">Choose folder...</option>',
        ...mapping.candidateFolderPaths.map((candidatePath) => {
          const isCurrent = mapping.folderPath === candidatePath;
          return `<option value="${escapeHtml(candidatePath)}" ${isCurrent ? 'selected' : ''}>${escapeHtml(candidatePath)}</option>`;
        }),
      ].join('');
      return `
        <div class="service-map-row is-conflict${mapping.isMapped ? ' is-resolved' : ''}">
          <span class="service-map-name">${escapeHtml(mapping.appName)}</span>
          <label class="service-map-picker">
            <select data-role="service-folder-path-select" data-app-id="${escapeHtml(mapping.appId)}">
              ${optionsMarkup}
            </select>
          </label>
          <span class="service-map-state">${mapping.isMapped ? 'Resolved' : 'Choose folder'}</span>
        </div>
      `;
    }

    if (!mapping.isMapped) {
      return `
        <div class="service-map-row is-unmapped" aria-disabled="true">
          <span class="service-map-name">${escapeHtml(mapping.appName)}</span>
          <span class="service-map-state">Unmapped</span>
        </div>
      `;
    }

    return `
      <button
        type="button"
        class="service-map-row${isSelected ? ' is-selected' : ''}"
        data-action="select-export-service"
        data-app-id="${escapeHtml(mapping.appId)}"
      >
        <span class="service-map-name">${escapeHtml(mapping.appName)}</span>
        <span
          class="service-map-state service-map-state-mapped"
          title="${escapeHtml(mapping.folderPath)}"
        >Mapped</span>
      </button>
    `;
  });

  return mappedRows.join('');
}

function renderServiceExportStatus() {
  if (serviceExportStatusMessage.length === 0) {
    return '<p class="service-export-status" data-role="service-export-status" hidden></p>';
  }

  const toneClass = resolveServiceExportStatusToneClass();
  return `<p class="service-export-status ${toneClass}" data-role="service-export-status">${escapeHtml(serviceExportStatusMessage)}</p>`;
}

function applyServiceExportStatusElement(statusElement) {
  statusElement.className = 'service-export-status';
  statusElement.hidden = serviceExportStatusMessage.length === 0;
  statusElement.textContent = serviceExportStatusMessage;
  if (serviceExportStatusMessage.length === 0) {
    return;
  }

  statusElement.classList.add(resolveServiceExportStatusToneClass());
}

function resolveServiceExportStatusToneClass() {
  if (serviceExportStatusTone === 'success') {
    return 'is-success';
  }

  if (serviceExportStatusTone === 'error') {
    return 'is-error';
  }

  return 'is-info';
}

function renderAppLogCatalogMarkup(availableApps, selectedApps, activeApps) {
  if (availableApps.length === 0) {
    return '<p class="logs-empty-message">No apps found in current space.</p>';
  }

  return availableApps
    .map((app) => {
      const isLogging = activeApps.has(app.id);
      const isChecked = isLogging || selectedApps.has(app.id);
      const actionMarkup = isLogging
        ? ''
        : '<span class="app-log-state is-idle">Ready</span>';

      return `
        <div class="app-log-item${isLogging ? ' is-logging is-locked' : ''}">
          <input
            type="checkbox"
            data-role="log-app-checkbox"
            data-app-id="${app.id}"
            aria-label="Select ${escapeHtml(app.name)}"
            ${isChecked ? 'checked' : ''}
            ${isLogging ? 'disabled' : ''}
          />
          <span class="app-log-name">${escapeHtml(app.name)}</span>
          ${actionMarkup}
        </div>
      `;
    })
    .join('');
}

function renderCatalogByState(availableApps, selectedApps, activeApps) {
  if (vscodeApi !== null && appsLoadingState === 'loading') {
    return '<p class="stage-loading" aria-live="polite">Loading apps&#8230;</p>';
  }

  if (
    vscodeApi !== null &&
    appsLoadingState === 'idle' &&
    selectedSpaceId.length > 0 &&
    liveAppOptions === null
  ) {
    return '<p class="stage-loading" aria-live="polite">Loading apps&#8230;</p>';
  }

  if (vscodeApi !== null && appsLoadingState === 'error') {
    return `<p class="stage-error" role="alert">${escapeHtml(appsErrorMessage)}</p>`;
  }

  return renderAppLogCatalogMarkup(availableApps, selectedApps, activeApps);
}

function isAppsCatalogReady() {
  if (vscodeApi === null) {
    return true;
  }

  return appsLoadingState === 'idle' || appsLoadingState === 'loaded';
}

function getStartableSelectionCount(activeApps) {
  return selectedAppLogIds.filter((appId) => !activeApps.has(appId)).length;
}

function renderActiveAppsLogList(availableApps, activeAppIds) {
  const activeItems = availableApps.filter((app) => activeAppIds.has(app.id));
  if (activeItems.length === 0) {
    return '<p class="logs-empty-message">No active app logs yet.</p>';
  }

  const rowsMarkup = activeItems
    .map((app) => {
      return `
        <div class="active-app-row">
          <span class="active-app-name">${escapeHtml(app.name)}</span>
          <span class="active-app-meta">
            <button type="button" class="small-action app-log-stop" data-action="stop-app-logging" data-app-id="${app.id}">
              Stop
            </button>
          </span>
        </div>
      `;
    })
    .join('');

  return `<div class="active-app-list">${rowsMarkup}</div>`;
}

function renderCfLogsPanelBridge(logs) {
  const previewLines = getCfLogsPanelPreviewLines(logs);

  return `
    <section class="panel-logs-bridge" aria-label="CFLogs panel bridge">
      <div class="panel-logs-head">
        <h3>CFLogs Panel</h3>
        <button type="button" class="small-action" data-action="open-cf-logs-panel">Open CFLogs Panel</button>
      </div>
      <p class="panel-logs-description">
        Log stream is presented in a dedicated panel channel named <strong>CFLogs</strong> near Output and Terminal.
      </p>
      <div class="panel-logs-preview" role="log" aria-live="polite">
        ${previewLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
      </div>
    </section>
  `;
}

function getCfLogsPanelPreviewLines(logs) {
  if (logs.length === 0) {
    return ['No log lines available yet in CFLogs panel.'];
  }

  return logs.slice(-3).map((entry) => {
    return `[${entry.time}] ${entry.level} ${entry.app}/${entry.instance} ${entry.message}`;
  });
}

function renderLogsToolbar() {
  const liveLabel = isLiveMode ? 'Pause Live' : 'Start Live';

  return `
    <div class="toolbar-row" role="group" aria-label="Log actions">
      <button type="button" class="small-action" data-action="fetch-recent">Fetch Recent</button>
      <button type="button" class="small-action" data-action="toggle-live">${liveLabel}</button>
      <button type="button" class="small-action" data-action="clear-logs">Clear</button>
      <button type="button" class="small-action" data-action="export-logs">Export</button>
    </div>
  `;
}

function renderLogsFilters() {
  const levels = ['all', 'ERR', 'WARN', 'INFO', 'DEBUG'];
  const levelButtons = levels
    .map((level) => {
      const isActive = level === selectedLevel;
      return `
        <button
          type="button"
          class="level-chip${isActive ? ' is-active' : ''}"
          data-action="set-level"
          data-level="${level}"
        >
          ${level}
        </button>
      `;
    })
    .join('');

  return `
    <div class="scope-row">
      <span class="scope-chip">Org: ${resolveSelectedOrgName() || 'n/a'}</span>
      <span class="scope-chip">Space: ${selectedSpaceId.length > 0 ? selectedSpaceId : 'n/a'}</span>
      <span class="scope-chip">App: all</span>
      <span class="scope-chip">Range: 15m</span>
    </div>
    <div class="filter-row">
      <div class="level-group" role="group" aria-label="Severity levels">${levelButtons}</div>
      <input
        type="search"
        class="log-search"
        data-role="log-search"
        value="${escapeHtml(searchKeyword)}"
        placeholder="Search by app or message"
      />
    </div>
  `;
}

function renderLogsTable(logs, activeLogId) {
  if (logs.length === 0) {
    return '<p class="logs-empty-message">No logs match current filters.</p>';
  }

  const rowsMarkup = logs
    .map((entry) => {
      const isActive = entry.id === activeLogId;
      return `
        <button
          type="button"
          class="log-row${isActive ? ' is-active' : ''}"
          data-action="select-log"
          data-log-id="${entry.id}"
        >
          <span class="cell time">${entry.time}</span>
          <span class="cell level">${entry.level}</span>
          <span class="cell app">${entry.app}/${entry.instance}</span>
          <span class="cell message">${escapeHtml(entry.message)}</span>
        </button>
      `;
    })
    .join('');

  return `<div class="logs-table" role="list">${rowsMarkup}</div>`;
}

function renderLogDetails(entry) {
  const rawLine = `${entry.time} ${entry.level} ${entry.app}/${entry.instance} ${entry.message}`;

  return `
    <section class="log-detail" aria-label="Log details">
      <h3>Selected Log</h3>
      <pre>${escapeHtml(rawLine)}</pre>
    </section>
  `;
}

function renderEmptyLogDetails() {
  return `
    <section class="log-detail" aria-label="Log details">
      <h3>Selected Log</h3>
      <p>No log line selected.</p>
    </section>
  `;
}

function refreshUiAfterSqlStateChange() {
  if (isWorkspaceSqlMounted()) {
    refreshMountedSqlWorkbench();
    return;
  }
  if (mode === 'workspace') {
    renderPrototype();
  }
}

function refreshWorkspaceSqlView() {
  const tabContainer = appElement.querySelector('.workspace-body');
  if (!(tabContainer instanceof HTMLElement)) {
    renderPrototype();
    return;
  }
  tabContainer.innerHTML = renderSqlWorkbenchTab();
  queueSqlTableNameTruncation();
}

function refreshMountedSqlWorkbench() {
  const serviceSelectionRefreshed = refreshSqlServiceSelectionState();
  const tablesPanelRefreshed = refreshSqlTablesPanelContainer();
  if (!serviceSelectionRefreshed || !tablesPanelRefreshed) {
    refreshWorkspaceSqlView();
    return;
  }
  updateHanaQueryStatusElement();
  refreshSqlResultPreviewPanel();
  queueSqlTableNameTruncation();
}

function refreshSqlServiceSelectionState() {
  const serviceRows = appElement.querySelectorAll('.sql-service-row[data-service-id]');
  if (serviceRows.length === 0) {
    return false;
  }
  for (const row of serviceRows) {
    if (!(row instanceof HTMLButtonElement)) {
      continue;
    }
    const isSelected = row.dataset.serviceId === selectedHanaServiceId;
    row.classList.toggle('is-selected', isSelected);
    row.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  }
  return true;
}

function refreshSqlTablesPanelContainer() {
  const tablesPanel = appElement.querySelector('[data-role="hana-tables-panel"]');
  if (!(tablesPanel instanceof HTMLElement)) {
    return false;
  }
  const previousServiceId = tablesPanel.dataset.serviceId ?? '';
  const previousScrollTop = readSqlTablesListScrollTop(tablesPanel);
  tablesPanel.outerHTML = renderSqlTablesPanel();
  const nextTablesPanel = appElement.querySelector('[data-role="hana-tables-panel"]');
  if (!(nextTablesPanel instanceof HTMLElement)) {
    return false;
  }
  if (previousServiceId === (nextTablesPanel.dataset.serviceId ?? '')) {
    restoreSqlTablesListScrollTop(nextTablesPanel, previousScrollTop);
  }
  return true;
}

function readSqlTablesListScrollTop(tablesPanel) {
  const tablesList = tablesPanel.querySelector('[data-role="hana-tables-list"]');
  return tablesList instanceof HTMLElement ? tablesList.scrollTop : 0;
}
