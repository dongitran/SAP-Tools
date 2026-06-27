/* eslint-disable */
// @ts-nocheck

import * as vscode from 'vscode';
import { ApisExplorerPanelSession } from '../../apisExplorerPanel';
import { cfLogin, CfSession, fetchCfLoginInfo, fetchOrgs, getCfApiEndpoint, isCfSessionExpired } from '../../cfClient';
import { ensureCfHomeDir } from '../../cfHome';
import { clearCredentials, getEffectiveCredentials, storeCredentials } from '../../credentialStore';
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    createNonce,
    haveSameOrgEntries,
    sanitizeSqlUiLogValue
} from '../../sidebarProvider.helpers';
import { buildLoginGateHtml, buildMainHtml } from '../../sidebarProvider.html';
import {
    LogoutResultPayload,
    MSG_LOCAL_ROOT_FOLDER_UPDATED,
    MSG_LOGIN_RESULT,
    MSG_LOGOUT_RESULT,
    MSG_ORGS_ERROR,
    MSG_ORGS_LOADED,
    MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
    MSG_SPACES_ERROR,
    MSG_SSH_PROXY_STATUS
} from '../../sidebarProvider.types';

const CONFIRMED_SCOPE_BY_EMAIL_GLOBAL_STATE_KEY = 'sapTools.confirmedScopeByEmail.v1';
const SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY = 'sapTools.serviceMappingsByScope.v1';


export async function openApisExplorerSession(this: any, appId: string): Promise<ApisExplorerPanelSession> {
const confirmedScope = this.currentConfirmedScope;
if (confirmedScope === undefined) {
  return this.apisExplorerPanelManager.openApisExplorer(appId);
}

const credentials = await getEffectiveCredentials(this.context);
if (credentials === null) {
  return this.apisExplorerPanelManager.openApisExplorer(appId);
}

const cfHomeDir = await ensureCfHomeDir(this.context);
return this.apisExplorerPanelManager.openApisExplorer(appId, {
  apiEndpoint: getCfApiEndpoint(confirmedScope.regionCode),
  email: credentials.email,
  password: credentials.password,
  orgName: confirmedScope.orgName,
  spaceName: confirmedScope.spaceName,
  cfHomeDir,
});
}

export function reloadToMainView(this: any): void {
if (this.webviewView === undefined) {
  return;
}

const assetsRoot = vscode.Uri.joinPath(
  this.extensionUri,
  'docs',
  'designs',
  'prototypes',
  'assets'
);
const nonce = createNonce();
this.webviewView.webview.html = buildMainHtml(
  this.webviewView.webview,
  nonce,
  assetsRoot
);
}

export function reloadToLoginView(this: any): void {
if (this.webviewView === undefined) {
  return;
}

const assetsRoot = vscode.Uri.joinPath(
  this.extensionUri,
  'docs',
  'designs',
  'prototypes',
  'assets'
);
const nonce = createNonce();
this.webviewView.webview.html = buildLoginGateHtml(
  this.webviewView.webview,
  nonce,
  assetsRoot
);
}

export async function ensureRegionSession(this: any, credentials: { readonly email: string; readonly password: string }): Promise<CfSession> {
if (
  this.cfSession !== null &&
  this.cfSessionRegionCode.length > 0 &&
  this.cfSessionRegionCode === this.selectedRegionCode &&
  !isCfSessionExpired(this.cfSession)
) {
  return this.cfSession;
}

const regionCode = this.selectedRegionCode;
if (regionCode.length === 0) {
  throw new Error('CF session expired. Please select a region again.');
}

const apiEndpoint = getCfApiEndpoint(regionCode);
const loginInfo = await fetchCfLoginInfo(apiEndpoint);
const token = await cfLogin(
  loginInfo.authorizationEndpoint,
  credentials.email,
  credentials.password
);
this.cfSession = { token, apiEndpoint };
this.cfSessionRegionCode = regionCode;
return this.cfSession;
}

export async function establishRegionSession(this: any, credentials: { readonly email: string; readonly password: string }, regionCode: string, requestId: number): Promise<void> {
const apiEndpoint = getCfApiEndpoint(regionCode);
const loginInfo = await fetchCfLoginInfo(apiEndpoint);
const token = await cfLogin(
  loginInfo.authorizationEndpoint,
  credentials.email,
  credentials.password
);
if (!this.isCurrentRegionRequest(requestId) || this.selectedRegionCode !== regionCode) {
  return;
}
this.cfSession = { token, apiEndpoint };
this.cfSessionRegionCode = regionCode;
}

export async function refreshOrgsFromLiveAfterCachedRender(this: any, credentials: { readonly email: string; readonly password: string }, regionCode: string, requestId: number, cachedOrgs: readonly { readonly guid: string; readonly name: string }[]): Promise<void> {
await this.establishRegionSession(credentials, regionCode, requestId);
if (!this.isCurrentRegionRequest(requestId)) {
  return;
}

const session = await this.ensureRegionSession(credentials);
if (!this.isCurrentRegionRequest(requestId)) {
  return;
}

const liveOrgs = await fetchOrgs(session);
if (!this.isCurrentRegionRequest(requestId)) {
  return;
}

if (!haveSameOrgEntries(cachedOrgs, liveOrgs)) {
  this.postMessage({
    type: MSG_ORGS_LOADED,
    orgs: liveOrgs,
  });
}
}

