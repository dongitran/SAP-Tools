import { DESIGN_CATALOG, REGION_GROUPS } from './design-catalog.js?v=20260509a';

const TAB_ITEMS = [
  { id: 'logs', label: 'Logs' },
  { id: 'apps', label: 'Apps' },
  { id: 'settings', label: 'SQL' },
];

const DEFAULT_ORG_OPTIONS = [
  {
    id: 'org-core-prod',
    name: 'core-platform-prod',
    spaces: ['prod', 'staging', 'integration'],
  },
  {
    id: 'org-finance-prod',
    name: 'finance-services-prod',
    spaces: ['prod', 'uat', 'sandbox'],
  },
  {
    id: 'org-retail-prod',
    name: 'retail-experience-prod',
    spaces: ['prod', 'campaigns', 'performance'],
  },
  {
    id: 'org-data-prod',
    name: 'data-foundation-prod',
    spaces: ['prod', 'etl', 'observability'],
  },
];

const BR10_ORG_OPTIONS = [
  { id: 'org-br10-core-platform', name: 'core-platform-prod', spaces: ['prod', 'staging', 'integration'] },
  { id: 'org-br10-finance-services', name: 'finance-services-prod', spaces: ['prod', 'uat', 'sandbox'] },
  { id: 'org-br10-retail-experience', name: 'retail-experience-prod', spaces: ['prod', 'campaigns', 'performance'] },
  { id: 'org-br10-data-foundation', name: 'data-foundation-prod', spaces: ['prod', 'etl', 'observability'] },
  { id: 'org-br10-tax-engineering', name: 'tax-engineering-prod', spaces: ['prod', 'uat'] },
  { id: 'org-br10-payments-ledger', name: 'payments-ledger-prod', spaces: ['prod', 'staging'] },
  { id: 'org-br10-supply-chain', name: 'supply-chain-control-prod', spaces: ['prod', 'integration'] },
  { id: 'org-br10-customer-insights', name: 'customer-insights-prod', spaces: ['prod', 'performance'] },
  { id: 'org-br10-partner-gateway', name: 'partner-gateway-prod', spaces: ['prod', 'sandbox'] },
  { id: 'org-br10-revenue-ops', name: 'revenue-operations-prod', spaces: ['prod', 'uat', 'observability'] },
  { id: 'org-br10-commerce-catalog', name: 'commerce-catalog-prod', spaces: ['prod', 'campaigns'] },
  { id: 'org-br10-risk-compliance', name: 'risk-compliance-prod', spaces: ['prod', 'staging', 'observability'] },
  { id: 'org-br10-identity-access', name: 'identity-access-prod', spaces: ['prod', 'integration', 'sandbox'] },
  {
    id: 'org-br10-billing-reconciliation',
    name: 'billing-reconciliation-prod',
    spaces: ['prod', 'uat', 'etl'],
  },
];

const SPACE_APP_OPTIONS = {
  prod: ['billing-api', 'payments-worker', 'audit-service', 'destination-adapter'],
  staging: ['billing-api-staging', 'payments-worker-staging', 'audit-service-staging'],
  integration: ['billing-api-int', 'payments-worker-int', 'events-int-consumer'],
  uat: [
    'finance-uat-api',
    'finance-uat-worker',
    'finance-uat-audit',
    'finance-uat-ledger',
    'finance-uat-recon',
    'finance-uat-payments',
    'finance-uat-tax',
    'finance-uat-fx',
    'finance-uat-risk',
    'finance-uat-notify',
    'finance-uat-reporting',
    'finance-uat-archive',
  ],
  sandbox: ['sandbox-api', 'sandbox-worker', 'sandbox-observer'],
  campaigns: ['campaign-engine', 'campaign-events', 'campaign-content'],
  performance: ['perf-api', 'perf-worker', 'perf-load-probe'],
  etl: ['etl-scheduler', 'etl-transformer', 'etl-writer'],
  observability: ['metrics-collector', 'traces-forwarder', 'alerts-dispatcher'],
};

const LOG_SEED = [
  {
    id: 'log-001',
    time: '11:25:18',
    level: 'INFO',
    app: 'billing-api',
    instance: '0',
    message: 'Request completed with 200 status for invoice summary endpoint.',
  },
  {
    id: 'log-002',
    time: '11:25:22',
    level: 'WARN',
    app: 'billing-api',
    instance: '1',
    message: 'Retrying connection to dependent destination service after timeout.',
  },
  {
    id: 'log-003',
    time: '11:25:30',
    level: 'ERR',
    app: 'payments-worker',
    instance: '0',
    message: 'Failed to bind queue consumer because of temporary authorization error.',
  },
  {
    id: 'log-004',
    time: '11:25:36',
    level: 'INFO',
    app: 'payments-worker',
    instance: '0',
    message: 'Queue consumer resumed and processing backlog messages.',
  },
  {
    id: 'log-005',
    time: '11:25:44',
    level: 'DEBUG',
    app: 'audit-service',
    instance: '2',
    message: 'Generated trace id for cf request flow in middleware.',
  },
  {
    id: 'log-006',
    time: '11:25:51',
    level: 'INFO',
    app: 'audit-service',
    instance: '2',
    message: 'Persisted audit event for org and space operation.',
  },
];

const appElement = document.getElementById('app');
const REQUEST_INITIAL_STATE_MESSAGE_TYPE = 'sapTools.requestInitialState';
const REGION_SELECTED_MESSAGE_TYPE = 'sapTools.regionSelected';
const CONFIRM_SCOPE_MESSAGE_TYPE = 'sapTools.confirmScope';
const OPEN_CF_LOGS_PANEL_MESSAGE_TYPE = 'sapTools.openCfLogsPanel';
const ORG_SELECTED_MESSAGE_TYPE = 'sapTools.orgSelected';
const SPACE_SELECTED_MESSAGE_TYPE = 'sapTools.spaceSelected';
const ACTIVE_APPS_CHANGED_MESSAGE_TYPE = 'sapTools.activeAppsChanged';
const UPDATE_SYNC_INTERVAL_MESSAGE_TYPE = 'sapTools.updateSyncInterval';
const SYNC_NOW_MESSAGE_TYPE = 'sapTools.syncNow';
const LOGOUT_MESSAGE_TYPE = 'sapTools.logout';
const SELECT_LOCAL_ROOT_FOLDER_MESSAGE_TYPE = 'sapTools.selectLocalRootFolder';
const BUILD_PUBLISH_ALL_MESSAGE_TYPE = 'sapTools.buildPublishAll';
const BUILD_SINGLE_PACKAGE_MESSAGE_TYPE = 'sapTools.buildSinglePackage';
const LOCAL_REGISTRY_START_MESSAGE_TYPE = 'sapTools.localRegistryStart';
const LOCAL_REGISTRY_STOP_MESSAGE_TYPE = 'sapTools.localRegistryStop';
const LOCAL_REGISTRY_STATUS_MESSAGE_TYPE = 'sapTools.localRegistryStatus';
const OPEN_LOCAL_PACKAGES_SETTINGS_MESSAGE_TYPE = 'sapTools.openLocalPackagesSettings';
const REFRESH_SERVICE_FOLDER_MAPPINGS_MESSAGE_TYPE =
  'sapTools.refreshServiceFolderMappings';
const SELECT_SERVICE_FOLDER_MAPPING_MESSAGE_TYPE = 'sapTools.selectServiceFolderMapping';
const EXPORT_SERVICE_ARTIFACTS_MESSAGE_TYPE = 'sapTools.exportServiceArtifacts';
const EXPORT_SQLTOOLS_CONFIG_MESSAGE_TYPE = 'sapTools.exportSqlToolsConfig';
const OPEN_HANA_SQL_FILE_MESSAGE_TYPE = 'sapTools.openHanaSqlFile';
const RUN_HANA_TABLE_SELECT_MESSAGE_TYPE = 'sapTools.runHanaTableSelect';
const RESTORE_CONFIRMED_SCOPE_MESSAGE_TYPE = 'sapTools.restoreConfirmedScope';
const HANA_SQL_FILE_OPEN_RESULT_MESSAGE_TYPE = 'sapTools.hanaSqlFileOpenResult';
const HANA_TABLES_LOADED_MESSAGE_TYPE = 'sapTools.hanaTablesLoaded';
const HANA_TABLE_SELECT_RESULT_MESSAGE_TYPE = 'sapTools.hanaTableSelectResult';
const CF_TOPOLOGY_MESSAGE_TYPE = 'sapTools.cfTopology';
const TOPOLOGY_SCOPE_RESOLVED_MESSAGE_TYPE = 'sapTools.topologyScopeResolved';
const TOPOLOGY_ORG_SELECTED_MESSAGE_TYPE = 'sapTools.topologyOrgSelected';
const QUICK_SCOPE_CONFIRM_MESSAGE_TYPE = 'sapTools.quickScopeConfirm';
const TOPOLOGY_ORG_SEARCH_LIMIT = 50;
const vscodeApi = resolveVscodeApi();

const SYNC_INTERVAL_OPTIONS = [12, 24, 48, 96];
const SERVICE_MAP_PATH_LABEL_MAX_CHARS = 72;
const SERVICE_MAP_PATH_LABEL_ELLIPSIS = '...';

