// Listen for messages from the extension host (org/space data, scope updates).
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!isRecord(msg)) {
    return;
  }

  // Ignore gallery navigation messages (prototype gallery only).
  if (msg.type === 'saptools.prototype.navigate') {
    return;
  }

  if (msg.type === 'sapTools.orgsLoaded') {
    const rawOrgs = msg.orgs;
    if (!Array.isArray(rawOrgs)) {
      return;
    }
    liveOrgOptions = rawOrgs
      .filter((o) => isRecord(o) && typeof o.guid === 'string' && typeof o.name === 'string')
      .map((o) => ({ guid: o.guid, name: o.name }));
    liveOrgLookup = new Map(liveOrgOptions.map((o) => [o.guid, o]));
    orgsLoadingState = 'loaded';
    rerenderSelectionStageSlotsWithMotion(['org', 'space', 'confirm']);
    return;
  }

  if (msg.type === 'sapTools.orgsError') {
    orgsLoadingState = 'error';
    orgsErrorMessage =
      typeof msg.message === 'string' ? msg.message : 'Failed to load organizations.';
    topologyPickInProgress = false;
    rerenderSelectionStageSlotsWithMotion(['org', 'space', 'confirm']);
    return;
  }

  if (msg.type === 'sapTools.spacesLoaded') {
    const rawSpaces = msg.spaces;
    if (!Array.isArray(rawSpaces)) {
      return;
    }
    liveSpaceNames = rawSpaces
      .filter((s) => isRecord(s) && typeof s.name === 'string' && s.name.length > 0)
      .map((s) => s.name);
    spacesLoadingState = 'loaded';
    appsLoadingState = 'idle';
    const preserveSelectedSpace = mode === 'workspace' && selectedSpaceId.length > 0;
    if (!preserveSelectedSpace) {
      selectedSpaceId = '';
    }
    liveAppOptions = null;
    appsErrorMessage = '';
    // Auto-select when there is only one space.
    if (liveSpaceNames.length === 1) {
      selectedSpaceId = liveSpaceNames[0];
      requestAppsForSelectedScope(selectedSpaceId);
    }
    rerenderSelectionStageSlotsWithMotion(['space', 'confirm']);
    return;
  }

  if (msg.type === 'sapTools.spacesError') {
    if (activeSelectionMode === 'quick' && quickConfirmInProgress) {
      quickConfirmInProgress = false;
      quickConfirmError =
        typeof msg.message === 'string' && msg.message.length > 0
          ? msg.message
          : typeof msg.error === 'string' && msg.error.length > 0
            ? msg.error
            : 'Could not confirm scope. Try Custom tab.';
      updateQuickPanelInPlace();
      return;
    }

    spacesLoadingState = 'error';
    spacesErrorMessage =
      typeof msg.message === 'string' ? msg.message : 'Failed to load spaces.';
    liveAppOptions = null;
    appsLoadingState = 'idle';
    appsErrorMessage = '';
    topologyPickInProgress = false;
    rerenderSelectionStageSlotsWithMotion(['space', 'confirm']);
    return;
  }

  if (msg.type === 'sapTools.appsLoaded') {
    const rawApps = msg.apps;
    if (!Array.isArray(rawApps)) {
      return;
    }

    // When the active scope changes, drop per-service SQL state. serviceId is the
    // app name, which can collide across spaces, so stale table lists / tunnel
    // badges from the previous scope must not bleed into the new one.
    const scopeKey = typeof msg.scopeKey === 'string' ? msg.scopeKey : null;
    if (scopeKey !== lastSqlScopeKey) {
      lastSqlScopeKey = scopeKey;
      selectedHanaServiceId = '';
      hanaTablesByServiceId = new Map();
      hanaTablesLoadingByServiceId = new Map();
      hanaTablesErrorByServiceId = new Map();
      hanaTunnelByServiceId = new Map();
    }

    liveAppOptions = rawApps
      .filter((app) => isRecord(app) && typeof app.name === 'string')
      .map((app) => ({
        id: typeof app.id === 'string' && app.id.length > 0 ? app.id : app.name,
        name: app.name,
        runningInstances:
          typeof app.runningInstances === 'number' && Number.isFinite(app.runningInstances)
            ? app.runningInstances
            : 0,
      }));

    appsLoadingState = 'loaded';
    appsErrorMessage = '';
    pruneSelectedAppIds();
    syncSqlAppTargetsFromCurrentApps();
    if (localServiceRootFolderPath.length > 0) {
      refreshServiceMappingsAfterAppsLoaded();
    } else {
      clearServiceMappingsForScope();
    }

    if (isWorkspaceLogsMounted()) {
      refreshWorkspaceLogsView();
      return;
    }
    if (isWorkspaceAppsMounted()) {
      refreshWorkspaceAppsView();
      return;
    }
    if (isWorkspaceSqlMounted()) {
      refreshMountedSqlWorkbench();
      return;
    }
    if (mode === 'selection') {
      return;
    }
    renderPrototype();
    return;
  }

  if (msg.type === RESTORE_CONFIRMED_SCOPE_MESSAGE_TYPE) {
    const scope = msg.scope;
    if (!isRecord(scope)) {
      return;
    }
    applyRestoredConfirmedScope(scope);
    return;
  }

  if (msg.type === 'sapTools.appsError') {
    liveAppOptions = [];
    appsLoadingState = 'error';
    appsErrorMessage = typeof msg.message === 'string' ? msg.message : 'Failed to load apps.';
    pruneSelectedAppIds();
    syncSqlAppTargetsFromCurrentApps();
    clearServiceMappingsForScope();

    if (isWorkspaceLogsMounted()) {
      refreshWorkspaceLogsView();
      return;
    }
    if (isWorkspaceAppsMounted()) {
      refreshWorkspaceAppsView();
      return;
    }
    if (isWorkspaceSqlMounted()) {
      refreshWorkspaceSqlView();
      return;
    }
    if (mode === 'selection') {
      return;
    }
    renderPrototype();
    return;
  }

  if (msg.type === HANA_SQL_FILE_OPEN_RESULT_MESSAGE_TYPE) {
    const serviceId = typeof msg.serviceId === 'string' ? msg.serviceId : '';
    const message = typeof msg.message === 'string' ? msg.message : '';
    const previousServiceId = selectedHanaServiceId;
    if (serviceId.length > 0) {
      selectedHanaServiceId = serviceId;
    }
    if (msg.success === true) {
      hanaQueryStatusTone = 'info';
      hanaQueryStatusMessage = '';
    } else {
      hanaQueryStatusTone = 'error';
      hanaQueryStatusMessage = message;
    }
    if (isWorkspaceSqlMounted()) {
      if (previousServiceId !== selectedHanaServiceId) {
        refreshMountedSqlWorkbench();
        return;
      }
      updateHanaQueryStatusElement();
      return;
    }
    refreshUiAfterSqlStateChange();
    return;
  }

  if (msg.type === HANA_TABLES_LOADED_MESSAGE_TYPE) {
    const serviceId = typeof msg.serviceId === 'string' ? msg.serviceId : '';
    if (serviceId.length === 0) {
      return;
    }
    const success = msg.success === true;
    const tables = Array.isArray(msg.tables) ? normalizeHanaTableEntries(msg.tables) : [];
    hanaTablesByServiceId = new Map(hanaTablesByServiceId);
    hanaTablesLoadingByServiceId = new Map(hanaTablesLoadingByServiceId);
    hanaTablesErrorByServiceId = new Map(hanaTablesErrorByServiceId);
    hanaTunnelByServiceId = new Map(hanaTunnelByServiceId);
    hanaTunnelByServiceId.set(serviceId, msg.tunnelActive === true);
    hanaTablesByServiceId.set(serviceId, tables);
    hanaTablesLoadingByServiceId.set(serviceId, success ? 'loaded' : 'error');
    if (success) {
      hanaTablesErrorByServiceId.delete(serviceId);
    } else {
      hanaTablesErrorByServiceId.set(
        serviceId,
        typeof msg.message === 'string' ? msg.message : 'Failed to load tables.'
      );
    }
    refreshUiAfterSqlStateChange();
    refreshSqlTunnelIndicators();
    return;
  }

  if (msg.type === HANA_TUNNEL_STATE_MESSAGE_TYPE) {
    const serviceId = typeof msg.serviceId === 'string' ? msg.serviceId : '';
    if (serviceId.length === 0) {
      return;
    }
    hanaTunnelByServiceId = new Map(hanaTunnelByServiceId);
    hanaTunnelByServiceId.set(serviceId, msg.active === true);
    refreshSqlTunnelIndicators();
    return;
  }

  if (msg.type === HANA_TABLE_SELECT_RESULT_MESSAGE_TYPE) {
    const serviceId = typeof msg.serviceId === 'string' ? msg.serviceId : '';
    const tableName = typeof msg.tableName === 'string' ? msg.tableName : '';
    if (serviceId.length > 0 && tableName.length > 0) {
      setHanaTableSelectLoading(serviceId, tableName, false);
    }
    const message = typeof msg.message === 'string' ? msg.message : '';
    hanaQueryStatusTone = msg.success === true ? 'success' : 'error';
    hanaQueryStatusMessage = message;
    if (isWorkspaceSqlMounted()) {
      updateHanaQueryStatusElement();
      return;
    }
    refreshUiAfterSqlStateChange();
    return;
  }

  if (msg.type === MICROSOFT_GRAPH_TOOL_PROGRESS_MESSAGE_TYPE) {
    applyMicrosoftGraphToolProgress(msg);
    if (mode === 'tools') {
      renderPrototype();
    }
    return;
  }

  if (msg.type === MICROSOFT_GRAPH_TOOL_RESULT_MESSAGE_TYPE) {
    applyMicrosoftGraphToolResult(msg);
    if (mode === 'tools') {
      renderPrototype();
    }
    return;
  }

  if (msg.type === CF_TOPOLOGY_MESSAGE_TYPE) {
    applyCfTopologySnapshot(msg.topology);
    return;
  }

  if (msg.type === TOPOLOGY_SCOPE_RESOLVED_MESSAGE_TYPE) {
    applyTopologyScopeResolved(msg.scope);
    return;
  }

  if (msg.type === 'sapTools.cacheState') {
    applyCacheStateSnapshot(msg.snapshot);
    return;
  }

  if (msg.type === 'sapTools.logoutResult') {
    const success = msg.success === true;
    settingsStatusMessage = success
      ? 'Logging out...'
      : (typeof msg.error === 'string' && msg.error.length > 0
        ? msg.error
        : 'Failed to logout.');
    renderPrototype();
    return;
  }

  if (msg.type === 'sapTools.localRootFolderUpdated') {
    if (typeof msg.path === 'string') {
      localServiceRootFolderPath = msg.path.trim();
      if (localServiceRootFolderPath.length === 0) {
        serviceExportStatusTone = 'error';
        serviceExportStatusMessage = 'Root folder is not selected yet.';
      }
      refreshServiceMappingsAfterAppsLoaded();
      refreshUiAfterServiceExportStateChange();
    }
    return;
  }

  if (msg.type === 'sapTools.serviceFolderMappingsLoaded') {
    const rawMappings = msg.mappings;
    if (!Array.isArray(rawMappings)) {
      return;
    }

    serviceFolderScanInProgress = false;
    serviceFolderMappings = normalizeServiceFolderMappings(rawMappings);
    pruneSelectedServiceExportAppId();
    // The "Mapped x/x services" summary line was intentionally dropped — the
    // mapping rows themselves already convey the mapped/unmapped state.
    serviceExportStatusTone = 'info';
    serviceExportStatusMessage = '';
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.serviceFolderMappingsError') {
    serviceFolderScanInProgress = false;
    serviceFolderMappings = [];
    selectedServiceExportAppId = '';
    serviceExportStatusTone = 'error';
    serviceExportStatusMessage =
      typeof msg.message === 'string' && msg.message.length > 0
        ? msg.message
        : 'Failed to scan local folder mappings.';
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.exportArtifactProgress') {
    serviceExportInProgress = msg.inProgress === true;
    if (typeof msg.message === 'string' && msg.message.length > 0) {
      serviceExportStatusTone = 'info';
      serviceExportStatusMessage = msg.message;
    }
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.exportArtifactResult') {
    serviceExportInProgress = false;
    const success = msg.success === true;
    serviceExportStatusTone = success ? 'success' : 'error';
    serviceExportStatusMessage =
      typeof msg.message === 'string' && msg.message.length > 0
        ? msg.message
        : success
          ? 'Export completed.'
          : 'Export failed.';
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.exportSqlToolsProgress') {
    serviceExportInProgress = msg.inProgress === true;
    if (typeof msg.message === 'string' && msg.message.length > 0) {
      serviceExportStatusTone = 'info';
      serviceExportStatusMessage = msg.message;
    }
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.exportSqlToolsResult') {
    serviceExportInProgress = false;
    const success = msg.success === true;
    serviceExportStatusTone = success ? 'success' : 'error';
    serviceExportStatusMessage =
      typeof msg.message === 'string' && msg.message.length > 0
        ? msg.message
        : success
          ? 'SQLTools config exported.'
          : 'SQLTools config export failed.';
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.localRegistryState') {
    localRegistryRunning = msg.running === true;
    localRegistryInstalling = msg.installing === true;
    localRegistryUrl = typeof msg.url === 'string' ? msg.url : '';
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.buildPublishPreview') {
    if (Array.isArray(msg.order)) {
      buildPublishOrder = msg.order.filter((name) => typeof name === 'string');
      // Only clear ALL statuses if this is a global "Build All" run.
      // If it's a single build, we keep existing statuses so other packages' "Published" badges remain.
      if (buildingPackageName.length === 0) {
        buildPublishStatuses = {};
      } else {
        for (const name of buildPublishOrder) {
          buildPublishStatuses[name] = { phase: '', status: '', message: '' };
        }
      }
      buildPublishCompletedCount = 0;
      refreshUiAfterServiceExportStateChange();
    }
    return;
  }

  if (msg.type === 'sapTools.buildPublishProgress') {
    if (typeof msg.packageName === 'string') {
      const prevStatus = buildPublishStatuses[msg.packageName];
      const newStatus = typeof msg.status === 'string' ? msg.status : '';
      buildPublishStatuses[msg.packageName] = {
        phase: typeof msg.phase === 'string' ? msg.phase : '',
        status: newStatus,
        message: typeof msg.message === 'string' ? msg.message : '',
      };
      // When a package finishes successfully in a Build All run, show its Published badge
      // and increment the completed counter for progress tracking.
      if (msg.phase === 'publish' && newStatus === 'done' && prevStatus?.status !== 'done' && buildingPackageName.length === 0) {
        buildResultPackageName = msg.packageName;
        buildResultSuccess = true;
        buildResultMessage = 'Built & published';
        buildPublishCompletedCount += 1;
      }
      updateSinglePackageBuildUI(msg.packageName);
    }
    return;
  }

  if (msg.type === 'sapTools.buildPublishResult') {
    buildPublishInProgress = false;
    buildPublishCompletedCount = 0;
    const success = msg.success === true;
    const resultText =
      typeof msg.message === 'string' && msg.message.length > 0
        ? msg.message
        : success
          ? ''
          : 'Build & publish failed.';

    // Single-package build → show an in-list result on that package row only.
    if (buildingPackageName.length > 0) {
      const pkgName = buildingPackageName;
      buildingPackageName = '';
      buildResultPackageName = pkgName;
      buildResultSuccess = success;
      buildResultMessage = success ? 'Built & published' : resultText;
      if (success) {
        buildPublishStatuses[pkgName] = { phase: 'publish', status: 'done', message: 'Built & published' };
      }

      if (buildResultTimer !== null) {
        clearTimeout(buildResultTimer);
        buildResultTimer = null;
      }
      updateSinglePackageBuildUI(pkgName);
    } else {
      buildPublishResultMessage = resultText;
      buildPublishResultTone = success ? 'success' : 'error';
      refreshUiAfterServiceExportStateChange();
    }
    return;
  }

  if (msg.type === 'sapTools.localPackagesLoading') {
    detectedPackagesLoading = msg.loading === true;
    refreshUiAfterServiceExportStateChange();
    return;
  }

  if (msg.type === 'sapTools.localPackagesLoaded') {
    detectedPackagesLoading = false;
    detectedPackagesConfigured = msg.configured === true;
    detectedPackagesPatterns = typeof msg.patterns === 'string' ? msg.patterns : '';
    detectedPackagesError = typeof msg.error === 'string' ? msg.error : '';
    detectedPackages = Array.isArray(msg.packages)
      ? msg.packages.filter((pkg) => isRecord(pkg) && typeof pkg.name === 'string')
      : [];
    refreshUiAfterServiceExportStateChange();
    return;
  }

});

