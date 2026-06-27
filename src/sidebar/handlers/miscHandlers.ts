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


export function resolveE2eRootDialogOverride(this: any): {
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

export function applyServiceFolderSelections(this: any, baseMappings: readonly ServiceFolderMapping[]): ServiceFolderMapping[] {
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

export function postBuildResult(this: any, success: boolean, message: string): void {
this.postMessage({ type: MSG_BUILD_PUBLISH_RESULT, success, message });
}

export function appendMicrosoftGraphToolProgress(this: any, progress: MicrosoftGraphToolStepProgress): void {
this.appendMicrosoftGraphToolLog(
  progress.toolId,
  progress.stepId,
  progress.status,
  progress.message
);
}

export function appendMicrosoftGraphToolLog(this: any, toolId: string, stepId: string, status: string, message: string): void {
this.microsoftGraphChannel.appendLine(
  `[${new Date().toISOString()}] ${toolId} ${stepId} ${status}: ` +
    sanitizeGraphMessage(message)
);
}

export async function confirmSensitiveExport(this: any, options: {
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

export function bumpRegionSelectionRequestId(this: any): number {
this.regionSelectionRequestId += 1;
this.orgSelectionRequestId += 1;
this.spaceSelectionRequestId += 1;
return this.regionSelectionRequestId;
}

export function bumpOrgSelectionRequestId(this: any): number {
this.orgSelectionRequestId += 1;
this.spaceSelectionRequestId += 1;
return this.orgSelectionRequestId;
}

export function bumpSpaceSelectionRequestId(this: any): number {
this.spaceSelectionRequestId += 1;
return this.spaceSelectionRequestId;
}

export function isCurrentRegionRequest(this: any, requestId: number): boolean {
return requestId === this.regionSelectionRequestId;
}

export function isCurrentOrgRequest(this: any, requestId: number): boolean {
return requestId === this.orgSelectionRequestId;
}

export function isCurrentSpaceRequest(this: any, requestId: number): boolean {
return requestId === this.spaceSelectionRequestId;
}

export function logRegionSelection(this: any, region: RegionSelectionPayload): void {
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

export function logWebviewMessageFailure(this: any, context: string, error: unknown): void {
const errorMessage =
  error instanceof Error ? error.message : 'Unexpected webview message failure.';
this.outputChannel.appendLine(
  `[webview] ${sanitizeForLog(context)} failed: ${sanitizeErrorForLog(errorMessage)}`
);
}

export function postMessage(this: any, message: Record<string, unknown>): void {
void this.webviewView?.webview.postMessage(message);
}

export function postCacheState(this: any, snapshot: CacheRuntimeSnapshot): void {
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