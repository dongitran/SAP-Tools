/* eslint-disable */
// @ts-nocheck

import { normalizeUserEmail } from '../../cacheStore';
import { cfLogin, CfSession, fetchCfLoginInfo, fetchOrgs, fetchSpaces, getCfApiEndpoint, isCfSessionExpired } from '../../cfClient';
import { ensureCfHomeDir } from '../../cfHome';
import { refreshCfSyncSpace } from '../../cfSpaceRefresh';
import {
    getAppsFromTopologySync
} from '../../cfTopology';
import { getEffectiveCredentials } from '../../credentialStore';
import { SAP_BTP_REGIONS, toHyphenatedRegionCode } from '../../regions';
import { writeScopeIfChanged, type SharedCfScope } from '../../scopeSync';
import {
    type ServiceFolderMapping
} from '../../serviceFolderMapping';
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    appListsEqual,
    areSharedScopesEqual,
    buildScopeLabel,
    buildServiceMappingsScopeKey,
    buildSharedScopeFromConfirmPayload,
    isRecord,
    isTestMode,
    normalizePersistedServiceMappingsByScope,
    normalizeServiceMappingForPersistence,
    pathExists,
    readOptionalString,
    resolveE2eTestModeAppsDelayMs,
    sanitizeErrorForLog,
    sanitizeForLog,
    sleep
} from '../../sidebarProvider.helpers';
import {
    ConfirmScopeOptions,
    ConfirmScopePayload,
    MSG_APPS_LOADED,
    MSG_ORGS_LOADED,
    MSG_RESTORE_CONFIRMED_SCOPE,
    MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
    MSG_SPACES_LOADED,
    OrgSelectionPayload,
    PersistedConfirmedScopeEntry,
    PersistedServiceMappingScopeEntry,
    QuickScopeConfirmPayload,
    RegionSelectionPayload,
    RootFolderCacheScope,
    SidebarAppEntry,
    SpaceSelectionPayload
} from '../../sidebarProvider.types';
import {
    resolveMockApps,
    resolveMockOrgsForRegion,
    resolveMockSpacesForOrg
} from '../../testModeData';

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

export async function handleConfirmScope(this: RegionSidebarProvider, payload: ConfirmScopePayload, options: ConfirmScopeOptions = {}): Promise<void> {
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

export async function handleExternalScopeChange(this: RegionSidebarProvider, scope: SharedCfScope): Promise<void> {
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

export async function handleQuickScopeConfirm(this: RegionSidebarProvider, payload: QuickScopeConfirmPayload): Promise<void> {
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

export async function handleRegionSelected(this: RegionSidebarProvider, region: RegionSelectionPayload): Promise<void> {
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

export async function handleOrgSelected(this: RegionSidebarProvider, org: OrgSelectionPayload): Promise<void> {
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

export async function handleSpaceSelected(this: RegionSidebarProvider, payload: SpaceSelectionPayload): Promise<void> {
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
    const previousSeed = this.currentLogSessionSeed;
    const spaceChanged = previousSeed?.apiEndpoint !== apiEndpoint ||
          previousSeed.orgName !== payload.orgName ||
          previousSeed.spaceName !== payload.spaceName;
    if (spaceChanged) {
      this.hanaSqlWorkbench.invalidateAllAppContexts();
    }

    const topologyApps = getAppsFromTopologySync(apiEndpoint, payload.orgName, payload.spaceName);
    const cachedApps = topologyApps === null
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

    const immediateApps: SidebarAppEntry[] | null = topologyApps ??
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

export async function handleTestModeSpaceSelection(this: RegionSidebarProvider, payload: SpaceSelectionPayload): Promise<void> {
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
