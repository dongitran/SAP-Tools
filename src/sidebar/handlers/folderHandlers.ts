/* eslint-disable */
// @ts-nocheck

import * as vscode from 'vscode';
import {
    buildServiceFolderMappings,
    type ServiceFolderMapping,
} from '../../serviceFolderMapping';
import { readSharedAppFolderMappings } from '../../sharedDebugConfig';
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    pathExists,
    sanitizeErrorForLog,
    sanitizeForLog
} from '../../sidebarProvider.helpers';
import {
    MSG_LOCAL_ROOT_FOLDER_UPDATED,
    MSG_SERVICE_FOLDER_MAPPINGS_ERROR,
    MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
    RefreshServiceFolderMappingsPayload,
    RootFolderCacheScope,
    SelectServiceFolderMappingPayload,
    SpaceSelectionPayload
} from '../../sidebarProvider.types';

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

export async function handleSelectLocalRootFolder(this: RegionSidebarProvider): Promise<void> {
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

export async function handleRefreshServiceFolderMappings(this: RegionSidebarProvider, payload: RefreshServiceFolderMappingsPayload): Promise<void> {
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

    await this.refreshServiceFolderMappings(payload.appNames);
}