if (!(appElement instanceof HTMLElement)) {
  throw new Error('Prototype root element not found.');
}

const designIdRaw = Number.parseInt(document.body.dataset.designId ?? '34', 10);
const activeDesign =
  DESIGN_CATALOG.find((design) => design.id === designIdRaw) ?? DESIGN_CATALOG[0];

const groupLookup = new Map(REGION_GROUPS.map((group) => [group.id, group]));
const regionLookup = new Map(
  REGION_GROUPS.flatMap((group) => group.regions.map((region) => [region.id, region]))
);
const regionGroupLookup = new Map(
  REGION_GROUPS.flatMap((group) => group.regions.map((region) => [region.id, group.id]))
);
let mode = 'selection';
let selectedGroupId = '';
let selectedRegionId = '';
let selectedOrgId = '';
let selectedOrgName = '';
let selectedSpaceId = '';
let orgSearchQuery = '';
let regionSearchQuery = '';
let activeTabId = 'logs';
let isConnected = false;
let isLiveMode = false;
let selectedLevel = 'all';
let searchKeyword = '';
let appCatalogSearchKeyword = '';
let serviceExportSearchKeyword = '';
let selectedLogId = '';
let statusMessage = '';
let lastSyncLabel = 'Not synced yet';
let logsData = cloneSeedLogs();
let selectedAppLogIds = [];
let activeAppLogIds = [];
let pausedAppLogIds = [];
let pendingSelectionMotion = null;
const DESIGN_PATTERN_CLASS_PREFIX = 'pattern-';
const DESIGN_THEME_CLASS_PREFIX = 'theme-';
const SELECTION_STAGE_SLOT_IDS = ['area', 'region', 'org', 'space', 'confirm'];

