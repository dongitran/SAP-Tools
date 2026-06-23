import * as vscode from 'vscode';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  cfLogin,
  fetchCfLoginInfo,
  fetchOrgs,
  fetchSpaces,
  getCfApiEndpoint,
  isCfSessionExpired,
} from './cfClient';
import type { CfSession } from './cfClient';
import { ensureCfHomeDir } from './cfHome';
import type { CacheRuntimeSnapshot, CacheSyncService } from './cacheSyncService';
import { normalizeUserEmail, type CacheStore } from './cacheStore';
import type { CfLogsPanelProvider } from './cfLogsPanel';
import { clearCredentials, getEffectiveCredentials, storeCredentials } from './credentialStore';
import { isSyncIntervalHours } from './cacheModels';
import type { SyncIntervalHours } from './cacheModels';
import {
  buildServiceFolderMappings,
  type ServiceFolderMapping,
} from './serviceFolderMapping';
import {
  exportServiceArtifacts,
  formatServiceArtifactExportCompletionMessage,
  type ServiceExportSession,
} from './serviceArtifactExporter';
import { readSharedAppFolderMappings, readSharedRemoteRoot } from './sharedDebugConfig';
import { exportSqlToolsConfig } from './sqlToolsConfigExporter';
import type { ApisExplorerPanelManager, ApisExplorerPanelSession } from './apisExplorerPanel';
import type { EventMeshTargetParams } from './eventMeshPanel';
import {
  resolveMockApps,
  resolveMockCfTopology,
  resolveMockOrgsForRegion,
  resolveMockSpacesForOrg,
} from './testModeData';
import { SAP_BTP_REGIONS, toHyphenatedRegionCode } from './regions';
import {
  EMPTY_CF_TOPOLOGY,
  getAppsFromTopologySync,
  getCfTopologySnapshot,
  getCfTopologySnapshotSync,
  type CfTopology,
} from './cfTopology';
import { refreshCfSyncSpace } from './cfSpaceRefresh';
import type { HanaSqlWorkbench } from './hanaSqlWorkbench';
import { writeScopeIfChanged, type SharedCfScope } from './scopeSync';
import {
  readLocalPackagesConfig,
  type LocalPackagesConfig,
} from './localPackages/localPackagesConfig';
import { VerdaccioManager } from './localPackages/verdaccioManager';
import { runBuildPublishAll } from './localPackages/buildPublishOrchestrator';
import { scanLocalPackages } from './localPackages/localPackageScanner';
import { buildDependencyOrder } from './localPackages/dependencyGraph';
import {
  replaceServicePackageDependencyTags,
  type ServiceDependencyTagReplacementResult,
} from './localPackages/serviceDependencyTags';
import {
  readMicrosoftGraphToolRunRequest,
  runMicrosoftGraphTool,
  type MicrosoftGraphToolRunRequest,
  type MicrosoftGraphToolStepProgress,
  sanitizeGraphMessage,
} from './microsoftGraphTools';
import type { EventMeshStopReason } from './eventMeshProviderRouter';

export const REGION_VIEW_ID = 'sapTools.regionView';

const PROTOTYPE_DESIGN_ID = '34';
const CONFIRMED_SCOPE_BY_EMAIL_GLOBAL_STATE_KEY = 'sapTools.confirmedScopeByEmail.v1';
const SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY = 'sapTools.serviceMappingsByScope.v1';

// ── Inbound message types (webview → extension) ─────────────────────────────

const MSG_REQUEST_INITIAL_STATE = 'sapTools.requestInitialState';
const MSG_LOGIN_SUBMIT = 'sapTools.loginSubmit';
const MSG_REGION_SELECTED = 'sapTools.regionSelected';
const MSG_ORG_SELECTED = 'sapTools.orgSelected';
const MSG_SPACE_SELECTED = 'sapTools.spaceSelected';
const MSG_CONFIRM_SCOPE = 'sapTools.confirmScope';
const MSG_TOPOLOGY_ORG_SELECTED = 'sapTools.topologyOrgSelected';
const MSG_QUICK_SCOPE_CONFIRM = 'sapTools.quickScopeConfirm';
const MSG_REQUEST_CF_TOPOLOGY = 'sapTools.requestCfTopology';
const MSG_OPEN_CF_LOGS_PANEL = 'sapTools.openCfLogsPanel';
const MSG_ACTIVE_APPS_CHANGED = 'sapTools.activeAppsChanged';
const MSG_PAUSED_APPS_CHANGED = 'sapTools.pausedAppsChanged';
const MSG_UPDATE_SYNC_INTERVAL = 'sapTools.updateSyncInterval';
const MSG_SYNC_NOW = 'sapTools.syncNow';
const MSG_LOGOUT = 'sapTools.logout';
const MSG_SELECT_LOCAL_ROOT_FOLDER = 'sapTools.selectLocalRootFolder';
const MSG_REFRESH_SERVICE_FOLDER_MAPPINGS = 'sapTools.refreshServiceFolderMappings';
const MSG_SELECT_SERVICE_FOLDER_MAPPING = 'sapTools.selectServiceFolderMapping';
const MSG_EXPORT_SERVICE_ARTIFACTS = 'sapTools.exportServiceArtifacts';
const MSG_REPLACE_SERVICE_PACKAGE_PLACEHOLDER = 'sapTools.replaceServicePackagePlaceholder';
const MSG_EXPORT_SQLTOOLS_CONFIG = 'sapTools.exportSqlToolsConfig';
const MSG_OPEN_HANA_SQL_FILE = 'sapTools.openHanaSqlFile';
const MSG_OPEN_APIS_EXPLORER = 'saptools.openApisExplorer';
const MSG_OPEN_EVENT_MESH = 'saptools.openEventMesh';
const MSG_RUN_HANA_TABLE_SELECT = 'sapTools.runHanaTableSelect';
const MSG_OPEN_SQLTOOLS_EXTENSION = 'sapTools.openSqlToolsExtension';
const MSG_BUILD_PUBLISH_ALL = 'sapTools.buildPublishAll';
const MSG_BUILD_SINGLE_PACKAGE = 'sapTools.buildSinglePackage';
const MSG_LOCAL_REGISTRY_START = 'sapTools.localRegistryStart';
const MSG_LOCAL_REGISTRY_STOP = 'sapTools.localRegistryStop';
const MSG_LOCAL_REGISTRY_STATUS = 'sapTools.localRegistryStatus';
const MSG_OPEN_LOCAL_PACKAGES_SETTINGS = 'sapTools.openLocalPackagesSettings';
const MSG_RUN_MICROSOFT_GRAPH_TOOL = 'sapTools.runMicrosoftGraphTool';
const MSG_RELOAD_APP_LIST = 'sapTools.reloadAppList';
const SQLTOOLS_EXTENSION_ID = 'mtxr.sqltools';
const SQLTOOLS_ACTIVITY_BAR_COMMAND = 'workbench.view.extension.sqltools-activity-bar';
const BUILTIN_EXTENSION_OPEN_COMMAND = 'extension.open';

// ── Outbound message types (extension → webview) ────────────────────────────

const MSG_LOGIN_RESULT = 'sapTools.loginResult';
const MSG_LOGOUT_RESULT = 'sapTools.logoutResult';
const MSG_ORGS_LOADED = 'sapTools.orgsLoaded';
const MSG_ORGS_ERROR = 'sapTools.orgsError';
const MSG_SPACES_LOADED = 'sapTools.spacesLoaded';
const MSG_SPACES_ERROR = 'sapTools.spacesError';
const MSG_APPS_LOADED = 'sapTools.appsLoaded';
const MSG_APPS_ERROR = 'sapTools.appsError';
const MSG_APPS_RELOAD_ERROR = 'sapTools.appsReloadError';
const MSG_CACHE_STATE = 'sapTools.cacheState';
const MSG_LOCAL_ROOT_FOLDER_UPDATED = 'sapTools.localRootFolderUpdated';
const MSG_SERVICE_FOLDER_MAPPINGS_LOADED = 'sapTools.serviceFolderMappingsLoaded';
const MSG_SERVICE_FOLDER_MAPPINGS_ERROR = 'sapTools.serviceFolderMappingsError';
const MSG_EXPORT_ARTIFACT_PROGRESS = 'sapTools.exportArtifactProgress';
const MSG_EXPORT_ARTIFACT_RESULT = 'sapTools.exportArtifactResult';
const MSG_EXPORT_SQLTOOLS_PROGRESS = 'sapTools.exportSqlToolsProgress';
const MSG_EXPORT_SQLTOOLS_RESULT = 'sapTools.exportSqlToolsResult';
const MSG_RESTORE_CONFIRMED_SCOPE = 'sapTools.restoreConfirmedScope';
const MSG_HANA_SQL_FILE_OPEN_RESULT = 'sapTools.hanaSqlFileOpenResult';
const MSG_HANA_TABLES_LOADED = 'sapTools.hanaTablesLoaded';
const MSG_HANA_TUNNEL_STATE = 'sapTools.hanaTunnelState';
const MSG_HANA_TABLE_SELECT_RESULT = 'sapTools.hanaTableSelectResult';
const MSG_REFRESH_HANA_TABLES = 'sapTools.refreshHanaTables';
const MSG_CF_TOPOLOGY = 'sapTools.cfTopology';
const MSG_TOPOLOGY_SCOPE_RESOLVED = 'sapTools.topologyScopeResolved';
const MSG_LOCAL_REGISTRY_STATE = 'sapTools.localRegistryState';
const MSG_LOCAL_PACKAGES_LOADED = 'sapTools.localPackagesLoaded';
const MSG_LOCAL_PACKAGES_LOADING = 'sapTools.localPackagesLoading';
const MSG_BUILD_PUBLISH_PREVIEW = 'sapTools.buildPublishPreview';
const MSG_BUILD_PUBLISH_PROGRESS = 'sapTools.buildPublishProgress';
const MSG_BUILD_PUBLISH_RESULT = 'sapTools.buildPublishResult';
const MSG_MICROSOFT_GRAPH_TOOL_PROGRESS = 'sapTools.microsoftGraphToolProgress';
const MSG_MICROSOFT_GRAPH_TOOL_RESULT = 'sapTools.microsoftGraphToolResult';
const MSG_APIS_EXPLORER_SETTLED = 'sapTools.apisExplorerSettled';
const MSG_EVENT_MESH_VIEWER_SETTLED = 'sapTools.eventMeshViewerSettled';

// ── Payload interfaces ───────────────────────────────────────────────────────

interface RegionSelectionPayload {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly area: string;
}

interface OrgSelectionPayload {
  readonly guid: string;
  readonly name: string;
}

interface SpaceSelectionPayload {
  readonly spaceName: string;
  readonly orgGuid: string;
  readonly orgName: string;
}

interface ConfirmScopePayload {
  readonly regionId: string;
  readonly regionCode: string;
  readonly regionName: string;
  readonly regionArea: string;
  readonly orgGuid: string;
  readonly orgName: string;
  readonly spaceName: string;
}

interface ConfirmScopeOptions {
  readonly invalidateHanaAppContexts?: boolean;
  readonly writeSharedScope?: boolean;
}

interface TopologyOrgSelectedPayload {
  readonly regionKey: string;
  readonly orgName: string;
}

interface QuickScopeConfirmPayload {
  readonly regionKey: string;
  readonly orgName: string;
  readonly spaceName: string;
}

interface ActiveAppsChangedPayload {
  readonly appNames: string[];
}

interface UpdateSyncIntervalPayload {
  readonly syncIntervalHours: SyncIntervalHours;
}

interface RefreshServiceFolderMappingsPayload {
  readonly rootFolderPath: string;
  readonly appNames: readonly string[];
}

interface SelectServiceFolderMappingPayload {
  readonly appId: string;
  readonly folderPath: string;
}

interface ExportServiceArtifactsPayload {
  readonly appId: string;
  readonly appName: string;
  readonly rootFolderPath: string;
}

interface ExportSqlToolsConfigPayload {
  readonly appId: string;
  readonly appName: string;
  readonly rootFolderPath: string;
}

interface OpenHanaSqlFilePayload {
  readonly requestId: number;
  readonly serviceId: string;
  readonly serviceName: string;
}

interface RefreshHanaTablesPayload {
  readonly serviceId: string;
  readonly serviceName: string;
}

interface RunHanaTableSelectPayload {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly tableName: string;
}

interface LogoutResultPayload {
  readonly type: string;
  readonly success: boolean;
  readonly error?: string;
}

interface CacheStatePayload {
  readonly type: string;
  readonly snapshot: {
    readonly activeUserEmail: string | null;
    readonly syncInProgress: boolean;
    readonly lastSyncStartedAt: string | null;
    readonly lastSyncCompletedAt: string | null;
    readonly lastSyncError: string;
    readonly syncIntervalHours: number;
    readonly nextSyncAt: string | null;
    readonly regionAccessById: Record<string, string>;
  };
}

interface CfLogSessionSeed {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir: string;
}

interface SidebarAppEntry {
  readonly id: string;
  readonly name: string;
  readonly runningInstances: number;
}

interface PersistedConfirmedScopeEntry {
  readonly regionId: string;
  readonly regionCode: string;
  readonly regionName: string;
  readonly regionArea: string;
  readonly orgGuid: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly confirmedAt: string;
}

interface LoadedScopeState {
  readonly regionId: string;
  readonly regionCode: string;
  readonly orgGuid: string;
  readonly orgName: string;
  readonly spaceName: string;
}

interface AppListReloadRequest {
  readonly scope: SharedCfScope;
  readonly loadedScope: LoadedScopeState | null;
  readonly regionId: string;
  readonly regionCode: string;
  readonly orgGuid: string;
  readonly spaceSelectionRequestId: number;
}

interface RootFolderCacheScope {
  readonly email: string;
  readonly regionCode: string;
  readonly orgGuid: string;
  readonly spaceName: string;
}

interface PersistedServiceMappingScopeEntry {
  readonly rootFolderPath: string;
  readonly mappings: readonly ServiceFolderMapping[];
  readonly updatedAt: string;
}

