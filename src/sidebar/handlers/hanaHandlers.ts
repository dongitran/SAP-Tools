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


export async function publishHanaTablesForApp(this: any, appId: string, appName: string, session: CfLogSessionSeed | null, forceRefresh = false): Promise<void> {
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

export function postHanaSqlFileOpenResult(this: any, requestId: number, serviceId: string, success: boolean, message: string): void {
this.postMessage({
  type: MSG_HANA_SQL_FILE_OPEN_RESULT,
  requestId,
  serviceId,
  success,
  message,
});
}

export function postHanaTableSelectResult(this: any, serviceId: string, tableName: string, success: boolean, message: string): void {
this.postMessage({
  type: MSG_HANA_TABLE_SELECT_RESULT,
  serviceId,
  tableName,
  success,
  message,
});
}