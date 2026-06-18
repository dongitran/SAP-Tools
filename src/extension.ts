import * as vscode from 'vscode';

import { CF_LOGS_VIEW_ID, CfLogsPanelProvider } from './cfLogsPanel';
import { CacheStore } from './cacheStore';
import { CacheSyncService } from './cacheSyncService';
import { configureCfCommandLogger } from './cfClient';
import { getEffectiveCredentials } from './credentialStore';
import { HanaSqlWorkbench } from './hanaSqlWorkbench';
import { reapOrphanedTunnels } from './hanaTunnelRegistry';
import { REGION_VIEW_ID, RegionSidebarProvider } from './sidebarProvider';
import { readCurrentScope } from './scopeSync';

import { ApisExplorerPanelManager } from './apisExplorerPanel';
import { EventMeshPanelManager } from './eventMeshPanel';

const OPEN_REGION_MENU_COMMAND = 'sapTools.selectSapBtpRegion';
const OPEN_CF_LOGS_PANEL_COMMAND = 'sapTools.openCfLogsPanel';
const START_LOCAL_REGISTRY_COMMAND = 'sapTools.startLocalRegistry';
const STOP_LOCAL_REGISTRY_COMMAND = 'sapTools.stopLocalRegistry';
const OUTPUT_CHANNEL_NAME = 'SAP Tools';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  configureCfCommandLogger((message) => {
    outputChannel.appendLine(message);
  });

  // Close any HANA tunnels left behind by a previous session that crashed before
  // it could tear them down (normal shutdown / scope changes close them cleanly).
  void reapOrphanedTunnels((message) => {
    outputChannel.appendLine(message);
  });
  const cacheStore = new CacheStore(context);
  const cacheSyncService = new CacheSyncService(cacheStore, context, outputChannel);

  const cfLogsPanel = new CfLogsPanelProvider(context);
  const hanaSqlWorkbench = new HanaSqlWorkbench(outputChannel, cacheStore);
  const apisExplorerPanelManager = new ApisExplorerPanelManager(context.extensionUri, outputChannel, cacheStore);
  const eventMeshPanelManager = new EventMeshPanelManager(context.extensionUri, outputChannel);

  const regionSidebarProvider = new RegionSidebarProvider(
    context.extensionUri,
    outputChannel,
    context,
    cfLogsPanel,
    cacheSyncService,
    cacheStore,
    hanaSqlWorkbench,
    apisExplorerPanelManager,
    eventMeshPanelManager
  );

  void getEffectiveCredentials(context)
    .then(async (credentials) => cacheSyncService.initialize(credentials))
    .catch(() => undefined);

  const webviewProviderRegistration = vscode.window.registerWebviewViewProvider(
    REGION_VIEW_ID,
    regionSidebarProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  );

  const cfLogsPanelRegistration = vscode.window.registerWebviewViewProvider(
    CF_LOGS_VIEW_ID,
    cfLogsPanel,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  );

  const openRegionMenuCommand = vscode.commands.registerCommand(
    OPEN_REGION_MENU_COMMAND,
    async (): Promise<void> => {
      await vscode.commands.executeCommand(`${REGION_VIEW_ID}.focus`);
    }
  );

  const openCfLogsPanelCommand = vscode.commands.registerCommand(
    OPEN_CF_LOGS_PANEL_COMMAND,
    async (): Promise<void> => {
      await vscode.commands.executeCommand(`${CF_LOGS_VIEW_ID}.focus`);
    }
  );

  const startLocalRegistryCommand = vscode.commands.registerCommand(
    START_LOCAL_REGISTRY_COMMAND,
    async (): Promise<void> => {
      await regionSidebarProvider.startLocalRegistry();
    }
  );

  const stopLocalRegistryCommand = vscode.commands.registerCommand(
    STOP_LOCAL_REGISTRY_COMMAND,
    (): void => {
      regionSidebarProvider.stopLocalRegistry();
    }
  );

  const scopeConfigurationSubscription = vscode.workspace.onDidChangeConfiguration(
    (event): void => {
      if (!event.affectsConfiguration('sapCap.currentScope')) {
        return;
      }

      const newScope = readCurrentScope();
      if (newScope === undefined) {
        return;
      }

      void regionSidebarProvider.handleExternalScopeChange(newScope);
    }
  );

  context.subscriptions.push(
    outputChannel,
    new vscode.Disposable(() => {
      configureCfCommandLogger(null);
    }),
    cacheSyncService,
    regionSidebarProvider,
    cfLogsPanel,
    hanaSqlWorkbench,
    apisExplorerPanelManager,
    eventMeshPanelManager,
    webviewProviderRegistration,
    cfLogsPanelRegistration,
    openRegionMenuCommand,
    openCfLogsPanelCommand,
    startLocalRegistryCommand,
    stopLocalRegistryCommand,
    scopeConfigurationSubscription
  );
}
