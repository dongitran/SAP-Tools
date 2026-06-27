/* eslint-disable */
// @ts-nocheck

import * as vscode from 'vscode';
import { CacheRuntimeSnapshot } from '../../cacheSyncService';
import {
    runMicrosoftGraphTool,
    sanitizeGraphMessage,
    type MicrosoftGraphToolRunRequest,
    type MicrosoftGraphToolStepProgress
} from '../../microsoftGraphTools';
import { exportServiceArtifacts, formatServiceArtifactExportCompletionMessage, type ServiceExportSession } from "../../serviceArtifactExporter";
import {
    type ServiceFolderMapping
} from '../../serviceFolderMapping';
import { readSharedRemoteRoot } from '../../sharedDebugConfig';
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    sanitizeErrorForLog,
    sanitizeForLog,
    shouldSkipSensitiveExportConfirmation
} from '../../sidebarProvider.helpers';
import {
    CacheStatePayload,
    ExportServiceArtifactsPayload,
    ExportSqlToolsConfigPayload,
    MSG_APIS_EXPLORER_SETTLED,
    MSG_BUILD_PUBLISH_RESULT,
    MSG_CACHE_STATE,
    MSG_EXPORT_ARTIFACT_PROGRESS, MSG_EXPORT_ARTIFACT_RESULT, MSG_EXPORT_SQLTOOLS_PROGRESS, MSG_EXPORT_SQLTOOLS_RESULT,
    MSG_MICROSOFT_GRAPH_TOOL_PROGRESS, MSG_MICROSOFT_GRAPH_TOOL_RESULT,
    RegionSelectionPayload
} from '../../sidebarProvider.types';
import { exportSqlToolsConfig } from "../../sqlToolsConfigExporter";

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

export async function handleOpenApisExplorer(this: RegionSidebarProvider, appId: string): Promise<void> {
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

export async function handleExportServiceArtifacts(this: RegionSidebarProvider, payload: ExportServiceArtifactsPayload, options: {
      readonly includeDefaultEnv: boolean;
      readonly includePnpmLock: boolean;
    }): Promise<void> {
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

export async function handleMicrosoftGraphToolRun(this: RegionSidebarProvider, request: MicrosoftGraphToolRunRequest): Promise<void> {
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

export async function handleExportSqlToolsConfig(this: RegionSidebarProvider, payload: ExportSqlToolsConfigPayload): Promise<void> {
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