// Live data state — only used in VSCode mode (vscodeApi !== null).
let liveOrgOptions = null;        // [{guid, name}] when loaded, null = use mock data
let liveOrgLookup = new Map();    // guid → {guid, name}
let liveSpaceNames = null;        // string[] when loaded, null = use mock data
let liveAppOptions = null;        // [{id, name, runningInstances}] when loaded, null = use mock data
let orgsLoadingState = 'idle';    // 'idle' | 'loading' | 'loaded' | 'error'
let spacesLoadingState = 'idle';  // 'idle' | 'loading' | 'loaded' | 'error'
let appsLoadingState = 'idle';    // 'idle' | 'loading' | 'loaded' | 'error'
let orgsErrorMessage = '';
let spacesErrorMessage = '';
let appsErrorMessage = '';
let syncIntervalHours = 24;
let syncInProgress = false;
let lastSyncStartedAt = null;
let lastSyncCompletedAt = null;
let nextSyncAt = null;
let lastSyncError = '';
let activeUserEmail = '';
let settingsStatusMessage = '';
let previousModeBeforeSettings = 'selection';
let regionAccessById = new Map();
let localServiceRootFolderPath = '';
let serviceFolderMappings = [];
let selectedServiceExportAppId = '';
let serviceExportStatusMessage = '';
let serviceExportStatusTone = 'info';
let serviceFolderScanInProgress = false;
let serviceExportInProgress = false;
let localRegistryRunning = false;
let localRegistryInstalling = false;
let localRegistryUrl = '';
let buildPublishInProgress = false;
let buildPublishOrder = [];
let buildPublishStatuses = {};
let buildPublishResultMessage = '';
let buildPublishResultTone = 'info';
// Per-package single-build effect state (in-list, no separate panel).
let buildingPackageName = '';
let buildResultPackageName = '';
let buildResultSuccess = false;
let buildResultMessage = '';
let buildResultTimer = null;
let detectedPackages = [];
let detectedPackagesConfigured = false;
let detectedPackagesLoading = false;
let detectedPackagesPatterns = '';
let detectedPackagesError = '';
let hanaServiceOptions = null;
let selectedHanaServiceId = '';
let sqlAppSearchKeyword = '';
let hanaQueryStatusMessage = '';
let hanaQueryStatusTone = 'info';
let hanaTablesByServiceId = new Map();
let hanaTablesLoadingByServiceId = new Map();
let hanaTablesErrorByServiceId = new Map();
let sqlTableSearchKeyword = '';
let hanaTableSelectLoadingKeys = new Set();
const hanaTableDisplayNameCache = new Map();
let hanaSqlResultPreviewState = null;
let hanaSqlResultExportMenuOpen = false;
let hanaSqlResultContextMenuState = null;
const SQL_TABLE_NAME_WIDTH_TOLERANCE = 1;
let sqlTableResultsRefreshTimer = 0;
let sqlTableNameTruncationFrame = 0;
let sqlTableNameResizeObserver = null;
let sqlTableNamePanelWidth = -1;
let sqlTableNameMeasureContext = null;
let cfTopology = resolveInitialCfTopology();
let topologyOrgSearchQuery = '';
let topologyPickInProgress = false;
let activeSelectionMode = resolveInitialSelectionMode();
let quickPickRegionKey = '';
let quickPickOrgName = '';
let quickPickOrgSpaces = [];
let quickPickSpaceName = '';
let quickConfirmInProgress = false;
let quickConfirmError = '';

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
      buildPublishStatuses = {};
      refreshUiAfterServiceExportStateChange();
    }
    return;
  }

  if (msg.type === 'sapTools.buildPublishProgress') {
    if (typeof msg.packageName === 'string') {
      buildPublishStatuses[msg.packageName] = {
        phase: typeof msg.phase === 'string' ? msg.phase : '',
        status: typeof msg.status === 'string' ? msg.status : '',
        message: typeof msg.message === 'string' ? msg.message : '',
      };
      if (buildingPackageName.length === 0) {
        refreshUiAfterServiceExportStateChange();
      }
    }
    return;
  }

  if (msg.type === 'sapTools.buildPublishResult') {
    buildPublishInProgress = false;
    const success = msg.success === true;
    const resultText =
      typeof msg.message === 'string' && msg.message.length > 0
        ? msg.message
        : success
          ? 'Build & publish completed.'
          : 'Build & publish failed.';

    // Single-package build → show an in-list result on that package row only.
    if (buildingPackageName.length > 0) {
      const pkgName = buildingPackageName;
      buildingPackageName = '';
      buildResultPackageName = pkgName;
      buildResultSuccess = success;
      buildResultMessage = success ? 'Built & published' : resultText;

      if (buildResultTimer !== null) {
        clearTimeout(buildResultTimer);
        buildResultTimer = null;
      }
      updateSinglePackageBuildUI(pkgName);
      if (success) {
        // Keep the green confirmation for ~2s, then quietly fade it away.
        buildResultTimer = setTimeout(() => {
          buildResultTimer = null;
          buildResultPackageName = '';
          updateSinglePackageBuildUI(pkgName);
        }, 2000);
      }
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
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const clickedContextMenu = target.closest('[data-role="sql-result-context-menu"]');
  const clickedAction = target.closest('[data-action]');
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
    action === 'select-export-service' ||
    action === 'export-service-artifacts' ||
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
  const selectedMapping = mappingRows.find(
    (mapping) => mapping.appId === selectedServiceExportAppId && mapping.isMapped
  );
  const selectedSpaceLabel =
    selectedSpaceId.length > 0 ? selectedSpaceId : 'Select a space first';
  const selectedServiceLabel =
    selectedMapping === undefined ? 'No service selected' : selectedMapping.appName;
  const canExport = selectedMapping !== undefined && !serviceExportInProgress;
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

  const registryRowElement = exportTab.querySelector('.local-registry-row');
  if (registryRowElement instanceof HTMLElement) {
    registryRowElement.outerHTML = renderLocalRegistryRow();
  }

  const detectedPackagesElement = exportTab.querySelector('[data-role="detected-packages"]');
  if (detectedPackagesElement instanceof HTMLElement) {
    // Save scroll position of the package list
    const listElement = detectedPackagesElement.querySelector('.detected-pkg-list');
    const scrollTop = listElement ? listElement.scrollTop : 0;

    // Prevent wiping the list DOM if a single package build is in progress.
    // The single package build UI is handled via targeted updates in updateSinglePackageBuildUI.
    if (buildingPackageName.length === 0) {
      detectedPackagesElement.innerHTML = renderDetectedPackagesInner();

      // Restore scroll position
      if (scrollTop > 0) {
        const newListElement = detectedPackagesElement.querySelector('.detected-pkg-list');
        if (newListElement) {
          newListElement.scrollTop = scrollTop;
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

  const selectedLabelElement = exportTab.querySelector(
    '[data-role="service-export-selected-label"]'
  );
  if (!(selectedLabelElement instanceof HTMLElement)) {
    renderPrototype();
    return;
  }
  selectedLabelElement.textContent = selectedServiceLabel;

  const exportButton = exportTab.querySelector('[data-action="export-service-artifacts"]');
  if (exportButton instanceof HTMLButtonElement) {
    exportButton.disabled = !canExport;
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

function handleAction(action, actionElement) {
  const selectionActionHandled = handleSelectionFlowAction(action);
  if (selectionActionHandled !== null) {
    return selectionActionHandled;
  }

  const tabActionHandled = handleTabAction(action, actionElement.dataset.tabId ?? '');
  if (tabActionHandled !== null) {
    return tabActionHandled;
  }

  const logsActionHandled = handleLogsAction(action, actionElement);
  if (logsActionHandled !== null) {
    return logsActionHandled;
  }

  const serviceExportActionHandled = handleServiceExportAction(action, actionElement);
  if (serviceExportActionHandled !== null) {
    return serviceExportActionHandled;
  }

  const sqlTabActionHandled = handleSqlTabAction(action, actionElement);
  if (sqlTabActionHandled !== null) {
    return sqlTabActionHandled;
  }

  return false;
}

function handleSqlTabAction(action, actionElement) {
  if (action === 'toggle-sql-result-export-menu') {
    hanaSqlResultExportMenuOpen = !hanaSqlResultExportMenuOpen;
    hanaSqlResultContextMenuState = null;
    return true;
  }

  if (
    action === 'copy-sql-result-csv' ||
    action === 'copy-sql-result-json' ||
    action === 'export-sql-result-csv' ||
    action === 'export-sql-result-json'
  ) {
    return triggerPrototypeSqlResultExportAction(action);
  }

  if (
    action === 'copy-sql-result-row-object' ||
    action === 'copy-sql-result-cell-value'
  ) {
    return triggerPrototypeSqlResultContextCopyAction(action);
  }

  if (action === 'select-hana-service') {
    const serviceId = actionElement.dataset.serviceId ?? '';
    if (serviceId.length === 0) {
      return false;
    }
    if (selectedHanaServiceId !== serviceId) {
      sqlTableSearchKeyword = '';
      hanaSqlResultPreviewState = null;
      hanaSqlResultExportMenuOpen = false;
      hanaSqlResultContextMenuState = null;
    }
    selectedHanaServiceId = serviceId;
    if (vscodeApi !== null && !hanaTablesByServiceId.has(serviceId)) {
      hanaTablesLoadingByServiceId = new Map(hanaTablesLoadingByServiceId);
      hanaTablesLoadingByServiceId.set(serviceId, 'loading');
    }
    primeHanaTablesForStandalone(serviceId);
    return triggerOpenHanaSqlFile();
  }

  if (action === 'run-hana-table-select') {
    const serviceId = actionElement.dataset.serviceId ?? '';
    const tableName = actionElement.dataset.tableName ?? '';
    const row = actionElement.closest('[data-role="hana-table-row"]');
    const displayTableName =
      row instanceof HTMLElement ? row.dataset.displayTableName ?? tableName : tableName;
    if (serviceId.length === 0 || tableName.length === 0) {
      return false;
    }
    return triggerRunHanaTableSelect(serviceId, tableName, displayTableName);
  }

  if (action === 'refresh-hana-tables') {
    return triggerRefreshHanaTables();
  }

  return null;
}

function triggerRefreshHanaTables() {
  const serviceId = selectedHanaServiceId;
  if (serviceId.length === 0) {
    return false;
  }
  const service = resolveHanaServices().find((entry) => entry.id === serviceId);
  if (service === undefined) {
    return false;
  }
  hanaTablesLoadingByServiceId = new Map(hanaTablesLoadingByServiceId);
  hanaTablesLoadingByServiceId.set(serviceId, 'loading');
  hanaTablesErrorByServiceId = new Map(hanaTablesErrorByServiceId);
  hanaTablesErrorByServiceId.delete(serviceId);
  if (vscodeApi !== null) {
    vscodeApi.postMessage({
      type: 'sapTools.refreshHanaTables',
      serviceId: service.id,
      serviceName: service.name,
    });
    return true;
  }
  hanaTablesByServiceId = new Map(hanaTablesByServiceId);
  hanaTablesByServiceId.delete(serviceId);
  primeHanaTablesForStandalone(serviceId);
  return true;
}

function primeHanaTablesForStandalone(serviceId) {
  if (vscodeApi !== null) {
    return;
  }
  if (hanaTablesByServiceId.has(serviceId)) {
    return;
  }
  if (hanaTablesLoadingByServiceId.get(serviceId) === 'loading') {
    return;
  }
  const service = resolveHanaServices().find((entry) => entry.id === serviceId);
  if (service === undefined) {
    return;
  }
  hanaTablesLoadingByServiceId = new Map(hanaTablesLoadingByServiceId);
  hanaTablesLoadingByServiceId.set(serviceId, 'loading');
  window.setTimeout(() => {
    hanaTablesByServiceId = new Map(hanaTablesByServiceId);
    hanaTablesLoadingByServiceId = new Map(hanaTablesLoadingByServiceId);
    hanaTablesByServiceId.set(
      serviceId,
      normalizeHanaTableEntries(buildStandaloneTableNames(service.name))
    );
    hanaTablesLoadingByServiceId.set(serviceId, 'loaded');
    refreshUiAfterSqlStateChange();
  }, 450);
}

function buildStandaloneTableNames(appName) {
  const prefix = (appName ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const normalized = prefix.length > 0 ? prefix : 'APP';
  const baseTables = [
    `${normalized}_ORDERS`,
    `${normalized}_ITEMS`,
    `${normalized}_AUDIT`,
    `${normalized}_SAP_CAP_CDS_INVOICE_RECONCILIATION_DRAFTADMINISTRATIVEDATA`,
    `${normalized}_COM_SAP_S4HANA_FINANCE_GENERAL_LEDGER_ACCOUNTING_DOCUMENT_ITEM`,
    `${normalized}_VERY_LONG_NAMESPACE_WITH_DEEPLY_NESTED_SERVICE_PROJECTION_FOR_PAYMENT_ALLOCATION_HISTORY`,
    `${normalized}_I_BUSINESSPARTNERBANK_0001_TO_SUPPLIERINVOICEPAYMENTBLOCKREASON`,
    'DEMO_APP',
    'DEMO_PURCHASEORDERITEMMAPPING',
    'DEMO_BUSINESSAPP_TEST',
    'DUMMY',
    'M_TABLES',
  ];
  const generatedTables = Array.from({ length: 93 }, (_, index) => {
    return `${normalized}_ENTITY_${String(index + 1).padStart(3, '0')}`;
  });
  return [...baseTables, ...generatedTables];
}

function triggerRunHanaTableSelect(serviceId, tableName, displayTableName = tableName) {
  const service = resolveHanaServices().find((entry) => entry.id === serviceId);
  if (service === undefined) {
    hanaQueryStatusTone = 'error';
    hanaQueryStatusMessage = 'Selected app is no longer available.';
    return true;
  }
  hanaQueryStatusTone = 'info';
  hanaQueryStatusMessage = '';
  hanaSqlResultContextMenuState = null;
  setHanaTableSelectLoading(serviceId, tableName, true);

  if (vscodeApi === null) {
    hanaSqlResultPreviewState = buildPrototypeSqlResultLoadingState(service.name, displayTableName);
    hanaSqlResultExportMenuOpen = false;
    window.setTimeout(() => {
      setHanaTableSelectLoading(serviceId, tableName, false);
      hanaSqlResultPreviewState = buildPrototypeSqlResultReadyState(
        service.name,
        tableName,
        displayTableName
      );
      refreshSqlResultPreviewPanel();
    }, 700);
    return true;
  }

  vscodeApi.postMessage({
    type: RUN_HANA_TABLE_SELECT_MESSAGE_TYPE,
    serviceId: service.id,
    serviceName: service.name,
    tableName,
  });
  return true;
}

function buildPrototypeSqlResultLoadingState(appName, tableName) {
  return {
    appName,
    tableName,
    phase: 'loading',
    startedAt: new Date().toISOString(),
  };
}

function buildPrototypeSqlResultReadyState(appName, tableName, displayTableName = tableName) {
  const executedAt = new Date().toISOString();
  return {
    appName,
    batchSummary: {
      committed: false,
      rolledBack: true,
      usedTransaction: true,
    },
    executedAt,
    phase: 'ready',
    statements: [
      {
        columns: ['ID', 'TABLE_NAME', 'STATUS', 'DESCRIPTION'],
        elapsedMs: 128,
        rows: [
          ['1', tableName, 'READY', 'Prototype row with comma, quote " and newline\nfor export checks.'],
          [
            '2',
            tableName,
            'SUCCESS',
            '{"status":"Success","message":"This is mock data for testing","timestamp":"2026-04-08T03:10:07.482Z"}',
          ],
        ],
        sql: `SELECT * FROM "${tableName}" LIMIT 100`,
        status: 'success',
        tableName: displayTableName,
      },
      {
        elapsedMs: 64,
        errorMessage: 'Prototype batch statement failed, so SAP Tools rolled back the transaction.',
        sql: `UPDATE "${tableName}" SET STATUS = 'READY' WHERE ID = 'draft-42'`,
        status: 'error',
        tableName: displayTableName,
      },
      {
        sql: `SELECT COUNT(*) AS TOTAL FROM "${tableName}"`,
        status: 'skipped',
        tableName: displayTableName,
      },
    ],
    tableName: displayTableName,
  };
}

function triggerPrototypeSqlResultExportAction(action) {
  if (hanaSqlResultPreviewState?.phase !== 'ready') {
    return true;
  }

  const isJson = action.endsWith('-json');
  const isCopy = action.startsWith('copy-');
  const content = isJson
    ? buildPrototypeSqlResultJson(hanaSqlResultPreviewState)
    : buildPrototypeSqlResultCsv(hanaSqlResultPreviewState);
  hanaSqlResultExportMenuOpen = false;
  hanaSqlResultContextMenuState = null;

  if (isCopy && navigator.clipboard?.writeText !== undefined) {
    void navigator.clipboard.writeText(content);
  }

  return true;
}

function triggerPrototypeSqlResultContextCopyAction(action) {
  if (hanaSqlResultPreviewState?.phase !== 'ready' || hanaSqlResultContextMenuState === null) {
    return true;
  }

  const state = hanaSqlResultPreviewState;
  const { rowIndex, columnIndex, statementIndex } = hanaSqlResultContextMenuState;
  const resultState = resolvePrototypeSqlResultContextState(state, statementIndex);
  const row = resultState?.rows[rowIndex];
  hanaSqlResultContextMenuState = null;
  if (!Array.isArray(row)) {
    return true;
  }

  const content =
    action === 'copy-sql-result-row-object'
      ? buildPrototypeSqlResultRowObjectJson(resultState, row)
      : row[columnIndex] ?? '';
  if (navigator.clipboard?.writeText !== undefined) {
    void navigator.clipboard.writeText(content);
  }
  return true;
}

function buildPrototypeSqlResultCsv(state) {
  if (isPrototypeSqlResultBatchState(state)) {
    return buildPrototypeSqlResultBatchCsv(state);
  }
  return [
    state.columns.map(escapeCsvValue).join(','),
    ...state.rows.map((row) => state.columns.map((_, index) => escapeCsvValue(row[index] ?? '')).join(',')),
  ].join('\n');
}

function escapeCsvValue(value) {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function buildPrototypeSqlResultJson(state) {
  if (isPrototypeSqlResultBatchState(state)) {
    return buildPrototypeSqlResultBatchJson(state);
  }
  const columnKeys = buildPrototypeSqlResultColumnKeys(state.columns);
  const rows = state.rows.map((row) => {
    return Object.fromEntries(columnKeys.map((column, index) => [column, row[index] ?? '']));
  });
  return JSON.stringify(rows, null, 2);
}

function buildPrototypeSqlResultRowObjectJson(state, row) {
  const columnKeys = buildPrototypeSqlResultColumnKeys(state.columns);
  const rowObject = Object.fromEntries(
    columnKeys.map((column, index) => [column, row[index] ?? ''])
  );
  return JSON.stringify(rowObject, null, 2);
}

function buildPrototypeSqlResultColumnKeys(columns) {
  const counts = new Map();
  return columns.map((column, index) => {
    const rawColumn = typeof column === 'string' ? column.trim() : '';
    const baseKey = rawColumn.length > 0 ? rawColumn : `COLUMN_${String(index + 1)}`;
    const count = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, count);
    return count === 1 ? baseKey : `${baseKey}_${String(count)}`;
  });
}

function isPrototypeSqlResultBatchState(state) {
  return Array.isArray(state?.statements) && state.statements.length > 1;
}

function resolvePrototypeSqlResultContextState(state, statementIndex) {
  if (!isPrototypeSqlResultBatchState(state)) {
    return state;
  }
  if (!Number.isInteger(statementIndex)) {
    return null;
  }
  const statement = state.statements[statementIndex];
  if (statement?.status !== 'success' || !Array.isArray(statement.rows)) {
    return null;
  }
  return statement;
}

function buildPrototypeSqlResultBatchCsv(state) {
  const sections = [];
  state.statements.forEach((statement, index) => {
    sections.push(buildPrototypeSqlBatchSectionHeader(statement, index));
    if (statement.status === 'success' && Array.isArray(statement.rows)) {
      sections.push(buildPrototypeSqlResultCsv(statement));
    }
    sections.push('');
  });
  return sections.join('\n');
}

function buildPrototypeSqlBatchSectionHeader(statement, index) {
  const status = String(statement.status ?? 'pending').toUpperCase();
  const tableName = statement.tableName ?? 'SQL statement';
  const elapsed = Number.isInteger(statement.elapsedMs) ? `, ${String(statement.elapsedMs)} ms` : '';
  const suffix = statement.errorMessage !== undefined ? ` - ${statement.errorMessage}` : '';
  return `-- Statement ${String(index + 1)} (${status}, ${tableName}${elapsed})${suffix}`;
}

function buildPrototypeSqlResultBatchJson(state) {
  const statements = state.statements.map((statement, index) => {
    const record = {
      index: index + 1,
      sql: statement.sql,
      status: statement.status,
      tableName: statement.tableName,
    };
    if (Number.isInteger(statement.elapsedMs)) {
      record.elapsedMs = statement.elapsedMs;
    }
    if (typeof statement.errorMessage === 'string') {
      record.errorMessage = statement.errorMessage;
    }
    if (Array.isArray(statement.rows)) {
      record.rows = buildPrototypeSqlResultRows(statement);
    }
    return record;
  });
  return JSON.stringify({ statements }, null, 2);
}

function buildPrototypeSqlResultRows(state) {
  const columnKeys = buildPrototypeSqlResultColumnKeys(state.columns);
  return state.rows.map((row) => {
    return Object.fromEntries(columnKeys.map((column, index) => [column, row[index] ?? '']));
  });
}

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
    serviceExportStatusMessage = `Selected ${mapping.appName} for export.`;
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

function formatSyncIntervalLabel(syncHours) {
  if (syncHours === 24) {
    return '1 day';
  }

  if (syncHours % 24 === 0) {
    return `${String(syncHours / 24)} days`;
  }

  return `${String(syncHours)} hours`;
}

function formatTimestampLabel(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Never';
  }

  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    return 'Never';
  }

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestampMs));
}

function resolveSyncStatusLabel() {
  if (syncInProgress) {
    return 'Sync in progress...';
  }

  if (lastSyncError.length > 0) {
    return `Last sync failed: ${lastSyncError}`;
  }

  if (lastSyncCompletedAt !== null) {
    return `Last sync completed at ${formatTimestampLabel(lastSyncCompletedAt)}.`;
  }

  return 'Sync has not started yet.';
}

function resolveSettingsStatusMessage() {
  if (settingsStatusMessage.length > 0) {
    return settingsStatusMessage;
  }

  return resolveSyncStatusLabel();
}

function applyDesignTokens(design) {
  const root = document.body;
  const themeClass = `theme-${String(design.id).padStart(2, '0')}`;
  const patternClass = `pattern-${design.pattern}`;
  applyDesignClasses(root, patternClass, themeClass);
  root.style.setProperty('--design-page-bg', design.colors.page);
  root.style.setProperty('--design-frame-bg', design.colors.frame);
  root.style.setProperty('--design-surface-bg', design.colors.surface);
  root.style.setProperty('--design-border-color', design.colors.border);
  root.style.setProperty('--design-text-color', design.colors.text);
  root.style.setProperty('--design-muted-color', design.colors.muted);
  root.style.setProperty('--design-accent-color', design.colors.accent);
  root.style.setProperty('--design-accent-soft', design.colors.accentSoft);
  root.style.setProperty('--design-chip-text', design.colors.chipText);
  root.style.setProperty('--design-panel-shadow', design.shadow);
  root.style.setProperty('--design-title-font', design.typography.title);
  root.style.setProperty('--design-body-font', design.typography.body);
}

function applyDesignClasses(root, patternClass, themeClass) {
  const classNames = Array.from(root.classList);
  for (const className of classNames) {
    if (
      className.startsWith(DESIGN_PATTERN_CLASS_PREFIX) ||
      className.startsWith(DESIGN_THEME_CLASS_PREFIX)
    ) {
      root.classList.remove(className);
    }
  }

  root.classList.add('prototype-page', patternClass, themeClass);
}

function renderPrototype() {
  const groupsContainer = appElement.querySelector('.groups');
  const groupsScrollTop = groupsContainer ? groupsContainer.scrollTop : 0;
  const pkgList = appElement.querySelector('.detected-pkg-list');
  const pkgListScrollTop = pkgList ? pkgList.scrollTop : 0;

  const shellMarkup = resolveShellMarkupByMode();

  appElement.innerHTML = `
    <section class="prototype-shell select-style-${activeDesign.selectStyle} mode-${mode}">
      ${shellMarkup}
    </section>
  `;

  if (groupsScrollTop > 0) {
    const newGroups = appElement.querySelector('.groups');
    if (newGroups) newGroups.scrollTop = groupsScrollTop;
  }
  if (pkgListScrollTop > 0) {
    const newPkgList = appElement.querySelector('.detected-pkg-list');
    if (newPkgList) newPkgList.scrollTop = pkgListScrollTop;
  }
  queueSqlTableNameTruncation();

  if (mode === 'selection') {
    updateSelectionStageSlots(SELECTION_STAGE_SLOT_IDS);
    return;
  }
}

function resolveShellMarkupByMode() {
  if (mode === 'selection') {
    return renderSelectionScreen();
  }

  if (mode === 'settings') {
    return renderSettingsScreen();
  }

  return renderWorkspaceScreen();
}

function rerenderSelectionStageSlotsWithMotion(stageSlotIds) {
  if (mode !== 'selection') {
    renderPrototype();
    return;
  }

  if (!isSelectionShellMounted()) {
    renderPrototype();
    playSelectionMotion();
    return;
  }

  updateSelectionStageSlots(stageSlotIds);
  playSelectionMotion();
}

function queueSelectionMotion(optionElement, selector) {
  const sourceRect = optionElement.getBoundingClientRect();
  pendingSelectionMotion = {
    selector,
    left: sourceRect.left,
    top: sourceRect.top,
  };
}

function playSelectionMotion() {
  if (pendingSelectionMotion === null) {
    return;
  }

  if (prefersReducedMotion()) {
    pendingSelectionMotion = null;
    return;
  }

  const target = appElement.querySelector(pendingSelectionMotion.selector);
  if (!(target instanceof HTMLElement)) {
    pendingSelectionMotion = null;
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const dx = pendingSelectionMotion.left - targetRect.left;
  const dy = pendingSelectionMotion.top - targetRect.top;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    pendingSelectionMotion = null;
    return;
  }

  target.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0, 0)' },
    ],
    {
      duration: 280,
      easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)',
      fill: 'both',
    }
  );

  pendingSelectionMotion = null;
}

