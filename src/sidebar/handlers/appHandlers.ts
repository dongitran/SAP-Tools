/* eslint-disable */
// @ts-nocheck

import * as vscode from 'vscode';
import type { ApisExplorerPanelManager, ApisExplorerPanelSession } from '../../apisExplorerPanel';
import { normalizeUserEmail, type CacheStore } from '../../cacheStore';
import type { CacheRuntimeSnapshot, CacheSyncService } from '../../cacheSyncService';
import type { CfSession } from '../../cfClient';
import {
    cfLogin,
    fetchCfLoginInfo,
    fetchOrgs,
    getCfApiEndpoint,
    isCfSessionExpired
} from '../../cfClient';
import { ensureCfHomeDir } from '../../cfHome';
import type { CfLogsPanelProvider } from '../../cfLogsPanel';
import { refreshCfSyncSpace } from '../../cfSpaceRefresh';
import {
    EMPTY_CF_TOPOLOGY,
    getCfTopologySnapshot,
    getCfTopologySnapshotSync,
    type CfTopology
} from '../../cfTopology';
import { getEffectiveCredentials } from '../../credentialStore';
import type { HanaSqlBackupStore } from '../../hanaSqlBackupStore';
import type { HanaSqlHistoryPanelManager } from '../../hanaSqlHistoryPanel';
import type { HanaSqlWorkbench } from '../../hanaSqlWorkbench';
import { buildDependencyOrder } from '../../localPackages/dependencyGraph';
import { scanLocalPackages } from '../../localPackages/localPackageScanner';
import {
    readLocalPackagesConfig,
    type LocalPackagesConfig,
} from '../../localPackages/localPackagesConfig';
import { VerdaccioManager } from '../../localPackages/verdaccioManager';
import {
    readMicrosoftGraphToolRunRequest,
    sanitizeGraphMessage,
    type MicrosoftGraphToolRunRequest,
    type MicrosoftGraphToolStepProgress
} from '../../microsoftGraphTools';
import { SAP_BTP_REGIONS, toHyphenatedRegionCode } from '../../regions';
import { type SharedCfScope } from '../../scopeSync';
import {
    buildServiceFolderMappings,
    type ServiceFolderMapping,
} from '../../serviceFolderMapping';
import { readSharedAppFolderMappings } from '../../sharedDebugConfig';
import {
    resolveMockCfTopology,
    resolveMockOrgsForRegion
} from '../../testModeData';
import { buildLoginGateHtml, buildMainHtml } from '../../sidebarProvider.html';
import type {
    AppListReloadRequest,
    CacheStatePayload,
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
} from '../../sidebarProvider.types';
import {
    MSG_ACTIVE_APPS_CHANGED,
    MSG_APPS_ERROR,
    MSG_APPS_LOADED,
    MSG_APPS_RELOAD_ERROR,
    MSG_BUILD_PUBLISH_ALL,
    MSG_BUILD_PUBLISH_RESULT,
    MSG_BUILD_SINGLE_PACKAGE,
    MSG_CACHE_STATE,
    MSG_CF_TOPOLOGY,
    MSG_CLEAR_SSH_PROXY_SETTINGS,
    MSG_CONFIRM_SCOPE,
    MSG_EVENT_MESH_VIEWER_SETTLED,
    MSG_EXPORT_SERVICE_ARTIFACTS,
    MSG_EXPORT_SQLTOOLS_CONFIG,
    MSG_GET_SSH_PROXY_STATUS,
    MSG_HANA_SQL_FILE_OPEN_RESULT,
    MSG_HANA_TABLE_SELECT_RESULT,
    MSG_HANA_TABLES_LOADED,
    MSG_HANA_TUNNEL_STATE,
    MSG_LOCAL_PACKAGES_LOADED,
    MSG_LOCAL_PACKAGES_LOADING,
    MSG_LOCAL_REGISTRY_START,
    MSG_LOCAL_REGISTRY_STATE,
    MSG_LOCAL_REGISTRY_STATUS,
    MSG_LOCAL_REGISTRY_STOP,
    MSG_LOCAL_ROOT_FOLDER_UPDATED,
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
    MSG_ORGS_ERROR,
    MSG_ORGS_LOADED,
    MSG_PAUSED_APPS_CHANGED,
    MSG_QUICK_SCOPE_CONFIRM,
    MSG_REFRESH_HANA_TABLES,
    MSG_REFRESH_SERVICE_FOLDER_MAPPINGS,
    MSG_REGION_SELECTED,
    MSG_RELOAD_APP_LIST,
    MSG_REPLACE_SERVICE_PACKAGE_PLACEHOLDER,
    MSG_REQUEST_CF_TOPOLOGY,
    MSG_REQUEST_INITIAL_STATE,
    MSG_RESTORE_CONFIRMED_SCOPE,
    MSG_RUN_HANA_TABLE_SELECT,
    MSG_RUN_MICROSOFT_GRAPH_TOOL,
    MSG_SAVE_SSH_PROXY_SETTINGS,
    MSG_SELECT_LOCAL_ROOT_FOLDER,
    MSG_SELECT_SERVICE_FOLDER_MAPPING,
    MSG_SERVICE_FOLDER_MAPPINGS_ERROR,
    MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
    MSG_SPACE_SELECTED,
    MSG_SPACES_ERROR,
    MSG_SSH_PROXY_STATUS,
    MSG_SYNC_NOW,
    MSG_TOPOLOGY_ORG_SELECTED,
    MSG_UPDATE_SYNC_INTERVAL
} from '../../sidebarProvider.types';
import { handleBuildPublishAll, handleClearSshProxySettings, handleConfirmScope, handleExportServiceArtifacts, handleExportSqlToolsConfig, handleExternalScopeChange, handleLoginSubmit, handleLogout, handleMicrosoftGraphToolRun, handleOpenApisExplorer, handleOpenHanaSqlFile, handleOpenSqlBackupHistory, handleOpenSqlToolsExtension, handleOrgSelected, handleQuickScopeConfirm, handleRefreshHanaTables, handleRefreshServiceFolderMappings, handleRegionSelected, handleReloadAppList, handleReplaceServicePackagePlaceholder, handleRequestInitialState, handleRunHanaTableSelect, handleSaveSshProxySettings, handleSelectLocalRootFolder, handleSpaceSelected, handleTestModeSpaceSelection, handleTopologyOrgSelected } from "../../sidebar/handlers/sidebarHandlers";
import {
    appListsEqual,
    areLocalPackageListsEqual,
    areRegionCodesEquivalent,
    areReloadScopesEqual,
    areSharedScopesEqual,
    buildLocalPackagesCacheKey,
    buildScopeLabel,
    buildServiceMappingsScopeKey,
    buildSharedScopeFromConfirmPayload,
    createNonce,
    formatAppListReloadFailure,
    haveSameOrgEntries,
    isActiveAppsChangedMessage,
    isConfirmScopeMessage,
    isExportServiceArtifactsMessage,
    isExportSqlToolsConfigMessage,
    isLoadedScopeForConfirmedScope,
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
    isTestMode,
    isTopologyOrgSelectedMessage,
    isUpdateSyncIntervalMessage,
    normalizePersistedServiceMappingsByScope,
    normalizeServiceMappingForPersistence,
    pathExists,
    readActiveAppsChangedPayload,
    readConfirmScopePayload,
    readExportServiceArtifactsPayload,
    readExportSqlToolsConfigPayload,
    readLoginSubmitPayload,
    readOpenHanaSqlFilePayload,
    readOptionalString,
    readOrgSelectionPayload,
    readQuickScopeConfirmPayload,
    readRefreshHanaTablesPayload,
    readRefreshServiceFolderMappingsPayload,
    readRegionSelectionPayload,
    readRunHanaTableSelectPayload,
    readSelectServiceFolderMappingPayload,
    readSpaceSelectionPayload,
    readTopologyOrgSelectedPayload,
    readUpdateSyncIntervalPayload,
    sanitizeErrorForLog,
    sanitizeForLog,
    sanitizeSqlUiLogValue,
    shouldSkipSensitiveExportConfirmation
} from '../../sidebarProvider.helpers';