export function postOrgsError(this: any, message: string): void {
this.postMessage({ type: MSG_ORGS_ERROR, message });
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

export function postSpacesError(this: any, message: string): void {
this.postMessage({ type: MSG_SPACES_ERROR, message });
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

export function sendSshProxyStatus(this: any): void {
 
const config = vscode.workspace.getConfiguration('sapTools').get<any>('sshProxy') ?? {};
this.postMessage({
  type: MSG_SSH_PROXY_STATUS,
  payload: {
     
    enabled: config.enabled === true,
     
    host: typeof config.host === 'string' ? (config.host as string) : '',
     
    port: typeof config.port === 'number' ? (config.port as number) : 22,
     
    username: typeof config.username === 'string' ? (config.username as string) : '',
     
    connection: config.enabled === true ? 'disconnected' : 'disabled',
    message: null,
  },
});
}

export async function handleRequestInitialState(this: RegionSidebarProvider): Promise<void> {
    const snapshot = await this.cacheSyncService.getRuntimeSnapshot();
    this.postCacheState(snapshot);
    this.sendSshProxyStatus();
    if (!this.hasAttemptedConfirmedScopeRestore) {
      await this.preloadRootFolderForPersistedScope();
    }

    this.postMessage({
      type: MSG_LOCAL_ROOT_FOLDER_UPDATED,
      path: this.selectedLocalRootFolderPath,
    });
    this.postMessage({
      type: MSG_SERVICE_FOLDER_MAPPINGS_LOADED,
      mappings: this.serviceFolderMappings,
    });
    void this.postDetectedLocalPackages();
    this.postCfTopologySnapshot(this.resolveCfTopologySync());
    void this.pushCfTopology();
    if (!this.hasAttemptedConfirmedScopeRestore) {
      this.hasAttemptedConfirmedScopeRestore = true;
      await this.restoreConfirmedScopeForCurrentUser();
    }
}

export async function handleLoginSubmit(this: RegionSidebarProvider, email: string, password: string): Promise<void> {
    try {
      await storeCredentials(this.context, { email, password });
      await this.cacheSyncService.setCredentials({ email, password });
      this.hasAttemptedConfirmedScopeRestore = false;
      this.reloadToMainView();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save credentials.';
      this.postMessage({ type: MSG_LOGIN_RESULT, success: false, error: errorMessage });
    }
}

export async function handleLogout(this: RegionSidebarProvider): Promise<void> {
    try {
      const previousCredentials = await getEffectiveCredentials(this.context).catch(() => null);
      const previousEmail = previousCredentials?.email ?? '';
      await clearCredentials(this.context);
      await this.cacheSyncService.setCredentials(null);
      if (previousEmail.length > 0) {
        try {
          const removed = await this.cacheStore.clearHanaTableListsForUser(previousEmail);
          if (removed > 0) {
            this.outputChannel.appendLine(
              `[sql-ui] cleared ${String(removed)} cached HANA table list(s) for ${sanitizeSqlUiLogValue(previousEmail)}`
            );
          }
          // Drop remembered HANA tunnel jump-hosts too (HANA hostnames + app
          // names) so a logged-out account leaves no residual SQL state.
          await this.cacheStore.clearHanaTunnelJumpApps();
        } catch {
          /* best effort cleanup, ignore failures */
        }
      }
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
      this.exportInProgress = false;
      this.hasAttemptedConfirmedScopeRestore = false;
      this.lastLoadedScope = null;
      this.lastWrittenScope = undefined;
      this.currentConfirmedScope = undefined;
      this.hanaSqlWorkbench.invalidateAllAppContexts();
      this.cfLogsPanel.updateApps([], null);
      this.cfLogsPanel.updateScope('No scope selected');
      this.reloadToLoginView();
      this.postMessage({
        type: MSG_LOGOUT_RESULT,
        success: true,
      } satisfies LogoutResultPayload);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to clear credentials.';
      this.postMessage({
        type: MSG_LOGOUT_RESULT,
        success: false,
        error: errorMessage,
      } satisfies LogoutResultPayload);
    }
}

export async function handleSaveSshProxySettings(this: RegionSidebarProvider, payload: any): Promise<void> {
    const config = vscode.workspace.getConfiguration('sapTools');
    await config.update('sshProxy', {
       
      enabled: payload.enabled === true,
       
      host: typeof payload.host === 'string' ? (payload.host as string) : '',
       
      port: typeof payload.port === 'number' ? (payload.port as number) : 22,
       
      username: typeof payload.username === 'string' ? (payload.username as string) : '',
       
      password: typeof payload.password === 'string' ? (payload.password as string) : undefined,
    }, vscode.ConfigurationTarget.Global);
    if (payload.enabled === true) {
      try {
        const { ensureSshProxy } = await import('../../sshProxyTunnel.js');
        await ensureSshProxy();
        this.postMessage({
          type: MSG_SSH_PROXY_STATUS,
          payload: { connection: 'connected', message: null }
        });
      } catch (error: unknown) {
        this.postMessage({
          type: MSG_SSH_PROXY_STATUS,
          payload: { connection: 'error', message: error instanceof Error ? error.message : String(error) }
        });
      }
    } else {
      this.sendSshProxyStatus();
    }
}

export async function handleClearSshProxySettings(this: RegionSidebarProvider): Promise<void> {
    const config = vscode.workspace.getConfiguration('sapTools');
    await config.update('sshProxy', undefined, vscode.ConfigurationTarget.Global);
    this.sendSshProxyStatus();
}