function prefersReducedMotion() {
  if (typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function buildDataSelector(attribute, value) {
  const escapedValue =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replaceAll('"', '\\"');

  return `[${attribute}="${escapedValue}"]`;
}

function resolveVscodeApi() {
  if (typeof acquireVsCodeApi !== 'function') {
    return null;
  }

  return acquireVsCodeApi();
}

function requestInitialState() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: REQUEST_INITIAL_STATE_MESSAGE_TYPE,
  });
  vscodeApi.postMessage({
    type: LOCAL_REGISTRY_STATUS_MESSAGE_TYPE,
  });
}

function postConfirmScope() {
  if (vscodeApi === null) {
    return;
  }

  const selectedRegion = resolveSelectedRegion();
  const selectedOrg = resolveSelectedOrg();
  const selectedGroup = groupLookup.get(selectedGroupId);
  const normalizedSpaceName = selectedSpaceId.trim();

  if (
    selectedRegion === undefined ||
    selectedOrg === undefined ||
    selectedGroup === undefined ||
    normalizedSpaceName.length === 0
  ) {
    return;
  }

  vscodeApi.postMessage({
    type: CONFIRM_SCOPE_MESSAGE_TYPE,
    scope: {
      regionId: selectedRegion.id,
      regionCode: selectedRegion.code,
      regionName: selectedRegion.name,
      regionArea: selectedGroup.label,
      orgGuid: selectedOrgId,
      orgName: selectedOrg.name,
      spaceName: normalizedSpaceName,
    },
  });
}

