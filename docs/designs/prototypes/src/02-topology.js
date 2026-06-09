function updateTopologyOrgSearchResults() {
  const panel = appElement.querySelector('[data-role="topology-search-panel"]');
  if (!(panel instanceof HTMLElement)) {
    return;
  }

  const filtered = filterTopologyOrgEntries();
  const existingResults = panel.querySelector('[data-role="topology-org-results"]');
  const existingEmpty = panel.querySelector('[data-role="topology-org-empty"]');

  if (filtered.length === 0) {
    const queryLabel = escapeHtml(topologyOrgSearchQuery.trim());
    const emptyMarkup = `<div class="topology-org-empty" data-role="topology-org-empty">No org matches "${queryLabel}"</div>`;
    if (existingResults instanceof HTMLElement) {
      existingResults.outerHTML = emptyMarkup;
    } else if (existingEmpty instanceof HTMLElement) {
      existingEmpty.outerHTML = emptyMarkup;
    } else {
      panel.insertAdjacentHTML('beforeend', emptyMarkup);
    }
    return;
  }

  const rowsMarkup = filtered
    .map((account) => {
      const knownRegion = isKnownTopologyRegion(account.regionKey);
      const spaceCount = Array.isArray(account.spaces) ? account.spaces.length : 0;
      const meta =
        spaceCount === 1
          ? `${escapeHtml(account.regionKey)} - 1 space`
          : `${escapeHtml(account.regionKey)} - ${String(spaceCount)} spaces`;
      const disabledAttr = knownRegion ? '' : ' disabled aria-disabled="true"';
      const disabledClass = knownRegion ? '' : ' is-disabled';
      const selectedOrg = resolveSelectedOrg();
      const isSelected =
        selectedRegionId === account.regionKey && selectedOrg?.name === account.orgName;
      return `
        <button
          type="button"
          class="topology-org-row${disabledClass}${isSelected ? ' is-selected' : ''}"
          data-topology-region-key="${escapeHtml(account.regionKey)}"
          data-topology-org="${escapeHtml(account.orgName)}"
          aria-label="Quick org search pick ${escapeHtml(account.orgName)} in ${escapeHtml(account.regionKey)}"
          aria-pressed="${isSelected}"
          ${disabledAttr}
          title="${escapeHtml(account.orgName)} - ${escapeHtml(account.regionLabel)}"
        >
          <span class="topology-org-name">${escapeHtml(account.orgName)}</span>
          <span class="topology-org-meta">${meta}</span>
        </button>
      `;
    })
    .join('');

  const resultsMarkup = `<div class="topology-org-results" data-role="topology-org-results">${rowsMarkup}</div>`;

  if (existingResults instanceof HTMLElement) {
    existingResults.outerHTML = resultsMarkup;
  } else if (existingEmpty instanceof HTMLElement) {
    existingEmpty.outerHTML = resultsMarkup;
  } else {
    panel.insertAdjacentHTML('beforeend', resultsMarkup);
  }
}

