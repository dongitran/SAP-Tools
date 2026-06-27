import type * as vscode from 'vscode';

/* cspell:disable */
export const TEST_MODE_SAMPLE_LOGS = `Retrieving logs for app finance-uat-api in org finance-services-prod / space uat as developer@example.com...

2026-04-12T09:14:31.73+0700 [CELL/0] OUT Cell 91130a14 stopping instance 13af001e
2026-04-12T09:14:32.19+0700 [API/2] OUT Restarted app with guid 8a45de1d
2026-04-12T09:14:32.26+0700 [CELL/0] OUT Cell d436706e creating container for instance 6eb35470
2026-04-12T09:14:43.98+0700 [CELL/0] OUT Cell d436706e successfully created container for instance 6eb35470
2026-04-12T09:14:44.55+0700 [APP/PROC/WEB/0] ERR npm warn Unknown project config "always-auth".
2026-04-12T09:14:44.73+0700 [APP/PROC/WEB/0] OUT > finance-uat-api@0.0.0 start
2026-04-12T09:14:44.73+0700 [APP/PROC/WEB/0] OUT > cds-serve -p gen/srv
2026-04-12T09:14:45.25+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"NodeCacheStrategy","timestamp":"2026-04-12T02:14:45.255Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"NodeCacheStrategy initialized","type":"log"}
2026-04-12T09:14:45.25+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"CacheService","timestamp":"2026-04-12T02:14:45.256Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"CacheService initialized with strategy: NodeCacheStrategy","type":"log"}
2026-04-12T09:14:47.26+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","timestamp":"2026-04-12T02:14:47.260Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"loaded model from 1 file(s)","type":"log"}
2026-04-12T09:14:47.90+0700 [APP/PROC/WEB/0] OUT {"level":"warn","logger":"cds","timestamp":"2026-04-12T02:14:47.904Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"using auth strategy jwt with fallback mode","type":"log"}
2026-04-12T09:14:47.95+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","timestamp":"2026-04-12T02:14:47.953Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"server listening on http://localhost:8080","type":"log"}
2026-04-12T09:14:47.95+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"cds","timestamp":"2026-04-12T02:14:47.953Z","component_name":"finance-uat-api","organization_name":"finance-services-prod","space_name":"uat","msg":"database retry exhausted on startup","type":"log"}
2026-05-11T18:20:17.84+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"SyntheticBatchJob - runSyntheticBatch","correlation_id":"synthetic-correlation-001","remote_user":"sample-user","timestamp":"2026-05-11T11:20:17.839Z","layer":"cds","component_type":"application","container_id":"192.0.2.10","component_id":"00000000-0000-4000-8000-000000000001","component_name":"synthetic-cap-service","component_instance":0,"source_instance":0,"organization_name":"synthetic-org","organization_id":"00000000-0000-4000-8000-000000000002","space_name":"sandbox","space_id":"00000000-0000-4000-8000-000000000003","msg":"{\n refID: 'synthetic-ref-001',\n batchID: 997,\n concurrencyLimit: 5\n}","type":"log"}
2026-05-11T18:22:00.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"SyntheticRemoteService","msg":"{\"statusCode\":502,\"reason\":{\"message\":\"\",\"name\":\"Error\",\"request\":{\"method\":\"POST\",\"url\":\"http://example.test:44300/odata/v1/SyntheticEntities\"},\"response\":{\"status\":503,\"statusText\":\"Service Unavailable\"}}}","type":"log"}
2026-05-11T18:22:01.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"SyntheticValidationRunner","msg":"{\n  name: 'syntheticValidationRun - [Info] Sample validation message',\n  error: Error: Error during request to remote service: synthetic-validation-marker\n      at module.exports.run (/srv/node_modules/@sap/cds/runtime/remote/utils/client.js:196:31),\n    statusCode: 502,\n    code: 'ERR_BAD_REQUEST'\n}","type":"log"}
2026-05-11T18:22:02.00+0700 [APP/PROC/WEB/0] OUT {"level":"error","logger":"cds","msg":"400 - Error: Synthetic escaped character in JSON at position 81\n    at SyntheticActionHandler.executeSyntheticAction (/srv/srv/handlers/SyntheticAction.handler.ts:49:18) {\n  code: '400'\n}","type":"log"}
2026-05-13T16:51:41.16+0700 [APP/PROC/WEB/0] OUT {"level":"debug","logger":"remote","tenant_id":"tenant-remote-sample","x_cf_true_client_ip":"192.0.2.44","request_id":"1758b535-a6bc-4eee-5261-bf740494e2e","x_correlation_id":"1758b535-a6bc-4eee-5261-bf740494e2e","msg":"get <srv_process_system>/systemprocessservice/requesttaskeventdata?$top=1&$select=deepdata,reqid,mdglogid&$filter=mdglogid%20eq%20'a1db2b12-16d3-43e5-b73d-35744eb1e2e' {\n  headers: {\n    accept: 'application/json,text/plain',\n    authorization: 'bearer ***'\n  }\n}","type":"log"}
2026-04-12T09:14:48.20+0700 [RTR/0] OUT finance-uat-api.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.200Z] "GET /rtr-health-check HTTP/1.1" 200 42 10 "-" "probe/1.0" "10.0.1.1:1001" "10.0.2.1:2001" x_forwarded_for:"1.2.3.4" x_forwarded_proto:"https" vcap_request_id:"rtr-req-001" response_time:0.001 gorouter_time:0.000010 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_b3_traceid:"aabbccdd" x_b3_spanid:"aabbccdd" b3:"aabbccdd-aabbccdd"
2026-04-12T09:14:48.25+0700 [RTR/0] OUT finance-uat-api.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.250Z] "GET /rtr-not-found HTTP/1.1" 404 80 10 "-" "curl/7.88.1" "10.0.1.2:1002" "10.0.2.2:2002" x_forwarded_for:"1.2.3.5" x_forwarded_proto:"https" vcap_request_id:"rtr-req-002" response_time:0.000 gorouter_time:0.000009 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_b3_traceid:"bbccddee" x_b3_spanid:"bbccddee" b3:"bbccddee-bbccddee"
2026-04-12T09:14:48.30+0700 [RTR/0] OUT finance-uat-api.cfapps.ap11.hana.ondemand.com - [2026-04-12T02:14:48.300Z] "POST /rtr-upstream-fail HTTP/1.1" 500 120 10 "-" "axios/1.0.0" "10.0.1.3:1003" "10.0.2.3:2003" x_forwarded_for:"1.2.3.6" x_forwarded_proto:"https" vcap_request_id:"rtr-req-003" response_time:0.123 gorouter_time:0.000011 app_id:"app001" app_index:"0" instance_id:"inst001" failed_attempts:0 failed_attempts_time:"-" x_cf_routererror:"-" x_b3_traceid:"ccddeeff" x_b3_spanid:"ccddeeff" b3:"ccddeeff-ccddeeff"
Failed to retrieve logs from Log Cache: unexpected status code 404
Failed to retrieve logs from Log Cache: unexpected status code 404
Failed to retrieve logs from Log Cache: unexpected status code 404`;
/* cspell:enable */

