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


export function handleSelectServiceFolderMapping(this: any, payload: SelectServiceFolderMappingPayload): void {
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

export async function refreshServiceFolderMappings(this: any, requestedAppNames: readonly string[] = []): Promise<void> {
// Scan for local npm packages independently of the CF-app service mapping below.
void this.postDetectedLocalPackages();

if (this.selectedLocalRootFolderPath.length === 0) {
  this.postMessage({
    type: MSG_SERVICE_FOLDER_MAPPINGS_ERROR,
    message: 'Select a local root folder before scanning service mappings.',
  });
  return;
}

const appNames =
  this.currentApps.length > 0
    ? this.currentApps.map((app) => app.name)
    : requestedAppNames;

if (appNames.length === 0) {
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
    appNames,
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

export async function restoreRootFolderForLoadedSpace(this: any, payload: SpaceSelectionPayload): Promise<void> {
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

export async function restoreRootFolderForLoadedSpaceUnsafe(this: any, payload: SpaceSelectionPayload): Promise<void> {
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

export async function deleteMissingRootFolderCache(this: any, cacheScope: RootFolderCacheScope): Promise<void> {
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

export function clearRootFolderSelection(this: any): void {
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

export function resolveServiceFolderMapping(this: any, payload: {
      readonly appId: string;
      readonly appName: string;
    }): ServiceFolderMapping | null {
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