function postRegionSelection(region, areaLabel) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: REGION_SELECTED_MESSAGE_TYPE,
    region: {
      id: region.id,
      name: region.name,
      code: region.code,
      area: areaLabel,
    },
  });
}

function postOrgSelection(orgGuid, orgName) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: ORG_SELECTED_MESSAGE_TYPE,
    org: { guid: orgGuid, name: orgName },
  });
}

function postSpaceSelection(spaceName, orgGuid, orgName) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: SPACE_SELECTED_MESSAGE_TYPE,
    scope: {
      spaceName,
      orgGuid,
      orgName,
    },
  });
}

function requestAppsForSelectedScope(spaceName) {
  if (vscodeApi === null) {
    return;
  }

  const normalizedSpaceName = spaceName.trim();
  if (normalizedSpaceName.length === 0 || selectedOrgId.length === 0) {
    return;
  }

  liveAppOptions = null;
  appsErrorMessage = '';
  appsLoadingState = 'loading';

  const orgName = resolveSelectedOrgName() || selectedOrgId;
  postSpaceSelection(normalizedSpaceName, selectedOrgId, orgName);
}

function postOpenCfLogsPanel() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: OPEN_CF_LOGS_PANEL_MESSAGE_TYPE,
  });
}

function postActiveAppsChanged(appNames) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: ACTIVE_APPS_CHANGED_MESSAGE_TYPE,
    appNames,
  });
}

function postSelectServiceFolderMapping(appId, folderPath) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: SELECT_SERVICE_FOLDER_MAPPING_MESSAGE_TYPE,
    appId,
    folderPath,
  });
}

function postSyncIntervalUpdate(syncHours) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: UPDATE_SYNC_INTERVAL_MESSAGE_TYPE,
    syncIntervalHours: syncHours,
  });
}

function postSyncNow() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: SYNC_NOW_MESSAGE_TYPE,
  });
}

function postLogout() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: LOGOUT_MESSAGE_TYPE,
  });
}

function applyCfTopologySnapshot(rawTopology) {
  const wasReady = cfTopology.ready === true;
  const previousSelectionMode = activeSelectionMode;

  if (!isRecord(rawTopology)) {
    cfTopology = { ready: false, accounts: [] };
  } else {
    const ready = rawTopology.ready === true;
    const rawAccounts = Array.isArray(rawTopology.accounts)
      ? rawTopology.accounts
      : [];
    const accounts = rawAccounts
      .filter(
        (account) =>
          isRecord(account) &&
          typeof account.regionKey === 'string' &&
          account.regionKey.length > 0 &&
          typeof account.orgName === 'string' &&
          account.orgName.length > 0
      )
      .map((account) => ({
        regionKey: account.regionKey,
        regionLabel:
          typeof account.regionLabel === 'string' && account.regionLabel.length > 0
            ? account.regionLabel
            : account.regionKey,
        apiEndpoint:
          typeof account.apiEndpoint === 'string' ? account.apiEndpoint : '',
        orgName: account.orgName,
        spaces: Array.isArray(account.spaces)
          ? account.spaces.filter(
              (space) => typeof space === 'string' && space.length > 0
            )
          : [],
      }));
    cfTopology = { ready, accounts };
  }

  if (!wasReady && cfTopology.ready && cfTopology.accounts.length > 0) {
    activeSelectionMode = 'quick';
  }

  if (!wasReady && cfTopology.ready && cfTopology.accounts.length === 0) {
    activeSelectionMode = 'custom';
  }

  reconcileQuickSelectionWithTopology();

  if (mode !== 'selection') {
    return;
  }

  if (wasReady !== cfTopology.ready || previousSelectionMode !== activeSelectionMode) {
    renderPrototype();
    return;
  }

  if (activeSelectionMode === 'quick' && isQuickSelectionPanelMounted()) {
    updateQuickPanelInPlace();
    return;
  }

  if (!isSelectionShellMounted()) {
    renderPrototype();
  }
}

function updateTopologySearchInPlace() {
  const slot = appElement.querySelector('[data-stage-slot="area"]');
  if (!(slot instanceof HTMLElement)) {
    return;
  }

  const existingPanel = slot.querySelector('[data-role="topology-search-panel"]');
  const newMarkup = renderTopologyOrgSearchPanel();

  if (newMarkup.length === 0) {
    if (existingPanel instanceof HTMLElement) {
      existingPanel.remove();
    }
    return;
  }

  if (existingPanel instanceof HTMLElement) {
    const focusedRole =
      document.activeElement instanceof HTMLInputElement
        ? document.activeElement.dataset.role ?? ''
        : '';
    const focusedSelectionStart =
      document.activeElement instanceof HTMLInputElement
        ? document.activeElement.selectionStart
        : null;
    existingPanel.outerHTML = newMarkup;
    if (focusedRole === 'topology-org-search') {
      const refocused = appElement.querySelector(
        '[data-role="topology-org-search"]'
      );
      if (refocused instanceof HTMLInputElement) {
        refocused.focus();
        if (focusedSelectionStart !== null) {
          refocused.setSelectionRange(focusedSelectionStart, focusedSelectionStart);
        }
      }
    }
    return;
  }

  slot.insertAdjacentHTML('afterbegin', newMarkup);
}

function applyTopologyScopeResolved(scope) {
  if (!isRecord(scope)) {
    return;
  }

  const regionId = typeof scope.regionId === 'string' ? scope.regionId.trim() : '';
  const orgGuid = typeof scope.orgGuid === 'string' ? scope.orgGuid.trim() : '';
  const orgName = typeof scope.orgName === 'string' ? scope.orgName.trim() : '';
  if (regionId.length === 0 || orgGuid.length === 0) {
    topologyPickInProgress = false;
    return;
  }

  const region = regionLookup.get(regionId);
  const groupId = regionGroupLookup.get(regionId);
  if (region === undefined || groupId === undefined) {
    topologyPickInProgress = false;
    return;
  }

  selectedGroupId = groupId;
  selectedRegionId = region.id;
  selectedOrgId = orgGuid;
  selectedOrgName = orgName;
  selectedSpaceId = '';
  orgSearchQuery = '';
  regionSearchQuery = '';
  topologyPickInProgress = false;

  if (mode !== 'selection') {
    mode = 'selection';
    renderPrototype();
    return;
  }

  rerenderSelectionStageSlotsWithMotion(SELECTION_STAGE_SLOT_IDS);
}

function postTopologyOrgSelection(regionKey, orgName) {
  if (vscodeApi === null) {
    const org = resolvePrototypeTopologyOrg(regionKey, orgName);
    if (org === undefined) {
      topologyPickInProgress = false;
      return;
    }
    applyTopologyScopeResolved({
      regionId: regionKey,
      orgGuid: org.id,
    });
    return;
  }

  vscodeApi.postMessage({
    type: TOPOLOGY_ORG_SELECTED_MESSAGE_TYPE,
    payload: { regionKey, orgName },
  });
}

function filterTopologyOrgEntries() {
  const accounts = Array.isArray(cfTopology.accounts) ? cfTopology.accounts : [];
  const query = topologyOrgSearchQuery.trim().toLowerCase();
  if (query.length === 0) {
    return accounts.slice(0, TOPOLOGY_ORG_SEARCH_LIMIT);
  }
  const matches = [];
  for (const account of accounts) {
    const haystack = [
      account.orgName,
      account.regionKey,
      account.regionLabel,
    ]
      .join(' ')
      .toLowerCase();
    if (haystack.indexOf(query) !== -1) {
      matches.push(account);
    }
    if (matches.length >= TOPOLOGY_ORG_SEARCH_LIMIT) {
      break;
    }
  }
  return matches;
}

function isKnownTopologyRegion(regionKey) {
  return regionLookup.has(regionKey);
}

function resolveInitialCfTopology() {
  if (vscodeApi !== null) {
    return { ready: false, accounts: [] };
  }

  const accounts = [
    ...buildPrototypeTopologyAccounts('us10', 'US East (VA) - AWS (us10)', DEFAULT_ORG_OPTIONS),
    ...buildPrototypeTopologyAccounts('br10', 'Brazil (Sao Paulo) - AWS (br10)', BR10_ORG_OPTIONS),
  ];
  accounts.sort((left, right) => {
    const orgCompare = left.orgName.localeCompare(right.orgName);
    if (orgCompare !== 0) return orgCompare;
    return left.regionKey.localeCompare(right.regionKey);
  });
  return { ready: accounts.length > 0, accounts };
}

function resolveInitialSelectionMode() {
  return cfTopology.ready === true && cfTopology.accounts.length > 0
    ? 'quick'
    : 'custom';
}

function buildPrototypeTopologyAccounts(regionKey, regionLabel, orgOptions) {
  return orgOptions.map((org) => ({
    regionKey,
    regionLabel,
    apiEndpoint: `https://api.cf.${regionKey}.hana.ondemand.com`,
    orgName: org.name,
    spaces: org.spaces,
  }));
}

function resolvePrototypeTopologyOrg(regionKey, orgName) {
  const orgOptions = regionKey === 'br10' ? BR10_ORG_OPTIONS : DEFAULT_ORG_OPTIONS;
  return orgOptions.find((org) => org.name === orgName);
}

function findTopologyAccount(regionKey, orgName) {
  const accounts = Array.isArray(cfTopology.accounts) ? cfTopology.accounts : [];
  return accounts.find(
    (account) => account.regionKey === regionKey && account.orgName === orgName
  );
}

function resetQuickSelectionState() {
  quickPickRegionKey = '';
  quickPickOrgName = '';
  quickPickOrgSpaces = [];
  quickPickSpaceName = '';
  quickConfirmInProgress = false;
  quickConfirmError = '';
}

function reconcileQuickSelectionWithTopology() {
  if (quickPickRegionKey.length === 0 || quickPickOrgName.length === 0) {
    return;
  }

  const account = findTopologyAccount(quickPickRegionKey, quickPickOrgName);
  if (account === undefined) {
    resetQuickSelectionState();
    return;
  }

  quickPickOrgSpaces = Array.isArray(account.spaces) ? [...account.spaces] : [];
  if (
    quickPickSpaceName.length > 0 &&
    !quickPickOrgSpaces.includes(quickPickSpaceName)
  ) {
    quickPickSpaceName = '';
  }
  if (quickPickSpaceName.length === 0 && quickPickOrgSpaces.length === 1) {
    quickPickSpaceName = quickPickOrgSpaces[0];
  }
}

function isQuickSelectionPanelMounted() {
  return appElement.querySelector('.selection-quick-panel') instanceof HTMLElement;
}

