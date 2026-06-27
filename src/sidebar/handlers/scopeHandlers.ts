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


export async function restoreExternalScope(this: any, scope: SharedCfScope, requestId = this.externalScopeChangeRequestId): Promise<void> {
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

export function clearScopeBoundRuntimeStateForScopeChange(this: any): void {
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

export async function refreshTopologyForConfirmedScope(this: any, payload: ConfirmScopePayload): Promise<void> {
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

export async function applyRefreshedAppsForConfirmedScope(this: any, payload: ConfirmScopePayload, refreshedApps: readonly SidebarAppEntry[], credentials: { readonly email: string; readonly password: string }): Promise<void> {
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

export async function resolveQuickScopeOrgGuid(this: any, region: (typeof SAP_BTP_REGIONS)[number], orgName: string): Promise<string> {
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

export async function resolveQuickScopeSession(this: any, credentials: { readonly email: string; readonly password: string }, regionCode: string): Promise<CfSession> {
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

export async function hydrateQuickConfirmedScope(this: any, payload: ConfirmScopePayload): Promise<void> {
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

export async function resolveOrgGuidByName(this: any, regionId: string, orgName: string, isCurrentRequest: () => boolean = () => true): Promise<string> {
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

export async function resolveCachedOrTestOrgGuid(this: any, regionId: string, regionCode: string, orgName: string, isCurrentRequest: () => boolean): Promise<string | null> {
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

export async function resolveLiveOrgGuid(this: any, regionCode: string, orgName: string, isCurrentRequest: () => boolean): Promise<string> {
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

export async function establishCurrentScopeResolutionSession(this: any, credentials: { readonly email: string; readonly password: string }, regionCode: string, isCurrentRequest: () => boolean): Promise<CfSession | null> {
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

export async function preloadRootFolderForPersistedScope(this: any): Promise<void> {
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
this.preloadServiceFolderMappingsForPersistedScope(
  credentials.email,
  persistedScope,
  cachedEntry.rootFolderPath
);
}

export function preloadServiceFolderMappingsForPersistedScope(this: any, email: string, persistedScope: PersistedConfirmedScopeEntry, rootFolderPath: string): void {
const scopeKey = buildServiceMappingsScopeKey(
  email,
  persistedScope.regionCode,
  persistedScope.orgGuid,
  persistedScope.spaceName,
  rootFolderPath
);
if (scopeKey.length === 0) {
  return;
}

const cachedEntry = this.readServiceMappingCacheByScope()[scopeKey];
if (cachedEntry === undefined || cachedEntry.mappings.length === 0) {
  return;
}

this.serviceFolderSelections.clear();
for (const mapping of cachedEntry.mappings) {
  if (
    mapping.hasConflict &&
    mapping.folderPath.length > 0 &&
    mapping.candidateFolderPaths.includes(mapping.folderPath)
  ) {
    this.serviceFolderSelections.set(mapping.appId, mapping.folderPath);
  }
}
this.serviceFolderMappings = this.applyServiceFolderSelections(cachedEntry.mappings);
}

export async function restoreConfirmedScopeForCurrentUser(this: any): Promise<void> {
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

export async function hydrateRestoredScope(this: any, persistedScope: PersistedConfirmedScopeEntry): Promise<void> {
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

export async function persistConfirmedScopeForCurrentUser(this: any, payload: ConfirmScopePayload): Promise<void> {
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

export function readPersistedConfirmedScopeForEmail(this: any, email: string): PersistedConfirmedScopeEntry | null {
const emailKey = normalizeUserEmail(email);
if (emailKey.length === 0) {
  return null;
}

const confirmedScopeByEmail = this.readConfirmedScopeMap();
const entry = confirmedScopeByEmail[emailKey];
return entry ?? null;
}

export function readConfirmedScopeMap(this: any): Record<string, PersistedConfirmedScopeEntry> {
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

export async function persistRootFolderForCurrentScope(this: any, rootFolderPath: string): Promise<void> {
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

export async function resolveCurrentRootFolderScope(this: any): Promise<RootFolderCacheScope | null> {
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

export async function resolveRootFolderScopeForLoadedSpace(this: any, payload: SpaceSelectionPayload): Promise<RootFolderCacheScope | null> {
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

export function isLoadedScope(this: any, orgGuid: string, spaceName: string): boolean {
return (
  this.lastLoadedScope?.orgGuid === orgGuid &&
  this.lastLoadedScope.spaceName === spaceName
);
}

export async function restoreServiceFolderMappingsForCurrentScope(this: any): Promise<boolean> {
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

export async function persistServiceFolderMappingsForCurrentScope(this: any, mappings: readonly ServiceFolderMapping[]): Promise<void> {
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

export async function resolveCurrentServiceMappingCacheScope(this: any): Promise<{
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

export function readServiceMappingCacheByScope(this: any): Record<string, PersistedServiceMappingScopeEntry> {
const rawValue = this.context.globalState.get<unknown>(
  SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY
);
return normalizePersistedServiceMappingsByScope(rawValue);
}

export function bumpExternalScopeChangeRequestId(this: any): number {
this.externalScopeChangeRequestId += 1;
return this.externalScopeChangeRequestId;
}

export function isCurrentExternalScopeRequest(this: any, requestId: number): boolean {
return requestId === this.externalScopeChangeRequestId;
}