applyDesignTokens(activeDesign);
renderPrototype();
requestInitialState();

window.addEventListener('resize', () => {
  hanaSqlResultContextMenuState = null;
  queueSqlTableNameTruncation();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || hanaSqlResultContextMenuState === null) {
    return;
  }
  hanaSqlResultContextMenuState = null;
  refreshSqlResultPreviewPanel();
});

if (typeof window.ResizeObserver === 'function') {
  sqlTableNameResizeObserver = new window.ResizeObserver(() => {
    hanaSqlResultContextMenuState = null;
    queueSqlTableNameTruncation();
  });
  sqlTableNameResizeObserver.observe(appElement);
}

appElement.addEventListener('click', (event) => {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) {
    return;
  }

  const actionTarget = eventTarget.closest('[data-action]');
  const target = eventTarget instanceof HTMLElement
    ? eventTarget
    : actionTarget ?? eventTarget.parentElement;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const clickedContextMenu = target.closest('[data-role="sql-result-context-menu"]');
  const clickedAction = actionTarget ?? target.closest('[data-action]');
  if (
    hanaSqlResultContextMenuState !== null &&
    !(clickedContextMenu instanceof HTMLElement) &&
    !(clickedAction instanceof HTMLElement)
  ) {
    hanaSqlResultContextMenuState = null;
    refreshSqlResultPreviewPanel();
    return;
  }

  const selectionModeBtn = target.closest('[data-action="switch-selection-mode"]');
  if (selectionModeBtn instanceof HTMLButtonElement) {
    const nextMode = selectionModeBtn.dataset.selectionMode ?? '';
    if (nextMode === 'quick' || nextMode === 'custom') {
      activeSelectionMode = nextMode;
      resetQuickSelectionState();
      renderPrototype();
    }
    return;
  }

  const topologyOrgButton = target.closest('[data-topology-region-key]');
  if (topologyOrgButton instanceof HTMLButtonElement) {
    if (topologyOrgButton.disabled || topologyOrgButton.dataset.disabled === 'true') {
      return;
    }
    const regionKey = topologyOrgButton.dataset.topologyRegionKey ?? '';
    const orgName = topologyOrgButton.dataset.topologyOrg ?? '';
    if (regionKey.length === 0 || orgName.length === 0) {
      return;
    }
    if (activeSelectionMode === 'quick') {
      const account = findTopologyAccount(regionKey, orgName);
      quickPickRegionKey = regionKey;
      quickPickOrgName = orgName;
      quickPickOrgSpaces = Array.isArray(account?.spaces) ? [...account.spaces] : [];
      quickPickSpaceName = quickPickOrgSpaces.length === 1 ? quickPickOrgSpaces[0] : '';
      quickConfirmInProgress = false;
      quickConfirmError = '';
      updateQuickPanelInPlace();
      return;
    }
    if (topologyPickInProgress) {
      return;
    }
    topologyPickInProgress = true;
    postTopologyOrgSelection(regionKey, orgName);
    return;
  }

  const quickSpaceButton = target.closest('[data-quick-space]');
  if (quickSpaceButton instanceof HTMLButtonElement) {
    const spaceName = quickSpaceButton.dataset.quickSpace ?? '';
    if (spaceName.length === 0 || quickPickSpaceName === spaceName) {
      return;
    }
    quickPickSpaceName = spaceName;
    quickConfirmError = '';
    updateQuickPanelInPlace();
    return;
  }

  const areaButton = target.closest('[data-group-id]');
  if (areaButton instanceof HTMLButtonElement) {
    if (areaButton.disabled) {
      return;
    }
    const nextGroupId = areaButton.dataset.groupId ?? '';
    if (selectedGroupId !== nextGroupId) {
      queueSelectionMotion(areaButton, buildDataSelector('data-group-id', nextGroupId));
    }
    handleGroupSelection(nextGroupId);
    rerenderSelectionStageSlotsWithMotion(SELECTION_STAGE_SLOT_IDS);
    return;
  }

  const regionButton = target.closest('[data-region-id]');
  if (regionButton instanceof HTMLButtonElement) {
    if (regionButton.disabled) {
      return;
    }
    const nextRegionId = regionButton.dataset.regionId ?? '';
    if (selectedRegionId === nextRegionId) {
      return;
    }
    queueSelectionMotion(regionButton, buildDataSelector('data-region-id', nextRegionId));
    handleRegionSelection(nextRegionId);
    rerenderSelectionStageSlotsWithMotion(['area', 'region', 'org', 'space', 'confirm']);
    return;
  }

  const orgButton = target.closest('[data-org-id]');
  if (orgButton instanceof HTMLButtonElement) {
    const nextOrgId = orgButton.dataset.orgId ?? '';
    if (selectedOrgId === nextOrgId) {
      return;
    }
    queueSelectionMotion(orgButton, buildDataSelector('data-org-id', nextOrgId));
    handleOrgSelection(nextOrgId);
    rerenderSelectionStageSlotsWithMotion(['org', 'space', 'confirm']);
    return;
  }

  const spaceButton = target.closest('[data-space-id]');
  if (spaceButton instanceof HTMLButtonElement) {
    const nextSpaceId = spaceButton.dataset.spaceId ?? '';
    if (selectedSpaceId === nextSpaceId) {
      return;
    }
    queueSelectionMotion(spaceButton, buildDataSelector('data-space-id', nextSpaceId));
    handleSpaceSelection(nextSpaceId);
    rerenderSelectionStageSlotsWithMotion(['space', 'confirm']);
    return;
  }

  if (handleAppLogRowClick(target)) {
    return;
  }

  const actionElement = target.closest('[data-action]');
  if (!(actionElement instanceof HTMLElement)) {
    return;
  }

  const action = actionElement.dataset.action ?? '';
  const modeBeforeAction = mode;
  const tabBeforeAction = activeTabId;
  if (!handleAction(action, actionElement)) {
    return;
  }

  if (shouldRefreshWorkspaceLogsOnly(action, modeBeforeAction, tabBeforeAction)) {
    refreshWorkspaceLogsView();
    return;
  }

  if (shouldRefreshWorkspaceAppsOnly(action, modeBeforeAction, tabBeforeAction)) {
    refreshWorkspaceAppsView();
    return;
  }

  if (shouldRefreshWorkspaceSqlOnly(action, modeBeforeAction, tabBeforeAction)) {
    if (action === 'select-hana-service') {
      refreshMountedSqlWorkbench();
    } else {
      updateHanaQueryStatusElement();
      refreshSqlResultPreviewPanel();
    }
    return;
  }

  if (mode !== modeBeforeAction || mode !== 'selection') {
    renderPrototype();
    return;
  }

  const affectedSlots = resolveSelectionStageSlotsForAction(action);
  if (affectedSlots.length === 0) {
    rerenderSelectionStageSlotsWithMotion(SELECTION_STAGE_SLOT_IDS);
    return;
  }

  rerenderSelectionStageSlotsWithMotion(affectedSlots);
});