interface EventMeshViewerController {
  openEventMeshViewer(appId: string, targetParams?: EventMeshTargetParams): void | Promise<void>;
  stopAllListeners(reason: EventMeshStopReason): void;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class RegionSidebarProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private webviewView: vscode.WebviewView | undefined;
  private cfSession: CfSession | null = null;
  private cfSessionRegionCode = '';
  private selectedRegionCode = '';
  private selectedRegionId = '';
  private selectedOrgGuid = '';
  private regionSelectionRequestId = 0;
  private orgSelectionRequestId = 0;
  private spaceSelectionRequestId = 0;
  private selectedLocalRootFolderPath = '';
  private currentApps: SidebarAppEntry[] = [];
  private currentLogSessionSeed: CfLogSessionSeed | null = null;
  private serviceFolderMappings: ServiceFolderMapping[] = [];
  private readonly serviceFolderSelections = new Map<string, string>();
  private e2eRootDialogStepIndex = 0;
  private exportInProgress = false;
  private buildPublishInProgress = false;
  private hasAttemptedConfirmedScopeRestore = false;
  private lastLoadedScope: LoadedScopeState | null = null;
  private lastWrittenScope: SharedCfScope | undefined;
  private currentConfirmedScope: SharedCfScope | undefined;
  private externalScopeChangeRequestId = 0;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly npmBuildChannel: vscode.OutputChannel;
  private readonly microsoftGraphChannel: vscode.OutputChannel;
  private readonly verdaccioManager: VerdaccioManager;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly context: vscode.ExtensionContext,
    private readonly cfLogsPanel: CfLogsPanelProvider,
    private readonly cacheSyncService: CacheSyncService,
    private readonly cacheStore: CacheStore,
    private readonly hanaSqlWorkbench: HanaSqlWorkbench,
    private readonly apisExplorerPanelManager: ApisExplorerPanelManager,
    private readonly eventMeshPanelManager: EventMeshViewerController
  ) {
    this.hanaSqlWorkbench.registerActiveSessionProvider(() => this.currentLogSessionSeed);
    this.hanaSqlWorkbench.registerTunnelStateListener((appId, active) => {
      this.postMessage({
        type: MSG_HANA_TUNNEL_STATE,
        serviceId: appId,
        active,
      });
    });

    const cacheSubscription = this.cacheSyncService.subscribe((snapshot) => {
      this.postCacheState(snapshot);
      if (!snapshot.syncInProgress) {
        void this.pushCfTopology();
      }
    });
    this.disposables.push(cacheSubscription);

    this.npmBuildChannel = vscode.window.createOutputChannel('SAP Tools: NPM Build');
    this.microsoftGraphChannel = vscode.window.createOutputChannel('SAP Tools: Microsoft Graph');
    this.verdaccioManager = new VerdaccioManager(this.npmBuildChannel);
    this.disposables.push(
      this.npmBuildChannel,
      this.microsoftGraphChannel,
      this.verdaccioManager
    );

    // Re-scan local packages whenever the user changes sapTools.localPackages settings
    // (e.g. namePatterns) without requiring a VSCode restart.
    const localPackagesConfigSubscription = vscode.workspace.onDidChangeConfiguration(
      (event): void => {
        if (event.affectsConfiguration('sapTools.localPackages')) {
          void this.postDetectedLocalPackages();
        }
      }
    );
    this.disposables.push(localPackagesConfigSubscription);
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.webviewView = webviewView;
    this.cfSession = null;
    this.cfSessionRegionCode = '';
    this.selectedRegionCode = '';
    this.selectedRegionId = '';
    this.selectedOrgGuid = '';
    this.bumpRegionSelectionRequestId();
    this.currentApps = [];
    this.currentLogSessionSeed = null;
    this.serviceFolderMappings = [];
    this.serviceFolderSelections.clear();
    this.e2eRootDialogStepIndex = 0;
    this.exportInProgress = false;
    this.hasAttemptedConfirmedScopeRestore = false;
    this.lastLoadedScope = null;
    this.lastWrittenScope = undefined;
    this.currentConfirmedScope = undefined;

    const assetsRoot = vscode.Uri.joinPath(
      this.extensionUri,
      'docs',
      'designs',
      'prototypes',
      'assets'
    );

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [assetsRoot],
    };

    const credentials = await getEffectiveCredentials(this.context);
    await this.cacheSyncService.setCredentials(credentials);
    const nonce = createNonce();

    webviewView.webview.html =
      credentials !== null
        ? this.buildMainHtml(webviewView.webview, nonce, assetsRoot)
        : this.buildLoginGateHtml(webviewView.webview, nonce, assetsRoot);

    const messageSubscription = webviewView.webview.onDidReceiveMessage(
      (message: unknown): void => {
        void this.handleWebviewMessage(message).catch((error: unknown) => {
          this.logWebviewMessageFailure('message dispatch', error);
        });
      }
    );
    this.disposables.push(messageSubscription);
  }

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  // ── Message dispatcher ───────────────────────────────────────────────────

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isRecord(message)) {
      return;
    }

    const type = message['type'];

    if (type === MSG_REQUEST_INITIAL_STATE) {
      await this.handleRequestInitialState();
      return;
    }

    if (type === MSG_LOGIN_SUBMIT && isLoginSubmitMessage(message)) {
      const payload = readLoginSubmitPayload(message);
      await this.handleLoginSubmit(payload.email, payload.password);
      return;
    }

    if (type === MSG_REGION_SELECTED && isRegionSelectedMessage(message)) {
      const payload = readRegionSelectionPayload(message);
      this.logRegionSelection(payload);
      await this.handleRegionSelected(payload);
      return;
    }

    if (type === MSG_ORG_SELECTED && isOrgSelectedMessage(message)) {
      const payload = readOrgSelectionPayload(message);
      try {
        await this.handleOrgSelected(payload);
      } catch (error) {
        this.logWebviewMessageFailure('org selection', error);
        this.postSpacesError('Failed to load spaces for the selected organization.');
      }
      return;
    }

    if (type === MSG_SPACE_SELECTED && isSpaceSelectedMessage(message)) {
      const payload = readSpaceSelectionPayload(message);
      await this.handleSpaceSelected(payload);
      return;
    }

    if (type === MSG_CONFIRM_SCOPE && isConfirmScopeMessage(message)) {
      const payload = readConfirmScopePayload(message);
      await this.handleConfirmScope(payload);
      return;
    }

    if (type === MSG_TOPOLOGY_ORG_SELECTED && isTopologyOrgSelectedMessage(message)) {
      const payload = readTopologyOrgSelectedPayload(message);
      await this.handleTopologyOrgSelected(payload);
      return;
    }

    if (type === MSG_QUICK_SCOPE_CONFIRM && isQuickScopeConfirmMessage(message)) {
      const payload = readQuickScopeConfirmPayload(message);
      await this.handleQuickScopeConfirm(payload);
      return;
    }

    if (type === MSG_REQUEST_CF_TOPOLOGY) {
      await this.pushCfTopology();
      return;
    }

    if (type === MSG_RELOAD_APP_LIST) {
      await this.handleReloadAppList();
      return;
    }

    if (type === MSG_OPEN_CF_LOGS_PANEL) {
      this.cfLogsPanel.focus();
      return;
    }

    if (type === MSG_OPEN_APIS_EXPLORER) {
      const appId = message['appId'] as string;
      await this.handleOpenApisExplorer(appId);
      return;
    }

    if (type === MSG_OPEN_EVENT_MESH) {
      const appId = message['appId'] as string;
      if (appId === '') {
        return;
      }
      try {
        if (this.currentConfirmedScope !== undefined) {
          const credentials = await getEffectiveCredentials(this.context);
          if (credentials !== null) {
            const cfHomeDir = await ensureCfHomeDir(this.context);
            await this.eventMeshPanelManager.openEventMeshViewer(appId, {
              apiEndpoint: getCfApiEndpoint(this.currentConfirmedScope.regionCode),
              email: credentials.email,
              password: credentials.password,
              orgName: this.currentConfirmedScope.orgName,
              spaceName: this.currentConfirmedScope.spaceName,
              cfHomeDir,
            });
            return;
          }
        }
        await this.eventMeshPanelManager.openEventMeshViewer(appId);
      } finally {
        this.postMessage({
          type: MSG_EVENT_MESH_VIEWER_SETTLED,
          appId,
        });
      }
      return;
    }

    if (type === MSG_ACTIVE_APPS_CHANGED && isActiveAppsChangedMessage(message)) {
      const payload = readActiveAppsChangedPayload(message);
      this.cfLogsPanel.updateActiveApps(payload.appNames);
      return;
    }

    if (type === MSG_PAUSED_APPS_CHANGED && isActiveAppsChangedMessage(message)) {
      const payload = readActiveAppsChangedPayload(message);
      this.cfLogsPanel.updatePausedApps(payload.appNames);
      return;
    }

    if (type === MSG_SELECT_LOCAL_ROOT_FOLDER) {
      await this.handleSelectLocalRootFolder();
      return;
    }

    if (
      type === MSG_REFRESH_SERVICE_FOLDER_MAPPINGS &&
      isRefreshServiceFolderMappingsMessage(message)
    ) {
      const payload = readRefreshServiceFolderMappingsPayload(message);
      await this.handleRefreshServiceFolderMappings(payload);
      return;
    }

    if (
      type === MSG_SELECT_SERVICE_FOLDER_MAPPING &&
      isSelectServiceFolderMappingMessage(message)
    ) {
      const payload = readSelectServiceFolderMappingPayload(message);
      this.handleSelectServiceFolderMapping(payload);
      return;
    }

    if (type === MSG_EXPORT_SERVICE_ARTIFACTS && isExportServiceArtifactsMessage(message)) {
      const payload = readExportServiceArtifactsPayload(message);
      await this.handleExportServiceArtifacts(payload, {
        includeDefaultEnv: true,
        includePnpmLock: true,
      });
      return;
    }

    if (type === MSG_REPLACE_SERVICE_PACKAGE_PLACEHOLDER) {
      const appId = (message as { appId?: unknown }).appId;
      if (typeof appId === 'string' && appId.length > 0) {
        await this.handleReplaceServicePackagePlaceholder(appId);
      }
      return;
    }

    if (type === MSG_EXPORT_SQLTOOLS_CONFIG && isExportSqlToolsConfigMessage(message)) {
      const payload = readExportSqlToolsConfigPayload(message);
      await this.handleExportSqlToolsConfig(payload);
      return;
    }

    if (type === MSG_OPEN_HANA_SQL_FILE && isOpenHanaSqlFileMessage(message)) {
      const payload = readOpenHanaSqlFilePayload(message);
      await this.handleOpenHanaSqlFile(payload);
      return;
    }

    if (type === MSG_REFRESH_HANA_TABLES && isRefreshHanaTablesMessage(message)) {
      const payload = readRefreshHanaTablesPayload(message);
      await this.handleRefreshHanaTables(payload);
      return;
    }

    if (type === MSG_RUN_HANA_TABLE_SELECT && isRunHanaTableSelectMessage(message)) {
      const payload = readRunHanaTableSelectPayload(message);
      await this.handleRunHanaTableSelect(payload);
      return;
    }

    if (type === MSG_OPEN_SQLTOOLS_EXTENSION) {
      await this.handleOpenSqlToolsExtension();
      return;
    }

    if (type === MSG_BUILD_PUBLISH_ALL) {
      await this.handleBuildPublishAll();
      return;
    }

    if (type === MSG_BUILD_SINGLE_PACKAGE) {
      const payload = message['payload'];
      if (
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { packageName?: unknown }).packageName === 'string'
      ) {
        await this.handleBuildPublishAll((payload as { packageName: string }).packageName);
      }
      return;
    }

    if (type === MSG_LOCAL_REGISTRY_START) {
      await this.startLocalRegistry();
      return;
    }

    if (type === MSG_LOCAL_REGISTRY_STOP) {
      this.stopLocalRegistry();
      return;
    }

    if (type === MSG_LOCAL_REGISTRY_STATUS) {
      await this.postRegistryState();
      return;
    }

    if (type === MSG_OPEN_LOCAL_PACKAGES_SETTINGS) {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:dongtran.sap-tools local'
      );
      return;
    }

    if (type === MSG_RUN_MICROSOFT_GRAPH_TOOL) {
      const request = readMicrosoftGraphToolRunRequest(message);
      if (request !== null) {
        await this.handleMicrosoftGraphToolRun(request);
      }
      return;
    }

    if (type === MSG_UPDATE_SYNC_INTERVAL && isUpdateSyncIntervalMessage(message)) {
      const payload = readUpdateSyncIntervalPayload(message);
      const snapshot = await this.cacheSyncService.updateSyncInterval(
        payload.syncIntervalHours
      );
      this.postCacheState(snapshot);
      return;
    }

    if (type === MSG_SYNC_NOW) {
      const snapshot = await this.cacheSyncService.triggerSyncNow();
      this.postCacheState(snapshot);
      return;
    }

    if (type === MSG_LOGOUT) {
      await this.handleLogout();
      return;
    }
  }

  private async handleOpenApisExplorer(appId: string): Promise<void> {
    if (appId.length === 0) {
      return;
    }
    try {
      const session = await this.openApisExplorerSession(appId);
      await session.initialLoad;
    } finally {
      this.postMessage({
        type: MSG_APIS_EXPLORER_SETTLED,
        appId,
      });
    }
  }

  private async openApisExplorerSession(appId: string): Promise<ApisExplorerPanelSession> {
    const confirmedScope = this.currentConfirmedScope;
    if (confirmedScope === undefined) {
      return this.apisExplorerPanelManager.openApisExplorer(appId);
    }

    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      return this.apisExplorerPanelManager.openApisExplorer(appId);
    }

    const cfHomeDir = await ensureCfHomeDir(this.context);
    return this.apisExplorerPanelManager.openApisExplorer(appId, {
      apiEndpoint: getCfApiEndpoint(confirmedScope.regionCode),
      email: credentials.email,
      password: credentials.password,
      orgName: confirmedScope.orgName,
      spaceName: confirmedScope.spaceName,
      cfHomeDir,
    });
  }

  private async handleRequestInitialState(): Promise<void> {
    const snapshot = await this.cacheSyncService.getRuntimeSnapshot();
    this.postCacheState(snapshot);

    if (!this.hasAttemptedConfirmedScopeRestore) {
      await this.preloadRootFolderForPersistedScope();
    }

    this.postMessage({
      type: MSG_LOCAL_ROOT_FOLDER_UPDATED,
      path: this.selectedLocalRootFolderPath,
    });
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
    void this.postDetectedLocalPackages();

    this.postCfTopologySnapshot(this.resolveCfTopologySync());
    void this.pushCfTopology();

    if (!this.hasAttemptedConfirmedScopeRestore) {
      this.hasAttemptedConfirmedScopeRestore = true;
      await this.restoreConfirmedScopeForCurrentUser();
    }
  }

  private resolveCfTopologySync(): CfTopology {
    if (isTestMode()) {
      return resolveMockCfTopology();
    }
    return getCfTopologySnapshotSync();
  }

  private async resolveCfTopologyAsync(): Promise<CfTopology> {
    if (isTestMode()) {
      return resolveMockCfTopology();
    }
    return getCfTopologySnapshot();
  }

  private async pushCfTopology(): Promise<void> {
    try {
      const topology = await this.resolveCfTopologyAsync();
      this.postCfTopologySnapshot(topology);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to read CF topology snapshot.';
      this.outputChannel.appendLine(
        `[topology] Failed to read cf-sync topology: ${sanitizeForLog(errorMessage)}`
      );
      this.postCfTopologySnapshot(EMPTY_CF_TOPOLOGY);
    }
  }

  private postCfTopologySnapshot(topology: CfTopology): void {
    this.outputChannel.appendLine(
      `[topology] Pushed snapshot ready=${topology.ready ? 'true' : 'false'} accounts=${String(topology.accounts.length)}`
    );
    this.postMessage({
      type: MSG_CF_TOPOLOGY,
      topology: {
        ready: topology.ready,
        accounts: topology.accounts.map((account) => ({
          regionKey: account.regionKey,
          regionLabel: account.regionLabel,
          apiEndpoint: account.apiEndpoint,
          orgName: account.orgName,
          spaces: [...account.spaces],
        })),
      },
    });
  }

  private async handleConfirmScope(
    payload: ConfirmScopePayload,
    options: ConfirmScopeOptions = {}
  ): Promise<void> {
    await this.persistConfirmedScopeForCurrentUser(payload);
    const sharedScope = buildSharedScopeFromConfirmPayload(payload);
    const isChangedScope = !areSharedScopesEqual(sharedScope, this.currentConfirmedScope);
    this.lastWrittenScope = sharedScope;
    this.currentConfirmedScope = sharedScope;
    const shouldInvalidateHanaAppContexts = options.invalidateHanaAppContexts ?? true;
    if (isChangedScope && shouldInvalidateHanaAppContexts) {
      this.hanaSqlWorkbench.invalidateAllAppContexts();
    }
    if (isChangedScope) {
      // An open event viewer is bound to the previous scope's app/queue; stop its
      // AMQP listener and delete its debug queue so we never leak a tap across scopes.
      this.eventMeshPanelManager.stopAllListeners('scope-changed');
      void this.apisExplorerPanelManager.stopAllTraces('scope-changed');
    }
    const shouldWriteSharedScope = options.writeSharedScope ?? true;
    if (shouldWriteSharedScope) {
      try {
        await writeScopeIfChanged(sharedScope);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to write shared scope setting.';
        this.outputChannel.appendLine(
          `[scope] Shared setting update failed: ${sanitizeForLog(errorMessage)}`
        );
      }
    }
    this.outputChannel.appendLine(
      `[scope] Confirmed scope region=${sanitizeForLog(payload.regionCode)} org=${sanitizeForLog(payload.orgName)} space=${sanitizeForLog(payload.spaceName)}`
    );
    void this.refreshTopologyForConfirmedScope(payload).catch(() => undefined);
  }

  public async handleExternalScopeChange(scope: SharedCfScope): Promise<void> {
    if (areSharedScopesEqual(scope, this.lastWrittenScope)) {
      return;
    }

    const region = SAP_BTP_REGIONS.find((entry) => entry.id === scope.regionCode);
    if (region === undefined) {
      return;
    }

    if (areSharedScopesEqual(scope, this.currentConfirmedScope)) {
      return;
    }

    const requestId = this.bumpExternalScopeChangeRequestId();
    try {
      await this.restoreExternalScope(scope, requestId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to restore external scope.';
      this.outputChannel.appendLine(
        `[scope] External scope restore failed: ${sanitizeForLog(errorMessage)}`
      );
    }
  }

  private async restoreExternalScope(
    scope: SharedCfScope,
    requestId = this.externalScopeChangeRequestId
  ): Promise<void> {
    const region = SAP_BTP_REGIONS.find((entry) => entry.id === scope.regionCode);
    if (region === undefined) {
      return;
    }

    this.clearScopeBoundRuntimeStateForScopeChange();
    const orgGuid = await this.resolveOrgGuidByName(
      scope.regionCode,
      scope.orgName,
      () => this.isCurrentExternalScopeRequest(requestId)
    );
    if (!this.isCurrentExternalScopeRequest(requestId)) {
      return;
    }
    if (orgGuid.length === 0) {
      return;
    }

    const payload: ConfirmScopePayload = {
      regionId: region.id,
      regionCode: toHyphenatedRegionCode(region.id),
      regionName: region.displayName,
      regionArea: region.area,
      orgGuid,
      orgName: scope.orgName,
      spaceName: scope.spaceName,
    };

    await this.handleConfirmScope(payload, {
      invalidateHanaAppContexts: false,
      writeSharedScope: false,
    });
    if (!this.isCurrentExternalScopeRequest(requestId)) {
      return;
    }
    this.cfLogsPanel.updateScope(
      buildScopeLabel(payload.regionCode, payload.orgName, payload.spaceName)
    );
    this.postMessage({
      type: MSG_RESTORE_CONFIRMED_SCOPE,
      scope: {
        regionId: payload.regionId,
        orgGuid: payload.orgGuid,
        orgName: payload.orgName,
        spaceName: payload.spaceName,
      },
    });
    await this.hydrateRestoredScope({
      ...payload,
      confirmedAt: new Date().toISOString(),
    });
  }

  private clearScopeBoundRuntimeStateForScopeChange(): void {
    this.bumpRegionSelectionRequestId();
    this.currentApps = [];
    this.currentLogSessionSeed = null;
    this.serviceFolderMappings = [];
    this.serviceFolderSelections.clear();
    this.exportInProgress = false;
    this.lastLoadedScope = null;
    this.cfLogsPanel.updateApps([], null);
    this.hanaSqlWorkbench.invalidateAllAppContexts();
    this.postMessage({ type: MSG_APPS_LOADED, apps: [], scopeKey: '' });
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
  }

  private async handleReloadAppList(): Promise<void> {
    const request = this.createAppListReloadRequest();
    if (request === null) {
      this.postAppsReloadError('No active region/org/space is loaded.');
      return;
    }

    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      this.postAppsReloadError('No credentials found. Please re-open SAP Tools and log in.');
      return;
    }

    const cfHomeDir = await ensureCfHomeDir(this.context);
    if (!this.isCurrentAppListReloadRequest(request)) {
      return;
    }

    const result = await refreshCfSyncSpace({
      apiEndpoint: getCfApiEndpoint(request.regionCode),
      orgName: request.scope.orgName,
      spaceName: request.scope.spaceName,
      email: credentials.email,
      password: credentials.password,
      log: (message) => {
        this.outputChannel.appendLine(message);
      },
    });
    if (!this.isCurrentAppListReloadRequest(request)) {
      return;
    }

    await this.applyReloadedAppListResult(request, result, credentials, cfHomeDir);
  }

  private createAppListReloadRequest(): AppListReloadRequest | null {
    const scope = this.currentConfirmedScope;
    const loadedScope = this.lastLoadedScope;
    if (scope === undefined) {
      return null;
    }
    if (loadedScope !== null && isLoadedScopeForConfirmedScope(loadedScope, scope)) {
      return {
        scope: { ...scope },
        loadedScope: { ...loadedScope },
        regionId: loadedScope.regionId,
        regionCode: loadedScope.regionCode,
        orgGuid: loadedScope.orgGuid,
        spaceSelectionRequestId: this.spaceSelectionRequestId,
      };
    }

    const selectedRegionMatches =
      areRegionCodesEquivalent(this.selectedRegionId, scope.regionCode) ||
      areRegionCodesEquivalent(this.selectedRegionCode, scope.regionCode);
    if (
      !selectedRegionMatches ||
      this.selectedRegionId.length === 0 ||
      this.selectedRegionCode.length === 0 ||
      this.selectedOrgGuid.length === 0
    ) {
      return null;
    }
    return {
      scope: { ...scope },
      loadedScope: null,
      regionId: this.selectedRegionId,
      regionCode: this.selectedRegionCode,
      orgGuid: this.selectedOrgGuid,
      spaceSelectionRequestId: this.spaceSelectionRequestId,
    };
  }

  private isCurrentAppListReloadRequest(request: AppListReloadRequest): boolean {
    const currentLoadedScope = this.lastLoadedScope;
    if (!areReloadScopesEqual(this.currentConfirmedScope, request.scope)) {
      return false;
    }

    if (request.loadedScope !== null) {
      return (
        currentLoadedScope !== null &&
        currentLoadedScope.regionId === request.loadedScope.regionId &&
        areRegionCodesEquivalent(
          currentLoadedScope.regionCode,
          request.loadedScope.regionCode
        ) &&
        currentLoadedScope.orgGuid === request.loadedScope.orgGuid &&
        currentLoadedScope.orgName === request.loadedScope.orgName &&
        currentLoadedScope.spaceName === request.loadedScope.spaceName
      );
    }

    return (
      this.spaceSelectionRequestId === request.spaceSelectionRequestId &&
      this.selectedRegionId === request.regionId &&
      areRegionCodesEquivalent(this.selectedRegionCode, request.regionCode) &&
      this.selectedOrgGuid === request.orgGuid
    );
  }

  private async applyReloadedAppListResult(
    request: AppListReloadRequest,
    result: Awaited<ReturnType<typeof refreshCfSyncSpace>>,
    credentials: { readonly email: string; readonly password: string },
    cfHomeDir: string
  ): Promise<void> {
    if (result.status !== 'refreshed') {
      this.postAppsReloadError(formatAppListReloadFailure(result));
      return;
    }
    const apps = result.apps.map((app) => ({
      id: app.id,
      name: app.name,
      runningInstances: app.runningInstances,
    }));
    this.outputChannel.appendLine(
      `[apps] Reloaded ${sanitizeForLog(request.scope.orgName)}/${sanitizeForLog(request.scope.spaceName)} via ${result.source} (${String(result.appCount)} apps)`
    );
    await this.postAppsLoaded(apps, {
      spaceName: request.scope.spaceName,
      orgGuid: request.orgGuid,
      orgName: request.scope.orgName,
    }, credentials, cfHomeDir, request.regionCode);
  }

  private async refreshTopologyForConfirmedScope(
    payload: ConfirmScopePayload
  ): Promise<void> {
    if (isTestMode()) {
      return;
    }
    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      return;
    }
    const apiEndpoint = getCfApiEndpoint(payload.regionCode);
    const result = await refreshCfSyncSpace({
      apiEndpoint,
      orgName: payload.orgName,
      spaceName: payload.spaceName,
      email: credentials.email,
      password: credentials.password,
      log: (message) => {
        this.outputChannel.appendLine(message);
      },
    });
    if (result.status === 'refreshed') {
      this.outputChannel.appendLine(
        `[topology] Refreshed ${result.regionKey}/${sanitizeForLog(payload.orgName)}/${sanitizeForLog(payload.spaceName)} via ${result.source} (${String(result.appCount)} apps)`
      );
      void this.pushCfTopology();
      const refreshedApps: SidebarAppEntry[] = result.apps.map((app) => ({
        id: app.id,
        name: app.name,
        runningInstances: app.runningInstances,
      }));
      await this.applyRefreshedAppsForConfirmedScope(payload, refreshedApps, credentials);
    } else if (result.status === 'failed') {
      const errorMessage =
        result.error instanceof Error ? result.error.message : String(result.error);
      this.outputChannel.appendLine(
        `[topology] Refresh failed for ${result.regionKey}/${sanitizeForLog(payload.orgName)}/${sanitizeForLog(payload.spaceName)}: ${sanitizeForLog(errorMessage)}`
      );
    } else {
      this.outputChannel.appendLine(
        `[topology] Refresh skipped (${result.reason}) for region=${sanitizeForLog(payload.regionCode)}`
      );
    }
  }

  /**
   * Surface the apps discovered by the confirmed-scope topology refresh.
   *
   * The shared cf-structure.json is a broad tree: it lists every region/org/space
   * but only carries the apps for spaces that have actually been app-synced.
   * Switching to a space that is in the tree yet was never app-synced makes
   * getAppsFromTopologySync return an empty list, so handleSpaceSelected renders
   * zero apps (and, since the list is empty rather than absent, never falls back to
   * a live refresh). refreshTopologyForConfirmedScope then syncs that space and
   * finds its real apps — re-post them so the dashboard reflects the freshly synced
   * list instead of the stale (empty) snapshot it first rendered. This mirrors the
   * sibling CDS Debug extension, which reloads and re-renders apps on scope change.
   *
   * Guarded against a refresh that resolves after the user has moved on: re-post
   * only while the just-refreshed scope is still the confirmed scope, and skip
   * entirely when the freshly synced list already matches what is shown (the common
   * case where the space was already populated, so no redundant re-render/remap).
   */
  private async applyRefreshedAppsForConfirmedScope(
    payload: ConfirmScopePayload,
    refreshedApps: readonly SidebarAppEntry[],
    credentials: { readonly email: string; readonly password: string }
  ): Promise<void> {
    const scope = buildSharedScopeFromConfirmPayload(payload);
    if (!areSharedScopesEqual(scope, this.currentConfirmedScope)) {
      return;
    }
    if (appListsEqual(refreshedApps, this.currentApps)) {
      return;
    }
    const cfHomeDir = await ensureCfHomeDir(this.context);
    // Resolving cfHomeDir awaits; a newer scope confirm may have landed meanwhile.
    // Re-check so we never stomp the app list of whatever scope is now active.
    if (!areSharedScopesEqual(scope, this.currentConfirmedScope)) {
      return;
    }
    this.outputChannel.appendLine(
      `[topology] Updated app list for ${sanitizeForLog(payload.orgName)}/${sanitizeForLog(payload.spaceName)} after refresh (${String(refreshedApps.length)} apps)`
    );
    await this.postAppsLoaded(
      [...refreshedApps],
      {
        spaceName: payload.spaceName,
        orgGuid: payload.orgGuid,
        orgName: payload.orgName,
      },
      credentials,
      cfHomeDir,
      payload.regionCode
    );
  }

  private async handleTopologyOrgSelected(
    payload: TopologyOrgSelectedPayload
  ): Promise<void> {
    const region = SAP_BTP_REGIONS.find((entry) => entry.id === payload.regionKey);
    if (region === undefined) {
      this.outputChannel.appendLine(
        `[topology] Quick org pick rejected: unknown region key=${sanitizeForLog(payload.regionKey)}`
      );
      this.postOrgsError(`Region "${payload.regionKey}" is not known to SAP Tools.`);
      return;
    }

    this.outputChannel.appendLine(
      `[topology] Quick org pick region=${region.id} org=${sanitizeForLog(payload.orgName)}`
    );

    const regionPayload: RegionSelectionPayload = {
      id: region.id,
      name: region.displayName,
      code: toHyphenatedRegionCode(region.id),
      area: region.area,
    };
    this.logRegionSelection(regionPayload);
    await this.handleRegionSelected(regionPayload);
    // Snapshot the region request id after handleRegionSelected resolves: any
    // subsequent manual region click bumps it, and we must not stomp on the
    // user's newer choice with our resolved scope.
    const regionRequestId = this.regionSelectionRequestId;
    if (this.selectedRegionId !== region.id) {
      return;
    }

    let orgGuid = '';
    if (isTestMode()) {
      const mockOrg = resolveMockOrgsForRegion(regionPayload.code).find(
        (entry) => entry.name === payload.orgName
      );
      orgGuid = mockOrg?.guid ?? '';
    } else {
      orgGuid = await this.resolveOrgGuidByName(region.id, payload.orgName);
    }

    if (!this.isCurrentRegionRequest(regionRequestId)) {
      return;
    }

    if (orgGuid.length === 0) {
      this.outputChannel.appendLine(
        `[topology] Quick org pick failed: org "${sanitizeForLog(payload.orgName)}" not found in region ${region.id}`
      );
      this.postSpacesError(
        `Org "${payload.orgName}" was not found in region ${region.id}.`
      );
      return;
    }

    this.postMessage({
      type: MSG_TOPOLOGY_SCOPE_RESOLVED,
      scope: {
        regionId: region.id,
        regionCode: regionPayload.code,
        regionName: region.displayName,
        regionArea: region.area,
        orgGuid,
        orgName: payload.orgName,
      },
    });

    await this.handleOrgSelected({ guid: orgGuid, name: payload.orgName });
  }

  private async handleQuickScopeConfirm(
    payload: QuickScopeConfirmPayload
  ): Promise<void> {
    const region = SAP_BTP_REGIONS.find((entry) => entry.id === payload.regionKey);
    if (region === undefined) {
      this.postSpacesError(`Region "${payload.regionKey}" is not known to SAP Tools.`);
      return;
    }

    let orgGuid = '';
    try {
      orgGuid = await this.resolveQuickScopeOrgGuid(region, payload.orgName);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Could not confirm scope.';
      this.outputChannel.appendLine(
        `[scope] Quick scope confirm failed: ${sanitizeForLog(errorMessage)}`
      );
      this.postSpacesError(
        'Could not confirm scope. Please try again or use Custom tab.'
      );
      return;
    }

    if (orgGuid.length === 0) {
      this.postSpacesError(
        `Org "${payload.orgName}" was not found in region ${region.id}. It may have been removed.`
      );
      return;
    }

    const confirmPayload: ConfirmScopePayload = {
      regionId: region.id,
      regionCode: toHyphenatedRegionCode(region.id),
      regionName: region.displayName,
      regionArea: region.area,
      orgGuid,
      orgName: payload.orgName,
      spaceName: payload.spaceName,
    };
    await this.handleConfirmScope(confirmPayload);
    await this.hydrateQuickConfirmedScope(confirmPayload);
  }

  private async resolveQuickScopeOrgGuid(
    region: (typeof SAP_BTP_REGIONS)[number],
    orgName: string
  ): Promise<string> {
    const cachedOrgs = await this.cacheSyncService.getCachedOrgs(region.id);
    const cachedMatch = cachedOrgs?.find((org) => org.name === orgName);
    if (cachedMatch !== undefined) {
      return cachedMatch.guid;
    }

    const regionCode = toHyphenatedRegionCode(region.id);
    if (isTestMode()) {
      const mockOrg = resolveMockOrgsForRegion(regionCode).find(
        (entry) => entry.name === orgName
      );
      return mockOrg?.guid ?? '';
    }

    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      throw new Error('No credentials found. Please re-open SAP Tools and log in.');
    }

    const session = await this.resolveQuickScopeSession(credentials, regionCode);
    const liveOrgs = await fetchOrgs(session);

    // Every fallible async step has now succeeded, so it is safe to commit the
    // shared scope/session state. Mutating earlier would corrupt provider state
    // (e.g. clearing a valid session, leaving selectedRegionCode pointing at a
    // region whose login then threw) on any failure.
    this.selectedRegionId = region.id;
    this.selectedRegionCode = regionCode;
    this.selectedOrgGuid = '';
    this.cfSession = session;
    this.cfSessionRegionCode = regionCode;

    const liveMatch = liveOrgs.find((org) => org.name === orgName);
    return liveMatch?.guid ?? '';
  }

  private async resolveQuickScopeSession(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string
  ): Promise<CfSession> {
    if (
      this.cfSession !== null &&
      this.cfSessionRegionCode === regionCode &&
      !isCfSessionExpired(this.cfSession)
    ) {
      return this.cfSession;
    }

    const apiEndpoint = getCfApiEndpoint(regionCode);
    const loginInfo = await fetchCfLoginInfo(apiEndpoint);
    const token = await cfLogin(
      loginInfo.authorizationEndpoint,
      credentials.email,
      credentials.password
    );
    return { token, apiEndpoint };
  }

  private async hydrateQuickConfirmedScope(
    payload: ConfirmScopePayload
  ): Promise<void> {
    this.bumpRegionSelectionRequestId();
    this.selectedRegionId = payload.regionId;
    this.selectedRegionCode = payload.regionCode;
    this.selectedOrgGuid = payload.orgGuid;
    this.cfLogsPanel.updateScope(
      buildScopeLabel(payload.regionCode, payload.orgName, payload.spaceName)
    );
    this.postMessage({
      type: MSG_RESTORE_CONFIRMED_SCOPE,
      scope: {
        regionId: payload.regionId,
        orgGuid: payload.orgGuid,
        orgName: payload.orgName,
        spaceName: payload.spaceName,
      },
    });
    await this.handleSpaceSelected({
      spaceName: payload.spaceName,
      orgGuid: payload.orgGuid,
      orgName: payload.orgName,
    });
  }

  private async resolveOrgGuidByName(
    regionId: string,
    orgName: string,
    isCurrentRequest: () => boolean = () => true
  ): Promise<string> {
    const region = SAP_BTP_REGIONS.find((entry) => entry.id === regionId);
    if (region === undefined) {
      return '';
    }

    const regionCode = toHyphenatedRegionCode(region.id);
    this.selectedRegionId = region.id;
    this.selectedRegionCode = regionCode;
    this.selectedOrgGuid = '';

    const cachedOrTestGuid = await this.resolveCachedOrTestOrgGuid(
      regionId,
      regionCode,
      orgName,
      isCurrentRequest
    );
    if (cachedOrTestGuid !== null) {
      return cachedOrTestGuid;
    }

    return this.resolveLiveOrgGuid(regionCode, orgName, isCurrentRequest);
  }

  private async resolveCachedOrTestOrgGuid(
    regionId: string,
    regionCode: string,
    orgName: string,
    isCurrentRequest: () => boolean
  ): Promise<string | null> {
    const cachedOrgs = await this.cacheSyncService.getCachedOrgs(regionId);
    if (!isCurrentRequest()) {
      return '';
    }
    const cachedMatch = cachedOrgs?.find((org) => org.name === orgName);
    if (cachedMatch !== undefined) {
      return cachedMatch.guid;
    }
    if (isTestMode()) {
      const mockOrg = resolveMockOrgsForRegion(regionCode).find(
        (entry) => entry.name === orgName
      );
      return mockOrg?.guid ?? '';
    }

    return null;
  }

  private async resolveLiveOrgGuid(
    regionCode: string,
    orgName: string,
    isCurrentRequest: () => boolean
  ): Promise<string> {
    if (
      this.cfSessionRegionCode !== regionCode ||
      (this.cfSession !== null && isCfSessionExpired(this.cfSession))
    ) {
      this.cfSession = null;
      this.cfSessionRegionCode = '';
    }
    if (this.cfSession === null) {
      const credentials = await getEffectiveCredentials(this.context);
      if (!isCurrentRequest()) {
        return '';
      }
      if (credentials === null) {
        return '';
      }
      const establishedSession = await this.establishCurrentScopeResolutionSession(
        credentials,
        regionCode,
        isCurrentRequest
      );
      if (establishedSession === null) {
        return '';
      }
    }
    const session = this.cfSession;
    if (session === null) {
      return '';
    }
    try {
      const liveOrgs = await fetchOrgs(session);
      if (!isCurrentRequest()) {
        return '';
      }
      const liveMatch = liveOrgs.find((org) => org.name === orgName);
      return liveMatch?.guid ?? '';
    } catch {
      return '';
    }
  }

  private async establishCurrentScopeResolutionSession(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string,
    isCurrentRequest: () => boolean
  ): Promise<CfSession | null> {
    if (
      this.cfSession !== null &&
      this.cfSessionRegionCode.length > 0 &&
      this.cfSessionRegionCode === regionCode &&
      !isCfSessionExpired(this.cfSession)
    ) {
      return this.cfSession;
    }

    const apiEndpoint = getCfApiEndpoint(regionCode);
    const loginInfo = await fetchCfLoginInfo(apiEndpoint);
    const token = await cfLogin(
      loginInfo.authorizationEndpoint,
      credentials.email,
      credentials.password
    );
    if (!isCurrentRequest() || this.selectedRegionCode !== regionCode) {
      return null;
    }
    this.cfSession = { token, apiEndpoint };
    this.cfSessionRegionCode = regionCode;
    return this.cfSession;
  }

  private async preloadRootFolderForPersistedScope(): Promise<void> {
    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      return;
    }

    const persistedScope = this.readPersistedConfirmedScopeForEmail(credentials.email);
    if (persistedScope === null) {
      return;
    }

    const cachedEntry = await this.cacheStore.getExportRootFolder(
      credentials.email,
      persistedScope.regionCode,
      persistedScope.orgGuid,
      persistedScope.spaceName
    );
    if (cachedEntry === null) {
      return;
    }

    const folderExists = await pathExists(cachedEntry.rootFolderPath);
    if (!folderExists) {
      await this.cacheStore.deleteExportRootFolder(
        credentials.email,
        persistedScope.regionCode,
        persistedScope.orgGuid,
        persistedScope.spaceName
      );
      return;
    }

    this.selectedLocalRootFolderPath = cachedEntry.rootFolderPath;
  }

  private async restoreConfirmedScopeForCurrentUser(): Promise<void> {
    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      return;
    }

    const persistedScope = this.readPersistedConfirmedScopeForEmail(credentials.email);
    if (persistedScope === null) {
      return;
    }

    const hasKnownRegion = SAP_BTP_REGIONS.some((region) => {
      return region.id === persistedScope.regionId;
    });
    if (!hasKnownRegion) {
      return;
    }

    this.currentConfirmedScope = {
      regionCode: persistedScope.regionId,
      orgName: persistedScope.orgName,
      spaceName: persistedScope.spaceName,
    };
    this.cfLogsPanel.updateScope(
      buildScopeLabel(
        persistedScope.regionCode,
        persistedScope.orgName,
        persistedScope.spaceName
      )
    );
    this.postMessage({
      type: MSG_RESTORE_CONFIRMED_SCOPE,
      scope: {
        regionId: persistedScope.regionId,
        orgGuid: persistedScope.orgGuid,
        orgName: persistedScope.orgName,
        spaceName: persistedScope.spaceName,
      },
    });

    try {
      void this.hydrateRestoredScope(persistedScope).catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to hydrate restored scope.';
        this.outputChannel.appendLine(
          `[scope] Restored scope hydration failed: ${sanitizeForLog(errorMessage)}`
        );
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to restore confirmed scope.';
      this.outputChannel.appendLine(
        `[scope] Restore confirmed scope failed: ${sanitizeForLog(errorMessage)}`
      );
    }
  }

  private async hydrateRestoredScope(
    persistedScope: PersistedConfirmedScopeEntry
  ): Promise<void> {
    await this.handleRegionSelected({
      id: persistedScope.regionId,
      name: persistedScope.regionName,
      code: persistedScope.regionCode,
      area: persistedScope.regionArea,
    });
    if (this.selectedRegionId !== persistedScope.regionId) {
      return;
    }

    await this.handleOrgSelected({
      guid: persistedScope.orgGuid,
      name: persistedScope.orgName,
    });
    if (this.selectedOrgGuid !== persistedScope.orgGuid) {
      return;
    }

    await this.handleSpaceSelected({
      spaceName: persistedScope.spaceName,
      orgGuid: persistedScope.orgGuid,
      orgName: persistedScope.orgName,
    });

    if (
      this.selectedRegionId === persistedScope.regionId &&
      this.selectedOrgGuid === persistedScope.orgGuid &&
      this.selectedLocalRootFolderPath.length > 0 &&
      this.currentApps.length > 0
    ) {
      await this.refreshServiceFolderMappings();
    }
  }

  private async persistConfirmedScopeForCurrentUser(
    payload: ConfirmScopePayload
  ): Promise<void> {
    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      return;
    }

    const emailKey = normalizeUserEmail(credentials.email);
    if (emailKey.length === 0) {
      return;
    }

    const normalizedScope: PersistedConfirmedScopeEntry = {
      regionId: payload.regionId.trim(),
      regionCode: payload.regionCode.trim().toLowerCase(),
      regionName: payload.regionName.trim(),
      regionArea: payload.regionArea.trim(),
      orgGuid: payload.orgGuid.trim(),
      orgName: payload.orgName.trim(),
      spaceName: payload.spaceName.trim(),
      confirmedAt: new Date().toISOString(),
    };

    if (
      normalizedScope.regionId.length === 0 ||
      normalizedScope.regionCode.length === 0 ||
      normalizedScope.regionName.length === 0 ||
      normalizedScope.regionArea.length === 0 ||
      normalizedScope.orgGuid.length === 0 ||
      normalizedScope.orgName.length === 0 ||
      normalizedScope.spaceName.length === 0
    ) {
      return;
    }

    const currentByEmail = this.readConfirmedScopeMap();
    currentByEmail[emailKey] = normalizedScope;
    await this.context.globalState.update(
      CONFIRMED_SCOPE_BY_EMAIL_GLOBAL_STATE_KEY,
      currentByEmail
    );
  }

  private readPersistedConfirmedScopeForEmail(email: string): PersistedConfirmedScopeEntry | null {
    const emailKey = normalizeUserEmail(email);
    if (emailKey.length === 0) {
      return null;
    }

    const confirmedScopeByEmail = this.readConfirmedScopeMap();
    const entry = confirmedScopeByEmail[emailKey];
    return entry ?? null;
  }

  private readConfirmedScopeMap(): Record<string, PersistedConfirmedScopeEntry> {
    const rawValue = this.context.globalState.get<unknown>(
      CONFIRMED_SCOPE_BY_EMAIL_GLOBAL_STATE_KEY
    );
    if (!isRecord(rawValue)) {
      return {};
    }

    const normalizedEntries: Record<string, PersistedConfirmedScopeEntry> = {};
    for (const [emailKeyRaw, scopeRaw] of Object.entries(rawValue)) {
      const normalizedEmailKey = normalizeUserEmail(emailKeyRaw);
      if (normalizedEmailKey.length === 0 || !isRecord(scopeRaw)) {
        continue;
      }

      const regionId = readOptionalString(scopeRaw['regionId'], 64);
      const regionCode = readOptionalString(scopeRaw['regionCode'], 32).toLowerCase();
      const regionName = readOptionalString(scopeRaw['regionName'], 96);
      const regionArea = readOptionalString(scopeRaw['regionArea'], 96);
      const orgGuid = readOptionalString(scopeRaw['orgGuid'], 128);
      const orgName = readOptionalString(scopeRaw['orgName'], 128);
      const spaceName = readOptionalString(scopeRaw['spaceName'], 128);
      const confirmedAt = readOptionalString(scopeRaw['confirmedAt'], 64);

      if (
        regionId.length === 0 ||
        regionCode.length === 0 ||
        regionName.length === 0 ||
        regionArea.length === 0 ||
        orgGuid.length === 0 ||
        orgName.length === 0 ||
        spaceName.length === 0 ||
        confirmedAt.length === 0
      ) {
        continue;
      }

      normalizedEntries[normalizedEmailKey] = {
        regionId,
        regionCode,
        regionName,
        regionArea,
        orgGuid,
        orgName,
        spaceName,
        confirmedAt,
      };
    }

    return normalizedEntries;
  }

  private async handleSelectLocalRootFolder(): Promise<void> {
    let selectedUri: vscode.Uri | undefined;
    const dialogOverride = this.resolveE2eRootDialogOverride();
    if (dialogOverride.handled) {
      selectedUri = dialogOverride.uri;
    } else {
      const selectedUris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Select local root folder for service mapping',
      });
      selectedUri = selectedUris?.[0];
    }

    if (selectedUri === undefined) {
      return;
    }

    const selectedPath = selectedUri.fsPath.trim();
    if (selectedPath.length === 0) {
      return;
    }

    this.selectedLocalRootFolderPath = selectedPath;
    this.serviceFolderSelections.clear();
    this.postMessage({
      type: MSG_LOCAL_ROOT_FOLDER_UPDATED,
      path: selectedPath,
    });
    await this.persistRootFolderForCurrentScope(selectedPath);
    await this.refreshServiceFolderMappings();
  }

  private resolveE2eRootDialogOverride(): {
    readonly handled: boolean;
    readonly uri: vscode.Uri | undefined;
  } {
    if (process.env['SAP_TOOLS_E2E'] !== '1') {
      return { handled: false, uri: undefined };
    }

    const rawSteps = process.env['SAP_TOOLS_E2E_ROOT_DIALOG_STEPS'] ?? '';
    const steps = rawSteps
      .split(',')
      .map((step) => step.trim().toLowerCase())
      .filter((step) => step.length > 0);
    const step = steps[this.e2eRootDialogStepIndex];
    if (step === undefined) {
      return { handled: false, uri: undefined };
    }

    this.e2eRootDialogStepIndex += 1;
    if (step === 'cancel') {
      return { handled: true, uri: undefined };
    }

    if (step === 'select') {
      const rawPathByStep = process.env['SAP_TOOLS_E2E_ROOT_FOLDER_PATHS'] ?? '';
      const pathByStep =
        rawPathByStep.trim().length === 0
          ? []
          : rawPathByStep.split('::').map((pathValue) => pathValue.trim());
      const indexedPath = pathByStep[this.e2eRootDialogStepIndex - 1] ?? '';
      const fallbackPath = process.env['SAP_TOOLS_E2E_ROOT_FOLDER_PATH']?.trim() ?? '';
      const rawPath = indexedPath.length > 0 ? indexedPath : fallbackPath;
      if (rawPath.length === 0) {
        return { handled: true, uri: undefined };
      }

      return { handled: true, uri: vscode.Uri.file(rawPath) };
    }

    return { handled: false, uri: undefined };
  }

  private async handleRefreshServiceFolderMappings(
    payload: RefreshServiceFolderMappingsPayload
  ): Promise<void> {
    const rootFolderPath = payload.rootFolderPath.trim();
    if (rootFolderPath.length > 0 && rootFolderPath !== this.selectedLocalRootFolderPath) {
      this.selectedLocalRootFolderPath = rootFolderPath;
      this.serviceFolderSelections.clear();
      this.postMessage({
        type: MSG_LOCAL_ROOT_FOLDER_UPDATED,
        path: this.selectedLocalRootFolderPath,
      });
      await this.persistRootFolderForCurrentScope(this.selectedLocalRootFolderPath);
    }

    await this.refreshServiceFolderMappings();
  }

  private handleSelectServiceFolderMapping(
    payload: SelectServiceFolderMappingPayload
  ): void {
    const mapping = this.serviceFolderMappings.find((entry) => {
      return entry.appId === payload.appId;
    });
    if (mapping?.hasConflict !== true) {
      return;
    }

    const normalizedFolderPath = payload.folderPath.trim();
    if (normalizedFolderPath.length === 0) {
      this.serviceFolderSelections.delete(payload.appId);
    } else {
      const allowedPaths = new Set(mapping.candidateFolderPaths);
      if (!allowedPaths.has(normalizedFolderPath)) {
        return;
      }
      this.serviceFolderSelections.set(payload.appId, normalizedFolderPath);
    }

    this.serviceFolderMappings = this.applyServiceFolderSelections(this.serviceFolderMappings);
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
    void this.persistServiceFolderMappingsForCurrentScope(this.serviceFolderMappings);
  }

  private async refreshServiceFolderMappings(): Promise<void> {
    // Scan for local npm packages independently of the CF-app service mapping below.
    void this.postDetectedLocalPackages();

    if (this.selectedLocalRootFolderPath.length === 0) {
      this.postMessage({
        type: MSG_SERVICE_FOLDER_MAPPINGS_ERROR,
        message: 'Select a local root folder before scanning service mappings.',
      });
      return;
    }

    if (this.currentApps.length === 0) {
      this.serviceFolderMappings = [];
      this.postMessage({
        type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
        mappings: this.serviceFolderMappings,
      });
      return;
    }

    try {
      const mappings = await buildServiceFolderMappings(
        this.selectedLocalRootFolderPath,
        this.currentApps.map((app) => app.name),
        readSharedAppFolderMappings()
      );
      this.serviceFolderMappings = this.applyServiceFolderSelections(mappings);
      await this.persistServiceFolderMappingsForCurrentScope(this.serviceFolderMappings);
      this.postMessage({
        type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
        mappings: this.serviceFolderMappings,
      });
    } catch (error) {
      this.serviceFolderMappings = [];
      this.serviceFolderSelections.clear();
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to scan local folders for service mapping.';
      this.postMessage({
        type: MSG_SERVICE_FOLDER_MAPPINGS_ERROR,
        message: errorMessage,
      });
    }
  }

  private async restoreRootFolderForLoadedSpace(
    payload: SpaceSelectionPayload
  ): Promise<void> {
    try {
      await this.restoreRootFolderForLoadedSpaceUnsafe(payload);
    } catch (error) {
      if (!this.isLoadedScope(payload.orgGuid, payload.spaceName)) {
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to restore root folder.';
      this.outputChannel.appendLine(
        `[cache] Failed to restore root folder for space ${sanitizeForLog(payload.spaceName)}: ${sanitizeErrorForLog(errorMessage)}`
      );
      this.clearRootFolderSelection();
    }
  }

  private async restoreRootFolderForLoadedSpaceUnsafe(
    payload: SpaceSelectionPayload
  ): Promise<void> {
    const cacheScope = await this.resolveRootFolderScopeForLoadedSpace(payload);
    if (!this.isLoadedScope(payload.orgGuid, payload.spaceName)) {
      return;
    }

    if (cacheScope === null) {
      this.clearRootFolderSelection();
      return;
    }

    const cachedEntry = await this.cacheStore.getExportRootFolder(
      cacheScope.email,
      cacheScope.regionCode,
      cacheScope.orgGuid,
      cacheScope.spaceName
    );
    if (!this.isLoadedScope(payload.orgGuid, payload.spaceName)) {
      return;
    }

    if (cachedEntry === null) {
      this.clearRootFolderSelection();
      return;
    }

    const folderExists = await pathExists(cachedEntry.rootFolderPath);
    if (!this.isLoadedScope(payload.orgGuid, payload.spaceName)) {
      return;
    }

    if (!folderExists) {
      await this.deleteMissingRootFolderCache(cacheScope);
      if (!this.isLoadedScope(payload.orgGuid, payload.spaceName)) {
        return;
      }

      this.clearRootFolderSelection();
      return;
    }

    this.selectedLocalRootFolderPath = cachedEntry.rootFolderPath;
    this.postMessage({
      type: MSG_LOCAL_ROOT_FOLDER_UPDATED,
      path: this.selectedLocalRootFolderPath,
    });
  }

  private async deleteMissingRootFolderCache(
    cacheScope: RootFolderCacheScope
  ): Promise<void> {
    await this.cacheStore.deleteExportRootFolder(
      cacheScope.email,
      cacheScope.regionCode,
      cacheScope.orgGuid,
      cacheScope.spaceName
    );
    this.outputChannel.appendLine(
      `[cache] Removed missing root folder cache for space ${sanitizeForLog(cacheScope.spaceName)}`
    );
  }

  private async persistRootFolderForCurrentScope(rootFolderPath: string): Promise<void> {
    const normalizedRootFolderPath = rootFolderPath.trim();
    if (normalizedRootFolderPath.length === 0) {
      return;
    }

    const cacheScope = await this.resolveCurrentRootFolderScope();
    if (cacheScope === null) {
      return;
    }

    try {
      await this.cacheStore.setExportRootFolder(
        cacheScope.email,
        cacheScope.regionCode,
        cacheScope.orgGuid,
        cacheScope.spaceName,
        normalizedRootFolderPath
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unable to persist root folder cache.';
      this.outputChannel.appendLine(
        `[cache] Failed to persist root folder cache: ${sanitizeForLog(errorMessage)}`
      );
    }
  }

  private async resolveCurrentRootFolderScope(): Promise<RootFolderCacheScope | null> {
    const loadedScope = this.lastLoadedScope;
    if (loadedScope === null) {
      return null;
    }

    return this.resolveRootFolderScopeForLoadedSpace({
      spaceName: loadedScope.spaceName,
      orgGuid: loadedScope.orgGuid,
      orgName: '',
    });
  }

  private async resolveRootFolderScopeForLoadedSpace(
    payload: SpaceSelectionPayload
  ): Promise<RootFolderCacheScope | null> {
    const regionCode = this.selectedRegionCode.trim();
    const orgGuid = payload.orgGuid.trim();
    const spaceName = payload.spaceName.trim();
    if (regionCode.length === 0 || orgGuid.length === 0 || spaceName.length === 0) {
      return null;
    }

    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      return null;
    }
    return {
      email: credentials.email,
      regionCode,
      orgGuid,
      spaceName,
    };
  }

  private isLoadedScope(orgGuid: string, spaceName: string): boolean {
    return (
      this.lastLoadedScope?.orgGuid === orgGuid &&
      this.lastLoadedScope.spaceName === spaceName
    );
  }

  private clearRootFolderSelection(): void {
    if (this.selectedLocalRootFolderPath.length === 0) {
      return;
    }

    this.selectedLocalRootFolderPath = '';
    this.serviceFolderSelections.clear();
    this.postMessage({
      type: MSG_LOCAL_ROOT_FOLDER_UPDATED,
      path: '',
    });
  }

  private applyServiceFolderSelections(
    baseMappings: readonly ServiceFolderMapping[]
  ): ServiceFolderMapping[] {
    return baseMappings.map((mapping) => {
      if (!mapping.hasConflict) {
        return { ...mapping };
      }

      const selectedFolderPath = this.serviceFolderSelections.get(mapping.appId) ?? '';
      const allowedPaths = new Set(mapping.candidateFolderPaths);
      if (selectedFolderPath.length === 0 || !allowedPaths.has(selectedFolderPath)) {
        this.serviceFolderSelections.delete(mapping.appId);
        return {
          ...mapping,
          folderPath: '',
        };
      }

      return {
        ...mapping,
        folderPath: selectedFolderPath,
      };
    });
  }

  private async restoreServiceFolderMappingsForCurrentScope(): Promise<boolean> {
    if (this.currentApps.length === 0) {
      return false;
    }

    const cacheScope = await this.resolveCurrentServiceMappingCacheScope();
    if (cacheScope === null) {
      return false;
    }

    const mappingCacheByScope = this.readServiceMappingCacheByScope();
    const cachedEntry = mappingCacheByScope[cacheScope.scopeKey];
    if (cachedEntry === undefined || cachedEntry.mappings.length === 0) {
      return false;
    }

    const cachedMappingById = new Map(
      cachedEntry.mappings.map((mapping) => [mapping.appId, mapping])
    );
    const cachedMappingByName = new Map(
      cachedEntry.mappings.map((mapping) => [mapping.appName, mapping])
    );

    const restoredMappings = this.currentApps.map((app) => {
      const cachedMapping = cachedMappingById.get(app.id) ?? cachedMappingByName.get(app.name);
      if (cachedMapping === undefined) {
        return {
          appId: app.id,
          appName: app.name,
          folderPath: '',
          matchType: 'none',
          candidateFolderPaths: [],
          hasConflict: false,
        } satisfies ServiceFolderMapping;
      }

      return {
        ...cachedMapping,
        appId: app.id,
        appName: app.name,
      } satisfies ServiceFolderMapping;
    });

    this.serviceFolderSelections.clear();
    for (const mapping of restoredMappings) {
      if (
        mapping.hasConflict &&
        mapping.folderPath.length > 0 &&
        mapping.candidateFolderPaths.includes(mapping.folderPath)
      ) {
        this.serviceFolderSelections.set(mapping.appId, mapping.folderPath);
      }
    }

    this.serviceFolderMappings = this.applyServiceFolderSelections(restoredMappings);
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
    return true;
  }

  private async persistServiceFolderMappingsForCurrentScope(
    mappings: readonly ServiceFolderMapping[]
  ): Promise<void> {
    if (mappings.length === 0) {
      return;
    }

    const cacheScope = await this.resolveCurrentServiceMappingCacheScope();
    if (cacheScope === null) {
      return;
    }

    const normalizedMappings = mappings
      .map((mapping) => normalizeServiceMappingForPersistence(mapping))
      .filter((mapping): mapping is ServiceFolderMapping => mapping !== null);
    if (normalizedMappings.length === 0) {
      return;
    }

    const mappingCacheByScope = this.readServiceMappingCacheByScope();
    mappingCacheByScope[cacheScope.scopeKey] = {
      rootFolderPath: cacheScope.rootFolderPath,
      mappings: normalizedMappings,
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.context.globalState.update(
        SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY,
        mappingCacheByScope
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unable to persist service mapping cache.';
      this.outputChannel.appendLine(
        `[cache] Failed to persist service mapping cache: ${sanitizeForLog(errorMessage)}`
      );
    }
  }

  private async resolveCurrentServiceMappingCacheScope(): Promise<{
    readonly scopeKey: string;
    readonly rootFolderPath: string;
  } | null> {
    const loadedScope = this.lastLoadedScope;
    const regionCode = this.selectedRegionCode.trim();
    const rootFolderPath = this.selectedLocalRootFolderPath.trim();
    if (
      loadedScope === null ||
      regionCode.length === 0 ||
      rootFolderPath.length === 0
    ) {
      return null;
    }

    const spaceName = loadedScope.spaceName.trim();
    const orgGuid = loadedScope.orgGuid.trim();
    if (spaceName.length === 0 || orgGuid.length === 0) {
      return null;
    }

    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      return null;
    }

    const scopeKey = buildServiceMappingsScopeKey(
      credentials.email,
      regionCode,
      orgGuid,
      spaceName,
      rootFolderPath
    );
    if (scopeKey.length === 0) {
      return null;
    }

    return {
      scopeKey,
      rootFolderPath,
    };
  }

  private readServiceMappingCacheByScope(): Record<string, PersistedServiceMappingScopeEntry> {
    const rawValue = this.context.globalState.get<unknown>(
      SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY
    );
    return normalizePersistedServiceMappingsByScope(rawValue);
  }

  private async handleExportServiceArtifacts(
    payload: ExportServiceArtifactsPayload,
    options: {
      readonly includeDefaultEnv: boolean;
      readonly includePnpmLock: boolean;
    }
  ): Promise<void> {
    if (this.exportInProgress) {
      this.postMessage({
        type: MSG_EXPORT_ARTIFACT_RESULT,
        success: false,
        message: 'Another export is already running. Please wait.',
      });
      return;
    }

    const mapping = this.resolveServiceFolderMapping(payload);
    if (mapping === null || mapping.folderPath.length === 0) {
      this.postMessage({
        type: MSG_EXPORT_ARTIFACT_RESULT,
        success: false,
        message: `No mapped local folder found for service "${payload.appName}".`,
      });
      return;
    }

    const session = this.currentLogSessionSeed;
    if (session === null) {
      this.postMessage({
        type: MSG_EXPORT_ARTIFACT_RESULT,
        success: false,
        message: 'No active CF scope session. Select region/org/space again.',
      });
      return;
    }

    const exportSession: ServiceExportSession = {
      apiEndpoint: session.apiEndpoint,
      email: session.email,
      password: session.password,
      orgName: session.orgName,
      spaceName: session.spaceName,
      cfHomeDir: session.cfHomeDir,
    };

    const confirmed = await this.confirmSensitiveExport({
      appName: payload.appName,
      exportType: 'artifacts',
    });
    if (!confirmed) {
      this.postMessage({
        type: MSG_EXPORT_ARTIFACT_RESULT,
        success: false,
        message: 'Export cancelled.',
      });
      return;
    }

    this.exportInProgress = true;
    this.postMessage({
      type: MSG_EXPORT_ARTIFACT_PROGRESS,
      inProgress: true,
      message: `Exporting artifacts for "${payload.appName}"...`,
    });

    try {
      const remoteRootSetting = readSharedRemoteRoot();
      const result = await exportServiceArtifacts({
        appName: payload.appName,
        targetFolderPath: mapping.folderPath,
        session: exportSession,
        includeDefaultEnv: options.includeDefaultEnv,
        includePnpmLock: options.includePnpmLock,
        ...(remoteRootSetting !== undefined ? { remoteRootSetting } : {}),
      });

      const filesLabel = result.writtenFiles
        .map((filePath) => `"${filePath}"`)
        .join(', ');
      this.outputChannel.appendLine(
        `[export] ${sanitizeForLog(payload.appName)} -> ${sanitizeForLog(filesLabel)}`
      );
      this.postMessage({
        type: MSG_EXPORT_ARTIFACT_RESULT,
        success: true,
        message: formatServiceArtifactExportCompletionMessage(
          payload.appName,
          result.writtenFiles
        ),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to export service artifacts.';
      this.postMessage({
        type: MSG_EXPORT_ARTIFACT_RESULT,
        success: false,
        message: errorMessage,
      });
    } finally {
      this.exportInProgress = false;
      this.postMessage({
        type: MSG_EXPORT_ARTIFACT_PROGRESS,
        inProgress: false,
      });
    }
  }

  // ── Local package build + publish (Verdaccio) ────────────────────────────

  private async handleBuildPublishAll(targetPackageName?: string): Promise<void> {
    if (this.buildPublishInProgress) {
      this.postBuildResult(false, 'A build & publish run is already in progress.');
      return;
    }

    const rootFolderPath = this.selectedLocalRootFolderPath.trim();
    if (rootFolderPath.length === 0) {
      this.postBuildResult(false, 'Select a local root folder before building packages.');
      return;
    }

    const config = readLocalPackagesConfig(this.currentConfirmedScope);
    if (config.namePatterns.trim().length === 0) {
      this.postBuildResult(
        false,
        'Configure "sapTools.localPackages.namePatterns" (e.g. "@example/") to detect your packages.'
      );
      return;
    }

    this.buildPublishInProgress = true;
    // Log to the output channel but do not steal focus by auto-opening it.
    // Users can open "SAP Tools: NPM Build" manually if they want to follow along.
    this.npmBuildChannel.appendLine(
      `\n=== Build & publish all local packages (${new Date().toISOString()}) ===`
    );

    try {
      await this.verdaccioManager.start({
        port: config.registry.port,
        scopes: config.registry.scopes,
      });
      await this.postRegistryState();

      const requestOpts: import('./localPackages/buildPublishOrchestrator').BuildPublishRequest = {
        rootFolderPath,
        config,
        registryUrl: this.verdaccioManager.getRegistryUrl(config.registry.port),
        authToken: this.verdaccioManager.getAuthToken(),
        onOrder: (order) => {
          this.postMessage({ type: MSG_BUILD_PUBLISH_PREVIEW, order: [...order] });
        },
        onProgress: (progress) => {
          this.postMessage({ type: MSG_BUILD_PUBLISH_PROGRESS, ...progress });
        },
        onOutput: (chunk) => {
          this.npmBuildChannel.append(chunk);
        },
      };

      if (targetPackageName !== undefined) {
        Object.assign(requestOpts, { targetPackageName });
      }

      const outcome = await runBuildPublishAll(requestOpts);

      const summary =
        `Published ${String(outcome.order.length)} package(s) ` +
        `(${String(outcome.builtCount)} built, ${String(outcome.skippedCount)} skipped) ` +
        'to the local registry.';
      this.npmBuildChannel.appendLine(summary);
      this.postBuildResult(true, targetPackageName === undefined ? '' : summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Build & publish failed.';
      this.npmBuildChannel.appendLine(`ERROR: ${message}`);
      this.postBuildResult(false, message);
    } finally {
      this.buildPublishInProgress = false;
      await this.postRegistryState();
    }
  }

  private async handleReplaceServicePackagePlaceholder(appId: string): Promise<void> {
    const mapping = this.serviceFolderMappings.find(
      (m) => m.appId === appId && m.folderPath.length > 0
    );
    if (mapping === undefined) {
      void vscode.window.showErrorMessage(
        `SAP Tools: No mapped folder found for service "${appId}".`
      );
      return;
    }

    const config = readLocalPackagesConfig(this.currentConfirmedScope);
    const placeholders = config.packageJsonTagPlaceholder
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const tag = config.registry.defaultTag;
    const packageJsonPath = join(mapping.folderPath, 'package.json');

    try {
      const localPackageNames = await this.resolveLocalPackageNamesForReplacement(config);
      if (placeholders.length === 0 && localPackageNames.length === 0) {
        void vscode.window.showWarningMessage(
          'SAP Tools: No placeholder configured. Set "sapTools.localPackages.packageJsonTagPlaceholder" first.'
        );
        return;
      }

      const content = await readFile(packageJsonPath, 'utf8');
      const result = replaceServicePackageDependencyTags(content, {
        placeholders,
        localPackageNames,
        tag,
      });
      if (!result.changed) {
        void vscode.window.showInformationMessage(
          `SAP Tools: No package.json update needed for "${mapping.appName}".`
        );
        return;
      }
      await writeFile(packageJsonPath, result.content, 'utf8');
      void vscode.window.showInformationMessage(
        formatServicePackageReplaceMessage(mapping.appName, tag, result)
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`SAP Tools: Failed to update package.json: ${msg}`);
    }
  }

  private async resolveLocalPackageNamesForReplacement(
    config: LocalPackagesConfig
  ): Promise<string[]> {
    const rootFolderPath = this.selectedLocalRootFolderPath.trim();
    const patterns = config.namePatterns.trim();
    if (rootFolderPath.length === 0 || patterns.length === 0) {
      return [];
    }

    const packages = await scanLocalPackages(rootFolderPath, patterns);
    return packages.map((pkg) => pkg.name);
  }

  async startLocalRegistry(): Promise<void> {
    const config = readLocalPackagesConfig(this.currentConfirmedScope);
    this.npmBuildChannel.show(true);
    try {
      await this.verdaccioManager.start({
        port: config.registry.port,
        scopes: config.registry.scopes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start local registry.';
      this.npmBuildChannel.appendLine(`ERROR: ${message}`);
      void vscode.window.showErrorMessage(`SAP Tools: ${message}`);
    } finally {
      await this.postRegistryState();
    }
  }

  stopLocalRegistry(): void {
    this.verdaccioManager.stop();
    void this.postRegistryState();
  }

  private async postRegistryState(): Promise<void> {
    const status = await this.verdaccioManager.status();
    this.postMessage({ type: MSG_LOCAL_REGISTRY_STATE, ...status });
  }

  /**
   * Scans the selected root folder for locally-developed npm packages (by the
   * configured name regex), computes their build order, and pushes the list to the
   * webview as a separate "Detected packages" list, independent of the CF-app service
   * mapping list.
   */
  private async postDetectedLocalPackages(): Promise<void> {
    const rootFolderPath = this.selectedLocalRootFolderPath.trim();
    const patterns = readLocalPackagesConfig(this.currentConfirmedScope).namePatterns.trim();

    if (rootFolderPath.length === 0 || patterns.length === 0) {
      this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
      this.postMessage({
        type: MSG_LOCAL_PACKAGES_LOADED,
        configured: patterns.length > 0,
        patterns,
        packages: [],
      });
      return;
    }

    this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: true });

    const cacheKey = buildLocalPackagesCacheKey(rootFolderPath, patterns);
    const cached = await this.cacheStore.getLocalPackages(cacheKey);
    if (cached !== null) {
      // Serve stale-while-revalidate: show cached data instantly, then rescan.
      this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
      this.postMessage({
        type: MSG_LOCAL_PACKAGES_LOADED,
        configured: true,
        patterns,
        packages: cached.packages,
      });
    }

    try {
      const scanned = await this.scanAndOrderLocalPackages(rootFolderPath, patterns);
      const isSameAsCached = cached !== null && areLocalPackageListsEqual(scanned, cached.packages);
      if (!isSameAsCached) {
        this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
        this.postMessage({
          type: MSG_LOCAL_PACKAGES_LOADED,
          configured: true,
          patterns,
          packages: scanned,
        });
      }
      await this.cacheStore.setLocalPackages(cacheKey, scanned);
    } catch (error) {
      this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
      this.postMessage({
        type: MSG_LOCAL_PACKAGES_LOADED,
        configured: true,
        patterns,
        packages: [],
        error: error instanceof Error ? error.message : 'Failed to scan local packages.',
      });
    }
  }

  private async scanAndOrderLocalPackages(
    rootFolderPath: string,
    patterns: string
  ): Promise<{ name: string; version: string; hasBuildScript: boolean; round: number | null }[]> {
    const packages = await scanLocalPackages(rootFolderPath, patterns);
    const roundByName = new Map<string, number>();
    try {
      const order = buildDependencyOrder(
        packages.map((pkg) => ({ name: pkg.name, deps: pkg.dependencyNames }))
      );
      order.rounds.forEach((round, index) => {
        for (const name of round) {
          roundByName.set(name, index);
        }
      });
    } catch {
      // Dependency cycle — leave rounds unset; the list still shows the packages.
    }
    return packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      hasBuildScript: pkg.buildScript !== undefined,
      round: roundByName.get(pkg.name) ?? null,
    }));
  }

  private postBuildResult(success: boolean, message: string): void {
    this.postMessage({ type: MSG_BUILD_PUBLISH_RESULT, success, message });
  }

  private async handleMicrosoftGraphToolRun(
    request: MicrosoftGraphToolRunRequest
  ): Promise<void> {
    this.microsoftGraphChannel.show(true);
    this.appendMicrosoftGraphToolLog(request.toolId, 'run', 'started', 'Run started.');
    const result = await runMicrosoftGraphTool(request, {
      onProgress: (progress) => {
        this.appendMicrosoftGraphToolProgress(progress);
        this.postMessage({ type: MSG_MICROSOFT_GRAPH_TOOL_PROGRESS, ...progress });
      },
    });
    this.appendMicrosoftGraphToolLog(
      result.toolId,
      'result',
      result.success ? 'done' : 'failed',
      result.message
    );
    this.postMessage({ type: MSG_MICROSOFT_GRAPH_TOOL_RESULT, ...result });
  }

  private appendMicrosoftGraphToolProgress(
    progress: MicrosoftGraphToolStepProgress
  ): void {
    this.appendMicrosoftGraphToolLog(
      progress.toolId,
      progress.stepId,
      progress.status,
      progress.message
    );
  }

  private appendMicrosoftGraphToolLog(
    toolId: string,
    stepId: string,
    status: string,
    message: string
  ): void {
    this.microsoftGraphChannel.appendLine(
      `[${new Date().toISOString()}] ${toolId} ${stepId} ${status}: ` +
        sanitizeGraphMessage(message)
    );
  }

  private async handleExportSqlToolsConfig(
    payload: ExportSqlToolsConfigPayload
  ): Promise<void> {
    if (this.exportInProgress) {
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_RESULT,
        success: false,
        message: 'Another export is already running. Please wait.',
      });
      return;
    }

    const mapping = this.resolveServiceFolderMapping(payload);
    if (mapping === null || mapping.folderPath.length === 0) {
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_RESULT,
        success: false,
        message: `No mapped local folder found for service "${payload.appName}".`,
      });
      return;
    }

    const rootFolderPath = this.selectedLocalRootFolderPath.trim();
    if (rootFolderPath.length === 0) {
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_RESULT,
        success: false,
        message: 'No root folder selected. Select a root folder first.',
      });
      return;
    }

    const session = this.currentLogSessionSeed;
    if (session === null) {
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_RESULT,
        success: false,
        message: 'No active CF scope session. Select region/org/space again.',
      });
      return;
    }

    const exportSession = {
      apiEndpoint: session.apiEndpoint,
      email: session.email,
      password: session.password,
      orgName: session.orgName,
      spaceName: session.spaceName,
      cfHomeDir: session.cfHomeDir,
    };

    const confirmed = await this.confirmSensitiveExport({
      appName: payload.appName,
      exportType: 'sqltools',
    });
    if (!confirmed) {
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_RESULT,
        success: false,
        message: 'Export cancelled.',
      });
      return;
    }

    this.exportInProgress = true;
    this.postMessage({
      type: MSG_EXPORT_SQLTOOLS_PROGRESS,
      inProgress: true,
      message: `Exporting SQLTools config for "${payload.appName}"...`,
    });

    try {
      const result = await exportSqlToolsConfig({
        appName: payload.appName,
        regionCode: this.selectedRegionCode,
        rootFolderPath,
        session: exportSession,
      });

      this.outputChannel.appendLine(
        `[export] SQLTools ${sanitizeForLog(payload.appName)} -> ${sanitizeForLog(result.settingsPath)}`
      );
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_RESULT,
        success: true,
        message: `SQLTools connection "${result.connection.name}" exported to "${result.settingsPath}".`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to export SQLTools config.';
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_RESULT,
        success: false,
        message: errorMessage,
      });
    } finally {
      this.exportInProgress = false;
      this.postMessage({
        type: MSG_EXPORT_SQLTOOLS_PROGRESS,
        inProgress: false,
      });
    }
  }

  private resolveServiceFolderMapping(
    payload: {
      readonly appId: string;
      readonly appName: string;
    }
  ): ServiceFolderMapping | null {
    const mappingById = this.serviceFolderMappings.find((mapping) => {
      return mapping.appId === payload.appId;
    });
    if (mappingById !== undefined) {
      return mappingById;
    }

    const mappingByName = this.serviceFolderMappings.find((mapping) => {
      return mapping.appName === payload.appName;
    });
    return mappingByName ?? null;
  }

  private async confirmSensitiveExport(options: {
    readonly appName: string;
    readonly exportType: 'artifacts' | 'sqltools';
  }): Promise<boolean> {
    if (shouldSkipSensitiveExportConfirmation()) {
      return true;
    }

    const message =
      options.exportType === 'sqltools'
        ? `Export SQLTools config for "${options.appName}"? This can write database credentials to .vscode/settings.json.`
        : `Export artifacts for "${options.appName}"? default-env.json may contain secrets.`;

    const detail =
      options.exportType === 'sqltools'
        ? 'Do not commit generated credentials to source control.'
        : 'Do not commit generated artifact files to source control.';

    const selectedAction = await vscode.window.showWarningMessage(
      message,
      {
        modal: true,
        detail,
      },
      'Export'
    );
    return selectedAction === 'Export';
  }

  // ── SQLTools integration ─────────────────────────────────────────────────

  private async handleOpenHanaSqlFile(payload: OpenHanaSqlFilePayload): Promise<void> {
    const targetApp =
      this.currentApps.find((app) => app.id === payload.serviceId) ??
      this.currentApps.find((app) => app.name === payload.serviceName);
    if (targetApp === undefined) {
      this.outputChannel.appendLine(
        `[sql-ui] open sql file rejected: app not found serviceId=${sanitizeSqlUiLogValue(payload.serviceId)} serviceName=${sanitizeSqlUiLogValue(payload.serviceName)}`
      );
      this.postHanaSqlFileOpenResult(
        payload.requestId, payload.serviceId, false, 'Selected app was not found.'
      );
      return;
    }

    const sessionSeed = this.currentLogSessionSeed;
    if (sessionSeed === null && !isTestMode()) {
      this.outputChannel.appendLine(
        `[sql-ui] open sql file rejected: no active session app=${sanitizeSqlUiLogValue(targetApp.name)}`
      );
      this.postHanaSqlFileOpenResult(
        payload.requestId, payload.serviceId, false,
        'No active CF scope session. Confirm scope and choose app again.'
      );
      return;
    }

    this.outputChannel.appendLine(
      `[sql-ui] open sql file requested app=${sanitizeSqlUiLogValue(targetApp.name)}`
    );
    try {
      await this.hanaSqlWorkbench.openSqlDocumentForApp({
        appId: targetApp.id,
        appName: targetApp.name,
        session: sessionSeed,
      });
      this.outputChannel.appendLine(
        `[sql-ui] open sql file succeeded app=${sanitizeSqlUiLogValue(targetApp.name)}`
      );
      this.postHanaSqlFileOpenResult(payload.requestId, targetApp.id, true, '');
      void this.publishHanaTablesForApp(targetApp.id, targetApp.name, sessionSeed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to open SQL file.';
      this.outputChannel.appendLine(
        `[sql-ui] open sql file failed app=${sanitizeSqlUiLogValue(targetApp.name)} message=${sanitizeSqlUiLogValue(errorMessage)}`
      );
      this.postHanaSqlFileOpenResult(payload.requestId, targetApp.id, false, errorMessage);
    }
  }

  private async publishHanaTablesForApp(
    appId: string,
    appName: string,
    session: CfLogSessionSeed | null,
    forceRefresh = false
  ): Promise<void> {
    this.outputChannel.appendLine(
      `[sql-ui] ${forceRefresh ? 'refresh' : 'load'} tables requested app=${sanitizeSqlUiLogValue(appName)}`
    );
    try {
      const tables = forceRefresh
        ? await this.hanaSqlWorkbench.refreshTableEntriesForApp({
            appId,
            appName,
            session,
          })
        : await this.hanaSqlWorkbench.loadTableEntriesForApp({
            appId,
            appName,
            session,
          });
      this.outputChannel.appendLine(
        `[sql-ui] ${forceRefresh ? 'refresh' : 'load'} tables succeeded app=${sanitizeSqlUiLogValue(appName)} count=${String(tables.length)}`
      );
      this.postMessage({
        type: MSG_HANA_TABLES_LOADED,
        serviceId: appId,
        success: true,
        tunnelActive: this.hanaSqlWorkbench.isAppTunneled(appId),
        tables: tables.map((table) => ({
          displayName: table.displayName,
          name: table.name,
        })),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load tables for app.';
      this.outputChannel.appendLine(
        `[sql-ui] ${forceRefresh ? 'refresh' : 'load'} tables failed app=${sanitizeSqlUiLogValue(appName)} message=${sanitizeSqlUiLogValue(message)}`
      );
      this.postMessage({
        type: MSG_HANA_TABLES_LOADED,
        serviceId: appId,
        success: false,
        tables: [],
        message,
      });
    }
  }

  private async handleRefreshHanaTables(
    payload: RefreshHanaTablesPayload
  ): Promise<void> {
    const targetApp =
      this.currentApps.find((app) => app.id === payload.serviceId) ??
      this.currentApps.find((app) => app.name === payload.serviceName);
    if (targetApp === undefined) {
      this.outputChannel.appendLine(
        `[sql-ui] refresh tables rejected: app not found serviceId=${sanitizeSqlUiLogValue(payload.serviceId)} serviceName=${sanitizeSqlUiLogValue(payload.serviceName)}`
      );
      this.postMessage({
        type: MSG_HANA_TABLES_LOADED,
        serviceId: payload.serviceId,
        success: false,
        tables: [],
        message: 'Selected app was not found.',
      });
      return;
    }
    const sessionSeed = this.currentLogSessionSeed;
    await this.publishHanaTablesForApp(targetApp.id, targetApp.name, sessionSeed, true);
  }

  private async handleRunHanaTableSelect(payload: RunHanaTableSelectPayload): Promise<void> {
    const targetApp =
      this.currentApps.find((app) => app.id === payload.serviceId) ??
      this.currentApps.find((app) => app.name === payload.serviceName);
    if (targetApp === undefined) {
      this.outputChannel.appendLine(
        `[sql-ui] quick select rejected: app not found serviceId=${sanitizeSqlUiLogValue(payload.serviceId)} serviceName=${sanitizeSqlUiLogValue(payload.serviceName)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
      );
      this.postHanaTableSelectResult(
        payload.serviceId,
        payload.tableName,
        false,
        'Selected app was not found.'
      );
      return;
    }

    const sessionSeed = this.currentLogSessionSeed;
    if (sessionSeed === null && !isTestMode()) {
      this.outputChannel.appendLine(
        `[sql-ui] quick select rejected: no active session app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
      );
      this.postHanaTableSelectResult(
        payload.serviceId,
        payload.tableName,
        false,
        'No active CF scope session. Confirm scope and choose app again.'
      );
      return;
    }

    this.outputChannel.appendLine(
      `[sql-ui] quick select requested app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
    );
    try {
      await this.hanaSqlWorkbench.runQuickTableSelectForApp({
        appId: targetApp.id,
        appName: targetApp.name,
        session: sessionSeed,
        tableName: payload.tableName,
      });
      this.outputChannel.appendLine(
        `[sql-ui] quick select succeeded app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
      );
      this.postHanaTableSelectResult(
        targetApp.id,
        payload.tableName,
        true,
        ''
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to run quick SELECT.';
      this.outputChannel.appendLine(
        `[sql-ui] quick select failed app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)} message=${sanitizeSqlUiLogValue(errorMessage)}`
      );
      this.postHanaTableSelectResult(
        targetApp.id,
        payload.tableName,
        false,
        errorMessage
      );
    }
  }

  private postHanaSqlFileOpenResult(
    requestId: number,
    serviceId: string,
    success: boolean,
    message: string
  ): void {
    this.postMessage({
      type: MSG_HANA_SQL_FILE_OPEN_RESULT,
      requestId,
      serviceId,
      success,
      message,
    });
  }

  private postHanaTableSelectResult(
    serviceId: string,
    tableName: string,
    success: boolean,
    message: string
  ): void {
    this.postMessage({
      type: MSG_HANA_TABLE_SELECT_RESULT,
      serviceId,
      tableName,
      success,
      message,
    });
  }

  private async handleOpenSqlToolsExtension(): Promise<void> {
    const sqlToolsExtension = vscode.extensions.getExtension(SQLTOOLS_EXTENSION_ID);

    if (sqlToolsExtension !== undefined) {
      try {
        if (!sqlToolsExtension.isActive) {
          await sqlToolsExtension.activate();
        }
        await vscode.commands.executeCommand(SQLTOOLS_ACTIVITY_BAR_COMMAND);
        return;
      } catch {
        // Fall through to the marketplace-open fallback if the activity bar
        // command is not registered for the installed SQLTools version.
      }
    }

    await vscode.commands.executeCommand(
      BUILTIN_EXTENSION_OPEN_COMMAND,
      SQLTOOLS_EXTENSION_ID
    );
  }

  // ── Login / logout ───────────────────────────────────────────────────────

  private async handleLoginSubmit(email: string, password: string): Promise<void> {
    try {
      await storeCredentials(this.context, { email, password });
      await this.cacheSyncService.setCredentials({ email, password });
      this.hasAttemptedConfirmedScopeRestore = false;
      this.reloadToMainView();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save credentials.';
      this.postMessage({ type: MSG_LOGIN_RESULT, success: false, error: errorMessage });
    }
  }

  private async handleLogout(): Promise<void> {
    try {
      const previousCredentials = await getEffectiveCredentials(this.context).catch(() => null);
      const previousEmail = previousCredentials?.email ?? '';
      await clearCredentials(this.context);
      await this.cacheSyncService.setCredentials(null);
      if (previousEmail.length > 0) {
        try {
          const removed = await this.cacheStore.clearHanaTableListsForUser(previousEmail);
          if (removed > 0) {
            this.outputChannel.appendLine(
              `[sql-ui] cleared ${String(removed)} cached HANA table list(s) for ${sanitizeSqlUiLogValue(previousEmail)}`
            );
          }
          // Drop remembered HANA tunnel jump-hosts too (HANA hostnames + app
          // names) so a logged-out account leaves no residual SQL state.
          await this.cacheStore.clearHanaTunnelJumpApps();
        } catch {
          /* best effort cleanup, ignore failures */
        }
      }
      this.cfSession = null;
      this.cfSessionRegionCode = '';
      this.selectedRegionCode = '';
      this.selectedRegionId = '';
      this.selectedOrgGuid = '';
      this.bumpRegionSelectionRequestId();
      this.currentApps = [];
      this.currentLogSessionSeed = null;
      this.serviceFolderMappings = [];
      this.serviceFolderSelections.clear();
      this.exportInProgress = false;
      this.hasAttemptedConfirmedScopeRestore = false;
      this.lastLoadedScope = null;
      this.lastWrittenScope = undefined;
      this.currentConfirmedScope = undefined;
      this.hanaSqlWorkbench.invalidateAllAppContexts();
      this.cfLogsPanel.updateApps([], null);
      this.cfLogsPanel.updateScope('No scope selected');
      this.reloadToLoginView();
      this.postMessage({
        type: MSG_LOGOUT_RESULT,
        success: true,
      } satisfies LogoutResultPayload);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to clear credentials.';
      this.postMessage({
        type: MSG_LOGOUT_RESULT,
        success: false,
        error: errorMessage,
      } satisfies LogoutResultPayload);
    }
  }

  private reloadToMainView(): void {
    if (this.webviewView === undefined) {
      return;
    }

    const assetsRoot = vscode.Uri.joinPath(
      this.extensionUri,
      'docs',
      'designs',
      'prototypes',
      'assets'
    );
    const nonce = createNonce();
    this.webviewView.webview.html = this.buildMainHtml(
      this.webviewView.webview,
      nonce,
      assetsRoot
    );
  }

  private reloadToLoginView(): void {
    if (this.webviewView === undefined) {
      return;
    }

    const assetsRoot = vscode.Uri.joinPath(
      this.extensionUri,
      'docs',
      'designs',
      'prototypes',
      'assets'
    );
    const nonce = createNonce();
    this.webviewView.webview.html = this.buildLoginGateHtml(
      this.webviewView.webview,
      nonce,
      assetsRoot
    );
  }

  // ── Region selected → fetch orgs ─────────────────────────────────────────

  private async handleRegionSelected(region: RegionSelectionPayload): Promise<void> {
    const requestId = this.bumpRegionSelectionRequestId();
    this.selectedRegionId = region.id;
    this.selectedRegionCode = region.code;
    this.selectedOrgGuid = '';
    this.cfSession = null;
    this.cfSessionRegionCode = '';
    this.currentApps = [];
    this.currentLogSessionSeed = null;
    this.serviceFolderMappings = [];
    this.serviceFolderSelections.clear();
    this.exportInProgress = false;
    this.lastLoadedScope = null;
    this.hanaSqlWorkbench.invalidateAllAppContexts();
    this.cfLogsPanel.updateApps([], null);
    this.cfLogsPanel.updateScope(buildScopeLabel(region.code, 'select-org', 'select-space'));
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });

    if (isTestMode()) {
      this.cfSession = {
        apiEndpoint: getCfApiEndpoint(region.code),
        token: {
          accessToken: 'sap-tools-test-token',
          expiresAt: Number.MAX_SAFE_INTEGER,
          refreshToken: '',
        },
      };
      this.cfSessionRegionCode = region.code;
      this.postMessage({
        type: MSG_ORGS_LOADED,
        orgs: resolveMockOrgsForRegion(region.code),
      });
      return;
    }

    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      this.postOrgsError('No credentials found. Please re-open SAP Tools and log in.');
      return;
    }

    const cachedOrgs = await this.cacheSyncService.getCachedOrgs(region.id);
    if (!this.isCurrentRegionRequest(requestId)) {
      return;
    }

    if (cachedOrgs !== null && cachedOrgs.length > 0) {
      this.postMessage({
        type: MSG_ORGS_LOADED,
        orgs: cachedOrgs,
      });
      const warmupRequestId = requestId;
      void this.refreshOrgsFromLiveAfterCachedRender(
        credentials,
        region.code,
        warmupRequestId,
        cachedOrgs
      ).catch((error: unknown) => {
        if (!this.isCurrentRegionRequest(warmupRequestId)) {
          return;
        }
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown warm-up error while preparing CF session.';
        this.outputChannel.appendLine(
          `[session] Warm-up failed for ${region.code}: ${errorMessage}`
        );
      });
      return;
    }

    try {
      const session = await this.ensureRegionSession(credentials);
      if (!this.isCurrentRegionRequest(requestId)) {
        return;
      }
      const orgs = await fetchOrgs(session);
      if (!this.isCurrentRegionRequest(requestId)) {
        return;
      }
      this.postMessage({ type: MSG_ORGS_LOADED, orgs });
    } catch (error) {
      if (!this.isCurrentRegionRequest(requestId)) {
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to connect to Cloud Foundry.';
      this.postOrgsError(errorMessage);
    }
  }

  // ── Org selected → fetch spaces ──────────────────────────────────────────

  private async handleOrgSelected(org: OrgSelectionPayload): Promise<void> {
    const requestId = this.bumpOrgSelectionRequestId();
    this.selectedOrgGuid = org.guid;
    const scopeLabel = buildScopeLabel(this.selectedRegionCode, org.name, 'select-space');
    this.cfLogsPanel.updateScope(scopeLabel);
    this.cfLogsPanel.updateApps([], null);
    this.currentApps = [];
    this.currentLogSessionSeed = null;
    this.serviceFolderMappings = [];
    this.serviceFolderSelections.clear();
    this.exportInProgress = false;
    this.lastLoadedScope = null;
    this.hanaSqlWorkbench.invalidateAllAppContexts();
    this.clearRootFolderSelection();
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
    if (!this.isCurrentOrgRequest(requestId)) {
      return;
    }

    if (isTestMode()) {
      this.postMessage({ type: MSG_SPACES_LOADED, spaces: resolveMockSpacesForOrg(org) });
      return;
    }

    try {
      const cachedSpaces = await this.cacheSyncService.getCachedSpaces(
        this.selectedRegionId,
        org.guid
      );
      if (!this.isCurrentOrgRequest(requestId)) {
        return;
      }

      if (cachedSpaces !== null) {
        this.postMessage({ type: MSG_SPACES_LOADED, spaces: cachedSpaces });
        return;
      }

      const credentials = await getEffectiveCredentials(this.context);
      if (credentials === null) {
        this.postSpacesError('No credentials found. Please re-open SAP Tools and log in.');
        return;
      }

      const session = await this.ensureRegionSession(credentials);
      if (!this.isCurrentOrgRequest(requestId)) {
        return;
      }
      const spaces = await fetchSpaces(session, org.guid);
      if (!this.isCurrentOrgRequest(requestId)) {
        return;
      }
      this.postMessage({ type: MSG_SPACES_LOADED, spaces });
    } catch (error) {
      if (!this.isCurrentOrgRequest(requestId)) {
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch spaces.';
      this.outputChannel.appendLine(
        `[spaces] Failed to load spaces for org ${sanitizeForLog(org.guid)}: ${sanitizeErrorForLog(errorMessage)}`
      );
      this.postSpacesError(errorMessage);
    }
  }

  // ── Space selected → fetch apps ───────────────────────────────────────────

  private async handleSpaceSelected(payload: SpaceSelectionPayload): Promise<void> {
    const requestId = this.bumpSpaceSelectionRequestId();
    const regionCode = this.selectedRegionCode;
    this.lastLoadedScope = null;

    if (isTestMode()) {
      await this.handleTestModeSpaceSelection(payload);
      return;
    }

    const credentials = await getEffectiveCredentials(this.context);
    if (credentials === null) {
      this.postAppsError('No credentials found. Please re-open SAP Tools and log in.');
      return;
    }

    const apiEndpoint = getCfApiEndpoint(regionCode);

    // Switching to a different space must close any HANA tunnels opened for the
    // previous scope — they belong to the old space's apps. Skip when re-selecting
    // the same space so an in-use tunnel is not needlessly torn down and rebuilt.
    const previousSeed = this.currentLogSessionSeed;
    const spaceChanged =
      previousSeed?.apiEndpoint !== apiEndpoint ||
      previousSeed.orgName !== payload.orgName ||
      previousSeed.spaceName !== payload.spaceName;
    if (spaceChanged) {
      this.hanaSqlWorkbench.invalidateAllAppContexts();
    }

    // Primary source: the shared ~/.saptools/cf-structure.json (synced by the cf-sync
    // engine, shared with the CDS Debug extension). It lists every app — running,
    // scaled-to-zero, and stopped — so the dashboard matches CDS Debug instantly, even
    // on a fresh install where this extension's own globalState cache is still empty.
    const topologyApps = getAppsFromTopologySync(apiEndpoint, payload.orgName, payload.spaceName);

    // Fall back to the legacy per-extension globalState cache only when the shared
    // structure has nothing for this scope (e.g. a SAP-Tools-only install before a sync).
    const cachedApps =
      topologyApps === null
        ? await this.cacheSyncService.getCachedApps(
            this.selectedRegionId,
            payload.orgGuid,
            payload.spaceName
          )
        : null;
    if (!this.isCurrentSpaceRequest(requestId)) {
      return;
    }
    const cfHomeDir = await ensureCfHomeDir(this.context);
    if (!this.isCurrentSpaceRequest(requestId)) {
      return;
    }

    const immediateApps: SidebarAppEntry[] | null =
      topologyApps ??
      (cachedApps === null
        ? null
        : cachedApps.map((app) => ({
            id: app.id,
            name: app.name,
            runningInstances: app.runningInstances,
          })));

    if (immediateApps !== null) {
      // Serve straight from the shared cf-structure.json (kept fresh by the cf-sync
      // engine and the sibling CDS Debug extension). Do NOT trigger a live cf-sync
      // here: running it on every space selection — including scope hand-offs received
      // from CDS Debug via sapCap.currentScope — made both extensions drive the shared
      // ~/.saptools cf-sync engine at the same time, contending over its CF config and
      // lock files and breaking the bidirectional scope sync. Freshness for scopes the
      // user actually confirms is handled by refreshTopologyForConfirmedScope, and
      // CDS Debug keeps the shared structure fresh otherwise.
      await this.postAppsLoaded(immediateApps, payload, credentials, cfHomeDir, regionCode);
      return;
    }

    // Nothing cached for this scope yet (e.g. a SAP-Tools-only install before any
    // sync has populated the shared structure): populate just this one space on
    // demand, then serve it.
    try {
      const refresh = await refreshCfSyncSpace({
        apiEndpoint,
        orgName: payload.orgName,
        spaceName: payload.spaceName,
        email: credentials.email,
        password: credentials.password,
        log: (message) => {
        this.outputChannel.appendLine(message);
      },
      });
      if (!this.isCurrentSpaceRequest(requestId)) {
        return;
      }

      if (refresh.status === 'refreshed') {
        // Use the apps returned by the refresh directly: when the shared lock is
        // busy the sync runs against a private fallback directory that
        // getAppsFromTopologySync (which only reads the shared structure) cannot
        // see, so re-reading the shared file would yield nothing.
        const freshApps: SidebarAppEntry[] = refresh.apps.map((app) => ({
          id: app.id,
          name: app.name,
          runningInstances: app.runningInstances,
        }));
        this.outputChannel.appendLine(
          `[apps] Refreshed ${sanitizeForLog(payload.spaceName)} via ${refresh.source} (${String(refresh.appCount)} apps)`
        );
        await this.postAppsLoaded(freshApps, payload, credentials, cfHomeDir, regionCode);
        return;
      }

      const reason =
        refresh.status === 'failed'
          ? refresh.error instanceof Error
            ? refresh.error.message
            : 'Failed to load apps from Cloud Foundry.'
          : 'Could not resolve the Cloud Foundry region for this scope.';
      this.outputChannel.appendLine(
        `[apps] Refresh ${refresh.status} for ${sanitizeForLog(payload.spaceName)}: ${sanitizeForLog(reason)}`
      );
      this.postAppsError(reason);
    } catch (error) {
      if (!this.isCurrentSpaceRequest(requestId)) {
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load apps from Cloud Foundry.';
      this.postAppsError(errorMessage);
    }
  }

  private async handleTestModeSpaceSelection(payload: SpaceSelectionPayload): Promise<void> {
    const appsDelayMs = resolveE2eTestModeAppsDelayMs();
    if (appsDelayMs > 0) {
      await sleep(appsDelayMs);
    }

    if (payload.spaceName === 'failspace') {
      this.postAppsError(
        'Simulated CF CLI failure: could not reach API endpoint for failspace.'
      );
      return;
    }

    const apps = resolveMockApps(payload.spaceName).map((name) => ({
      id: name,
      name,
      runningInstances: 1,
    }));
    this.postMessage({
      type: MSG_APPS_LOADED,
      apps,
      scopeKey: `${this.selectedRegionCode}::${payload.orgName}::${payload.spaceName}`,
    });
    this.cfLogsPanel.updateScope(
      buildScopeLabel(this.selectedRegionCode, payload.orgName, payload.spaceName)
    );
    this.cfLogsPanel.updateApps(apps, null);
    this.currentApps = apps;
    this.currentLogSessionSeed = null;
    this.lastLoadedScope = {
      regionId: this.selectedRegionId,
      regionCode: this.selectedRegionCode,
      orgGuid: payload.orgGuid,
      orgName: payload.orgName,
      spaceName: payload.spaceName,
    };
    this.exportInProgress = false;
    await this.restoreRootFolderForLoadedSpace(payload);
    const restoredMappings = await this.restoreServiceFolderMappingsForCurrentScope();
    if (!restoredMappings) {
      this.serviceFolderMappings = [];
      this.serviceFolderSelections.clear();
      this.postMessage({
        type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
        mappings: this.serviceFolderMappings,
      });
    }

    if (this.selectedLocalRootFolderPath.length > 0) {
      void this.refreshServiceFolderMappings();
    }
  }

  // ── Session helpers ───────────────────────────────────────────────────────

  private async ensureRegionSession(
    credentials: { readonly email: string; readonly password: string }
  ): Promise<CfSession> {
    if (
      this.cfSession !== null &&
      this.cfSessionRegionCode.length > 0 &&
      this.cfSessionRegionCode === this.selectedRegionCode &&
      !isCfSessionExpired(this.cfSession)
    ) {
      return this.cfSession;
    }

    const regionCode = this.selectedRegionCode;
    if (regionCode.length === 0) {
      throw new Error('CF session expired. Please select a region again.');
    }

    const apiEndpoint = getCfApiEndpoint(regionCode);
    const loginInfo = await fetchCfLoginInfo(apiEndpoint);
    const token = await cfLogin(
      loginInfo.authorizationEndpoint,
      credentials.email,
      credentials.password
    );
    this.cfSession = { token, apiEndpoint };
    this.cfSessionRegionCode = regionCode;
    return this.cfSession;
  }

  private async establishRegionSession(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string,
    requestId: number
  ): Promise<void> {
    const apiEndpoint = getCfApiEndpoint(regionCode);
    const loginInfo = await fetchCfLoginInfo(apiEndpoint);
    const token = await cfLogin(
      loginInfo.authorizationEndpoint,
      credentials.email,
      credentials.password
    );
    if (!this.isCurrentRegionRequest(requestId) || this.selectedRegionCode !== regionCode) {
      return;
    }
    this.cfSession = { token, apiEndpoint };
    this.cfSessionRegionCode = regionCode;
  }

  private async refreshOrgsFromLiveAfterCachedRender(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string,
    requestId: number,
    cachedOrgs: readonly { readonly guid: string; readonly name: string }[]
  ): Promise<void> {
    await this.establishRegionSession(credentials, regionCode, requestId);
    if (!this.isCurrentRegionRequest(requestId)) {
      return;
    }

    const session = await this.ensureRegionSession(credentials);
    if (!this.isCurrentRegionRequest(requestId)) {
      return;
    }

    const liveOrgs = await fetchOrgs(session);
    if (!this.isCurrentRegionRequest(requestId)) {
      return;
    }

    if (!haveSameOrgEntries(cachedOrgs, liveOrgs)) {
      this.postMessage({
        type: MSG_ORGS_LOADED,
        orgs: liveOrgs,
      });
    }
  }

  private async postAppsLoaded(
    apps: SidebarAppEntry[],
    payload: SpaceSelectionPayload,
    credentials: { readonly email: string; readonly password: string },
    cfHomeDir: string,
    regionCode: string
  ): Promise<void> {
    this.postMessage({
      type: MSG_APPS_LOADED,
      apps,
      scopeKey: `${getCfApiEndpoint(regionCode)}::${payload.orgName}::${payload.spaceName}`,
    });
    this.updateCfLogsForLoadedApps(apps, payload, credentials, cfHomeDir, regionCode);
    this.currentApps = apps;
    this.lastLoadedScope = {
      regionId: this.selectedRegionId,
      regionCode,
      orgGuid: payload.orgGuid,
      orgName: payload.orgName,
      spaceName: payload.spaceName,
    };
    this.exportInProgress = false;
    await this.restoreRootFolderForLoadedSpace(payload);
    const restoredMappings = await this.restoreServiceFolderMappingsForCurrentScope();
    if (!restoredMappings) {
      this.serviceFolderMappings = [];
      this.serviceFolderSelections.clear();
      this.postMessage({
        type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
        mappings: this.serviceFolderMappings,
      });
    }

    if (this.selectedLocalRootFolderPath.length > 0) {
      void this.refreshServiceFolderMappings();
    }
  }

  private updateCfLogsForLoadedApps(
    apps: SidebarAppEntry[],
    payload: SpaceSelectionPayload,
    credentials: { readonly email: string; readonly password: string },
    cfHomeDir: string,
    regionCode: string
  ): void {
    const sessionSeed: CfLogSessionSeed = {
      apiEndpoint: getCfApiEndpoint(regionCode),
      email: credentials.email,
      password: credentials.password,
      orgName: payload.orgName,
      spaceName: payload.spaceName,
      cfHomeDir,
    };
    this.cfLogsPanel.updateScope(
      buildScopeLabel(regionCode, payload.orgName, payload.spaceName)
    );
    this.cfLogsPanel.updateApps(apps, sessionSeed);
    this.currentLogSessionSeed = sessionSeed;
  }

  private postOrgsError(message: string): void {
    this.postMessage({ type: MSG_ORGS_ERROR, message });
    this.cfLogsPanel.updateApps([], null);
    this.lastLoadedScope = null;
    this.currentApps = [];
    this.currentLogSessionSeed = null;
    this.serviceFolderMappings = [];
    this.serviceFolderSelections.clear();
    this.exportInProgress = false;
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
  }

  private postSpacesError(message: string): void {
    this.postMessage({ type: MSG_SPACES_ERROR, message });
    this.cfLogsPanel.updateApps([], null);
    this.lastLoadedScope = null;
    this.currentApps = [];
    this.currentLogSessionSeed = null;
    this.serviceFolderMappings = [];
    this.serviceFolderSelections.clear();
    this.exportInProgress = false;
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
  }

  private postAppsError(message: string): void {
    this.postMessage({ type: MSG_APPS_ERROR, message });
    this.cfLogsPanel.updateApps([], null);
    this.lastLoadedScope = null;
    this.currentApps = [];
    this.currentLogSessionSeed = null;
    this.serviceFolderMappings = [];
    this.serviceFolderSelections.clear();
    this.exportInProgress = false;
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
  }

  private postAppsReloadError(message: string): void {
    this.outputChannel.appendLine(
      `[apps] Reload failed: ${sanitizeErrorForLog(message)}`
    );
    this.postMessage({ type: MSG_APPS_RELOAD_ERROR, message });
  }

  private bumpRegionSelectionRequestId(): number {
    this.regionSelectionRequestId += 1;
    this.orgSelectionRequestId += 1;
    this.spaceSelectionRequestId += 1;
    return this.regionSelectionRequestId;
  }

  private bumpOrgSelectionRequestId(): number {
    this.orgSelectionRequestId += 1;
    this.spaceSelectionRequestId += 1;
    return this.orgSelectionRequestId;
  }

  private bumpSpaceSelectionRequestId(): number {
    this.spaceSelectionRequestId += 1;
    return this.spaceSelectionRequestId;
  }

  private bumpExternalScopeChangeRequestId(): number {
    this.externalScopeChangeRequestId += 1;
    return this.externalScopeChangeRequestId;
  }

  private isCurrentRegionRequest(requestId: number): boolean {
    return requestId === this.regionSelectionRequestId;
  }

  private isCurrentOrgRequest(requestId: number): boolean {
    return requestId === this.orgSelectionRequestId;
  }

  private isCurrentSpaceRequest(requestId: number): boolean {
    return requestId === this.spaceSelectionRequestId;
  }

  private isCurrentExternalScopeRequest(requestId: number): boolean {
    return requestId === this.externalScopeChangeRequestId;
  }

  // ── Region logging ───────────────────────────────────────────────────────

  private logRegionSelection(region: RegionSelectionPayload): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = [
      `[${timestamp}] Selected SAP BTP region:`,
      `${sanitizeForLog(region.name)} (${sanitizeForLog(region.code)})`,
      `| ${sanitizeForLog(region.area)}`,
      `| ${sanitizeForLog(region.id)}`,
    ].join(' ');

    this.outputChannel.appendLine(formattedMessage);

    if (process.env['SAP_TOOLS_E2E'] === '1') {
      void vscode.window.showInformationMessage(formattedMessage);
    }
  }

  private logWebviewMessageFailure(context: string, error: unknown): void {
    const errorMessage =
      error instanceof Error ? error.message : 'Unexpected webview message failure.';
    this.outputChannel.appendLine(
      `[webview] ${sanitizeForLog(context)} failed: ${sanitizeErrorForLog(errorMessage)}`
    );
  }

  // ── postMessage helpers ──────────────────────────────────────────────────

  private postMessage(message: Record<string, unknown>): void {
    void this.webviewView?.webview.postMessage(message);
  }

  private postCacheState(snapshot: CacheRuntimeSnapshot): void {
    this.postMessage({
      type: MSG_CACHE_STATE,
      snapshot: {
        activeUserEmail: snapshot.activeUserEmail,
        syncInProgress: snapshot.syncInProgress,
        lastSyncStartedAt: snapshot.lastSyncStartedAt,
        lastSyncCompletedAt: snapshot.lastSyncCompletedAt,
        lastSyncError: snapshot.lastSyncError,
        syncIntervalHours: snapshot.syncIntervalHours,
        nextSyncAt: snapshot.nextSyncAt,
        regionAccessById: snapshot.regionAccessById,
      },
    } satisfies CacheStatePayload);
  }

  // ── HTML builders ────────────────────────────────────────────────────────

  private buildMainHtml(
    webview: vscode.Webview,
    nonce: string,
    assetsRoot: vscode.Uri
  ): string {
    const scriptSrc = webview
      .asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'prototype.js'))
      .toString();
    const cssSrc = webview
      .asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'prototype.css'))
      .toString();
    const themeCssSrc = webview
      .asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'themes', 'design.css'))
      .toString();

    const csp = buildCsp(webview, nonce);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>SAP Tools</title>
    <link rel="stylesheet" href="${cssSrc}" />
    <link rel="stylesheet" href="${themeCssSrc}" />
  </head>
  <body class="prototype-page saptools-extension" data-design-id="${PROTOTYPE_DESIGN_ID}">
    <main id="app"></main>
    <script nonce="${nonce}" type="module" src="${scriptSrc}"></script>
  </body>
