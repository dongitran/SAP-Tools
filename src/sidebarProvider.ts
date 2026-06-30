import * as vscode from 'vscode';

import type { ApisExplorerPanelManager, ApisExplorerPanelSession } from './apisExplorerPanel';
import { type CacheStore } from './cacheStore';
import type { CacheRuntimeSnapshot, CacheSyncService } from './cacheSyncService';
import type { CfSession } from './cfClient';
import {
    getCfApiEndpoint
} from './cfClient';
import { ensureCfHomeDir } from './cfHome';
import type { CfLogsPanelProvider } from './cfLogsPanel';
import type { refreshCfSyncSpace } from './cfSpaceRefresh';
import {
    type CfTopology
} from './cfTopology';
import { getEffectiveCredentials } from './credentialStore';
import type { HanaSqlBackupStore } from './hanaSqlBackupStore';
import type { HanaSqlHistoryPanelManager } from './hanaSqlHistoryPanel';
import type { HanaSqlWorkbench } from './hanaSqlWorkbench';
import {
    type LocalPackagesConfig
} from './localPackages/localPackagesConfig';
import { VerdaccioManager } from './localPackages/verdaccioManager';
import {
    readMicrosoftGraphToolRunRequest,
    type MicrosoftGraphToolRunRequest,
    type MicrosoftGraphToolStepProgress
} from './microsoftGraphTools';
import type { SAP_BTP_REGIONS } from './regions';
import { type SharedCfScope } from './scopeSync';
import {
    type ServiceFolderMapping
} from './serviceFolderMapping';


import { buildLoginGateHtml, buildMainHtml } from './sidebarProvider.html';

import type {
    AppListReloadRequest,
    CfLogSessionSeed,
    ConfirmScopeOptions,
    ConfirmScopePayload,
    EventMeshViewerController,
    ExportServiceArtifactsPayload,
    ExportSqlToolsConfigPayload,
    LoadedScopeState,
    OpenHanaSqlFilePayload,
    OrgSelectionPayload,
    PersistedConfirmedScopeEntry,
    PersistedServiceMappingScopeEntry,
    QuickScopeConfirmPayload,
    RefreshHanaTablesPayload,
    RefreshServiceFolderMappingsPayload,
    RegionSelectionPayload,
    RootFolderCacheScope,
    RunHanaTableSelectPayload,
    SelectServiceFolderMappingPayload,
    SidebarAppEntry,
    SpaceSelectionPayload,
    TopologyOrgSelectedPayload
} from './sidebarProvider.types';
import {
    MSG_ACTIVE_APPS_CHANGED,
    MSG_BUILD_PUBLISH_ALL,
    MSG_BUILD_SINGLE_PACKAGE,
    MSG_CLEAR_SSH_PROXY_SETTINGS,
    MSG_CONFIRM_SCOPE,
    MSG_EVENT_MESH_VIEWER_SETTLED,
    MSG_EXPORT_SERVICE_ARTIFACTS,
    MSG_EXPORT_SQLTOOLS_CONFIG,
    MSG_GET_SSH_PROXY_STATUS,
    MSG_HANA_TUNNEL_STATE,
    MSG_LOCAL_REGISTRY_START,
    MSG_LOCAL_REGISTRY_STATUS,
    MSG_LOCAL_REGISTRY_STOP,
    MSG_LOGIN_SUBMIT,
    MSG_LOGOUT,
    MSG_OPEN_APIS_EXPLORER,
    MSG_OPEN_CF_LOGS_PANEL,
    MSG_OPEN_EVENT_MESH,
    MSG_OPEN_HANA_SQL_FILE,
    MSG_OPEN_LOCAL_PACKAGES_SETTINGS,
    MSG_OPEN_SQL_BACKUP_HISTORY,
    MSG_OPEN_SQLTOOLS_EXTENSION,
    MSG_ORG_SELECTED,
    MSG_PAUSED_APPS_CHANGED,
    MSG_QUICK_SCOPE_CONFIRM,
    MSG_REFRESH_HANA_TABLES,
    MSG_REFRESH_SERVICE_FOLDER_MAPPINGS,
    MSG_REGION_SELECTED,
    MSG_RELOAD_APP_LIST,
    MSG_REPLACE_SERVICE_PACKAGE_PLACEHOLDER,
    MSG_REQUEST_CF_TOPOLOGY,
    MSG_REQUEST_INITIAL_STATE,
    MSG_RUN_HANA_TABLE_SELECT,
    MSG_RUN_MICROSOFT_GRAPH_TOOL,
    MSG_SAVE_SSH_PROXY_SETTINGS,
    MSG_SELECT_LOCAL_ROOT_FOLDER,
    MSG_SELECT_SERVICE_FOLDER_MAPPING,
    MSG_SPACE_SELECTED,
    MSG_SYNC_NOW,
    MSG_TOPOLOGY_ORG_SELECTED,
    MSG_UPDATE_SYNC_INTERVAL
} from './sidebarProvider.types';

