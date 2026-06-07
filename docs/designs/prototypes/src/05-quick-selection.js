function requestHanaServicesIfNeeded() {
  syncSqlAppTargetsFromCurrentApps();
}

function triggerOpenHanaSqlFile() {
  const selectedService = resolveSelectedHanaService();
  if (selectedService === undefined) {
    hanaQueryStatusTone = 'error';
    hanaQueryStatusMessage = 'Choose an app before opening a SQL file.';
    return true;
  }

  hanaQueryStatusTone = 'info';
  hanaQueryStatusMessage = '';

  if (vscodeApi === null) {
    return true;
  }

  vscodeApi.postMessage({
    type: OPEN_HANA_SQL_FILE_MESSAGE_TYPE,
    serviceId: selectedService.id,
    serviceName: selectedService.name,
  });
  return true;
}

function handleSelectionFlowAction(action) {
  if (action === 'open-settings') {
    previousModeBeforeSettings = mode;
    mode = 'settings';
    settingsStatusMessage = '';
    return true;
  }

  if (action === 'close-settings') {
    mode = previousModeBeforeSettings === 'workspace' ? 'workspace' : 'selection';
    return true;
  }

  if (action === 'set-sync-interval') {
    return null;
  }

  if (action === 'sync-now') {
    return null;
  }

  if (action === 'logout') {
    return null;
  }

  if (action === 'reset-area-selection') {
    selectedGroupId = '';
    selectedRegionId = '';
    selectedOrgId = '';
    selectedOrgName = '';
    selectedSpaceId = '';
    orgSearchQuery = '';
    regionSearchQuery = '';
    resetWorkspaceLoggingState();
    return true;
  }

  if (action === 'reset-region-selection') {
    selectedRegionId = '';
    selectedOrgId = '';
    selectedOrgName = '';
    selectedSpaceId = '';
    orgSearchQuery = '';
    regionSearchQuery = '';
    resetWorkspaceLoggingState();
    return true;
  }

  if (action === 'reset-org-selection') {
    selectedOrgId = '';
    selectedOrgName = '';
    selectedSpaceId = '';
    resetWorkspaceLoggingState();
    return true;
  }

  if (action === 'reset-space-selection') {
    selectedSpaceId = '';
    resetWorkspaceLoggingState();
    return true;
  }

  if (action === 'quick-back-to-orgs') {
    resetQuickSelectionState();
    updateQuickPanelInPlace();
    return false;
  }

  if (action === 'quick-confirm-scope') {
    if (!quickPickRegionKey || !quickPickOrgName || !quickPickSpaceName) {
      return false;
    }
    if (quickConfirmInProgress) {
      return false;
    }
    quickConfirmInProgress = true;
    quickConfirmError = '';
    updateQuickPanelInPlace();
    postQuickScopeConfirm(quickPickRegionKey, quickPickOrgName, quickPickSpaceName);
    return false;
  }

  if (action === 'confirm-region') {
    if (selectedRegionId.length === 0 || selectedOrgId.length === 0 || selectedSpaceId.length === 0) {
      return false;
    }

    mode = 'workspace';
    activeTabId = 'logs';
    statusMessage = '';
    postConfirmScope();
    return true;
  }

  if (action === 'change-region') {
    mode = 'selection';
    isLiveMode = false;
    resetActiveAppLoggingState();
    return true;
  }

  return null;
}

function handleSettingsAction(action, actionElement) {
  if (action === 'set-sync-interval') {
    const syncHoursRaw = Number.parseInt(actionElement.dataset.syncHours ?? '', 10);
    if (!SYNC_INTERVAL_OPTIONS.includes(syncHoursRaw)) {
      return false;
    }

    syncIntervalHours = syncHoursRaw;
    settingsStatusMessage = `Sync interval updated to ${formatSyncIntervalLabel(syncHoursRaw)}.`;
    postSyncIntervalUpdate(syncHoursRaw);
    return true;
  }

  if (action === 'sync-now') {
    settingsStatusMessage = 'Sync started...';
    postSyncNow();
    return true;
  }

  if (action === 'logout') {
    settingsStatusMessage = 'Signing out...';
    postLogout();
    return true;
  }

  return null;
}

function handleTabAction(action, tabId) {
  if (action !== 'switch-tab') {
    return null;
  }

  if (TAB_ITEMS.every((item) => item.id !== tabId)) {
    return false;
  }

  activeTabId = tabId;
  if (activeTabId === 'settings') {
    requestHanaServicesIfNeeded();
  }
  return true;
}