</html>`;
  }

  private buildLoginGateHtml(
    webview: vscode.Webview,
    nonce: string,
    assetsRoot: vscode.Uri
  ): string {
    const scriptSrc = webview
      .asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'login-gate.js'))
      .toString();
    const cssSrc = webview
      .asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'login-gate.css'))
      .toString();
    const csp = buildCsp(webview, nonce);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>SAP Tools Login</title>
    <link rel="stylesheet" href="${cssSrc}" />
  </head>
  <body class="login-gate-page saptools-extension">
    <main class="login-shell">
      <header class="layout-head">
        <div class="layout-title-row">
          <h1>SAP Tools Login</h1>
          <span class="layout-chip">Secure</span>
        </div>
        <p class="layout-subline">Connect your SAP account to open region workspace.</p>
      </header>

      <section class="login-card" aria-label="SAP credential setup">
        <form id="login-gate-form" class="login-form" novalidate>
          <div class="field-row">
            <label for="sap-email">SAP Email</label>
            <input
              id="sap-email"
              name="sap-email"
              type="email"
              autocomplete="email"
              placeholder="developer@company.com"
              required
            />
          </div>

          <div class="field-row">
            <label for="sap-password">SAP Password</label>
            <input
              id="sap-password"
              name="sap-password"
              type="password"
              autocomplete="current-password"
              placeholder="Enter SAP password"
              required
            />
          </div>

          <p id="form-status" class="form-status" role="status" aria-live="polite"></p>

          <button id="submit-login-gate" type="submit">Save and Continue</button>
        </form>
      </section>
    </main>

    <script nonce="${nonce}" type="module" src="${scriptSrc}"></script>
  </body>
</html>`;
  }
}

