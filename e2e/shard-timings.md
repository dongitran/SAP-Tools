# E2E Shard Timings

Source: GitHub Actions run 27763277570 on 2026-06-18. Durations are Playwright list reporter timings from Ubuntu CI, with newly added or changed tests estimated from local full-suite timings until the next CI refresh.

The CI workflow reads this table through `scripts/run-e2e-lane.mjs`. When tests are added, moved, renamed, or materially changed, update the seconds and rebalance all 12 lanes.

## Lane Totals

| Lane | Expected seconds | Test count |
| --- | ---: | ---: |
| 01 | 84.1 | 3 |
| 02 | 88.8 | 4 |
| 03 | 84.0 | 3 |
| 04 | 87.1 | 10 |
| 05 | 87.6 | 12 |
| 06 | 86.3 | 12 |
| 07 | 88.3 | 13 |
| 08 | 85.7 | 12 |
| 09 | 85.4 | 12 |
| 10 | 84.8 | 12 |
| 11 | 84.7 | 12 |
| 12 | 84.6 | 12 |

## Test Timings

| Lane | Seconds | Selector | Title |
| --- | ---: | --- | --- |
| 01 | 72.0 | tests/region-selector-ui.e2e.spec.ts:220 | User can select EU10 extension landscape from Europe area |
| 01 | 6.2 | tests/region-selector-ui.e2e.spec.ts:2225 | User can choose org and space in Quick tab with focused organization and space sections |
| 01 | 5.9 | tests/region-selector-ui.e2e.spec.ts:2068 | User can see restored quick scope org name without manual org list |
| 02 | 72.0 | tests/region-selector-ui.e2e.spec.ts:975 | User can keep confirmed scope after closing and reopening extension host |
| 02 | 6.1 | tests/cf-logs-panel.e2e.spec.ts:1661 | User can use full-height CF logs table after opening and closing settings |
| 02 | 5.9 | tests/region-selector-ui.e2e.spec.ts:1972 | User can see interrupted sync status after stale cache sync recovery on launch |
| 02 | 4.8 | tests/sql-backup-history.e2e.spec.ts:260 | User can switch backup entries and copy CSV data |
| 03 | 72.0 | tests/region-selector-ui.e2e.spec.ts:1676 | User can reopen extension and see mapped services in Apps export table |
| 03 | 6.1 | tests/region-selector-ui.e2e.spec.ts:193 | User can see code-first region labels without cloud provider suffix |
| 03 | 5.9 | tests/region-selector-ui.e2e.spec.ts:2011 | User can start from Quick Org Search when synced topology has orgs |
| 04 | 29.9 | tests/region-selector-ui.e2e.spec.ts:1149 | User can reopen extension and reach monitoring workspace before delayed app hydration completes |
| 04 | 7.2 | tests/cf-logs-panel.e2e.spec.ts:324 | User can copy a CF log row message by clicking the row |
| 04 | 7.1 | tests/region-selector-ui.e2e.spec.ts:1193 | User can restore confirmed scope after logging out and logging in again in same session |
| 04 | 6.9 | tests/workspace-tabs.e2e.spec.ts:420 | User can use full-height Logs and Apps workspace panels |
| 04 | 6.7 | tests/workspace-tabs.e2e.spec.ts:245 | User can open the workspace with only the supported tabs |
| 04 | 6.4 | tests/region-selector-ui.e2e.spec.ts:2341 | User can confirm scope from Quick tab and enter monitoring workspace |
| 04 | 6.3 | tests/region-selector-ui.e2e.spec.ts:1292 | User can see smooth organization and space hover without top border clipping |
| 04 | 6.2 | tests/region-selector-ui.e2e.spec.ts:2039 | User can use Custom tab without topology rows changing manual selection |
| 04 | 5.9 | tests/login-gate.e2e.spec.ts:72 | User can see login validation for invalid email |
| 04 | 4.5 | tests/sql-backup-history.e2e.spec.ts:71 | User can inspect backups with many columns |
| 05 | 12.3 | tests/sql-workbench.e2e.spec.ts:257 | User can review SQL app list with initial tables panel state |
| 05 | 7.9 | tests/sql-workbench.e2e.spec.ts:718 | User can run manual SQL with uppercase app table references in selected schema |
| 05 | 7.5 | tests/cf-logs-panel.e2e.spec.ts:673 | User can inspect dominant endpoint events with compact HTTP details |
| 05 | 7.2 | tests/cf-logs-panel.e2e.spec.ts:295 | User can read clock-only timestamps in CF logs panel |
| 05 | 7.1 | tests/cf-logs-panel.e2e.spec.ts:796 | User can filter CF logs by level and search text |
| 05 | 6.9 | tests/region-selector-ui.e2e.spec.ts:1385 | User can toggle app selection by clicking app row in Apps & APIs |
| 05 | 6.7 | tests/region-selector-ui.e2e.spec.ts:1553 | User can keep current Apps export state when Select Root Folder is cancelled initially |
| 05 | 6.4 | tests/region-selector-ui.e2e.spec.ts:1237 | User can see smooth region hover without notch clipping artifacts |
| 05 | 6.3 | tests/region-selector-ui.e2e.spec.ts:803 | User can complete selection flow and reset via Change buttons only |
| 05 | 6.2 | tests/region-selector-ui.e2e.spec.ts:1934 | User can open settings, update sync interval, and return to selection screen |
| 05 | 7.5 | tests/apis-tab.e2e.spec.ts:147 | User can wait for API discovery without demo endpoints and keep scroll after selecting an endpoint |
| 05 | 5.6 | tests/sql-backup-history.e2e.spec.ts:48 | User can see the empty backup history state |
| 06 | 11.9 | tests/sql-workbench.e2e.spec.ts:1015 | User can search selected app tables and run a quick SELECT |
| 06 | 8.0 | tests/sql-workbench.e2e.spec.ts:1605 | User can select a lower SQL app while preserving the app list position |
| 06 | 7.5 | tests/cf-logs-panel.e2e.spec.ts:364 | User can inspect and copy raw JSON metadata from CF log messages |
| 06 | 7.3 | tests/workspace-tabs.e2e.spec.ts:450 | User can see service mapping icons at row start and use hover actions |
| 06 | 7.1 | tests/cf-logs-panel.e2e.spec.ts:206 | User can choose only apps started for logging in CF logs panel |
| 06 | 6.9 | tests/region-selector-ui.e2e.spec.ts:891 | User can confirm scope, view monitoring workspace, and switch back to selection |
| 06 | 6.7 | tests/region-selector-ui.e2e.spec.ts:1419 | User can open Apps tab and view service artifact export controls |
| 06 | 6.4 | tests/region-selector-ui.e2e.spec.ts:702 | User can see app catalog from extension host data for selected space |
| 06 | 6.3 | tests/region-selector-ui.e2e.spec.ts:659 | User can see stable selection cards without entry animation while choosing scope |
| 06 | 6.2 | tests/region-selector-ui.e2e.spec.ts:1064 | User can follow external SAP CAP scope before selecting a SAP Tools region |
| 06 | 6.0 | tests/region-selector-ui.e2e.spec.ts:785 | User can select one SAP BTP region in webview and output log is emitted |
| 06 | 6.0 | tests/region-selector-ui.e2e.spec.ts:2307 | User can continue immediately when Quick Org Search finds one space |
| 07 | 11.6 | tests/login-gate.e2e.spec.ts:14 | User can see login gate when credentials are not set |
| 07 | 8.1 | tests/sql-workbench.e2e.spec.ts:831 | User can view readable JSON text returned from SQL results |
| 07 | 5.0 | tests/apis-tab.e2e.spec.ts:213 | User can start Live Trace and inspect raw request and response details |
| 07 | 7.3 | tests/cf-logs-panel.e2e.spec.ts:474 | User can keep text and continuation messages faithful in CF logs |
| 07 | 7.2 | tests/region-selector-ui.e2e.spec.ts:1723 | User can confirm same scope after Change Region and keep mapped services |
| 07 | 6.9 | tests/cf-logs-panel.e2e.spec.ts:844 | User can see RTR access logs classified by HTTP status code |
| 07 | 6.7 | tests/cf-logs-panel.e2e.spec.ts:1820 | User can see CF logs scope update after confirming sidebar workspace |
| 07 | 6.4 | tests/cf-logs-panel.e2e.spec.ts:1181 | User can keep canonical CF logs header order when toggling Level |
| 07 | 6.3 | tests/region-selector-ui.e2e.spec.ts:576 | User can filter regions inline while choosing a custom region |
| 07 | 6.2 | tests/region-selector-ui.e2e.spec.ts:743 | User can see app catalog failure state for an unreachable selected space |
| 07 | 6.0 | tests/region-selector-ui.e2e.spec.ts:472 | User can load fourteen organizations when selecting br-10 from local fixtures |
| 07 | 5.7 | tests/region-selector-ui.e2e.spec.ts:2162 | User can keep Quick Org Search input focus while topology refreshes |
| 07 | 4.9 | tests/sql-backup-history.e2e.spec.ts:110 | User can inspect highlighted SQL mutation variants |
| 08 | 11.0 | tests/region-selector-ui.e2e.spec.ts:1627 | User can reopen extension host and keep mapped services without selecting root folder again |
| 08 | 8.2 | tests/sql-workbench.e2e.spec.ts:762 | User can save an app SQL editor and run a mutating statement to a status result |
| 08 | 7.6 | tests/workspace-tabs.e2e.spec.ts:368 | User can open compact Settings from selection and workspace headers |
| 08 | 7.4 | tests/region-selector-ui.e2e.spec.ts:1102 | User can clear active logging state when an external scope cannot be restored |
| 08 | 7.2 | tests/region-selector-ui.e2e.spec.ts:1584 | User can remap services after selecting a new root folder |
| 08 | 6.9 | tests/cf-logs-panel.e2e.spec.ts:250 | User can read compact endpoint events while raw log messages stay hidden |
| 08 | 6.7 | tests/cf-logs-panel.e2e.spec.ts:944 | User can keep CF CLI infrastructure messages out of the log table |
| 08 | 6.5 | tests/region-selector-ui.e2e.spec.ts:1839 | User can see consistent Apps and export typography with front-truncated service paths |
| 08 | 6.3 | tests/region-selector-ui.e2e.spec.ts:157 | User can keep VS Code webview theme classes during interactions |
| 08 | 6.2 | tests/region-selector-ui.e2e.spec.ts:496 | User can filter organizations and reset search after changing region |
| 08 | 6.0 | tests/login-gate.e2e.spec.ts:41 | User can submit credentials and reach the region selector |
| 08 | 5.7 | tests/region-selector-ui.e2e.spec.ts:119 | User can open selector and pick region in high-contrast theme |
| 09 | 10.3 | tests/sql-workbench.e2e.spec.ts:350 | User can open app SQL editor and run SQL command in a stable result group |
| 09 | 8.2 | tests/sql-workbench.e2e.spec.ts:556 | User can run selected SQL with a readable table name from the selected app |
| 09 | 7.6 | tests/cf-logs-panel.e2e.spec.ts:432 | User can read full raw messages by default and opt into compact scrolling |
| 09 | 7.4 | tests/region-selector-ui.e2e.spec.ts:1009 | User can sync confirmed scope through the global SAP CAP setting |
| 09 | 7.2 | tests/cf-logs-panel.e2e.spec.ts:1891 | User can pause and resume app logging while keeping collected logs |
| 09 | 7.0 | tests/cf-logs-panel.e2e.spec.ts:1286 | User can see concise CF logs row count summary |
| 09 | 6.8 | tests/region-selector-ui.e2e.spec.ts:1804 | User can search services in Services & Packages |
| 09 | 6.6 | tests/region-selector-ui.e2e.spec.ts:1885 | User can see the mapped folder path via the mapped icon tooltip when root path is long |
| 09 | 6.3 | tests/cf-logs-panel.e2e.spec.ts:1530 | User can use CF logs filters across two rows on narrow windows |
| 09 | 6.2 | tests/region-selector-ui.e2e.spec.ts:361 | User can select area region and organization without recreating selection shell nodes |
| 09 | 6.0 | tests/cf-logs-panel.e2e.spec.ts:1724 | User can use CF logs table area beyond the legacy half-height limit |
| 09 | 5.8 | tests/region-selector-ui.e2e.spec.ts:2508 | User can use area selector when cf-sync topology is unavailable |
| 10 | 9.2 | tests/output-channel.e2e.spec.ts:14 | User can inspect topology scope and SQL actions in the output channel |
| 10 | 8.5 | tests/sql-workbench.e2e.spec.ts:919 | User can copy a SQL result row object and cell value from the context menu |
| 10 | 7.7 | tests/cf-logs-panel.e2e.spec.ts:604 | User can scan CAP remote request logs without generic remote logger noise |
| 10 | 7.4 | tests/cf-logs-panel.e2e.spec.ts:1746 | User can keep selected CF log row while unrelated stream lines append |
| 10 | 7.2 | tests/cf-logs-panel.e2e.spec.ts:1370 | User can enforce CF logs row cap from log limit settings |
| 10 | 7.0 | tests/cf-logs-panel.e2e.spec.ts:522 | User can scan structured CAP events from Endpoint Event summaries |
| 10 | 6.8 | tests/region-selector-ui.e2e.spec.ts:1471 | User can reveal artifact actions on mapped service rows |
| 10 | 6.6 | tests/region-selector-ui.e2e.spec.ts:1770 | User can search services in Apps & APIs |
| 10 | 6.3 | tests/cf-logs-panel.e2e.spec.ts:1457 | User can use CF logs filters with compact panel padding |
| 10 | 6.2 | tests/region-selector-ui.e2e.spec.ts:119 | User can open selector and pick region in light theme |
| 10 | 6.1 | tests/region-selector-ui.e2e.spec.ts:2382 | User can return from Quick space view and reset Quick state through tab switching |
| 10 | 5.8 | tests/region-selector-ui.e2e.spec.ts:2415 | User can see disabled Quick confirmation when a topology org has no spaces |
| 11 | 9.0 | tests/sql-workbench.e2e.spec.ts:1674 | User can see centered loading state while selected app tables load |
| 11 | 8.5 | tests/apis-tab.e2e.spec.ts:64 | User can open APIs webview from Log-API-Event tab |
| 11 | 7.7 | tests/apis-tab.e2e.spec.ts:251 | User can open Event viewer from Log-API-Event tab |
| 11 | 7.4 | tests/cf-logs-panel.e2e.spec.ts:1581 | User can stream CF log bursts without excessive table rerenders |
| 11 | 7.2 | tests/cf-logs-panel.e2e.spec.ts:975 | User can remove a stopped app from the CF logs dropdown |
| 11 | 7.1 | tests/workspace-tabs.e2e.spec.ts:336 | User can switch between Logs Apps and SQL without removed workspace controls appearing |
| 11 | 6.8 | tests/cf-logs-panel.e2e.spec.ts:1859 | User can see the file logging dropdown defaulting to stream-only |
| 11 | 6.6 | tests/cf-logs-panel.e2e.spec.ts:1223 | User can toggle Source and Stream columns in CF logs settings |
| 11 | 6.3 | tests/cf-logs-panel.e2e.spec.ts:1122 | User can open CF logs settings with default column state |
| 11 | 6.2 | tests/region-selector-ui.e2e.spec.ts:119 | User can open selector and pick region in dark theme |
| 11 | 6.1 | tests/region-selector-ui.e2e.spec.ts:1993 | User can logout from settings and return to login gate |
| 11 | 5.8 | tests/region-selector-ui.e2e.spec.ts:2127 | User can filter Quick Org Search results by typing a query |
| 12 | 8.6 | tests/region-selector-ui.e2e.spec.ts:2458 | User can scroll Custom selection on a short sidebar |
| 12 | 8.6 | tests/sql-workbench.e2e.spec.ts:645 | User can run manual SQL with lower-case app table references in selected schema |
| 12 | 7.9 | tests/sql-workbench.e2e.spec.ts:1500 | User can use SQL workbench with bounded app and table lists |
| 12 | 7.4 | tests/cf-logs-panel.e2e.spec.ts:1316 | User can update CF logs table typography from font size settings |
| 12 | 7.2 | tests/cf-logs-panel.e2e.spec.ts:889 | User can see multiline stack traces escalated to error level |
| 12 | 7.1 | tests/region-selector-ui.e2e.spec.ts:1512 | User can keep mapped services when Select Root Folder is cancelled |
| 12 | 6.8 | tests/cf-logs-panel.e2e.spec.ts:1062 | User can see CF logs reset to empty state when apps fetch fails |
| 12 | 6.6 | tests/cf-logs-panel.e2e.spec.ts:181 | User can keep CF logs app selector empty until app logging starts |
| 12 | 6.3 | tests/cf-logs-panel.e2e.spec.ts:1020 | User can see CF logs empty state when selected space has no running apps |
| 12 | 6.2 | tests/cf-logs-panel.e2e.spec.ts:157 | User can open CF logs panel with table and filter controls |
| 12 | 6.1 | tests/region-selector-ui.e2e.spec.ts:306 | User can select EU20 extension landscape from Europe area |
| 12 | 5.8 | tests/region-selector-ui.e2e.spec.ts:2104 | User can start from Custom tab when synced topology has no orgs |
