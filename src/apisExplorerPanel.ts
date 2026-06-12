import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

const APIS_EXPLORER_VIEW_TYPE = 'sapTools.apisExplorer';

export interface ApisExplorerPanelSession {
  readonly panel: vscode.WebviewPanel;
}

export class ApisExplorerPanelManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sessions = new Map<string, ApisExplorerPanelSession>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  openApisExplorer(appId: string): ApisExplorerPanelSession {
    const existingSession = this.sessions.get(appId);
    if (existingSession !== undefined) {
      existingSession.panel.reveal();
      return existingSession;
    }

    this.log(`open APIs Explorer for app ${appId}`);

    const panel = vscode.window.createWebviewPanel(
      APIS_EXPLORER_VIEW_TYPE,
      `APIs Explorer · ${appId}`,
      { preserveFocus: false, viewColumn: vscode.ViewColumn.Active },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'docs', 'designs', 'prototypes')]
      }
    );

    const session: ApisExplorerPanelSession = { panel };
    this.sessions.set(appId, session);

    panel.webview.html = this.buildWebviewHtml(panel.webview, appId);

    panel.onDidDispose(() => {
      this.sessions.delete(appId);
    }, null, this.disposables);

    return session;
  }

  private buildWebviewHtml(webview: vscode.Webview, appId: string): string {
    const prototypesUri = vscode.Uri.joinPath(this.extensionUri, 'docs', 'designs', 'prototypes');
    const apisWebviewJsUri = webview.asWebviewUri(vscode.Uri.joinPath(prototypesUri, 'assets', 'apis-webview.js'));
    const prototypeCssUri = webview.asWebviewUri(vscode.Uri.joinPath(prototypesUri, 'assets', 'prototype.css'));
    // cspell:ignore wght
    const fontUri = webview.asWebviewUri(vscode.Uri.joinPath(prototypesUri, 'assets', 'Outfit-VariableFont_wght.ttf'));
    const apisWebviewJsUriStr = apisWebviewJsUri.toString();
    const prototypeCssUriStr = prototypeCssUri.toString();
    const fontUriStr = fontUri.toString();
    const nonce = randomBytes(16).toString('base64url');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>APIs Explorer</title>
  <style>
    @font-face {
      font-family: 'Outfit';
      src: url('${fontUriStr}') format('truetype');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      height: 100vh;
      overflow: hidden;
    }
    #webview-app {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  </style>
  <link rel="stylesheet" href="${prototypeCssUriStr}" />
</head>
<body class="vscode-dark">
  <!-- Root App Container -->
  <div id="webview-app"></div>

  <!-- Pass appId via a script tag so the JS can read it -->
  <script nonce="${nonce}">
    window.vscodeApiSelectedAppId = ${JSON.stringify(appId)};
  </script>
  <!-- Load the main UI logic -->
  <script nonce="${nonce}" src="${apisWebviewJsUriStr}"></script>
</body>
</html>`;
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[apis] ${message}`);
  }
}