function isTestMode(): boolean {
  return process.env['SAP_TOOLS_TEST_MODE'] === '1';
}

function buildSharedScopeFromConfirmPayload(
  payload: ConfirmScopePayload
): SharedCfScope {
  return {
    regionCode: payload.regionId,
    orgName: payload.orgName,
    spaceName: payload.spaceName,
  };
}

function areSharedScopesEqual(
  left: SharedCfScope | undefined,
  right: SharedCfScope | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return (
    left.regionCode === right.regionCode &&
    left.orgName === right.orgName &&
    left.spaceName === right.spaceName
  );
}

function areReloadScopesEqual(
  left: SharedCfScope | undefined,
  right: SharedCfScope | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return (
    areRegionCodesEquivalent(left.regionCode, right.regionCode) &&
    left.orgName === right.orgName &&
    left.spaceName === right.spaceName
  );
}

function isLoadedScopeForConfirmedScope(
  loadedScope: LoadedScopeState,
  confirmedScope: SharedCfScope
): boolean {
  return (
    areRegionCodesEquivalent(loadedScope.regionCode, confirmedScope.regionCode) &&
    loadedScope.orgName === confirmedScope.orgName &&
    loadedScope.spaceName === confirmedScope.spaceName
  );
}

function areRegionCodesEquivalent(left: string, right: string): boolean {
  return normalizeRegionCodeForComparison(left) === normalizeRegionCodeForComparison(right);
}