appElement.addEventListener('contextmenu', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const cell = target.closest('[data-role="sql-result-cell"]');
  if (!(cell instanceof HTMLElement)) {
    if (hanaSqlResultContextMenuState !== null) {
      hanaSqlResultContextMenuState = null;
      refreshSqlResultPreviewPanel();
    }
    return;
  }
  const rowIndex = Number.parseInt(cell.dataset.rowIndex ?? '', 10);
  const columnIndex = Number.parseInt(cell.dataset.columnIndex ?? '', 10);
  const statementIndex = Number.parseInt(cell.dataset.statementIndex ?? '', 10);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) {
    return;
  }
  event.preventDefault();
  hanaSqlResultExportMenuOpen = false;
  hanaSqlResultContextMenuState = {
    columnIndex,
    rowIndex,
    statementIndex: Number.isInteger(statementIndex) ? statementIndex : null,
    x: Math.min(event.clientX, Math.max(8, window.innerWidth - 190)),
    y: Math.min(event.clientY, Math.max(8, window.innerHeight - 96)),
  };
  refreshSqlResultPreviewPanel();
});

appElement.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const role = target.dataset.role ?? '';
  if (role === 'microsoft-graph-tool-field') {
    updateMicrosoftGraphToolFormValue(
      target.dataset.toolId ?? '',
      target.dataset.field ?? '',
      target.value
    );
    return;
  }

  if (role === 'log-search') {
    searchKeyword = target.value;
    renderPrototype();
    return;
  }

  if (role === 'app-log-search') {
    appCatalogSearchKeyword = target.value;
    if (isWorkspaceLogsMounted()) {
      refreshWorkspaceLogsView();
      return;
    }
    renderPrototype();
    return;
  }

  if (role === 'service-export-search') {
    serviceExportSearchKeyword = target.value;
    if (isWorkspaceAppsMounted()) {
      refreshWorkspaceAppsView();
      return;
    }
    renderPrototype();
    return;
  }

  if (role === 'sql-app-search') {
    sqlAppSearchKeyword = target.value;
    if (isWorkspaceSqlMounted()) {
      refreshSqlServiceSearchResults();
      return;
    }
    renderPrototype();
    return;
  }

  if (role === 'sql-table-search') {
    sqlTableSearchKeyword = target.value;
    if (isWorkspaceSqlMounted()) {
      queueSqlTableResultsRefresh();
      return;
    }
    renderPrototype();
    return;
  }

  if (role === 'org-search') {
    orgSearchQuery = target.value;
    updateOrgSearchResults();
    return;
  }

  if (role === 'region-search') {
    regionSearchQuery = target.value;
    updateRegionSearchResults();
    return;
  }

  if (role === 'topology-org-search') {
    topologyOrgSearchQuery = target.value;
    if (activeSelectionMode === 'quick') {
      updateQuickOrgSearchResultsInPlace();
      return;
    }
    updateTopologyOrgSearchResults();
  }
});

