import { DESIGN_CATALOG, REGION_GROUPS } from './design-catalog.js?v=20260509a';

const TAB_ITEMS = [
  { id: 'logs', label: 'Log-API-Event' },
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
  prod: ['demo-app', 'api1', 'api2', 'destination-adapter'],
  staging: ['demo-app-staging', 'api1-staging', 'api2-staging'],
  integration: ['demo-app-int', 'api1-int', 'events-int-consumer'],
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
    app: 'demo-app',
    instance: '0',
    message: 'Request completed with 200 status for invoice summary endpoint.',
  },
  {
    id: 'log-002',
    time: '11:25:22',
    level: 'WARN',
    app: 'demo-app',
    instance: '1',
    message: 'Retrying connection to dependent destination service after timeout.',
  },
  {
    id: 'log-003',
    time: '11:25:30',
    level: 'ERR',
    app: 'api1',
    instance: '0',
    message: 'Failed to bind queue consumer because of temporary authorization error.',
  },
  {
    id: 'log-004',
    time: '11:25:36',
    level: 'INFO',
    app: 'api1',
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
const PAUSED_APPS_CHANGED_MESSAGE_TYPE = 'sapTools.pausedAppsChanged';
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
const REPLACE_SERVICE_PACKAGE_PLACEHOLDER_MESSAGE_TYPE = 'sapTools.replaceServicePackagePlaceholder';
const EXPORT_SQLTOOLS_CONFIG_MESSAGE_TYPE = 'sapTools.exportSqlToolsConfig';
const OPEN_HANA_SQL_FILE_MESSAGE_TYPE = 'sapTools.openHanaSqlFile';
const RUN_HANA_TABLE_SELECT_MESSAGE_TYPE = 'sapTools.runHanaTableSelect';
const RUN_MICROSOFT_GRAPH_TOOL_MESSAGE_TYPE = 'sapTools.runMicrosoftGraphTool';
const RELOAD_APP_LIST_MESSAGE_TYPE = 'sapTools.reloadAppList';
const RESTORE_CONFIRMED_SCOPE_MESSAGE_TYPE = 'sapTools.restoreConfirmedScope';
const HANA_SQL_FILE_OPEN_RESULT_MESSAGE_TYPE = 'sapTools.hanaSqlFileOpenResult';
const HANA_TABLES_LOADED_MESSAGE_TYPE = 'sapTools.hanaTablesLoaded';
const HANA_TUNNEL_STATE_MESSAGE_TYPE = 'sapTools.hanaTunnelState';
const HANA_TABLE_SELECT_RESULT_MESSAGE_TYPE = 'sapTools.hanaTableSelectResult';
const MICROSOFT_GRAPH_TOOL_PROGRESS_MESSAGE_TYPE = 'sapTools.microsoftGraphToolProgress';
const MICROSOFT_GRAPH_TOOL_RESULT_MESSAGE_TYPE = 'sapTools.microsoftGraphToolResult';
const CF_TOPOLOGY_MESSAGE_TYPE = 'sapTools.cfTopology';
const TOPOLOGY_SCOPE_RESOLVED_MESSAGE_TYPE = 'sapTools.topologyScopeResolved';
const TOPOLOGY_ORG_SELECTED_MESSAGE_TYPE = 'sapTools.topologyOrgSelected';
const QUICK_SCOPE_CONFIRM_MESSAGE_TYPE = 'sapTools.quickScopeConfirm';
const TOPOLOGY_ORG_SEARCH_LIMIT = 50;
const vscodeApi = resolveVscodeApi();
const HANA_SQL_RUN_SHORTCUT_LABEL = /Mac/i.test(navigator.platform)
  ? 'Cmd+E Cmd+E'
  : 'Ctrl+E Ctrl+E';
const HANA_SQL_SHORTCUT_NOTIFICATION_MS = 4500;

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
let appsReloadInProgress = false;
let syncIntervalHours = 24;
let syncInProgress = false;
let lastSyncStartedAt = null;
let lastSyncCompletedAt = null;
let nextSyncAt = null;
let lastSyncError = '';
let activeUserEmail = '';
let settingsStatusMessage = '';
let previousModeBeforeSettings = 'selection';
let previousModeBeforeTools = 'workspace';
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
let buildPublishCompletedCount = 0;
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
let hanaSqlOpenRequestSequence = 0;
let latestHanaSqlOpenRequestId = 0;
let sqlAppSearchKeyword = '';
let hanaQueryStatusMessage = '';
let hanaQueryStatusTone = 'info';
let hanaTablesByServiceId = new Map();
let hanaTablesLoadingByServiceId = new Map();
let hanaTablesErrorByServiceId = new Map();
let hanaTunnelByServiceId = new Map();
// Scope (region/org/space) the per-service SQL maps above belong to. Used to drop
// them when the active scope changes, since serviceId (= app name) can collide
// across spaces and would otherwise show another scope's tables/tunnel badge.
let lastSqlScopeKey = null;
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
let activeSupportToolId = '';
let microsoftGraphToolRunInProgress = false;
let microsoftGraphToolStatusMessage = '';
let microsoftGraphToolStatusTone = 'info';
let microsoftGraphToolSteps = [];
let microsoftGraphClientSecretVisibleByTool = {
  outlook: false,
  sharepoint: false,
};
let microsoftGraphToolFormValues = {
  outlook: {
    clientId: '',
    clientSecret: '',
    tenantId: '',
    senderEmail: '',
    recipientEmail: '',
  },
  sharepoint: {
    clientId: '',
    clientSecret: '',
    tenantId: '',
    url: '',
    site: '',
    rootDir: '/',
  },
};

// ── APIs Explorer State ───────────────────────────────────────────────────────
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