function normalizeRegionCodeForComparison(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '');
}

/**
 * Order-independent equality for two app lists. App names are unique within a
 * space, so a length check plus matching id/name/runningInstances keys is exact.
 * Used to skip a redundant re-post when a topology refresh returns the same apps
 * the dashboard already shows.
 */
function appListsEqual(
  left: readonly SidebarAppEntry[],
  right: readonly SidebarAppEntry[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const toKey = (app: SidebarAppEntry): string =>
    `${app.id} ${app.name} ${String(app.runningInstances)}`;
  const leftKeys = new Set(left.map(toKey));
  return right.every((app) => leftKeys.has(toKey(app)));
}

function formatAppListReloadFailure(
  result: Exclude<Awaited<ReturnType<typeof refreshCfSyncSpace>>, { readonly status: 'refreshed' }>
): string {
  if (result.status === 'failed') {
    return result.error instanceof Error
      ? result.error.message
      : 'Failed to reload apps from Cloud Foundry.';
  }
  return result.reason === 'missing-credentials'
    ? 'No credentials found. Please re-open SAP Tools and log in.'
    : 'Could not resolve the Cloud Foundry region for this scope.';
}

function resolveE2eTestModeAppsDelayMs(): number {
  if (process.env['SAP_TOOLS_E2E'] !== '1') {
    return 0;
  }

  const rawDelay = process.env['SAP_TOOLS_E2E_TESTMODE_APPS_DELAY_MS'] ?? '';
  const parsedDelay = Number.parseInt(rawDelay, 10);
  if (!Number.isFinite(parsedDelay) || parsedDelay <= 0) {
    return 0;
  }

  return Math.min(parsedDelay, 30_000);
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildCsp(webview: vscode.Webview, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join('; ');
}

function buildScopeLabel(regionCode: string, orgName: string, spaceName: string): string {
  const normalizedRegionCode = regionCode.trim().length > 0 ? regionCode.trim() : 'no-region';
  const normalizedOrgName = orgName.trim().length > 0 ? orgName.trim() : 'no-org';
  const normalizedSpaceName = spaceName.trim().length > 0 ? spaceName.trim() : 'no-space';
  return `${normalizedRegionCode} \u2192 ${normalizedOrgName} \u2192 ${normalizedSpaceName}`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 24; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    nonce += alphabet[randomIndex] ?? 'A';
  }
  return nonce;
}

function sanitizeForLog(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

function sanitizeErrorForLog(value: string): string {
  return sanitizeForLog(value)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1<redacted>')
    .replace(/(access_token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(client_secret=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, '$1<redacted>');
}

function readOptionalString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    return '';
  }

  return normalized;
}

function buildServiceMappingsScopeKey(
  email: string,
  regionCode: string,
  orgGuid: string,
  spaceName: string,
  rootFolderPath: string
): string {
  const normalizedEmail = normalizeUserEmail(email);
  const normalizedRegionCode = regionCode.trim().toLowerCase();
  const normalizedOrgGuid = orgGuid.trim().toLowerCase();
  const normalizedSpaceName = spaceName.trim().toLowerCase();
  const normalizedRootFolderPath = rootFolderPath.trim();

  if (
    normalizedEmail.length === 0 ||
    normalizedRegionCode.length === 0 ||
    normalizedOrgGuid.length === 0 ||
    normalizedSpaceName.length === 0 ||
    normalizedRootFolderPath.length === 0
  ) {
    return '';
  }

  return JSON.stringify([
    normalizedEmail,
    normalizedRegionCode,
    normalizedOrgGuid,
    normalizedSpaceName,
    normalizedRootFolderPath,
  ]);
}

function normalizePersistedServiceMappingsByScope(
  rawValue: unknown
): Record<string, PersistedServiceMappingScopeEntry> {
  if (!isRecord(rawValue)) {
    return {};
  }

  const normalizedEntries: Record<string, PersistedServiceMappingScopeEntry> = {};
  for (const [scopeKeyRaw, entryRaw] of Object.entries(rawValue)) {
    const scopeKey = scopeKeyRaw.trim();
    if (scopeKey.length === 0) {
      continue;
    }

    const entry = normalizePersistedServiceMappingScopeEntry(entryRaw);
    if (entry === null) {
      continue;
    }

    normalizedEntries[scopeKey] = entry;
  }

  return normalizedEntries;
}

function normalizePersistedServiceMappingScopeEntry(
  rawValue: unknown
): PersistedServiceMappingScopeEntry | null {
  if (!isRecord(rawValue)) {
    return null;
  }

  const rootFolderPath = readOptionalString(rawValue['rootFolderPath'], 4096);
  const updatedAt = readOptionalString(rawValue['updatedAt'], 96);
  const rawMappings = rawValue['mappings'];
  if (rootFolderPath.length === 0 || updatedAt.length === 0 || !Array.isArray(rawMappings)) {
    return null;
  }

  const mappings = rawMappings
    .map((mapping) => normalizeServiceMappingForPersistence(mapping))
    .filter((mapping): mapping is ServiceFolderMapping => mapping !== null);

  return {
    rootFolderPath,
    updatedAt,
    mappings,
  };
}

function normalizeServiceMappingForPersistence(rawValue: unknown): ServiceFolderMapping | null {
  if (!isRecord(rawValue)) {
    return null;
  }

  const appId = readOptionalString(rawValue['appId'], 128);
  const appName = readOptionalString(rawValue['appName'], 128);
  const folderPath = readOptionalString(rawValue['folderPath'], 4096);
  const matchTypeRaw = readOptionalString(rawValue['matchType'], 16);
  const matchType =
    matchTypeRaw === 'exact' ||
    matchTypeRaw === 'underscore' ||
    matchTypeRaw === 'none' ||
    matchTypeRaw === 'ambiguous'
      ? matchTypeRaw
      : 'none';

  if (appId.length === 0 || appName.length === 0) {
    return null;
  }

  const rawCandidateFolderPaths = Array.isArray(rawValue['candidateFolderPaths'])
    ? rawValue['candidateFolderPaths']
    : [];
  const candidateFolderPaths = rawCandidateFolderPaths
    .map((candidatePath) => readOptionalString(candidatePath, 4096))
    .filter((candidatePath) => candidatePath.length > 0);

  const hasConflict = rawValue['hasConflict'] === true;
  const effectiveFolderPath =
    hasConflict && folderPath.length > 0 && !candidateFolderPaths.includes(folderPath)
      ? ''
      : folderPath;

  return {
    appId,
    appName,
    folderPath: effectiveFolderPath,
    matchType,
    candidateFolderPaths,
    hasConflict,
  };
}

function haveSameOrgEntries(
  leftOrgs: readonly { readonly guid: string; readonly name: string }[],
  rightOrgs: readonly { readonly guid: string; readonly name: string }[]
): boolean {
  if (leftOrgs.length !== rightOrgs.length) {
    return false;
  }

  const rightByGuid = new Map(
    rightOrgs.map((org) => {
      return [org.guid, org.name] as const;
    })
  );

  for (const leftOrg of leftOrgs) {
    const rightName = rightByGuid.get(leftOrg.guid);
    if (rightName === undefined || rightName !== leftOrg.name) {
      return false;
    }
  }

  return true;
}

function shouldSkipSensitiveExportConfirmation(): boolean {
  return process.env['SAP_TOOLS_E2E'] === '1' || process.env['SAP_TOOLS_TEST_MODE'] === '1';
}

async function pathExists(pathValue: string): Promise<boolean> {
  const normalizedPath = pathValue.trim();
  if (normalizedPath.length === 0) {
    return false;
  }

  try {
    await access(normalizedPath);
    return true;
  } catch {
    return false;
  }
}

// ── Type guards ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength;
}

function isLoginSubmitMessage(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value['email'], 256) && isNonEmptyString(value['password'], 256);
}