appElement.addEventListener('change', (event) => {
  const target = event.target;
  if (
    target instanceof HTMLSelectElement &&
    target.dataset.role === 'sync-interval-select'
  ) {
    const syncHoursRaw = Number.parseInt(target.value, 10);
    if (!SYNC_INTERVAL_OPTIONS.includes(syncHoursRaw)) {
      return;
    }

    syncIntervalHours = syncHoursRaw;
    settingsStatusMessage = `Sync interval updated to ${formatSyncIntervalLabel(syncHoursRaw)}.`;
    postSyncIntervalUpdate(syncHoursRaw);
    renderPrototype();
    return;
  }

  if (
    target instanceof HTMLSelectElement &&
    target.dataset.role === 'service-folder-path-select'
  ) {
    const appId = target.dataset.appId ?? '';
    if (appId.length === 0) {
      return;
    }

    const selectedFolderPath = target.value.trim();
    serviceFolderMappings = serviceFolderMappings.map((mapping) => {
      if (mapping.appId !== appId) {
        return mapping;
      }

      const candidateFolderPaths = Array.isArray(mapping.candidateFolderPaths)
        ? mapping.candidateFolderPaths
        : [];
      const isAllowedPath = candidateFolderPaths.includes(selectedFolderPath);
      const nextFolderPath = isAllowedPath ? selectedFolderPath : '';
      return {
        ...mapping,
        folderPath: nextFolderPath,
        isMapped: nextFolderPath.length > 0,
      };
    });

    if (selectedFolderPath.length > 0) {
      selectedServiceExportAppId = appId;
      serviceExportStatusTone = 'info';
      serviceExportStatusMessage = 'Service folder selected.';
    } else if (selectedServiceExportAppId === appId) {
      selectedServiceExportAppId = '';
      serviceExportStatusTone = 'info';
      serviceExportStatusMessage = 'Service folder selection cleared.';
    }

    postSelectServiceFolderMapping(appId, selectedFolderPath);
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (target.dataset.role !== 'log-app-checkbox') {
    return;
  }

  const appId = target.dataset.appId ?? '';
  if (appId.length === 0) {
    return;
  }

  const selectedIds = new Set(selectedAppLogIds);
  if (target.checked) {
    selectedIds.add(appId);
  } else {
    selectedIds.delete(appId);
  }

  selectedAppLogIds = Array.from(selectedIds);
  if (isWorkspaceLogsMounted()) {
    refreshWorkspaceLogsView();
    return;
  }
  renderPrototype();
});

function shouldRefreshWorkspaceLogsOnly(action, modeBeforeAction, tabBeforeAction) {
  const isLogsAction = action === 'start-app-logging' || action === 'stop-app-logging';
  if (!isLogsAction) {
    return false;
  }

  return (
    modeBeforeAction === 'workspace' &&
    mode === 'workspace' &&
    tabBeforeAction === 'logs' &&
    activeTabId === 'logs'
  );
}

function shouldRefreshWorkspaceAppsOnly(action, modeBeforeAction, tabBeforeAction) {
  const isAppsAction =
    action === 'select-local-root-folder' ||
    action === 'export-service-now' ||
    action === 'replace-service-package-placeholder' ||
    action === 'export-sqltools-config';
  if (!isAppsAction) {
    return false;
  }

  return (
    modeBeforeAction === 'workspace' &&
    mode === 'workspace' &&
    tabBeforeAction === 'apps' &&
    activeTabId === 'apps'
  );
}

function shouldRefreshWorkspaceSqlOnly(action, modeBeforeAction, tabBeforeAction) {
  const isSqlOnlyAction =
    action === 'select-hana-service' ||
    action === 'run-hana-table-select' ||
    action === 'toggle-sql-result-export-menu' ||
    action === 'copy-sql-result-csv' ||
    action === 'copy-sql-result-json' ||
    action === 'copy-sql-result-row-object' ||
    action === 'copy-sql-result-cell-value' ||
    action === 'export-sql-result-csv' ||
    action === 'export-sql-result-json';
  if (!isSqlOnlyAction) {
    return false;
  }

  return (
    modeBeforeAction === 'workspace' &&
    mode === 'workspace' &&
    tabBeforeAction === 'settings' &&
    activeTabId === 'settings'
  );
}

function isWorkspaceLogsMounted() {
  if (mode !== 'workspace' || activeTabId !== 'logs') {
    return false;
  }

  return appElement.querySelector('.app-logs-panel') instanceof HTMLElement;
}

function isWorkspaceAppsMounted() {
  if (mode !== 'workspace' || activeTabId !== 'apps') {
    return false;
  }

  return appElement.querySelector('.service-export-tab') instanceof HTMLElement;
}

function isWorkspaceSqlMounted() {
  if (mode !== 'workspace' || activeTabId !== 'settings') {
    return false;
  }

  return appElement.querySelector('.sql-workbench') instanceof HTMLElement;
}

function handleAppLogRowClick(target) {
  const appLogRow = target.closest('.app-log-item');
  if (!(appLogRow instanceof HTMLElement)) {
    return false;
  }

  const checkbox = appLogRow.querySelector('[data-role="log-app-checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) {
    return false;
  }

  if (target === checkbox) {
    return false;
  }

  if (checkbox.disabled) {
    return true;
  }

  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function refreshWorkspaceLogsView() {
  const logsPanel = appElement.querySelector('.app-logs-panel');
  if (!(logsPanel instanceof HTMLElement)) {
    renderPrototype();
    return;
  }

  const availableApps = resolveCurrentSpaceApps();
  const visibleApps = filterLoggableCatalogApps(filterAppCatalogRows(availableApps));
  const selectedApps = new Set(selectedAppLogIds);
  const activeApps = new Set(activeAppLogIds);
  const startableSelectionCount = getStartableSelectionCount(activeApps);
  const catalogMarkup = renderCatalogByState(visibleApps, selectedApps, activeApps);

  const catalogElement = logsPanel.querySelector('[data-role="app-log-catalog"]');
  if (!(catalogElement instanceof HTMLElement)) {
    renderPrototype();
    return;
  }
  catalogElement.innerHTML = catalogMarkup;

  const appSearchInput = logsPanel.querySelector('[data-role="app-log-search"]');
  if (appSearchInput instanceof HTMLInputElement) {
    appSearchInput.value = appCatalogSearchKeyword;
  }

  const activeAppsElement = logsPanel.querySelector('[data-role="active-app-log-list"]');
  if (!(activeAppsElement instanceof HTMLElement)) {
    renderPrototype();
    return;
  }
  activeAppsElement.innerHTML = renderActiveAppsLogList(availableApps, activeApps);

  const startButton = logsPanel.querySelector('[data-action="start-app-logging"]');
  if (startButton instanceof HTMLButtonElement) {
    startButton.disabled = startableSelectionCount === 0 || !isAppsCatalogReady();
  }

  const statusElement = logsPanel.querySelector('[data-role="app-log-status"]');
  if (statusElement instanceof HTMLElement) {
    statusElement.hidden = statusMessage.length === 0;
    statusElement.textContent = statusMessage;
  }

  const syncElement = appElement.querySelector('[data-role="workspace-last-sync"]');
  if (syncElement instanceof HTMLElement) {
    syncElement.textContent = `Last sync: ${lastSyncLabel}`;
  }
}

function refreshWorkspaceAppsView() {
  const exportTab = appElement.querySelector('.service-export-tab');
  if (!(exportTab instanceof HTMLElement)) {
    renderPrototype();
    return;
  }

  const availableApps = resolveCurrentSpaceApps();
  const mappingRows = resolveServiceExportRows(availableApps);
  const filteredMappingRows = filterServiceExportRows(mappingRows);
  const rootFolderLabel =
    localServiceRootFolderPath.length > 0 ? localServiceRootFolderPath : 'Not selected';

  const rootPathElement = exportTab.querySelector('[data-role="service-export-path"]');
  if (!(rootPathElement instanceof HTMLElement)) {
    renderPrototype();
    return;
  }
  rootPathElement.textContent = `Root: ${rootFolderLabel}`;
  rootPathElement.setAttribute('title', rootFolderLabel);

  const rootButtonElement = exportTab.querySelector('[data-action="select-local-root-folder"]');
  if (rootButtonElement instanceof HTMLButtonElement) {
    rootButtonElement.disabled = serviceExportInProgress;
  }

  const mappingListElement = exportTab.querySelector('[data-role="service-mapping-list"]');
  if (!(mappingListElement instanceof HTMLElement)) {
    renderPrototype();
    return;
  }
  const hasSearchKeyword = serviceExportSearchKeyword.trim().length > 0;
  mappingListElement.innerHTML = serviceFolderScanInProgress
    ? '<p class="stage-loading" aria-live="polite">Scanning local folders&#8230;</p>'
    : renderServiceExportMappingRows(filteredMappingRows, {
      hasSearchKeyword,
      totalRowCount: mappingRows.length,
    });

  const registryBadgeElement = exportTab.querySelector('[data-role="registry-badge"]');
  const newBadgeHtml = renderRegistryBadge();
  if (registryBadgeElement !== null) {
    registryBadgeElement.outerHTML = newBadgeHtml;
  } else if (newBadgeHtml.length > 0) {
    // Badge newly appeared — re-render the header h2.
    const h2 = exportTab.querySelector('.service-export-header h2');
    if (h2 instanceof HTMLElement) {
      h2.innerHTML = `Services &amp; Packages ${newBadgeHtml}`;
    }
  }

  const detectedPackagesElement = exportTab.querySelector('[data-role="detected-packages"]');
  if (detectedPackagesElement instanceof HTMLElement) {
    // Save scroll position of the package list
    const listElement = detectedPackagesElement.querySelector('.detected-pkg-list');
    const scrollTop = listElement ? listElement.scrollTop : 0;

    // Prevent wiping the list DOM if a single package build is in progress.
    // The single package build UI is handled via targeted updates in updateSinglePackageBuildUI.
    if (buildingPackageName.length === 0) {
      const newHtml = renderDetectedPackagesInner();
      if (detectedPackagesElement.innerHTML !== newHtml) {
        detectedPackagesElement.innerHTML = newHtml;

        // Restore scroll position
        if (scrollTop > 0) {
          const newListElement = detectedPackagesElement.querySelector('.detected-pkg-list');
          if (newListElement) {
            newListElement.scrollTop = scrollTop;
          }
        }
      }
    }
  } else if (localServiceRootFolderPath.length > 0) {
    renderPrototype();
    return;
  }

  const exportSearchInput = exportTab.querySelector('[data-role="service-export-search"]');
  if (exportSearchInput instanceof HTMLInputElement) {
    exportSearchInput.value = serviceExportSearchKeyword;
  }

  const statusElement = exportTab.querySelector('[data-role="service-export-status"]');
  if (!(statusElement instanceof HTMLElement)) {
    renderPrototype();
    return;
  }
  applyServiceExportStatusElement(statusElement);
}

function refreshUiAfterServiceExportStateChange() {
  if (mode === 'selection' && isSelectionShellMounted()) {
    updateSelectionStageSlots(SELECTION_STAGE_SLOT_IDS);
    return;
  }

  if (isWorkspaceAppsMounted()) {
    refreshWorkspaceAppsView();
    return;
  }

  if (isWorkspaceLogsMounted()) {
    refreshWorkspaceLogsView();
    return;
  }

  renderPrototype();
}

function handleGroupSelection(nextGroupId) {
  const nextGroup = groupLookup.get(nextGroupId);
  if (nextGroup === undefined || isAreaDisabled(nextGroupId)) {
    return;
  }

  const didChangeGroup = selectedGroupId !== nextGroupId;
  selectedGroupId = nextGroupId;

  if (!didChangeGroup) {
    return;
  }

  selectedRegionId = '';
  selectedOrgId = '';
  selectedOrgName = '';
  selectedSpaceId = '';
  orgSearchQuery = '';
  regionSearchQuery = '';
  resetWorkspaceLoggingState();
}

function handleRegionSelection(nextRegionId) {
  if (isRegionDisabled(nextRegionId)) {
    return;
  }

  const nextRegion = regionLookup.get(nextRegionId);
  const nextGroupId = regionGroupLookup.get(nextRegionId) ?? '';
  const nextGroup = groupLookup.get(nextGroupId);

  if (nextRegion === undefined || nextGroupId.length === 0 || nextGroup === undefined) {
    return;
  }

  selectedGroupId = nextGroupId;
  selectedRegionId = nextRegionId;
  selectedOrgId = '';
  selectedOrgName = '';
  selectedSpaceId = '';
  orgSearchQuery = '';
  regionSearchQuery = '';
  resetWorkspaceLoggingState();

  // Reset live data state so the org stage starts fresh.
  liveOrgOptions = null;
  liveOrgLookup = new Map();
  liveSpaceNames = null;
  liveAppOptions = null;
  spacesLoadingState = 'idle';
  spacesErrorMessage = '';
  appsLoadingState = 'idle';
  appsErrorMessage = '';

  if (vscodeApi !== null) {
    orgsLoadingState = 'loading';
    orgsErrorMessage = '';
  } else {
    orgsLoadingState = 'idle';
  }

  postRegionSelection(nextRegion, nextGroup.label);
}

function handleOrgSelection(nextOrgId) {
  if (selectedRegionId.length === 0) {
    return;
  }

  const selectedOrg =
    vscodeApi !== null && liveOrgOptions !== null
      ? liveOrgLookup.get(nextOrgId)
      : resolveCurrentMockOrgOptions().find((org) => org.id === nextOrgId);

  if (selectedOrg === undefined) {
    return;
  }

  selectedOrgId = nextOrgId;
  selectedOrgName = selectedOrg.name;
  selectedSpaceId = '';
  resetWorkspaceLoggingState();
  liveSpaceNames = null;
  liveAppOptions = null;
  spacesErrorMessage = '';
  appsErrorMessage = '';
  appsLoadingState = 'idle';

  if (vscodeApi !== null) {
    spacesLoadingState = 'loading';
    postOrgSelection(nextOrgId, selectedOrgName);
  } else {
    spacesLoadingState = 'idle';
  }
}

function handleSpaceSelection(nextSpaceId) {
  if (nextSpaceId === selectedSpaceId) {
    return;
  }

  const selectableSpaces = resolveSelectableSpaces();
  if (selectableSpaces.every((space) => space !== nextSpaceId)) {
    return;
  }

  selectedSpaceId = nextSpaceId;
  resetWorkspaceLoggingState();
  liveAppOptions = null;
  appsErrorMessage = '';

  if (vscodeApi !== null) {
    requestAppsForSelectedScope(nextSpaceId);
    return;
  }

  appsLoadingState = 'idle';
}