function handleLogsAction(action, actionElement) {
  const settingsActionHandled = handleSettingsAction(action, actionElement);
  if (settingsActionHandled !== null) {
    return settingsActionHandled;
  }

  const selectionActionHandled = handleLogsSelectionAction(action, actionElement);
  if (selectionActionHandled !== null) {
    return selectionActionHandled;
  }

  const controlActionHandled = handleLogsControlAction(action, actionElement);
  if (controlActionHandled !== null) {
    return controlActionHandled;
  }

  return null;
}

function handleServiceExportAction(action, actionElement) {
  if (action === 'select-local-root-folder') {
    if (vscodeApi !== null) {
      vscodeApi.postMessage({
        type: SELECT_LOCAL_ROOT_FOLDER_MESSAGE_TYPE,
      });
      return true;
    }

    serviceExportStatusTone = 'info';
    serviceExportStatusMessage = '';
    localServiceRootFolderPath = '/Users/demo/workspaces/sap-services';
    serviceExportStatusMessage = 'Root folder selected. Scan completed with prototype data.';
    serviceExportStatusTone = 'success';
    serviceFolderMappings = buildMockServiceFolderMappings(
      localServiceRootFolderPath,
      resolveCurrentSpaceApps()
    );
    pruneSelectedServiceExportAppId();
    return true;
  }

  if (action === 'select-export-service') {
    const appId = actionElement.dataset.appId ?? '';
    if (appId.length === 0) {
      return false;
    }
    const mapping = serviceFolderMappings.find((entry) => entry.appId === appId);
    if (mapping === undefined || !mapping.isMapped) {
      return true;
    }
    selectedServiceExportAppId = appId;
    serviceExportStatusTone = 'info';
    serviceExportStatusMessage = '';
    return true;
  }

  if (action === 'export-service-artifacts') {
    return triggerServiceExport();
  }

  if (action === 'export-sqltools-config') {
    return triggerSqlToolsConfigExport();
  }

  if (action === 'build-publish-all') {
    if (vscodeApi === null || detectedPackages.length === 0 || buildPublishInProgress) {
      return true;
    }
    // Clear any lingering single-build result so the two flows don't overlap.
    buildingPackageName = '';
    buildResultPackageName = '';
    buildResultMessage = '';
    if (buildResultTimer !== null) {
      clearTimeout(buildResultTimer);
      buildResultTimer = null;
    }
    buildPublishInProgress = true;
    buildPublishOrder = [];
    buildPublishStatuses = {};
    buildPublishCompletedCount = 0;
    buildPublishResultMessage = 'Building & publishing packages…';
    buildPublishResultTone = 'info';
    vscodeApi.postMessage({ type: BUILD_PUBLISH_ALL_MESSAGE_TYPE });
    return true;
  }

  if (action === 'build-single-package') {
    if (vscodeApi === null || !actionElement) {
      return true;
    }
    const packageName = actionElement.dataset.package;
    if (!packageName) {
      return true;
    }
    // Ignore re-clicks while a build is already running.
    if (buildPublishInProgress) {
      return true;
    }
    buildPublishInProgress = true;
    buildingPackageName = packageName;
    buildResultPackageName = '';
    buildResultMessage = '';
    if (buildResultTimer !== null) {
      clearTimeout(buildResultTimer);
      buildResultTimer = null;
    }
    vscodeApi.postMessage({
      type: BUILD_SINGLE_PACKAGE_MESSAGE_TYPE,
      payload: { packageName },
    });
    updateSinglePackageBuildUI(packageName);
    return true;
  }

  if (action === 'local-registry-toggle') {
    if (vscodeApi === null) {
      return true;
    }
    vscodeApi.postMessage({
      type: localRegistryRunning
        ? LOCAL_REGISTRY_STOP_MESSAGE_TYPE
        : LOCAL_REGISTRY_START_MESSAGE_TYPE,
    });
    if (!localRegistryRunning) {
      localRegistryInstalling = true;
    }
    return true;
  }

  if (action === 'open-local-packages-settings') {
    if (vscodeApi !== null) {
      vscodeApi.postMessage({ type: OPEN_LOCAL_PACKAGES_SETTINGS_MESSAGE_TYPE });
    }
    return true;
  }

  if (action === 'copy-build-error') {
    const errorText = actionElement.dataset.error ?? '';
    if (errorText.length > 0 && navigator.clipboard?.writeText !== undefined) {
      void navigator.clipboard.writeText(errorText);
      actionElement.classList.add('is-copied');
      setTimeout(() => actionElement.classList.remove('is-copied'), 1200);
    }
    return true;
  }

  return null;
}