function readLoginSubmitPayload(value: Record<string, unknown>): {
  readonly email: string;
  readonly password: string;
} {
  return {
    email: String(value['email']),
    password: String(value['password']),
  };
}

function isRegionSelectedMessage(value: Record<string, unknown>): boolean {
  const region = value['region'];
  if (!isRecord(region)) {
    return false;
  }
  return (
    isNonEmptyString(region['id'], 64) &&
    isNonEmptyString(region['name'], 96) &&
    isNonEmptyString(region['code'], 32) &&
    isNonEmptyString(region['area'], 64)
  );
}

function readRegionSelectionPayload(value: Record<string, unknown>): RegionSelectionPayload {
  const region = value['region'] as Record<string, unknown>;
  return {
    id: String(region['id']),
    name: String(region['name']),
    code: String(region['code']),
    area: String(region['area']),
  };
}

function isOrgSelectedMessage(value: Record<string, unknown>): boolean {
  const org = value['org'];
  if (!isRecord(org)) {
    return false;
  }
  return isNonEmptyString(org['guid'], 128) && isNonEmptyString(org['name'], 128);
}

function readOrgSelectionPayload(value: Record<string, unknown>): OrgSelectionPayload {
  const org = value['org'] as Record<string, unknown>;
  return {
    guid: String(org['guid']),
    name: String(org['name']),
  };
}