function updateQuickPanelInPlace() {
  const panel = appElement.querySelector('.selection-quick-panel');
  if (!(panel instanceof HTMLElement)) {
    renderPrototype();
    return;
  }

  const focusedSearch =
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.dataset.role === 'topology-org-search';
  const selectionStart = focusedSearch ? document.activeElement.selectionStart : null;
  const selectionEnd = focusedSearch ? document.activeElement.selectionEnd : null;
  panel.innerHTML = renderQuickOrgPanel();

  if (!focusedSearch) {
    return;
  }

  const refocused = panel.querySelector('[data-role="topology-org-search"]');
  if (refocused instanceof HTMLInputElement) {
    refocused.focus();
    if (selectionStart !== null && selectionEnd !== null) {
      refocused.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

function updateQuickOrgSearchResultsInPlace() {
  const panel = appElement.querySelector('.selection-quick-panel');
  if (!(panel instanceof HTMLElement) || quickPickOrgName.length > 0) {
    updateQuickPanelInPlace();
    return;
  }

  const nextMarkup = renderQuickOrgResultsMarkup(filterTopologyOrgEntries());
  const currentResults = panel.querySelector('[data-role="topology-org-results"]');
  const currentEmpty = panel.querySelector('[data-role="topology-org-empty"]');
  const currentNode = currentResults ?? currentEmpty;
  if (currentNode instanceof HTMLElement) {
    currentNode.outerHTML = nextMarkup;
    return;
  }

  panel.insertAdjacentHTML('beforeend', nextMarkup);
}

function postQuickScopeConfirm(regionKey, orgName, spaceName) {
  if (vscodeApi === null) {
    const org = resolvePrototypeTopologyOrg(regionKey, orgName);
    if (org === undefined) {
      quickConfirmInProgress = false;
      quickConfirmError = 'Could not confirm scope. Try Custom tab.';
      updateQuickPanelInPlace();
      return;
    }

    quickConfirmInProgress = false;
    applyRestoredConfirmedScope({
      regionId: regionKey,
      orgGuid: org.id,
      spaceName,
    });
    return;
  }

  vscodeApi.postMessage({
    type: QUICK_SCOPE_CONFIRM_MESSAGE_TYPE,
    payload: { regionKey, orgName, spaceName },
  });
}

function renderTopologyOrgRow(account, isSelected) {
  const knownRegion = isKnownTopologyRegion(account.regionKey);
  const spaceCount = Array.isArray(account.spaces) ? account.spaces.length : 0;
  const meta =
    spaceCount === 1
      ? `${escapeHtml(account.regionKey)} - 1 space`
      : `${escapeHtml(account.regionKey)} - ${String(spaceCount)} spaces`;
  const disabledAttr = knownRegion ? '' : ' disabled aria-disabled="true" data-disabled="true"';
  const disabledClass = knownRegion ? '' : ' is-disabled';

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
}

function renderTopologyOrgSearchPanel() {
  if (!cfTopology.ready) {
    return '';
  }
  if (!Array.isArray(cfTopology.accounts) || cfTopology.accounts.length === 0) {
    return '';
  }

  const filtered = filterTopologyOrgEntries();
  let resultsMarkup = '';
  if (filtered.length === 0) {
    const queryLabel = escapeHtml(topologyOrgSearchQuery.trim());
    resultsMarkup = `
      <div class="topology-org-empty" data-role="topology-org-empty">
        No org matches "${queryLabel}"
      </div>
    `;
  } else {
    resultsMarkup = filtered
      .map((account) => {
        const selectedOrg = resolveSelectedOrg();
        const isSelected =
          selectedRegionId === account.regionKey && selectedOrg?.name === account.orgName;
        return renderTopologyOrgRow(account, isSelected);
      })
      .join('');
    resultsMarkup = `<div class="topology-org-results" data-role="topology-org-results">${resultsMarkup}</div>`;
  }

  return `
    <section class="group-card topology-org-panel" data-role="topology-search-panel" aria-label="Quick org search">
      <div class="group-head">
        <h2>Quick Org Search</h2>
      </div>
      <p class="topology-org-hint">Search across all synced regions and jump straight to space selection.</p>
      <div class="topology-org-search-row">
        <input
          type="search"
          class="topology-org-search-input"
          data-role="topology-org-search"
          placeholder="Type org name, region key, or label..."
          autocomplete="off"
          spellcheck="false"
          value="${escapeHtml(topologyOrgSearchQuery)}"
        />
      </div>
      ${resultsMarkup}
    </section>
  `;
}

function applyRestoredConfirmedScope(scope) {
  const regionId =
    typeof scope.regionId === 'string' ? scope.regionId.trim() : '';
  const orgGuid = typeof scope.orgGuid === 'string' ? scope.orgGuid.trim() : '';
  const orgName = typeof scope.orgName === 'string' ? scope.orgName.trim() : '';
  const spaceName =
    typeof scope.spaceName === 'string' ? scope.spaceName.trim() : '';

  if (regionId.length === 0 || orgGuid.length === 0 || spaceName.length === 0) {
    return;
  }

  const selectedRegion = regionLookup.get(regionId);
  const selectedGroupIdFromRegion = regionGroupLookup.get(regionId);
  if (selectedRegion === undefined || selectedGroupIdFromRegion === undefined) {
    return;
  }

  selectedGroupId = selectedGroupIdFromRegion;
  selectedRegionId = selectedRegion.id;
  selectedOrgId = orgGuid;
  selectedOrgName = orgName;
  selectedSpaceId = spaceName;
  mode = 'workspace';
  activeTabId = 'logs';
  statusMessage = '';
  resetQuickSelectionState();

  if (isWorkspaceLogsMounted()) {
    refreshWorkspaceLogsView();
    return;
  }

  if (isWorkspaceAppsMounted()) {
    refreshWorkspaceAppsView();
    return;
  }

  renderPrototype();
}

function renderSelectionScreen() {
  const showTabs = cfTopology.ready === true;
  const isQuick = showTabs && activeSelectionMode === 'quick';

  if (!showTabs) {
    return `
      <header class="shell-header">
        <div class="shell-header-row">
          <h1>Select SAP BTP Region</h1>
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
      </header>

      <div class="groups" role="list">
        ${renderSelectionStageSlots()}
      </div>
    `;
  }

  return `
    <header class="shell-header">
      <div class="shell-header-row">
        <h1>Select SAP BTP Region</h1>
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
    </header>

    <nav class="selection-tabs" role="tablist" aria-label="Selection mode">
      <button
        id="selection-tab-quick"
        type="button"
        class="tab-button${isQuick ? ' is-active' : ''}"
        data-action="switch-selection-mode"
        data-selection-mode="quick"
        role="tab"
        aria-selected="${isQuick}"
      >
        Quick Org Search
      </button>
      <button
        id="selection-tab-custom"
        type="button"
        class="tab-button${isQuick ? '' : ' is-active'}"
        data-action="switch-selection-mode"
        data-selection-mode="custom"
        role="tab"
        aria-selected="${!isQuick}"
      >
        Custom
      </button>
    </nav>

    ${
      isQuick
        ? `<div class="selection-quick-panel" role="tabpanel" aria-label="Quick Org Search">${renderQuickOrgPanel()}</div>`
        : `<div class="groups selection-custom-panel" role="list" aria-label="Custom">${renderSelectionStageSlots()}</div>`
    }
  `;
}

function renderQuickOrgPanel() {
  const accounts = Array.isArray(cfTopology.accounts) ? cfTopology.accounts : [];
  const orgCount = accounts.length;

  if (orgCount === 0) {
    return `
      <div class="quick-empty-state">
        <p>No synced orgs found.</p>
        <p>Switch to <strong>Custom</strong> tab to select manually, or run CF sync to populate this list.</p>
      </div>
    `;
  }

  if (quickPickOrgName.length > 0) {
    return renderQuickSpaceView();
  }

  const filtered = filterTopologyOrgEntries();
  const resultsMarkup = renderQuickOrgResultsMarkup(filtered);

  return `
    <input
      type="search"
      class="topology-org-search-input"
      data-role="topology-org-search"
      aria-label="Search synced organizations"
      placeholder="Type org name, region key, or label..."
      autocomplete="off"
      spellcheck="false"
      value="${escapeHtml(topologyOrgSearchQuery)}"
    />
    ${resultsMarkup}
  `;
}

function renderQuickOrgResultsMarkup(filtered) {
  if (filtered.length === 0) {
    return `
      <div class="topology-org-empty" data-role="topology-org-empty">
        No org matches "${escapeHtml(topologyOrgSearchQuery.trim())}"
      </div>
    `;
  }

  const rowsMarkup = filtered
    .map((account) => {
      const isSelected =
        quickPickRegionKey === account.regionKey && quickPickOrgName === account.orgName;
      return renderTopologyOrgRow(account, isSelected);
    })
    .join('');
  return `<div class="topology-org-results" data-role="topology-org-results">${rowsMarkup}</div>`;
}

function renderQuickSpaceView() {
  const region = regionLookup.get(quickPickRegionKey);
  const regionLabel = region ? `${region.code} ${region.name}` : quickPickRegionKey;
  const canConfirm = quickPickSpaceName.length > 0 && !quickConfirmInProgress;
  const errorMarkup =
    quickConfirmError.length > 0
      ? `<p class="stage-error" role="alert">${escapeHtml(quickConfirmError)}</p>`
      : '';

  return `
    <div class="quick-space-view">
      ${renderQuickOrganizationCard(regionLabel)}
      ${renderQuickSpaceCard()}
      <button type="button" class="stage-reset quick-back-button" data-action="quick-back-to-orgs">
        ← Back
      </button>
      ${errorMarkup}
      ${renderQuickConfirmPanel(canConfirm)}
    </div>
  `;
}

function renderQuickOrganizationCard(regionLabel) {
  return `
    <section class="group-card org-stage quick-org-stage" aria-label="Quick organization" data-stage-id="quick-org">
      <div class="group-head"><h2>Organization</h2></div>
      <div class="org-picker quick-org-picker">
        <button
          type="button"
          class="org-option is-selected quick-org-option"
          aria-pressed="true"
          aria-label="${escapeHtml(quickPickOrgName)} in ${escapeHtml(regionLabel)}"
        >
          <span class="topology-org-name">${escapeHtml(quickPickOrgName)}</span>
          <span class="topology-org-meta">${escapeHtml(regionLabel)}</span>
        </button>
      </div>
    </section>
  `;
}

function renderQuickSpaceCard() {
  const spacesMarkup = renderQuickSpaceButtons();
  return `
    <section class="group-card space-stage quick-space-stage" aria-label="Quick space list" data-stage-id="quick-space">
      <div class="group-head"><h2>Choose Space</h2></div>
      <div class="space-picker quick-space-picker">
        ${spacesMarkup}
      </div>
    </section>
  `;
}

function renderQuickSpaceButtons() {
  const spaceButtons = quickPickOrgSpaces
    .map((space) => {
      const isSelected = space === quickPickSpaceName;
      return `
        <button
          type="button"
          class="space-option${isSelected ? ' is-selected' : ''}"
          data-quick-space="${escapeHtml(space)}"
          aria-pressed="${isSelected}"
        >
          ${escapeHtml(space)}
        </button>
      `;
    })
    .join('');

  return spaceButtons.length > 0
    ? spaceButtons
    : '<div class="topology-org-empty" data-role="quick-space-empty">No spaces found for this org.</div>';
}

function renderQuickConfirmPanel(canConfirm) {
  return `
    <div class="confirm-stage" aria-label="Region confirmation">
      <button
        type="button"
        class="confirm-button"
        data-action="quick-confirm-scope"
        ${canConfirm ? '' : 'disabled'}
      >
        ${quickConfirmInProgress ? 'Confirming…' : 'Confirm Scope'}
      </button>
    </div>
  `;
}

function renderSettingsScreen() {
  const syncIntervalOptions = SYNC_INTERVAL_OPTIONS.map((hours) => {
    const isSelected = syncIntervalHours === hours;
    return `
      <option value="${String(hours)}" ${isSelected ? 'selected' : ''}>
        ${formatSyncIntervalLabel(hours)}
      </option>
    `;
  }).join('');

  const userLabel = activeUserEmail.length > 0 ? activeUserEmail : 'Not signed in';
  const syncStatusMessage = resolveSettingsStatusMessage();

  return `
    <header class="shell-header settings-header">
      <div class="shell-header-row">
        <h1>Settings</h1>
        <button
          type="button"
          class="stage-reset"
          data-action="close-settings"
          aria-label="Close Settings"
        >
          Back
        </button>
      </div>
    </header>

    <section class="settings-body">
      <section class="group-card settings-section">
        <h2>Cache Sync Interval</h2>
        <div class="sync-interval-picker">
          <label class="sync-interval-label" for="sync-interval-select">Sync interval</label>
          <select
            id="sync-interval-select"
            class="sync-interval-select"
            data-role="sync-interval-select"
            aria-label="Cache sync interval"
          >
            ${syncIntervalOptions}
          </select>
        </div>
        <p class="settings-meta">Current account: ${escapeHtml(userLabel)}</p>
      </section>

      <section class="group-card settings-section">
        <h2>Sync Status</h2>
        <ul class="settings-status-list">
          <li><span>Last completion</span><strong>${escapeHtml(formatTimestampLabel(lastSyncCompletedAt))}</strong></li>
          <li><span>Next sync</span><strong>${escapeHtml(formatTimestampLabel(nextSyncAt))}</strong></li>
        </ul>
        <p class="settings-status-message" role="status" aria-live="polite">${escapeHtml(syncStatusMessage)}</p>
        <div class="toolbar-row settings-actions" role="group" aria-label="Settings actions">
          <button type="button" class="primary-action" data-action="sync-now">Sync now</button>
          <button type="button" class="secondary-action" data-action="logout">Logout</button>
        </div>
      </section>
    </section>
  `;
}

function renderSelectionStageSlots() {
  return SELECTION_STAGE_SLOT_IDS.map((stageSlotId) => {
    return `<div class="stage-slot" data-stage-slot="${stageSlotId}"></div>`;
  }).join('');
}

function resolveSelectionStageSlotsForAction(action) {
  if (action === 'reset-area-selection') {
    return ['area', 'region', 'org', 'space', 'confirm'];
  }

  if (action === 'reset-region-selection') {
    return ['area', 'region', 'org', 'space', 'confirm'];
  }

  if (action === 'reset-org-selection') {
    return ['org', 'space', 'confirm'];
  }

  if (action === 'reset-space-selection') {
    return ['space', 'confirm'];
  }

  return [];
}

function updateSelectionStageSlots(stageSlotIds) {
  const selectedGroup = groupLookup.get(selectedGroupId);
  const selectedRegion = resolveSelectedRegion();
  const normalizedSlotIds = normalizeSelectionStageSlots(stageSlotIds);

  for (const stageSlotId of normalizedSlotIds) {
    const markup = renderSelectionStageMarkup(stageSlotId, selectedGroup, selectedRegion);
    setSelectionStageSlotMarkup(stageSlotId, markup);
  }
}

function normalizeSelectionStageSlots(stageSlotIds) {
  const seenStageSlots = new Set();
  const normalizedStageSlots = [];

  for (const stageSlotId of stageSlotIds) {
    if (
      !SELECTION_STAGE_SLOT_IDS.includes(stageSlotId) ||
      seenStageSlots.has(stageSlotId)
    ) {
      continue;
    }

    normalizedStageSlots.push(stageSlotId);
    seenStageSlots.add(stageSlotId);
  }

  return normalizedStageSlots;
}

function renderSelectionStageMarkup(stageSlotId, selectedGroup, selectedRegion) {
  if (stageSlotId === 'area') {
    return renderAreaStage(selectedGroup);
  }

  if (stageSlotId === 'region') {
    return selectedGroup === undefined
      ? renderEmptyRegionPanel()
      : renderSelectedGroupPanel(selectedGroup);
  }

  if (stageSlotId === 'org') {
    return selectedRegion === undefined ? '' : renderOrgStage();
  }

  if (stageSlotId === 'space') {
    return selectedOrgId.length === 0 ? '' : renderSpaceStage();
  }

  if (stageSlotId === 'confirm') {
    return renderConfirmPanel();
  }

  return '';
}

function setSelectionStageSlotMarkup(stageSlotId, markup) {
  const slotElement = appElement.querySelector(
    `[data-stage-slot="${stageSlotId}"]`
  );
  if (!(slotElement instanceof HTMLElement)) {
    return;
  }

  slotElement.innerHTML = markup;
}

function isSelectionShellMounted() {
  const groupsElement = appElement.querySelector('.groups');
  if (!(groupsElement instanceof HTMLElement)) {
    return false;
  }

  return SELECTION_STAGE_SLOT_IDS.every((stageSlotId) => {
    return (
      appElement.querySelector(`[data-stage-slot="${stageSlotId}"]`) !== null
    );
  });
}

function renderAreaStage(selectedGroup) {
  const isCollapsed = selectedGroup !== undefined;
  const orderedGroups = resolveOrderedGroups();

  return `
    <section class="group-card area-stage" aria-label="Area selector" data-stage-id="area">
      <div class="group-head">
        <h2>Choose Area</h2>
        ${
          isCollapsed
            ? '<button type="button" class="stage-reset" data-action="reset-area-selection">Change</button>'
            : `<span class="group-count">${orderedGroups.length}</span>`
        }
      </div>
      <div class="area-picker${isCollapsed ? ' is-collapsed' : ''}" role="listbox" aria-label="SAP area groups">
        ${renderAreaPicker(selectedGroup, orderedGroups)}
      </div>
    </section>
  `;
}

function renderAreaPicker(selectedGroup, orderedGroups) {
  const isCollapsed = selectedGroup !== undefined;

  return orderedGroups
    .map((group) => {
      const isActive = group.id === selectedGroupId;
      const isHidden = isCollapsed && !isActive;
      const isDisabled = isAreaDisabled(group.id) && !isActive;
      const areaLabelParts = splitAreaLabel(group.label);
      return `
        <button
          type="button"
          class="area-option${isActive ? ' is-active' : ''}${isHidden ? ' is-hidden' : ''}${isDisabled ? ' is-disabled' : ''}"
          data-group-id="${group.id}"
          aria-pressed="${isActive}"
          aria-hidden="${isHidden}"
          aria-disabled="${isDisabled}"
          ${isDisabled ? 'disabled' : ''}
        >
          <span class="area-label">${areaLabelParts.title}</span>
          ${
            areaLabelParts.meta.length > 0
              ? `<span class="area-meta">${areaLabelParts.meta}</span>`
              : ''
          }
        </button>
      `;
    })
    .join('');
}

function splitAreaLabel(label) {
  const normalizedLabel = label.trim();
  const match = /^(.+?)\s*\(([^)]+)\)$/.exec(normalizedLabel);
  if (match === null) {
    return {
      title: normalizedLabel,
      meta: '',
    };
  }

  return {
    title: match[1].trim(),
    meta: match[2].trim(),
  };
}

function renderSelectedGroupPanel(group) {
  const isCollapsed = selectedRegionId.length > 0;
  const orderedRegions = resolveOrderedRegions(group);
  const filteredRegions = isCollapsed ? orderedRegions : filterRegionOptions(orderedRegions);
  const regionOptionsMarkup = filteredRegions
    .map((region) => {
      const isSelected = region.id === selectedRegionId;
      const isHidden = isCollapsed && !isSelected;
      const isDisabled = isRegionDisabled(region.id) && !isSelected;
      return `
        <button
          type="button"
          class="region-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}${isDisabled ? ' is-disabled' : ''}"
          data-region-id="${region.id}"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
          aria-disabled="${isDisabled}"
          ${isDisabled ? 'disabled' : ''}
        >
          <span class="region-code">${region.code}</span>
          <span class="region-name">${region.name}</span>
        </button>
      `;
    })
    .join('');

  return `
    <section class="group-card" aria-label="Region list" data-stage-id="region">
      <div class="group-head">
        <h2>Choose Region</h2>
        ${!isCollapsed ? renderRegionSearchInput() : ''}
        <button
          type="button"
          class="stage-reset"
          data-action="reset-region-selection"
          ${selectedRegionId.length === 0 ? 'disabled' : ''}
        >
          Change
        </button>
      </div>
      <div class="region-layout ${activeDesign.layout}">
        ${regionOptionsMarkup}
      </div>
    </section>
  `;
}

function renderRegionSearchInput() {
  return `
    <label class="group-head-search-wrapper search-input-with-icon">
      <span class="search-input-icon" aria-hidden="true">&#128269;</span>
      <input
        type="search"
        class="group-head-search-input"
        data-role="region-search"
        aria-label="Search regions"
        placeholder="Search..."
        autocomplete="off"
        value="${escapeHtml(regionSearchQuery)}"
      />
    </label>
  `;
}

function renderOrgStage() {
  if (vscodeApi !== null && orgsLoadingState === 'loading') {
    return `
      <section class="group-card org-stage" aria-label="Organization list" data-stage-id="org">
        <div class="group-head"><h2>Organization</h2></div>
        <p class="stage-loading" aria-live="polite">Loading organizations&#8230;</p>
      </section>
    `;
  }

  if (vscodeApi !== null && orgsLoadingState === 'error') {
    return `
      <section class="group-card org-stage" aria-label="Organization list" data-stage-id="org">
        <div class="group-head"><h2>Organization</h2></div>
        <p class="stage-error" role="alert">${escapeHtml(orgsErrorMessage)}</p>
      </section>
    `;
  }

  const activeOrgs = resolveActiveOrgOptions();
  const isCollapsed = selectedOrgId.length > 0;
  const visibleOrgs = isCollapsed ? activeOrgs : filterOrgOptions(activeOrgs);
  const searchInputMarkup = isCollapsed ? '' : renderOrgSearchInput();
  const orgButtons = renderOrgButtons(visibleOrgs, isCollapsed);

  return `
    <section class="group-card org-stage" aria-label="Organization list" data-stage-id="org">
      <div class="group-head">
        <h2>Organization</h2>
        ${searchInputMarkup}
        <button
          type="button"
          class="stage-reset"
          data-action="reset-org-selection"
          ${selectedOrgId.length === 0 ? 'disabled' : ''}
        >
          Change
        </button>
      </div>
      <div class="org-picker">
        ${orgButtons}
      </div>
    </section>
  `;
}

function resolveActiveOrgOptions() {
  if (vscodeApi !== null && liveOrgOptions !== null) {
    return liveOrgOptions.map((org) => ({ id: org.guid, name: org.name }));
  }

  return resolveCurrentMockOrgOptions().map((org) => ({ id: org.id, name: org.name }));
}

function filterOrgOptions(orgOptions) {
  const normalizedQuery = orgSearchQuery.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return orgOptions;
  }

  return orgOptions.filter((org) => {
    return org.name.toLowerCase().includes(normalizedQuery);
  });
}

function filterRegionOptions(regions) {
  const normalizedQuery = regionSearchQuery.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return regions;
  }

  return regions.filter((region) => {
    return (
      region.name.toLowerCase().includes(normalizedQuery) ||
      region.code.toLowerCase().includes(normalizedQuery)
    );
  });
}