const CONFIRMED_SCOPE_BY_EMAIL_GLOBAL_STATE_KEY = 'sapTools.confirmedScopeByEmail.v1';
const SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY = 'sapTools.serviceMappingsByScope.v1';


export function createAppListReloadRequest(this: any): AppListReloadRequest | null {
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

export function isCurrentAppListReloadRequest(this: any, request: AppListReloadRequest): boolean {
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

export async function applyReloadedAppListResult(this: any, request: AppListReloadRequest, result: Awaited<ReturnType<typeof refreshCfSyncSpace>>, credentials: { readonly email: string; readonly password: string }, cfHomeDir: string): Promise<void> {
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

export async function postAppsLoaded(this: any, apps: SidebarAppEntry[], payload: SpaceSelectionPayload, credentials: { readonly email: string; readonly password: string }, cfHomeDir: string, regionCode: string): Promise<void> {
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

export function updateCfLogsForLoadedApps(this: any, apps: SidebarAppEntry[], payload: SpaceSelectionPayload, credentials: { readonly email: string; readonly password: string }, cfHomeDir: string, regionCode: string): void {
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

export function postAppsError(this: any, message: string): void {
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

export function postAppsReloadError(this: any, message: string): void {
this.outputChannel.appendLine(
  `[apps] Reload failed: ${sanitizeErrorForLog(message)}`
);
this.postMessage({ type: MSG_APPS_RELOAD_ERROR, message });
}