function isSpaceSelectedMessage(value: Record<string, unknown>): boolean {
  const scope = value['scope'];
  if (!isRecord(scope)) {
    return false;
  }

  return (
    isNonEmptyString(scope['spaceName'], 128) &&
    isNonEmptyString(scope['orgGuid'], 128) &&
    isNonEmptyString(scope['orgName'], 128)
  );
}

function readSpaceSelectionPayload(value: Record<string, unknown>): SpaceSelectionPayload {
  const scope = value['scope'] as Record<string, unknown>;
  return {
    spaceName: String(scope['spaceName']),
    orgGuid: String(scope['orgGuid']),
    orgName: String(scope['orgName']),
  };
}

function isTopologyOrgSelectedMessage(value: Record<string, unknown>): boolean {
  const payload = value['payload'];
  if (!isRecord(payload)) {
    return false;
  }
  return (
    isNonEmptyString(payload['regionKey'], 32) &&
    isNonEmptyString(payload['orgName'], 128)
  );
}

function readTopologyOrgSelectedPayload(
  value: Record<string, unknown>
): TopologyOrgSelectedPayload {
  const payload = value['payload'] as Record<string, unknown>;
  return {
    regionKey: String(payload['regionKey']).trim(),
    orgName: String(payload['orgName']).trim(),
  };
}

