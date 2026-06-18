import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function buildEventMeshWebviewHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  appId: string
): string {
  const prototypesUri = vscode.Uri.joinPath(extensionUri, 'docs', 'designs', 'prototypes');
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(prototypesUri, 'assets', 'events-webview.js')
  );
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(prototypesUri, 'assets', 'prototype.css'));
  // cspell:ignore wght
  const fontUri = webview.asWebviewUri(
    vscode.Uri.joinPath(prototypesUri, 'assets', 'Outfit-VariableFont_wght.ttf')
  );
  const cacheBust = Date.now().toString();
  const scriptUriStr = scriptUri.with({ query: `t=${cacheBust}` }).toString();
  const cssUriStr = cssUri.with({ query: `t=${cacheBust}` }).toString();
  const fontUriStr = fontUri.toString();
  const nonce = randomBytes(16).toString('base64url');
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Event Mesh</title>
  <style nonce="${nonce}">
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
    #event-mesh-app {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  </style>
  <link rel="stylesheet" href="${cssUriStr}" />
</head>
<body class="vscode-dark">
  <div id="event-mesh-app"></div>
  <script nonce="${nonce}">
    window.eventMeshAppId = ${JSON.stringify(appId)};
  </script>
  <script nonce="${nonce}" src="${scriptUriStr}"></script>
</body>
</html>`;
}