export function buildWebviewHtml(
  webview: vscode.Webview,
  nonce: string,
  scriptUri: vscode.Uri,
  cssUri: vscode.Uri
): string {
  const scriptSrc = webview.asWebviewUri(scriptUri).toString();
  const cssSrc = webview.asWebviewUri(cssUri).toString();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>CF Logs</title>
  <link rel="stylesheet" href="${cssSrc}" />
</head>
<body
  class="cf-logs-panel-page"
  style="margin:0;padding:0;height:100vh;min-height:100vh;display:flex;flex-direction:column;overflow:hidden;"
>
  <section
    class="cf-logs-panel"
    aria-label="CFLogs panel content"
    style="flex:1 1 auto;min-height:0;height:100%;"
  >
    <p id="workspace-scope" class="workspace-scope" hidden></p>

    <section class="filter-inline" aria-label="CF log filters">
      <div class="filter-item filter-item-app">
        <select id="filter-app" aria-label="Select app">
          <option value="">— no apps loaded —</option>
        </select>
      </div>
      <div class="filter-item filter-item-search">
        <input
          id="filter-search"
          type="search"
          placeholder="message, logger"
          aria-label="Search logs"
        />
      </div>
      <div class="filter-item filter-item-level">
        <select id="filter-level" aria-label="Filter by level">
          <option value="all">All</option>
        </select>
      </div>
      <div class="filter-item filter-item-file-log">
        <select id="file-log-select" aria-label="File logging mode">
          <option value="off" selected>No file log</option>
          <option value="file">Log to file</option>
        </select>
      </div>
      <button
        type="button"
        class="gear-button"
        id="settings-toggle"
        aria-label="Column settings"
        aria-controls="settings-panel"
        aria-expanded="false"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.25"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1 .33H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1 .33 1.65 1.65 0 0 0-.6 1z"></path>
        </svg>
      </button>
    </section>

    <div
      class="settings-panel"
      id="settings-panel"
      aria-hidden="true"
      hidden
    >
      <div class="settings-row">
        <span class="settings-panel-label">Columns</span>
        <div class="settings-column-toggles" id="settings-column-toggles">
        </div>
      </div>
      <div class="settings-row settings-row-font">
        <label for="settings-font-size" class="settings-panel-label">Font Size</label>
        <select id="settings-font-size" class="settings-font-size-select" aria-label="Log table font size">
          <option value="smaller">Smaller</option>
          <option value="default" selected>Default</option>
          <option value="large">Large</option>
          <option value="xlarge">Extra Large</option>
        </select>
      </div>
      <div class="settings-row settings-row-limit">
        <label for="settings-log-limit" class="settings-panel-label">Log Limit</label>
        <select
          id="settings-log-limit"
          class="settings-font-size-select settings-log-limit-select"
          aria-label="Log row limit"
        >
          <option value="300" selected>300</option>
          <option value="500">500</option>
          <option value="1000">1000</option>
          <option value="3000">3000</option>
        </select>
      </div>
      <div class="settings-row settings-row-message-limit">
        <span class="settings-panel-label">Message</span>
        <label class="settings-column-item settings-message-limit-item" for="settings-message-limit">
          <input
            id="settings-message-limit"
            type="checkbox"
            aria-label="Limit message height"
          />
          Limit height and scroll long messages
        </label>
      </div>
    </div>

    <div
      class="table-shell"
      role="region"
      aria-label="Filtered logs table"
      style="flex:1 1 auto;min-height:0;"
    >
      <table class="cf-log-table" aria-describedby="table-summary">
        <thead id="log-table-head"><tr></tr></thead>
        <tbody id="log-table-body"></tbody>
      </table>
    </div>

    <p id="table-summary" class="table-summary" role="status" aria-live="polite"></p>
  </section>

  <div class="copy-toast" id="copy-toast" role="status" aria-live="polite" aria-atomic="true">Copied!</div>

  <script nonce="${nonce}" type="module" src="${scriptSrc}"></script>
</body>
</html>`;
}