function renderOrgSearchInput() {
  return `
    <label class="group-head-search-wrapper search-input-with-icon">
      <span class="search-input-icon" aria-hidden="true">&#128269;</span>
      <input
        type="search"
        class="group-head-search-input"
        data-role="org-search"
        aria-label="Search organizations"
        placeholder="Search..."
        autocomplete="off"
        value="${escapeHtml(orgSearchQuery)}"
      />
    </label>
  `;
}

function renderOrgButtons(orgOptions, isCollapsed) {
  return orgOptions
    .map((org) => {
      const isSelected = org.id === selectedOrgId;
      const isHidden = isCollapsed && !isSelected;
      return `
        <button
          type="button"
          class="org-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}"
          data-org-id="${escapeHtml(org.id)}"
          data-testid="org-option"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
        >
          ${escapeHtml(org.name)}
        </button>
      `;
    })
    .join('');
}

function updateOrgSearchResults() {
  const picker = appElement.querySelector('[data-stage-id="org"] .org-picker');
  if (!(picker instanceof HTMLElement)) {
    return;
  }

  picker.innerHTML = renderOrgButtons(filterOrgOptions(resolveActiveOrgOptions()), false);
}

function updateRegionSearchResults() {
  const layout = appElement.querySelector('[data-stage-id="region"] .region-layout');
  if (!(layout instanceof HTMLElement)) {
    return;
  }

  const group = groupLookup.get(selectedGroupId);
  if (group === undefined) {
    return;
  }

  const isCollapsed = selectedRegionId.length > 0;
  const orderedRegions = resolveOrderedRegions(group);
  const filteredRegions = isCollapsed ? orderedRegions : filterRegionOptions(orderedRegions);
  layout.innerHTML = filteredRegions
    .map((region) => {
      const isSelected = region.id === selectedRegionId;
      const isHidden = isCollapsed && !isSelected;
      const isDisabled = isRegionDisabled(region.id) && !isSelected;
      return `
        <button
          type="button"
          class="region-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}${isDisabled ? ' is-disabled' : ''}"
          data-region-id="${region.id}"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
          aria-disabled="${isDisabled}"
          ${isDisabled ? 'disabled' : ''}
        >
          <span class="region-code">${region.code}</span>
          <span class="region-name">${region.name}</span>
        </button>
      `;
    })
    .join('');
}