function handleLogsSelectionAction(action, actionElement) {
  if (action === 'set-level') {
    selectedLevel = actionElement.dataset.level ?? 'all';
    selectedLogId = '';
    return true;
  }

  if (action === 'select-log') {
    selectedLogId = actionElement.dataset.logId ?? '';
    return true;
  }

  return null;
}

function handleLogsControlAction(action, actionElement) {
  if (action === 'start-app-logging') {
    if (!isAppsCatalogReady()) {
      statusMessage =
        appsLoadingState === 'error'
          ? 'Cannot start logging because app list is unavailable.'
          : 'Apps are still loading. Please wait.';
      return true;
    }

    const availableApps = resolveCurrentSpaceApps();
    const validAppIds = new Set(availableApps.map((app) => app.id));
    const selectedValidIds = selectedAppLogIds.filter((appId) => validAppIds.has(appId));
    const nextActiveAppIds = new Set(activeAppLogIds.filter((appId) => validAppIds.has(appId)));

    if (selectedValidIds.length === 0) {
      statusMessage = 'Select at least one app to start logging.';
      return true;
    }

    let newlyStartedCount = 0;
    for (const appId of selectedValidIds) {
      if (!nextActiveAppIds.has(appId)) {
        newlyStartedCount += 1;
      }
      nextActiveAppIds.add(appId);
    }

    activeAppLogIds = Array.from(nextActiveAppIds);
    selectedAppLogIds = Array.from(new Set([...selectedValidIds, ...activeAppLogIds]));
    postActiveAppsChanged(resolveActiveAppNamesByIds(activeAppLogIds));
    postOpenCfLogsPanel();
    lastSyncLabel = formatNow();
    statusMessage =
      newlyStartedCount === 0
        ? 'All selected apps are already logging.'
        : `Logging started for ${newlyStartedCount} app${newlyStartedCount > 1 ? 's' : ''}.`;
    return true;
  }

  if (action === 'stop-app-logging') {
    const appId = actionElement.dataset.appId ?? '';
    if (appId.length === 0) {
      return false;
    }

    const isActive = activeAppLogIds.includes(appId);
    if (!isActive) {
      return true;
    }

    const appName =
      resolveCurrentSpaceApps().find((app) => app.id === appId)?.name ?? appId;
    activeAppLogIds = activeAppLogIds.filter((activeAppId) => activeAppId !== appId);
    selectedAppLogIds = selectedAppLogIds.filter((selectedAppId) => selectedAppId !== appId);
    postActiveAppsChanged(resolveActiveAppNamesByIds(activeAppLogIds));
    lastSyncLabel = formatNow();
    statusMessage = `Stopped logging for ${appName}.`;
    return true;
  }

  if (action === 'open-cf-logs-panel') {
    postOpenCfLogsPanel();
    statusMessage = 'CFLogs panel opened.';
    return true;
  }

  if (action === 'connect-cf') {
    isConnected = true;
    selectedLogId = logsData[0]?.id ?? '';
    lastSyncLabel = formatNow();
    statusMessage = 'Cloud Foundry target connected.';
    return true;
  }

  if (action === 'fetch-recent') {
    logsData = cloneSeedLogs();
    selectedLogId = logsData[0]?.id ?? '';
    lastSyncLabel = formatNow();
    statusMessage = 'Fetched latest log lines.';
    return true;
  }

  if (action === 'toggle-live') {
    isLiveMode = !isLiveMode;
    lastSyncLabel = formatNow();
    statusMessage = isLiveMode ? 'Live streaming enabled.' : 'Live streaming paused.';
    return true;
  }

  if (action === 'clear-logs') {
    logsData = [];
    selectedLogId = '';
    statusMessage = 'Log list cleared.';
    return true;
  }

  if (action === 'export-logs') {
    statusMessage = 'Export prepared as mock-log-export.txt';
    return true;
  }

  return null;
}

function applyCacheStateSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    return;
  }

  if (
    typeof snapshot.syncIntervalHours === 'number' &&
    SYNC_INTERVAL_OPTIONS.includes(snapshot.syncIntervalHours)
  ) {
    syncIntervalHours = snapshot.syncIntervalHours;
  }

  syncInProgress = snapshot.syncInProgress === true;
  lastSyncStartedAt =
    typeof snapshot.lastSyncStartedAt === 'string' && snapshot.lastSyncStartedAt.length > 0
      ? snapshot.lastSyncStartedAt
      : null;
  lastSyncCompletedAt =
    typeof snapshot.lastSyncCompletedAt === 'string' && snapshot.lastSyncCompletedAt.length > 0
      ? snapshot.lastSyncCompletedAt
      : null;
  nextSyncAt =
    typeof snapshot.nextSyncAt === 'string' && snapshot.nextSyncAt.length > 0
      ? snapshot.nextSyncAt
      : null;
  lastSyncError =
    typeof snapshot.lastSyncError === 'string' ? snapshot.lastSyncError : '';
  activeUserEmail =
    typeof snapshot.activeUserEmail === 'string' ? snapshot.activeUserEmail : '';
  regionAccessById = normalizeRegionAccessById(snapshot.regionAccessById);

  const selectedRegionExists = regionLookup.has(selectedRegionId);
  if (!selectedRegionExists) {
    selectedRegionId = '';
    selectedOrgId = '';
    selectedOrgName = '';
    selectedSpaceId = '';
    orgSearchQuery = '';
    regionSearchQuery = '';
    resetWorkspaceLoggingState();
  }

  if (mode === 'selection' && isSelectionShellMounted()) {
    updateSelectionStageSlots(SELECTION_STAGE_SLOT_IDS);
    return;
  }

  if (isWorkspaceLogsMounted()) {
    refreshWorkspaceLogsView();
    return;
  }

  renderPrototype();
}

function normalizeRegionAccessById(rawRegionAccessById) {
  const accessMap = new Map();
  if (!isRecord(rawRegionAccessById)) {
    return accessMap;
  }

  for (const [rawRegionId, rawState] of Object.entries(rawRegionAccessById)) {
    const regionId = rawRegionId.trim().toLowerCase();
    if (regionId.length === 0) {
      continue;
    }

    const normalizedState = normalizeRegionAccessState(rawState);
    accessMap.set(regionId, normalizedState);
  }

  return accessMap;
}

function normalizeRegionAccessState(rawState) {
  if (typeof rawState !== 'string') {
    return 'unknown';
  }

  const normalized = rawState.trim().toLowerCase();
  if (normalized === 'accessible') {
    return 'accessible';
  }

  if (normalized === 'inaccessible') {
    return 'inaccessible';
  }

  if (normalized === 'error') {
    return 'error';
  }

  return 'unknown';
}

function resolveOrderedGroups() {
  const orderedGroups = REGION_GROUPS.slice();
  orderedGroups.sort((leftGroup, rightGroup) => {
    const leftRank = resolveGroupAccessRank(leftGroup);
    const rightRank = resolveGroupAccessRank(rightGroup);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return leftGroup.label.localeCompare(rightGroup.label);
  });
  return orderedGroups;
}

function resolveGroupAccessRank(group) {
  const regionStates = group.regions.map((region) => resolveRegionAccessState(region.id));
  if (regionStates.some((state) => state === 'accessible')) {
    return 0;
  }

  if (regionStates.some((state) => state === 'unknown')) {
    return 1;
  }

  if (regionStates.some((state) => state === 'inaccessible')) {
    return 2;
  }

  return 3;
}

function resolveOrderedRegions(group) {
  const orderedRegions = group.regions.slice();
  orderedRegions.sort((leftRegion, rightRegion) => {
    const nameCompare = leftRegion.name.localeCompare(rightRegion.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return leftRegion.id.localeCompare(rightRegion.id);
  });
  return orderedRegions;
}

function resolveRegionAccessRank(regionId) {
  const state = resolveRegionAccessState(regionId);
  if (state === 'accessible') {
    return 0;
  }

  if (state === 'unknown') {
    return 1;
  }

  if (state === 'inaccessible') {
    return 2;
  }

  return 3;
}

function resolveRegionAccessState(regionId) {
  if (regionAccessById.size === 0) {
    return 'unknown';
  }

  const normalizedRegionId = regionId.trim().toLowerCase();
  const state = regionAccessById.get(normalizedRegionId);
  if (typeof state !== 'string') {
    return 'unknown';
  }

  return state;
}

function isAreaDisabled(groupId) {
  if (regionAccessById.size === 0) {
    return false;
  }

  const group = groupLookup.get(groupId);
  if (group === undefined) {
    return true;
  }

  return group.regions.every((region) => {
    const state = resolveRegionAccessState(region.id);
    return state === 'inaccessible';
  });
}

function isRegionDisabled(regionId) {
  if (regionAccessById.size === 0) {
    return false;
  }

  const state = resolveRegionAccessState(regionId);
  return state === 'inaccessible';
}