function isQuickScopeConfirmMessage(value: Record<string, unknown>): boolean {
  const payload = value['payload'];
  if (!isRecord(payload)) {
    return false;
  }
  return (
    isNonEmptyString(payload['regionKey'], 32) &&
    isNonEmptyString(payload['orgName'], 128) &&
    isNonEmptyString(payload['spaceName'], 128)
  );
}

function readQuickScopeConfirmPayload(
  value: Record<string, unknown>
): QuickScopeConfirmPayload {
  const payload = value['payload'] as Record<string, unknown>;
  return {
    regionKey: String(payload['regionKey']).trim(),
    orgName: String(payload['orgName']).trim(),
    spaceName: String(payload['spaceName']).trim(),
  };
}

function isConfirmScopeMessage(value: Record<string, unknown>): boolean {
  const scope = value['scope'];
  if (!isRecord(scope)) {
    return false;
  }

  return (
    isNonEmptyString(scope['regionId'], 64) &&
    isNonEmptyString(scope['regionCode'], 32) &&
    isNonEmptyString(scope['regionName'], 96) &&
    isNonEmptyString(scope['regionArea'], 96) &&
    isNonEmptyString(scope['orgGuid'], 128) &&
    isNonEmptyString(scope['orgName'], 128) &&
    isNonEmptyString(scope['spaceName'], 128)
  );
}

function readConfirmScopePayload(value: Record<string, unknown>): ConfirmScopePayload {
  const scope = value['scope'] as Record<string, unknown>;
  return {
    regionId: String(scope['regionId']).trim(),
    regionCode: String(scope['regionCode']).trim(),
    regionName: String(scope['regionName']).trim(),
    regionArea: String(scope['regionArea']).trim(),
    orgGuid: String(scope['orgGuid']).trim(),
    orgName: String(scope['orgName']).trim(),
    spaceName: String(scope['spaceName']).trim(),
  };
}

function isActiveAppsChangedMessage(value: Record<string, unknown>): boolean {
  const appNames = value['appNames'];
  if (!Array.isArray(appNames) || appNames.length > 64) {
    return false;
  }

  for (const appName of appNames) {
    if (!isNonEmptyString(appName, 128)) {
      return false;
    }
  }

  return true;
}

function readActiveAppsChangedPayload(
  value: Record<string, unknown>
): ActiveAppsChangedPayload {
  return {
    appNames: (value['appNames'] as string[]).map((name) => name.trim()),
  };
}

function isUpdateSyncIntervalMessage(value: Record<string, unknown>): boolean {
  const syncIntervalHours = value['syncIntervalHours'];
  return typeof syncIntervalHours === 'number' && isSyncIntervalHours(syncIntervalHours);
}

function readUpdateSyncIntervalPayload(
  value: Record<string, unknown>
): UpdateSyncIntervalPayload {
  return {
    syncIntervalHours: value['syncIntervalHours'] as SyncIntervalHours,
  };
}

function isRefreshServiceFolderMappingsMessage(
  value: Record<string, unknown>
): boolean {
  const rootFolderPath = value['rootFolderPath'];
  const appNames = value['appNames'];
  if (
    typeof rootFolderPath !== 'string' ||
    rootFolderPath.trim().length > 4096 ||
    !Array.isArray(appNames) ||
    appNames.length > 256
  ) {
    return false;
  }

  for (const appName of appNames) {
    if (!isNonEmptyString(appName, 128)) {
      return false;
    }
  }

  return true;
}

function readRefreshServiceFolderMappingsPayload(
  value: Record<string, unknown>
): RefreshServiceFolderMappingsPayload {
  const appNamesRaw = value['appNames'] as string[];
  return {
    rootFolderPath: String(value['rootFolderPath']).trim(),
    appNames: appNamesRaw.map((appName) => appName.trim()),
  };
}

function isSelectServiceFolderMappingMessage(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value['appId'], 128) &&
    typeof value['folderPath'] === 'string' &&
    value['folderPath'].trim().length <= 4096
  );
}

function readSelectServiceFolderMappingPayload(
  value: Record<string, unknown>
): SelectServiceFolderMappingPayload {
  return {
    appId: String(value['appId']).trim(),
    folderPath: String(value['folderPath']).trim(),
  };
}

function isExportServiceArtifactsMessage(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value['appId'], 128) &&
    isNonEmptyString(value['appName'], 128) &&
    typeof value['rootFolderPath'] === 'string' &&
    value['rootFolderPath'].trim().length <= 4096
  );
}

function readExportServiceArtifactsPayload(
  value: Record<string, unknown>
): ExportServiceArtifactsPayload {
  return {
    appId: String(value['appId']).trim(),
    appName: String(value['appName']).trim(),
    rootFolderPath: String(value['rootFolderPath']).trim(),
  };
}

function isExportSqlToolsConfigMessage(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value['appId'], 128) &&
    isNonEmptyString(value['appName'], 128) &&
    typeof value['rootFolderPath'] === 'string' &&
    value['rootFolderPath'].trim().length <= 4096
  );
}

function readExportSqlToolsConfigPayload(
  value: Record<string, unknown>
): ExportSqlToolsConfigPayload {
  return {
    appId: String(value['appId']).trim(),
    appName: String(value['appName']).trim(),
    rootFolderPath: String(value['rootFolderPath']).trim(),
  };
}

function isOpenHanaSqlFileMessage(value: Record<string, unknown>): boolean {
  return (
    typeof value['requestId'] === 'number' &&
    Number.isSafeInteger(value['requestId']) &&
    value['requestId'] > 0 &&
    isNonEmptyString(value['serviceId'], 128) &&
    isNonEmptyString(value['serviceName'], 128)
  );
}

function readOpenHanaSqlFilePayload(
  value: Record<string, unknown>
): OpenHanaSqlFilePayload {
  return {
    requestId: Number(value['requestId']),
    serviceId: String(value['serviceId']).trim(),
    serviceName: String(value['serviceName']).trim(),
  };
}

function isRefreshHanaTablesMessage(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value['serviceId'], 128) &&
    isNonEmptyString(value['serviceName'], 128)
  );
}

function readRefreshHanaTablesPayload(
  value: Record<string, unknown>
): RefreshHanaTablesPayload {
  return {
    serviceId: String(value['serviceId']).trim(),
    serviceName: String(value['serviceName']).trim(),
  };
}

function isRunHanaTableSelectMessage(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value['serviceId'], 128) &&
    isNonEmptyString(value['serviceName'], 128) &&
    isNonEmptyString(value['tableName'], 256)
  );
}

function readRunHanaTableSelectPayload(
  value: Record<string, unknown>
): RunHanaTableSelectPayload {
  return {
    serviceId: String(value['serviceId']).trim(),
    serviceName: String(value['serviceName']).trim(),
    tableName: String(value['tableName']).trim(),
  };
}

function formatServicePackageReplaceMessage(
  appName: string,
  tag: string,
  result: ServiceDependencyTagReplacementResult
): string {
  const actions: string[] = [];
  if (result.placeholderReplacementCount > 0) {
    actions.push(
      `replaced ${formatCount(result.placeholderReplacementCount, 'placeholder')} with "${tag}"`
    );
  }
  if (result.updatedPackageNames.length > 0) {
    actions.push(
      `set ${formatCount(result.updatedPackageNames.length, 'local package dependency')} to "${tag}"`
    );
  }

  return `SAP Tools: Updated package.json for "${appName}": ${actions.join('; ')}.`;
}

function formatCount(count: number, singularLabel: string): string {
  return `${String(count)} ${singularLabel}${count === 1 ? '' : 's'}`;
}

function sanitizeSqlUiLogValue(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function buildLocalPackagesCacheKey(rootFolderPath: string, namePatterns: string): string {
  return `${rootFolderPath.trim()}::${namePatterns.trim()}`;
}

function areLocalPackageListsEqual(
  left: readonly { name: string; version: string; hasBuildScript: boolean; round: number | null }[],
  right: readonly { readonly name: string; readonly version: string; readonly hasBuildScript: boolean; readonly round: number | null }[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    const l = left[i];
    const r = right[i];
    if (l === undefined || r === undefined) {
      return false;
    }
    if (l.name !== r.name || l.version !== r.version || l.hasBuildScript !== r.hasBuildScript || l.round !== r.round) {
      return false;
    }
  }
  return true;
}