function renderSpaceStage() {
  if (vscodeApi !== null && spacesLoadingState === 'loading') {
    return `
      <section class="group-card space-stage" aria-label="Space list" data-stage-id="space">
        <div class="group-head"><h2>Choose Space</h2></div>
        <p class="stage-loading" aria-live="polite">Loading spaces&#8230;</p>
      </section>
    `;
  }

  if (vscodeApi !== null && spacesLoadingState === 'error') {
    return `
      <section class="group-card space-stage" aria-label="Space list" data-stage-id="space">
        <div class="group-head"><h2>Choose Space</h2></div>
        <p class="stage-error" role="alert">${escapeHtml(spacesErrorMessage)}</p>
      </section>
    `;
  }

  const spaces = resolveSelectableSpaces();
  const isCollapsed = selectedSpaceId.length > 0;
  const spaceButtons = spaces
    .map((space) => {
      const isSelected = space === selectedSpaceId;
      const isHidden = isCollapsed && !isSelected;
      return `
        <button
          type="button"
          class="space-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}"
          data-space-id="${escapeHtml(space)}"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
        >
          ${escapeHtml(space)}
        </button>
      `;
    })
    .join('');

  return `
    <section class="group-card space-stage" aria-label="Space list" data-stage-id="space">
      <div class="group-head">
        <h2>Choose Space</h2>
        <button
          type="button"
          class="stage-reset"
          data-action="reset-space-selection"
          ${selectedSpaceId.length === 0 ? 'disabled' : ''}
        >
          Change
        </button>
      </div>
      <div class="space-picker">
        ${spaceButtons}
      </div>
    </section>
  `;
}

function renderConfirmPanel() {
  const selectedRegion = resolveSelectedRegion();
  const selectedOrg = resolveSelectedOrg();
  const isReady = selectedRegion !== undefined && selectedOrg !== undefined && selectedSpaceId.length > 0;

  return `
    <div class="confirm-stage" aria-label="Region confirmation">
      <button
        type="button"
        class="confirm-button"
        data-action="confirm-region"
        ${isReady ? '' : 'disabled'}
      >
        Confirm Scope
      </button>
    </div>
  `;
}

function renderEmptyRegionPanel() {
  return `
    <section class="group-card empty-panel" aria-live="polite">
      <p class="empty-title">No area selected yet</p>
      <p class="empty-description">Pick an area above to reveal region options.</p>
    </section>
  `;
}

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
        <h2>Export Service Artifacts</h2>
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

      ${renderLocalRegistryRow()}

      <label class="service-export-search-row search-input-with-icon">
        <span class="search-input-icon" aria-hidden="true">&#128269;</span>
        <input
          type="search"
          class="service-export-search"
          data-role="service-export-search"
          value="${escapeHtml(serviceExportSearchKeyword)}"
          placeholder="Search services or mapped paths"
          aria-label="Search services in Export Service Artifacts"
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

      <p class="service-export-selected">
        Selected service: <strong data-role="service-export-selected-label">${escapeHtml(selectedServiceLabel)}</strong>
      </p>

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

