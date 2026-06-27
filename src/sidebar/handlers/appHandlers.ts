/* eslint-disable */
// @ts-nocheck

import { getCfApiEndpoint } from '../../cfClient';
import { ensureCfHomeDir } from '../../cfHome';
import { refreshCfSyncSpace } from '../../cfSpaceRefresh';
import { getEffectiveCredentials } from '../../credentialStore';
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    areRegionCodesEquivalent,
    areReloadScopesEqual,
    buildScopeLabel,
    formatAppListReloadFailure,
    isLoadedScopeForConfirmedScope,
    sanitizeErrorForLog,
    sanitizeForLog
} from '../../sidebarProvider.helpers';
import {
    AppListReloadRequest,
    CfLogSessionSeed,
    MSG_APPS_ERROR,
    MSG_APPS_LOADED,
    MSG_APPS_RELOAD_ERROR,
    MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
    SidebarAppEntry,
    SpaceSelectionPayload
} from '../../sidebarProvider.types';

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

export async function handleReloadAppList(this: RegionSidebarProvider): Promise<void> {
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