export { REGION_VIEW_ID } from './sidebarProvider.types';

import { applyReloadedAppListResult, createAppListReloadRequest, isCurrentAppListReloadRequest, postAppsError, postAppsLoaded, postAppsReloadError, updateCfLogsForLoadedApps, handleReloadAppList } from "./sidebar/handlers/appHandlers";
import { clearRootFolderSelection, deleteMissingRootFolderCache, handleSelectServiceFolderMapping, refreshServiceFolderMappings, resolveServiceFolderMapping, restoreRootFolderForLoadedSpace, restoreRootFolderForLoadedSpaceUnsafe, handleRefreshServiceFolderMappings, handleSelectLocalRootFolder } from "./sidebar/handlers/folderHandlers";
import { postHanaSqlFileOpenResult, postHanaTableSelectResult, publishHanaTablesForApp, handleOpenHanaSqlFile, handleOpenSqlBackupHistory, handleOpenSqlToolsExtension, handleRefreshHanaTables, handleRunHanaTableSelect } from "./sidebar/handlers/hanaHandlers";
import { postDetectedLocalPackages, postRegistryState, resolveLocalPackageNamesForReplacement, scanAndOrderLocalPackages, startLocalRegistry, stopLocalRegistry, handleBuildPublishAll, handleReplaceServicePackagePlaceholder } from "./sidebar/handlers/localHandlers";
import { appendMicrosoftGraphToolLog, appendMicrosoftGraphToolProgress, applyServiceFolderSelections, bumpOrgSelectionRequestId, bumpRegionSelectionRequestId, bumpSpaceSelectionRequestId, confirmSensitiveExport, isCurrentOrgRequest, isCurrentRegionRequest, isCurrentSpaceRequest, logRegionSelection, logWebviewMessageFailure, postBuildResult, postCacheState, postMessage, resolveE2eRootDialogOverride, handleExportServiceArtifacts, handleExportSqlToolsConfig, handleMicrosoftGraphToolRun, handleOpenApisExplorer } from "./sidebar/handlers/miscHandlers";
import { applyRefreshedAppsForConfirmedScope, bumpExternalScopeChangeRequestId, clearScopeBoundRuntimeStateForScopeChange, establishCurrentScopeResolutionSession, hydrateQuickConfirmedScope, hydrateRestoredScope, isCurrentExternalScopeRequest, isHandledAppScope, isLoadedScope, persistConfirmedScopeForCurrentUser, persistRootFolderForCurrentScope, persistServiceFolderMappingsForCurrentScope, preloadRootFolderForPersistedScope, preloadServiceFolderMappingsForPersistedScope, readConfirmedScopeMap, readPersistedConfirmedScopeForEmail, readServiceMappingCacheByScope, refreshTopologyForConfirmedScope, resolveCachedOrTestOrgGuid, resolveCurrentRootFolderScope, resolveCurrentServiceMappingCacheScope, resolveLiveOrgGuid, resolveOrgGuidByName, resolveQuickScopeOrgGuid, resolveQuickScopeSession, resolveRootFolderScopeForLoadedSpace, restoreConfirmedScopeForCurrentUser, restoreExternalScope, restoreServiceFolderMappingsForCurrentScope, handleConfirmScope, handleExternalScopeChange, handleOrgSelected, handleQuickScopeConfirm, handleRegionSelected, handleSpaceSelected, handleTestModeSpaceSelection } from "./sidebar/handlers/scopeHandlers";
import { ensureRegionSession, establishRegionSession, openApisExplorerSession, postOrgsError, postSpacesError, refreshOrgsFromLiveAfterCachedRender, reloadToLoginView, reloadToMainView, sendSshProxyStatus, handleClearSshProxySettings, handleLoginSubmit, handleLogout, handleRequestInitialState, handleSaveSshProxySettings } from "./sidebar/handlers/sessionHandlers";
import { postCfTopologySnapshot, pushCfTopology, resolveCfTopologyAsync, resolveCfTopologySync, handleTopologyOrgSelected } from "./sidebar/handlers/topologyHandlers";
import {
    createNonce,
    isActiveAppsChangedMessage,
    isConfirmScopeMessage,
    isExportServiceArtifactsMessage,
    isExportSqlToolsConfigMessage,
    isLoginSubmitMessage,
    isOpenHanaSqlFileMessage,
    isOrgSelectedMessage,
    isQuickScopeConfirmMessage,
    isRecord,
    isRefreshHanaTablesMessage,
    isRefreshServiceFolderMappingsMessage,
    isRegionSelectedMessage,
    isRunHanaTableSelectMessage,
    isSelectServiceFolderMappingMessage,
    isSpaceSelectedMessage,
    isTopologyOrgSelectedMessage,
    isUpdateSyncIntervalMessage,
    readActiveAppsChangedPayload,
    readConfirmScopePayload,
    readExportServiceArtifactsPayload,
    readExportSqlToolsConfigPayload,
    readLoginSubmitPayload,
    readOpenHanaSqlFilePayload,
    readOrgSelectionPayload,
    readQuickScopeConfirmPayload,
    readRefreshHanaTablesPayload,
    readRefreshServiceFolderMappingsPayload,
    readRegionSelectionPayload,
    readRunHanaTableSelectPayload,
    readSelectServiceFolderMappingPayload,
    readSpaceSelectionPayload,
    readTopologyOrgSelectedPayload,
    readUpdateSyncIntervalPayload
} from './sidebarProvider.helpers';

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
  private lastAppLoadErrorScope: LoadedScopeState | null = null;
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
    private readonly eventMeshPanelManager: EventMeshViewerController,
    private readonly hanaSqlBackupStore: HanaSqlBackupStore | null = null,
    private readonly hanaSqlHistoryPanelManager: HanaSqlHistoryPanelManager | null = null
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
    this.sendSshProxyStatus();

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
    this.lastAppLoadErrorScope = null;
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
        ? buildMainHtml(webviewView.webview, nonce, assetsRoot)
        : buildLoginGateHtml(webviewView.webview, nonce, assetsRoot);

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

    if (type === MSG_OPEN_SQL_BACKUP_HISTORY) {
      await this.handleOpenSqlBackupHistory();
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
    this.sendSshProxyStatus();

      return;
    }

    if (type === MSG_SYNC_NOW) {
      const snapshot = await this.cacheSyncService.triggerSyncNow();
      this.postCacheState(snapshot);
    this.sendSshProxyStatus();

      return;
    }

    if (type === MSG_LOGOUT) {
      await this.handleLogout();
      return;
    }

    if (type === MSG_GET_SSH_PROXY_STATUS) {
      this.sendSshProxyStatus();
      return;
    }

    if (type === MSG_SAVE_SSH_PROXY_SETTINGS) {
      if ('payload' in message) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        await this.handleSaveSshProxySettings((message as any).payload);
      }
      return;
    }

    if (type === MSG_CLEAR_SSH_PROXY_SETTINGS) {
      await this.handleClearSshProxySettings();
      return;
    }

  }

  private async handleOpenApisExplorer(appId: string): Promise<void> {
      return handleOpenApisExplorer.call(this, appId);
  }

  private async openApisExplorerSession(appId: string): Promise<ApisExplorerPanelSession> {
      return await openApisExplorerSession.call(this, appId);
  }

  private async handleRequestInitialState(): Promise<void> {
      return handleRequestInitialState.call(this);
  }

  private resolveCfTopologySync(): CfTopology {
      return resolveCfTopologySync.call(this);
  }

  private async resolveCfTopologyAsync(): Promise<CfTopology> {
      return await resolveCfTopologyAsync.call(this);
  }

  private async pushCfTopology(): Promise<void> {
      await pushCfTopology.call(this);
  }

  private postCfTopologySnapshot(topology: CfTopology): void {
      postCfTopologySnapshot.call(this, topology);
  }

  private async handleConfirmScope(
    payload: ConfirmScopePayload,
    options: ConfirmScopeOptions = {}
  ): Promise<void> {
      return handleConfirmScope.call(this, payload, options);
  }

  public async handleExternalScopeChange(scope: SharedCfScope): Promise<void> {
      return handleExternalScopeChange.call(this, scope);
  }

  private async restoreExternalScope(
    scope: SharedCfScope,
    requestId = this.externalScopeChangeRequestId
  ): Promise<void> {
      await restoreExternalScope.call(this, scope, requestId);
  }

  private clearScopeBoundRuntimeStateForScopeChange(invalidateHanaAppContexts = true): void {
      clearScopeBoundRuntimeStateForScopeChange.call(this, invalidateHanaAppContexts);
  }

  private async handleReloadAppList(): Promise<void> {
      return handleReloadAppList.call(this);
  }

  private createAppListReloadRequest(): AppListReloadRequest | null {
      return createAppListReloadRequest.call(this);
  }

  private isCurrentAppListReloadRequest(request: AppListReloadRequest): boolean {
      return isCurrentAppListReloadRequest.call(this, request);
  }

  private async applyReloadedAppListResult(
    request: AppListReloadRequest,
    result: Awaited<ReturnType<typeof refreshCfSyncSpace>>,
    credentials: { readonly email: string; readonly password: string },
    cfHomeDir: string
  ): Promise<void> {
      await applyReloadedAppListResult.call(this, request, result, credentials, cfHomeDir);
  }

  private async refreshTopologyForConfirmedScope(
    payload: ConfirmScopePayload
  ): Promise<void> {
      await refreshTopologyForConfirmedScope.call(this, payload);
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
      await applyRefreshedAppsForConfirmedScope.call(this, payload, refreshedApps, credentials);
  }

  private async handleTopologyOrgSelected(
    payload: TopologyOrgSelectedPayload
  ): Promise<void> {
      return handleTopologyOrgSelected.call(this, payload);
  }

  private async handleQuickScopeConfirm(
    payload: QuickScopeConfirmPayload
  ): Promise<void> {
      return handleQuickScopeConfirm.call(this, payload);
  }

  private async resolveQuickScopeOrgGuid(
    region: (typeof SAP_BTP_REGIONS)[number],
    orgName: string
  ): Promise<string> {
      return await resolveQuickScopeOrgGuid.call(this, region, orgName);
  }

  private async resolveQuickScopeSession(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string
  ): Promise<CfSession> {
      return await resolveQuickScopeSession.call(this, credentials, regionCode);
  }

  private async hydrateQuickConfirmedScope(
    payload: ConfirmScopePayload
  ): Promise<void> {
      await hydrateQuickConfirmedScope.call(this, payload);
  }

  private async resolveOrgGuidByName(
    regionId: string,
    orgName: string,
    isCurrentRequest: () => boolean = () => true
  ): Promise<string> {
      return await resolveOrgGuidByName.call(this, regionId, orgName, isCurrentRequest);
  }

  private async resolveCachedOrTestOrgGuid(
    regionId: string,
    regionCode: string,
    orgName: string,
    isCurrentRequest: () => boolean
  ): Promise<string | null> {
      return await resolveCachedOrTestOrgGuid.call(this, regionId, regionCode, orgName, isCurrentRequest);
  }

  private async resolveLiveOrgGuid(
    regionCode: string,
    orgName: string,
    isCurrentRequest: () => boolean
  ): Promise<string> {
      return await resolveLiveOrgGuid.call(this, regionCode, orgName, isCurrentRequest);
  }

  private async establishCurrentScopeResolutionSession(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string,
    isCurrentRequest: () => boolean
  ): Promise<CfSession | null> {
      return await establishCurrentScopeResolutionSession.call(this, credentials, regionCode, isCurrentRequest);
  }

  private async preloadRootFolderForPersistedScope(): Promise<void> {
      await preloadRootFolderForPersistedScope.call(this);
  }

  private preloadServiceFolderMappingsForPersistedScope(
    email: string,
    persistedScope: PersistedConfirmedScopeEntry,
    rootFolderPath: string
  ): void {
      preloadServiceFolderMappingsForPersistedScope.call(this, email, persistedScope, rootFolderPath);
  }

  private async restoreConfirmedScopeForCurrentUser(): Promise<void> {
      await restoreConfirmedScopeForCurrentUser.call(this);
  }

  private async hydrateRestoredScope(
    persistedScope: PersistedConfirmedScopeEntry
  ): Promise<void> {
      await hydrateRestoredScope.call(this, persistedScope);
  }

  private async persistConfirmedScopeForCurrentUser(
    payload: ConfirmScopePayload
  ): Promise<void> {
      await persistConfirmedScopeForCurrentUser.call(this, payload);
  }

  private readPersistedConfirmedScopeForEmail(email: string): PersistedConfirmedScopeEntry | null {
      return readPersistedConfirmedScopeForEmail.call(this, email);
  }

  private readConfirmedScopeMap(): Record<string, PersistedConfirmedScopeEntry> {
      return readConfirmedScopeMap.call(this);
  }

  private async handleSelectLocalRootFolder(): Promise<void> {
      return handleSelectLocalRootFolder.call(this);
  }

  private resolveE2eRootDialogOverride(): {
    readonly handled: boolean;
    readonly uri: vscode.Uri | undefined;
  } {
      return resolveE2eRootDialogOverride.call(this);
  }

  private async handleRefreshServiceFolderMappings(
    payload: RefreshServiceFolderMappingsPayload
  ): Promise<void> {
      return handleRefreshServiceFolderMappings.call(this, payload);
  }

  private handleSelectServiceFolderMapping(
    payload: SelectServiceFolderMappingPayload
  ): void {
      handleSelectServiceFolderMapping.call(this, payload);
  }

  private async refreshServiceFolderMappings(
    requestedAppNames: readonly string[] = []
  ): Promise<void> {
      await refreshServiceFolderMappings.call(this, requestedAppNames);
  }

  private async restoreRootFolderForLoadedSpace(
    payload: SpaceSelectionPayload
  ): Promise<void> {
      await restoreRootFolderForLoadedSpace.call(this, payload);
  }

  private async restoreRootFolderForLoadedSpaceUnsafe(
    payload: SpaceSelectionPayload
  ): Promise<void> {
      await restoreRootFolderForLoadedSpaceUnsafe.call(this, payload);
  }

  private async deleteMissingRootFolderCache(
    cacheScope: RootFolderCacheScope
  ): Promise<void> {
      await deleteMissingRootFolderCache.call(this, cacheScope);
  }

  private async persistRootFolderForCurrentScope(rootFolderPath: string): Promise<void> {
      await persistRootFolderForCurrentScope.call(this, rootFolderPath);
  }

  private async resolveCurrentRootFolderScope(): Promise<RootFolderCacheScope | null> {
      return await resolveCurrentRootFolderScope.call(this);
  }

  private async resolveRootFolderScopeForLoadedSpace(
    payload: SpaceSelectionPayload
  ): Promise<RootFolderCacheScope | null> {
      return await resolveRootFolderScopeForLoadedSpace.call(this, payload);
  }

  private isLoadedScope(orgGuid: string, spaceName: string): boolean {
      return isLoadedScope.call(this, orgGuid, spaceName);
  }

  private isHandledAppScope(orgGuid: string, spaceName: string): boolean {
      return isHandledAppScope.call(this, orgGuid, spaceName);
  }

  private clearRootFolderSelection(): void {
      clearRootFolderSelection.call(this);
  }

  private applyServiceFolderSelections(
    baseMappings: readonly ServiceFolderMapping[]
  ): ServiceFolderMapping[] {
      return applyServiceFolderSelections.call(this, baseMappings);
  }

  private async restoreServiceFolderMappingsForCurrentScope(): Promise<boolean> {
      return await restoreServiceFolderMappingsForCurrentScope.call(this);
  }

  private async persistServiceFolderMappingsForCurrentScope(
    mappings: readonly ServiceFolderMapping[]
  ): Promise<void> {
      await persistServiceFolderMappingsForCurrentScope.call(this, mappings);
  }

  private async resolveCurrentServiceMappingCacheScope(): Promise<{
    readonly scopeKey: string;
    readonly rootFolderPath: string;
  } | null> {
      return await resolveCurrentServiceMappingCacheScope.call(this);
  }

  private readServiceMappingCacheByScope(): Record<string, PersistedServiceMappingScopeEntry> {
      return readServiceMappingCacheByScope.call(this);
  }

  private async handleExportServiceArtifacts(
    payload: ExportServiceArtifactsPayload,
    options: {
      readonly includeDefaultEnv: boolean;
      readonly includePnpmLock: boolean;
    }
  ): Promise<void> {
      return handleExportServiceArtifacts.call(this, payload, options);
  }

  // ── Local package build + publish (Verdaccio) ────────────────────────────

  private async handleBuildPublishAll(targetPackageName?: string): Promise<void> {
      return handleBuildPublishAll.call(this, targetPackageName);
  }

  private async handleReplaceServicePackagePlaceholder(appId: string): Promise<void> {
      return handleReplaceServicePackagePlaceholder.call(this, appId);
  }

  private async resolveLocalPackageNamesForReplacement(
    config: LocalPackagesConfig
  ): Promise<string[]> {
      return await resolveLocalPackageNamesForReplacement.call(this, config);
  }

  async startLocalRegistry(): Promise<void> {
      await startLocalRegistry.call(this);
  }

  stopLocalRegistry(): void {
      stopLocalRegistry.call(this);
  }

  private async postRegistryState(): Promise<void> {
      await postRegistryState.call(this);
  }

  /**
   * Scans the selected root folder for locally-developed npm packages (by the
   * configured name regex), computes their build order, and pushes the list to the
   * webview as a separate "Detected packages" list, independent of the CF-app service
   * mapping list.
   */
  private async postDetectedLocalPackages(): Promise<void> {
      await postDetectedLocalPackages.call(this);
  }

  private async scanAndOrderLocalPackages(
    rootFolderPath: string,
    patterns: string
  ): Promise<{ name: string; version: string; hasBuildScript: boolean; round: number | null }[]> {
      return await scanAndOrderLocalPackages.call(this, rootFolderPath, patterns);
  }

  private postBuildResult(success: boolean, message: string): void {
      postBuildResult.call(this, success, message);
  }

  private async handleMicrosoftGraphToolRun(
    request: MicrosoftGraphToolRunRequest
  ): Promise<void> {
      return handleMicrosoftGraphToolRun.call(this, request);
  }

  private appendMicrosoftGraphToolProgress(
    progress: MicrosoftGraphToolStepProgress
  ): void {
      appendMicrosoftGraphToolProgress.call(this, progress);
  }

  private appendMicrosoftGraphToolLog(
    toolId: string,
    stepId: string,
    status: string,
    message: string
  ): void {
      appendMicrosoftGraphToolLog.call(this, toolId, stepId, status, message);
  }

  private async handleExportSqlToolsConfig(
    payload: ExportSqlToolsConfigPayload
  ): Promise<void> {
      return handleExportSqlToolsConfig.call(this, payload);
  }

  private resolveServiceFolderMapping(
    payload: {
      readonly appId: string;
      readonly appName: string;
    }
  ): ServiceFolderMapping | null {
      return resolveServiceFolderMapping.call(this, payload);
  }

  private async confirmSensitiveExport(options: {
    readonly appName: string;
    readonly exportType: 'artifacts' | 'sqltools';
  }): Promise<boolean> {
      return await confirmSensitiveExport.call(this, options);
  }

  // ── SQLTools integration ─────────────────────────────────────────────────

  private async handleOpenHanaSqlFile(payload: OpenHanaSqlFilePayload): Promise<void> {
      return handleOpenHanaSqlFile.call(this, payload);
  }

  private async handleOpenSqlBackupHistory(): Promise<void> {
      return handleOpenSqlBackupHistory.call(this);
  }

  private async publishHanaTablesForApp(
    appId: string,
    appName: string,
    session: CfLogSessionSeed | null,
    forceRefresh = false
  ): Promise<void> {
      await publishHanaTablesForApp.call(this, appId, appName, session, forceRefresh);
  }

  private async handleRefreshHanaTables(
    payload: RefreshHanaTablesPayload
  ): Promise<void> {
      return handleRefreshHanaTables.call(this, payload);
  }

  private async handleRunHanaTableSelect(payload: RunHanaTableSelectPayload): Promise<void> {
      return handleRunHanaTableSelect.call(this, payload);
  }

  private postHanaSqlFileOpenResult(
    requestId: number,
    serviceId: string,
    success: boolean,
    message: string
  ): void {
      postHanaSqlFileOpenResult.call(this, requestId, serviceId, success, message);
  }

  private postHanaTableSelectResult(
    serviceId: string,
    tableName: string,
    success: boolean,
    message: string
  ): void {
      postHanaTableSelectResult.call(this, serviceId, tableName, success, message);
  }

  private async handleOpenSqlToolsExtension(): Promise<void> {
      return handleOpenSqlToolsExtension.call(this);
  }

  // ── Login / logout ───────────────────────────────────────────────────────

  private async handleLoginSubmit(email: string, password: string): Promise<void> {
      return handleLoginSubmit.call(this, email, password);
  }

  private async handleLogout(): Promise<void> {
      return handleLogout.call(this);
  }

  private reloadToMainView(): void {
      reloadToMainView.call(this);
  }

  private reloadToLoginView(): void {
      reloadToLoginView.call(this);
  }

  // ── Region selected → fetch orgs ─────────────────────────────────────────

  private async handleRegionSelected(region: RegionSelectionPayload): Promise<void> {
      return handleRegionSelected.call(this, region);
  }

  // ── Org selected → fetch spaces ──────────────────────────────────────────

  private async handleOrgSelected(org: OrgSelectionPayload): Promise<void> {
      return handleOrgSelected.call(this, org);
  }

  // ── Space selected → fetch apps ───────────────────────────────────────────

  private async handleSpaceSelected(payload: SpaceSelectionPayload): Promise<void> {
      return handleSpaceSelected.call(this, payload);
  }

  private async handleTestModeSpaceSelection(payload: SpaceSelectionPayload): Promise<void> {
      return handleTestModeSpaceSelection.call(this, payload);
  }

  // ── Session helpers ───────────────────────────────────────────────────────

  private async ensureRegionSession(
    credentials: { readonly email: string; readonly password: string }
  ): Promise<CfSession> {
      return await ensureRegionSession.call(this, credentials);
  }

  private async establishRegionSession(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string,
    requestId: number
  ): Promise<void> {
      await establishRegionSession.call(this, credentials, regionCode, requestId);
  }

  private async refreshOrgsFromLiveAfterCachedRender(
    credentials: { readonly email: string; readonly password: string },
    regionCode: string,
    requestId: number,
    cachedOrgs: readonly { readonly guid: string; readonly name: string }[]
  ): Promise<void> {
      await refreshOrgsFromLiveAfterCachedRender.call(this, credentials, regionCode, requestId, cachedOrgs);
  }

  private async postAppsLoaded(
    apps: SidebarAppEntry[],
    payload: SpaceSelectionPayload,
    credentials: { readonly email: string; readonly password: string },
    cfHomeDir: string,
    regionCode: string
  ): Promise<void> {
      await postAppsLoaded.call(this, apps, payload, credentials, cfHomeDir, regionCode);
  }

  private updateCfLogsForLoadedApps(
    apps: SidebarAppEntry[],
    payload: SpaceSelectionPayload,
    credentials: { readonly email: string; readonly password: string },
    cfHomeDir: string,
    regionCode: string
  ): void {
      updateCfLogsForLoadedApps.call(this, apps, payload, credentials, cfHomeDir, regionCode);
  }

  private postOrgsError(message: string): void {
      postOrgsError.call(this, message);
  }

  private postSpacesError(message: string): void {
      postSpacesError.call(this, message);
  }

  private postAppsError(message: string, failedScope?: LoadedScopeState): void {
      postAppsError.call(this, message, failedScope);
  }

  private postAppsReloadError(message: string): void {
      postAppsReloadError.call(this, message);
  }

  private bumpRegionSelectionRequestId(): number {
      return bumpRegionSelectionRequestId.call(this);
  }

  private bumpOrgSelectionRequestId(): number {
      return bumpOrgSelectionRequestId.call(this);
  }

  private bumpSpaceSelectionRequestId(): number {
      return bumpSpaceSelectionRequestId.call(this);
  }

  private bumpExternalScopeChangeRequestId(): number {
      return bumpExternalScopeChangeRequestId.call(this);
  }

  private isCurrentRegionRequest(requestId: number): boolean {
      return isCurrentRegionRequest.call(this, requestId);
  }

  private isCurrentOrgRequest(requestId: number): boolean {
      return isCurrentOrgRequest.call(this, requestId);
  }

  private isCurrentSpaceRequest(requestId: number): boolean {
      return isCurrentSpaceRequest.call(this, requestId);
  }

  private isCurrentExternalScopeRequest(requestId: number): boolean {
      return isCurrentExternalScopeRequest.call(this, requestId);
  }

  // ── Region logging ───────────────────────────────────────────────────────

  private logRegionSelection(region: RegionSelectionPayload): void {
      logRegionSelection.call(this, region);
  }


private sendSshProxyStatus(): void {
    sendSshProxyStatus.call(this);
}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleSaveSshProxySettings(payload: any): Promise<void> {
      return handleSaveSshProxySettings.call(this, payload);
  }

  private async handleClearSshProxySettings(): Promise<void> {
      return handleClearSshProxySettings.call(this);
  }

  private logWebviewMessageFailure(context: string, error: unknown): void {
      logWebviewMessageFailure.call(this, context, error);
  }

  // ── postMessage helpers ──────────────────────────────────────────────────

  private postMessage(message: Record<string, unknown>): void {
      postMessage.call(this, message);
  }

  private postCacheState(snapshot: CacheRuntimeSnapshot): void {
      postCacheState.call(this, snapshot);
  }

  // ── HTML builders ────────────────────────────────────────────────────────
}