// ── APIs Explorer Events ──────────────────────────────────────────────────────
appElement.addEventListener('click', (event) => {
  const target = event.target;
  const actionElement = target.closest('[data-action]');
  if (!actionElement) return;

  const action = actionElement.dataset.action;

  if (action === 'api-select-entity') {
    apiSelectedEntity = actionElement.dataset.entityName ?? '';
    apiResultState = 'idle';
    apiResultPayload = null;
    renderPrototype();
    return;
  }

  if (action === 'api-switch-view') {
    apiActiveView = actionElement.dataset.viewId ?? 'json';
    renderPrototype();
    return;
  }

  if (action === 'api-execute-request') {
    apiResultState = 'loading';
    renderPrototype();

    setTimeout(() => {
      apiResultState = 'done';
      apiResultTime = Math.floor(100 + Math.random() * 80);
      apiResultStatus = '200 OK';

      const appResponses = API_MOCK_RESPONSES[apiSelectedAppId] || {};
      const response = appResponses[apiSelectedEntity] || {
        value: [{ info: "No mock data configured for this entity", entity: apiSelectedEntity }]
      };
      apiResultPayload = response;

      renderPrototype();
    }, 850);
  }
});

appElement.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const action = target.dataset.action;
  if (action === 'api-select-auth') {
    apiAuthMethod = target.value;
    renderPrototype();
  }
});

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
        const currentCatalog = API_MOCK_CATALOG[apiSelectedAppId] || { servicePath: '/unknown' };
        const routeBase = `https://demo-env-${apiSelectedAppId}.cfapps.region.hana.ondemand.com`;
        const fullUrl = `${routeBase}${currentCatalog.servicePath}/${apiSelectedEntity}${buildApiQueryString()}`;
        urlInput.value = fullUrl;
      }
    }
  }
});