function renderLocalRegistryRow() {
  const stateLabel = localRegistryInstalling
    ? 'Installing…'
    : localRegistryRunning
      ? `Running · ${escapeHtml(localRegistryUrl)}`
      : 'Stopped';
  const stateClass = localRegistryInstalling
    ? 'is-installing'
    : localRegistryRunning
      ? 'is-running'
      : 'is-stopped';
  const toggleLabel = localRegistryRunning ? 'Stop Registry' : 'Start Registry';

  return `
    <section class="local-registry-row" aria-label="Local package registry">
      <span class="local-registry-dot ${stateClass}" aria-hidden="true"></span>
      <span class="local-registry-state" data-role="local-registry-state">
        Local registry: ${stateLabel}
      </span>
      <button
        type="button"
        class="secondary-action local-registry-toggle"
        data-action="local-registry-toggle"
        ${localRegistryInstalling ? 'disabled' : ''}
      >
        ${toggleLabel}
      </button>
    </section>
  `;
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
      const tone = buildResultSuccess ? 'is-success' : 'is-error';
      const resultText = buildResultSuccess ? '✓ Built &amp; published' : escapeHtml(buildResultMessage);
      actionCell = `<span class="detected-pkg-result ${tone}" title="${escapeHtml(buildResultMessage)}">${resultText}</span>`;
    } else if (isBuilding) {
      actionCell = `<button
        type="button"
        class="small-action detected-pkg-single-build is-building"
        data-action="build-single-package"
        data-package="${escapeHtml(pkgName)}"
        disabled
        aria-busy="true"
      ><span class="detected-pkg-spinner" aria-hidden="true"></span>Build</button>`;
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

    const roundLabel = pkg && typeof pkg.round === 'number' ? `Build ${String(pkg.round + 1)}` : '—';
    li.innerHTML = `
      <span class="detected-pkg-round" title="Build order (lower builds first)">${escapeHtml(roundLabel)}</span>
      <span class="detected-pkg-name" title="${escapeHtml(pkgName)}">${escapeHtml(pkgName)}</span>
      ${actionCell}
    `;
  }
  
  const buildAllBtn = document.querySelector('.detected-packages-build');
  if (buildAllBtn instanceof HTMLButtonElement) {
    if (buildPublishInProgress) {
      buildAllBtn.disabled = true;
      buildAllBtn.innerHTML = 'Building&#8230;';
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
        const roundLabel = typeof pkg.round === 'number' ? `Build ${String(pkg.round + 1)}` : '—';
        const isBuilding = buildingPackageName === pkg.name;
        const hasResult = buildResultPackageName === pkg.name;

        let actionCell;
        if (hasResult) {
          const tone = buildResultSuccess ? 'is-success' : 'is-error';
          const resultText = buildResultSuccess ? '✓ Built &amp; published' : escapeHtml(buildResultMessage);
          actionCell = `<span class="detected-pkg-result ${tone}" title="${escapeHtml(buildResultMessage)}">${resultText}</span>`;
        } else if (isBuilding) {
          actionCell = `<button
            type="button"
            class="small-action detected-pkg-single-build is-building"
            data-action="build-single-package"
            data-package="${escapeHtml(pkg.name)}"
            disabled
            aria-busy="true"
          ><span class="detected-pkg-spinner" aria-hidden="true"></span>Build</button>`;
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
            <span class="detected-pkg-round" title="Build order (lower builds first)">${escapeHtml(roundLabel)}</span>
            <span class="detected-pkg-name" title="${escapeHtml(pkg.name)}">${escapeHtml(pkg.name)}</span>
            ${actionCell}
          </li>`;
      })
      .join('');
    body = `<ol class="detected-pkg-list">${rows}</ol>`;
  }

  const buildAllButton =
    count > 0
      ? `<button
          type="button"
          class="small-action detected-packages-build"
          data-action="build-publish-all"
          title="Build &amp; publish all detected packages to the local registry, in dependency order"
          ${buildPublishInProgress ? 'disabled' : ''}
        >${buildPublishInProgress ? 'Building&#8230;' : 'Build All'}</button>`
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

  return `
    <section class="group-card sql-workbench" aria-label="S/4HANA SQL Workbench">
      <header class="sql-workbench-header">
        <h2>S/4HANA SQL Workbench</h2>
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

function getFilteredLogs() {
  const keyword = searchKeyword.trim().toLowerCase();

  return logsData.filter((entry) => {
    if (selectedLevel !== 'all' && entry.level !== selectedLevel) {
      return false;
    }

    if (keyword.length === 0) {
      return true;
    }

    const haystack = `${entry.app} ${entry.instance} ${entry.message}`.toLowerCase();
    return haystack.includes(keyword);
  });
}

function resolveSelectedRegion() {
  return regionLookup.get(selectedRegionId);
}

function resolveSelectedOrg() {
  if (vscodeApi !== null && liveOrgOptions !== null) {
    return liveOrgLookup.get(selectedOrgId);
  }

  return resolveCurrentMockOrgOptions().find((org) => org.id === selectedOrgId);
}

function resolveSelectedOrgName() {
  if (selectedOrgName.length > 0) {
    return selectedOrgName;
  }

  return resolveSelectedOrg()?.name ?? '';
}

function resolveCurrentMockOrgOptions() {
  const selectedRegion = resolveSelectedRegion();
  if (selectedRegion?.code === 'br-10') {
    return BR10_ORG_OPTIONS;
  }

  return DEFAULT_ORG_OPTIONS;
}

function resolveSelectableSpaces() {
  if (vscodeApi !== null && liveSpaceNames !== null) {
    return liveSpaceNames;
  }

  return resolveSelectedOrg()?.spaces ?? [];
}

function resolveSelectedLog(logs) {
  if (logs.length === 0) {
    return undefined;
  }

  const selectedLog = logs.find((entry) => entry.id === selectedLogId);
  return selectedLog ?? logs[0];
}

function cloneSeedLogs() {
  return LOG_SEED.map((entry) => ({ ...entry }));
}

function resolveCurrentSpaceApps() {
  if (vscodeApi !== null) {
    if (liveAppOptions === null) {
      return [];
    }
    return liveAppOptions.map((app) => ({
      id: app.id,
      name: app.name,
      runningInstances:
        typeof app.runningInstances === 'number' ? app.runningInstances : 0,
    }));
  }

  const spaceKey = selectedSpaceId.trim().toLowerCase();
  const curatedAppNames = SPACE_APP_OPTIONS[spaceKey];
  const appNames = Array.isArray(curatedAppNames) ? curatedAppNames : buildFallbackAppNames(spaceKey);
  return appNames.map((appName) => ({ id: appName, name: appName, runningInstances: 1 }));
}

function resolveHanaServices() {
  if (hanaServiceOptions !== null) {
    return hanaServiceOptions;
  }

  syncSqlAppTargetsFromCurrentApps();
  return hanaServiceOptions ?? [];
}

function filterHanaServiceRows(services) {
  const keyword = sqlAppSearchKeyword.trim().toLowerCase();
  if (keyword.length === 0) {
    return services;
  }

  return services.filter((service) => {
    const serviceName = typeof service.name === 'string' ? service.name.toLowerCase() : '';
    return serviceName.includes(keyword);
  });
}

function resolveSelectedHanaService() {
  const services = resolveHanaServices();
  return services.find((service) => service.id === selectedHanaServiceId);
}

function pruneSelectedHanaServiceId() {
  if (selectedHanaServiceId.length === 0) {
    return;
  }
  const serviceIds = new Set(resolveHanaServices().map((service) => service.id));
  if (!serviceIds.has(selectedHanaServiceId)) {
    selectedHanaServiceId = '';
  }
}

function syncSqlAppTargetsFromCurrentApps() {
  const apps = resolveCurrentSpaceApps();
  hanaServiceOptions = apps.map((app) => ({
    id: app.id,
    name: app.name,
    runningInstances:
      typeof app.runningInstances === 'number' && Number.isFinite(app.runningInstances)
        ? app.runningInstances
        : 0,
  }));
  pruneSelectedHanaServiceId();
}

// Only apps with at least one running instance can stream logs. Mirrors the CF Logs
// panel filter (filterLoggableApps / isLoggableApp) so the sidebar App Logging catalog
// no longer lists stopped or scaled-to-zero apps where logs cannot be viewed. Stopped
// apps remain available in the Apps workspace (service export) which uses the full list.
function filterLoggableCatalogApps(apps) {
  return apps.filter(
    (app) => Number.isFinite(app.runningInstances) && app.runningInstances > 0
  );
}

function filterAppCatalogRows(apps) {
  const keyword = appCatalogSearchKeyword.trim().toLowerCase();
  if (keyword.length === 0) {
    return apps;
  }

  return apps.filter((app) => {
    const appName = typeof app.name === 'string' ? app.name.toLowerCase() : '';
    return appName.includes(keyword);
  });
}

function resolveServiceExportRows(availableApps) {
  // Only apps actually running on CF (started, instances > 0) are services you can map
  // and export — mirror the Logs tab so stopped / scaled-to-zero apps are hidden here too.
  const runningApps = filterLoggableCatalogApps(availableApps);
  const mappingByAppId = new Map(serviceFolderMappings.map((mapping) => [mapping.appId, mapping]));
  return runningApps.map((app) => {
    const existingMapping = mappingByAppId.get(app.id);
    if (existingMapping !== undefined) {
      return existingMapping;
    }

    return {
      appId: app.id,
      appName: app.name,
      folderPath: '',
      isMapped: false,
      hasConflict: false,
      candidateFolderPaths: [],
      matchType: 'none',
    };
  });
}

function filterServiceExportRows(mappingRows) {
  const keyword = serviceExportSearchKeyword.trim().toLowerCase();
  if (keyword.length === 0) {
    return mappingRows;
  }

  return mappingRows.filter((mapping) => {
    const appName = mapping.appName.toLowerCase();
    const folderPath = mapping.folderPath.toLowerCase();
    return appName.includes(keyword) || folderPath.includes(keyword);
  });
}

function normalizeServiceFolderMappings(rawMappings) {
  const normalizedMappings = [];
  for (const rawMapping of rawMappings) {
    if (!isRecord(rawMapping)) {
      continue;
    }
    const appIdRaw = typeof rawMapping.appId === 'string' ? rawMapping.appId.trim() : '';
    const appNameRaw = typeof rawMapping.appName === 'string' ? rawMapping.appName.trim() : '';
    const folderPathRaw =
      typeof rawMapping.folderPath === 'string' ? rawMapping.folderPath.trim() : '';
    const matchTypeRaw =
      typeof rawMapping.matchType === 'string' ? rawMapping.matchType.trim() : '';
    const rawCandidateFolderPaths = Array.isArray(rawMapping.candidateFolderPaths)
      ? rawMapping.candidateFolderPaths
      : [];
    const candidateFolderPaths = rawCandidateFolderPaths
      .filter((pathValue) => typeof pathValue === 'string')
      .map((pathValue) => pathValue.trim())
      .filter((pathValue) => pathValue.length > 0);
    const hasConflict =
      rawMapping.hasConflict === true ||
      matchTypeRaw === 'ambiguous' ||
      candidateFolderPaths.length > 1;
    const appId = appIdRaw.length > 0 ? appIdRaw : appNameRaw;
    if (appId.length === 0 || appNameRaw.length === 0) {
      continue;
    }
    const normalizedFolderPath = folderPathRaw.length > 0 ? folderPathRaw : '';
    const isMapped =
      normalizedFolderPath.length > 0 &&
      (!hasConflict || candidateFolderPaths.includes(normalizedFolderPath));
    normalizedMappings.push({
      appId,
      appName: appNameRaw,
      folderPath: isMapped ? normalizedFolderPath : '',
      isMapped,
      hasConflict,
      candidateFolderPaths,
      matchType: matchTypeRaw.length > 0 ? matchTypeRaw : 'none',
    });
  }
  return normalizedMappings;
}

function formatServiceMapPathLabel(pathValue) {
  const normalizedPath = typeof pathValue === 'string' ? pathValue.trim() : '';
  if (normalizedPath.length === 0) {
    return '';
  }

  if (normalizedPath.length <= SERVICE_MAP_PATH_LABEL_MAX_CHARS) {
    return normalizedPath;
  }

  const suffixLength = SERVICE_MAP_PATH_LABEL_MAX_CHARS - SERVICE_MAP_PATH_LABEL_ELLIPSIS.length;
  if (suffixLength <= 0) {
    return SERVICE_MAP_PATH_LABEL_ELLIPSIS;
  }

  return `${SERVICE_MAP_PATH_LABEL_ELLIPSIS}${normalizedPath.slice(-suffixLength)}`;
}

function buildMockServiceFolderMappings(rootFolderPath, availableApps) {
  return availableApps.map((app, index) => {
    const shouldMap = index % 3 !== 2;
    const normalizedFolderName = app.name.replaceAll('-', '_');
    return {
      appId: app.id,
      appName: app.name,
      folderPath: shouldMap ? `${rootFolderPath}/${normalizedFolderName}` : '',
      isMapped: shouldMap,
      hasConflict: false,
      candidateFolderPaths: shouldMap ? [`${rootFolderPath}/${normalizedFolderName}`] : [],
      matchType: normalizedFolderName === app.name ? 'exact' : 'underscore',
    };
  });
}

function clearServiceMappingsForScope() {
  serviceFolderMappings = [];
  selectedServiceExportAppId = '';
  serviceFolderScanInProgress = false;
  serviceExportInProgress = false;
  serviceExportStatusMessage = '';
  serviceExportStatusTone = 'info';
}

function pruneSelectedServiceExportAppId() {
  if (selectedServiceExportAppId.length === 0) {
    return;
  }
  const mappedIds = new Set(
    serviceFolderMappings
      .filter((mapping) => mapping.isMapped)
      .map((mapping) => mapping.appId)
  );
  if (!mappedIds.has(selectedServiceExportAppId)) {
    selectedServiceExportAppId = '';
  }
}

function refreshServiceMappingsAfterAppsLoaded() {
  const availableApps = resolveCurrentSpaceApps();

  if (localServiceRootFolderPath.length === 0) {
    clearServiceMappingsForScope();
    serviceExportStatusTone = 'error';
    serviceExportStatusMessage = 'Select a local root folder before scanning service mappings.';
    return;
  }

  if (availableApps.length === 0) {
    serviceFolderScanInProgress = false;
    serviceExportInProgress = false;
    serviceExportStatusTone = 'info';
    serviceExportStatusMessage = 'No running services available in this space.';
    return;
  }

  if (vscodeApi === null) {
    serviceFolderMappings = buildMockServiceFolderMappings(
      localServiceRootFolderPath,
      availableApps
    );
    pruneSelectedServiceExportAppId();
    return;
  }

  serviceFolderScanInProgress = true;
  serviceExportStatusTone = 'info';
  serviceExportStatusMessage = 'Scanning local folders for service mapping...';
  vscodeApi.postMessage({
    type: REFRESH_SERVICE_FOLDER_MAPPINGS_MESSAGE_TYPE,
    rootFolderPath: localServiceRootFolderPath,
    appNames: availableApps.map((app) => app.name),
  });
}

function triggerServiceExport() {
  const selectedMapping = serviceFolderMappings.find(
    (mapping) => mapping.appId === selectedServiceExportAppId && mapping.isMapped
  );
  if (selectedMapping === undefined) {
    serviceExportStatusTone = 'error';
    serviceExportStatusMessage = 'Choose one mapped service before exporting.';
    return true;
  }

  const basePayload = {
    appId: selectedMapping.appId,
    appName: selectedMapping.appName,
    rootFolderPath: localServiceRootFolderPath,
  };

  serviceExportInProgress = true;
  serviceExportStatusTone = 'info';
  serviceExportStatusMessage = 'Exporting artifacts from Cloud Foundry...';

  if (vscodeApi === null) {
    serviceExportInProgress = false;
    serviceExportStatusTone = 'success';
    serviceExportStatusMessage =
      `Export completed for "${selectedMapping.appName}". 6 files: default-env.json, pnpm-lock.yaml, package.json, .npmrc, .cdsrc.json, .csdrc.json.`;
    return true;
  }

  vscodeApi.postMessage({
    type: EXPORT_SERVICE_ARTIFACTS_MESSAGE_TYPE,
    ...basePayload,
  });
  return true;
}

function triggerSqlToolsConfigExport() {
  const selectedMapping = serviceFolderMappings.find(
    (mapping) => mapping.appId === selectedServiceExportAppId && mapping.isMapped
  );
  if (selectedMapping === undefined) {
    serviceExportStatusTone = 'error';
    serviceExportStatusMessage = 'Choose one mapped service before exporting SQLTools config.';
    refreshUiAfterServiceExportStateChange();
    return true;
  }

  const basePayload = {
    appId: selectedMapping.appId,
    appName: selectedMapping.appName,
    rootFolderPath: localServiceRootFolderPath,
  };

  serviceExportInProgress = true;
  serviceExportStatusTone = 'info';
  serviceExportStatusMessage = `Exporting SQLTools config for ${selectedMapping.appName}...`;

  if (vscodeApi === null) {
    serviceExportInProgress = false;
    serviceExportStatusTone = 'success';
    serviceExportStatusMessage =
      `SQLTools connection "${selectedMapping.appName} (prototype)" exported.`;
    refreshUiAfterServiceExportStateChange();
    return true;
  }

  refreshUiAfterServiceExportStateChange();
  vscodeApi.postMessage({
    type: EXPORT_SQLTOOLS_CONFIG_MESSAGE_TYPE,
    ...basePayload,
  });
  return true;
}

function resolveActiveAppNamesByIds(activeAppIds) {
  const appNameById = new Map(resolveCurrentSpaceApps().map((app) => [app.id, app.name]));
  const names = [];
  for (const appId of activeAppIds) {
    const appName = appNameById.get(appId);
    if (typeof appName === 'string' && appName.length > 0) {
      names.push(appName);
    }
  }
  return names;
}

function buildFallbackAppNames(spaceKey) {
  const orgName = resolveSelectedOrgName() || 'app-services';
  const orgSlug = orgName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  const suffix = spaceKey.length > 0 ? spaceKey : 'space';
  return [
    `${orgSlug}-${suffix}-api`,
    `${orgSlug}-${suffix}-worker`,
    `${orgSlug}-${suffix}-jobs`,
  ];
}

function resetWorkspaceLoggingState() {
  resetActiveAppLoggingState();
  clearServiceMappingsForScope();
  resetSqlWorkbenchState();
}

function resetSqlWorkbenchState() {
  hanaServiceOptions = null;
  selectedHanaServiceId = '';
  hanaQueryStatusMessage = '';
  hanaQueryStatusTone = 'info';
  sqlTableSearchKeyword = '';
  hanaTablesByServiceId = new Map();
  hanaTablesLoadingByServiceId = new Map();
  hanaTablesErrorByServiceId = new Map();
  hanaSqlResultPreviewState = null;
  hanaSqlResultExportMenuOpen = false;
}

function resetActiveAppLoggingState() {
  const hadActiveApps = activeAppLogIds.length > 0;
  selectedAppLogIds = [];
  activeAppLogIds = [];
  statusMessage = '';
  if (hadActiveApps) {
    postActiveAppsChanged([]);
  }
}

function pruneSelectedAppIds() {
  const allowedAppIds = new Set(resolveCurrentSpaceApps().map((app) => app.id));
  selectedAppLogIds = selectedAppLogIds.filter((appId) => allowedAppIds.has(appId));
  activeAppLogIds = activeAppLogIds.filter((appId) => allowedAppIds.has(appId));
  postActiveAppsChanged(resolveActiveAppNamesByIds(activeAppLogIds));
}

function formatNow() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
