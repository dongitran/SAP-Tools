/* eslint-disable */
// @ts-nocheck

import * as vscode from 'vscode';
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    isTestMode,
    sanitizeSqlUiLogValue
} from '../../sidebarProvider.helpers';
import {
    BUILTIN_EXTENSION_OPEN_COMMAND,
    CfLogSessionSeed,
    MSG_HANA_SQL_FILE_OPEN_RESULT,
    MSG_HANA_TABLE_SELECT_RESULT,
    MSG_HANA_TABLES_LOADED,
    OpenHanaSqlFilePayload,
    RefreshHanaTablesPayload,
    RunHanaTableSelectPayload,
    SQLTOOLS_ACTIVITY_BAR_COMMAND,
    SQLTOOLS_EXTENSION_ID
} from '../../sidebarProvider.types';

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

export async function handleOpenHanaSqlFile(this: RegionSidebarProvider, payload: OpenHanaSqlFilePayload): Promise<void> {
    const targetApp = this.currentApps.find((app) => app.id === payload.serviceId) ??
          this.currentApps.find((app) => app.name === payload.serviceName);
    if (targetApp === undefined) {
      this.outputChannel.appendLine(
        `[sql-ui] open sql file rejected: app not found serviceId=${sanitizeSqlUiLogValue(payload.serviceId)} serviceName=${sanitizeSqlUiLogValue(payload.serviceName)}`
      );
      this.postHanaSqlFileOpenResult(
        payload.requestId, payload.serviceId, false, 'Selected app was not found.'
      );
      return;
    }

    const sessionSeed = this.currentLogSessionSeed;
    if (sessionSeed === null && !isTestMode()) {
      this.outputChannel.appendLine(
        `[sql-ui] open sql file rejected: no active session app=${sanitizeSqlUiLogValue(targetApp.name)}`
      );
      this.postHanaSqlFileOpenResult(
        payload.requestId, payload.serviceId, false,
        'No active CF scope session. Confirm scope and choose app again.'
      );
      return;
    }

    this.outputChannel.appendLine(
      `[sql-ui] open sql file requested app=${sanitizeSqlUiLogValue(targetApp.name)}`
    );
    try {
      await this.hanaSqlWorkbench.openSqlDocumentForApp({
        appId: targetApp.id,
        appName: targetApp.name,
        session: sessionSeed,
      });
      this.outputChannel.appendLine(
        `[sql-ui] open sql file succeeded app=${sanitizeSqlUiLogValue(targetApp.name)}`
      );
      this.postHanaSqlFileOpenResult(payload.requestId, targetApp.id, true, '');
      void this.publishHanaTablesForApp(targetApp.id, targetApp.name, sessionSeed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to open SQL file.';
      this.outputChannel.appendLine(
        `[sql-ui] open sql file failed app=${sanitizeSqlUiLogValue(targetApp.name)} message=${sanitizeSqlUiLogValue(errorMessage)}`
      );
      this.postHanaSqlFileOpenResult(payload.requestId, targetApp.id, false, errorMessage);
    }
}

export async function handleOpenSqlBackupHistory(this: RegionSidebarProvider): Promise<void> {
    if (this.hanaSqlHistoryPanelManager === null || this.hanaSqlBackupStore === null) {
      this.outputChannel.appendLine('[sql-history] history panel manager or backup store not available');
      return;
    }

    if (this.currentConfirmedScope === undefined) {
      this.outputChannel.appendLine('[sql-history] active scope not available');
      return;
    }

    this.outputChannel.appendLine('[sql-history] opening backup history panel');
    await this.hanaSqlHistoryPanelManager.openOrReveal(this.hanaSqlBackupStore, {
      region: this.currentConfirmedScope.regionCode,
      orgName: this.currentConfirmedScope.orgName,
      spaceName: this.currentConfirmedScope.spaceName
    });
}

export async function handleRefreshHanaTables(this: RegionSidebarProvider, payload: RefreshHanaTablesPayload): Promise<void> {
    const targetApp = this.currentApps.find((app) => app.id === payload.serviceId) ??
          this.currentApps.find((app) => app.name === payload.serviceName);
    if (targetApp === undefined) {
      this.outputChannel.appendLine(
        `[sql-ui] refresh tables rejected: app not found serviceId=${sanitizeSqlUiLogValue(payload.serviceId)} serviceName=${sanitizeSqlUiLogValue(payload.serviceName)}`
      );
      this.postMessage({
        type: MSG_HANA_TABLES_LOADED,
        serviceId: payload.serviceId,
        success: false,
        tables: [],
        message: 'Selected app was not found.',
      });
      return;
    }

    const sessionSeed = this.currentLogSessionSeed;
    await this.publishHanaTablesForApp(targetApp.id, targetApp.name, sessionSeed, true);
}

export async function handleRunHanaTableSelect(this: RegionSidebarProvider, payload: RunHanaTableSelectPayload): Promise<void> {
    const targetApp = this.currentApps.find((app) => app.id === payload.serviceId) ??
          this.currentApps.find((app) => app.name === payload.serviceName);
    if (targetApp === undefined) {
      this.outputChannel.appendLine(
        `[sql-ui] quick select rejected: app not found serviceId=${sanitizeSqlUiLogValue(payload.serviceId)} serviceName=${sanitizeSqlUiLogValue(payload.serviceName)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
      );
      this.postHanaTableSelectResult(
        payload.serviceId,
        payload.tableName,
        false,
        'Selected app was not found.'
      );
      return;
    }

    const sessionSeed = this.currentLogSessionSeed;
    if (sessionSeed === null && !isTestMode()) {
      this.outputChannel.appendLine(
        `[sql-ui] quick select rejected: no active session app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
      );
      this.postHanaTableSelectResult(
        payload.serviceId,
        payload.tableName,
        false,
        'No active CF scope session. Confirm scope and choose app again.'
      );
      return;
    }

    this.outputChannel.appendLine(
      `[sql-ui] quick select requested app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
    );
    try {
      await this.hanaSqlWorkbench.runQuickTableSelectForApp({
        appId: targetApp.id,
        appName: targetApp.name,
        session: sessionSeed,
        tableName: payload.tableName,
      });
      this.outputChannel.appendLine(
        `[sql-ui] quick select succeeded app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)}`
      );
      this.postHanaTableSelectResult(
        targetApp.id,
        payload.tableName,
        true,
        ''
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to run quick SELECT.';
      this.outputChannel.appendLine(
        `[sql-ui] quick select failed app=${sanitizeSqlUiLogValue(targetApp.name)} table=${sanitizeSqlUiLogValue(payload.tableName)} message=${sanitizeSqlUiLogValue(errorMessage)}`
      );
      this.postHanaTableSelectResult(
        targetApp.id,
        payload.tableName,
        false,
        errorMessage
      );
    }
}

export async function handleOpenSqlToolsExtension(this: RegionSidebarProvider): Promise<void> {
    const sqlToolsExtension = vscode.extensions.getExtension(SQLTOOLS_EXTENSION_ID);
    if (sqlToolsExtension !== undefined) {
      try {
        if (!sqlToolsExtension.isActive) {
          await sqlToolsExtension.activate();
        }
        await vscode.commands.executeCommand(SQLTOOLS_ACTIVITY_BAR_COMMAND);
        return;
      } catch {
        // Fall through to the marketplace-open fallback if the activity bar
        // command is not registered for the installed SQLTools version.
      }
    }

    await vscode.commands.executeCommand(
      BUILTIN_EXTENSION_OPEN_COMMAND,
      SQLTOOLS_EXTENSION_ID
    );
}
