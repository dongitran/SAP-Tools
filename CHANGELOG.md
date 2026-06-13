# SAP Tools Extension Changelog

## 0.10.71 (stable)
- Feature: Added a draggable Resizer between the endpoints sidebar and main panel.
- Feature: Reorganized OData Query Parameters layout for a more compact 50/50 split of `$filter` and `$expand`.
- Feature: Cleaned up Auth Settings by moving it to a Popover toggled via a new Gear icon.
- Feature: Endpoints in the sidebar now truncate to 2 lines and show full name on hover. URL input also shows full path on hover.
- UX: Correctly aligned Response tabs (JSON/Grid Data) to the same height as the Response header.

## 0.10.70 (stable)
- Feature: Refactored API Explorer Response layout to be more compact (merged tabs, status, and copy button into a single row).
- Fixed: Ensure "Copy" button works reliably for both JSON view and Grid Data view.

## 0.10.69 (stable)
- Feature: Added support for modifying HTTP methods (POST, PATCH, PUT, DELETE) and submitting a JSON Request Body in the APIs Explorer.
- Feature: Implement Stale-while-revalidate for API catalog caching. This allows instant UI loading while still silently discovering new endpoints in the background.
- Fixed: Resolved an issue where query parameters were incorrectly prefixed with `?` even if the endpoint already contained query strings.
- Fixed: Improved Grid Data "Copy" functionality to support OData v2 (`d.results`) and standard JSON arrays natively.

## 0.10.68 (stable)
- Feature: Implemented local caching for `ApiCatalog` to speed up API discovery.
- Feature: Auto-drills down into root endpoints to find sub-entities.
- Feature: Webview UI refactored to support partial updates without flickering.
- Feature: Added "Copy" button in the Grid Data view to easily copy results to the clipboard.

## 0.10.67 (stable)
- Fixed: Resolved JSON parsing failure when reading VCAP_SERVICES from container environment variables. This resolves the silent 401 Unauthorized errors when fetching endpoints.

## 0.10.66 (stable)
- Fixed: Resolved an issue where running requests with XSUAA auto-auth would return 401 Unauthorized for users logged in via SSO without explicit email/password in their credentials.

## 0.10.65 (stable)
- Feature: APIs Explorer now discovers actual endpoints directly from the CF app container (parsing remote `.cds` files via SSH) when the standard OData index page is disabled in production environments.

## 0.10.64 (stable)
- Changed: Removed hardcoded `AdminService` fallback when failing to retrieve the APIs catalog.
- Fixed: Improved UI to provide a proper loading spinner and manual URL entry when remote endpoints fail to load.

## 0.10.63 (stable)
- Fix: APIs Explorer now correctly renders endpoints without zero-count badges when no entity count is returned.
- Fix: APIs Explorer now correctly mounts execution requests by using the explicit root-resolved entity path instead of appending the entity name to a potentially undefined base path, resolving "Cannot GET /" execution errors.

## 0.10.62 (stable)
- Fix: Local Workspace Discovery fallback for production CAP apps where root metadata index is disabled.
- Fix: Implement XSUAA OAuth client credentials fetching to fix "XSUAA Client (Auto)" mode.
- Fix: Use E2E bypass mock to resolve Playwright timeouts in APIs Explorer.

## 0.10.61 (stable)
- Fix APIs Explorer E2E test timeout and webview crash.
- Ensure only single call to acquireVsCodeApi in webview scripts.

## 0.10.59 (stable)
- Fix APIs Explorer webview panel E2E tests and layout gap issues.
- Re-architected APIs Explorer to run as a full Webview Panel instead of a sidebar frame.

## 0.10.58 (stable)
- Fix workspace UI alignment (tabs display properly as 3 columns)
- Ensure APIs Explorer webview navigation is handled via workspace tab switching instead of popup frames.
- Resolved 404 iframe bugs in standalone design.html mode.

## 0.10.57 (stable)
- **UI:** Refined APIs Explorer mock data and UI naming for a more neutral design.

## 0.10.56 (stable)
- **Fix:** Prevent reusing stale database connections when the active session provider explicitly returns null (e.g. after logging out), ensuring that query execution throws the correct "No active CF scope session" error instead of falling back to a cached connection.

## 0.10.55 (stable)
- **Fix:** SQL execution and table caching now dynamically use the extension's active Cloud Foundry scope session. Switching space/org/region now correctly invalidates stale database connections and runs queries against the new space's database even if the SQL file was already open.

## 0.10.54 (stable)
- **Feature:** Normalize SharePoint URL protocol and rename OAuth2 references to Entra ID.

## 0.10.53 (stable)
- **UI:** Microsoft Graph tool screens now use the selected tool name as the main header, removing the duplicate inner `Tools` title row.
- **UI:** Outlook OAuth2 and SharePoint client secret fields now include an eye toggle so the entered secret can be reviewed and hidden again without leaving the form.

## 0.10.52 (stable)
- **UI:** Renamed the Apps workspace header from **Monitoring Workspace** to **BTP Workspace** and added a Tools icon between **Change Region** and Settings.
- **Feature:** Added a Microsoft Graph Tools screen with Outlook OAuth2 mail testing and SharePoint smoke testing, including credential validation, real test actions, and animated verification steps.
- **Security:** Graph client secrets are used only for the current extension-host request and are not persisted or written to output logs.

## 0.10.51 (stable)
- **Fix:** Package builds now clean up the previous local-registry version behind the same dist-tag after a new version publishes successfully, so repeated **Build** and **Build All** runs no longer keep piling up old tag versions.
- **Enhancement:** Service-row **Replace** now also updates detected local package dependency specs in the mapped service `package.json` to the active dist-tag, so the next install resolves the newest published package for that scope.

## 0.10.50 (stable)
- **UI:** Services & Packages now shows mapped/unmapped service state as compact leading icons: a green link for mapped services and a red unlink for unmapped services. The old trailing text badges were removed.
- **Fix:** Mapped service row hover actions remain visible and clickable for **Replace** and **Export**.
- **UI:** Removed the workspace footer "Last sync" line from the extension sidebar.

## 0.10.49 (stable)
- **Feature:** The CFLogs panel toolbar gained a file-logging dropdown (left of the gear button, default **No file log**). Choosing **Log to file** keeps streaming as before and additionally writes each app's logs to a timestamped file (`<app-name>_<YYYY-MM-DD_HH-mm-ss>.log`) — one fresh file per logging run, surviving stream reconnects. The target folder is configurable via the new `sapTools.cfLogs.fileLogDirectory` setting (defaults to `~/.saptools/cflogs`).
- **Feature:** Active app logs in the sidebar can now be **paused and resumed**, not just stopped. Pausing freezes the CFLogs panel display so collected rows stay reviewable while the `cf logs` session keeps running in the background (file logging keeps capturing); resuming flushes the lines buffered during the pause. The panel summary shows a paused/live indicator for the selected app.

## 0.10.48 (stable)
- **Fix:** SQL workbench result tables now display BOOLEAN columns as `true`/`false` instead of `0`/`1`. The HANA connection now requests data format version 7, so the server sends BOOLEAN columns with their native wire type instead of downgrading them to TINYINT.

## 0.10.47 (stable)
- **Feature:** Removed the standalone "Export Artifacts" button. Each mapped service row now shows **Export** and **Replace** buttons on hover (at the position of the "Mapped" badge). **Export** triggers artifact export directly; **Replace** permanently replaces the configured `packageJsonTagPlaceholder` strings in the service's `package.json` with the active CF dist-tag (no revert).

## 0.10.46 (stable)
- **Fix:** "Published" labels in the Packages list no longer flicker when clicking an app in the Services list. The packages section now skips DOM mutation when its rendered content is unchanged.

## 0.10.45 (stable)
- **Enhancement:** `sapTools.localPackages.packageJsonTagPlaceholder` now accepts multiple comma-separated placeholders (e.g. `${BRANCH}, {branch}`); each is trimmed and all occurrences in `package.json` are replaced with the active CF dist-tag before building.

## 0.10.44 (stable)
- **Feature:** Added `sapTools.localPackages.packageJsonTagPlaceholder` setting. When set (e.g. `${BRANCH}`), SAP Tools finds that string in each package's `package.json` and temporarily replaces it with the active CF dist-tag (e.g. `cf-finance-prod`) before building, then automatically restores the original file after publishing — keeping the git tree clean.

## 0.10.43 (stable)
- **Fix:** Failed package rows now include the retry Build action on hover, matching published rows while keeping the warning icon visible at rest for error details.

## 0.10.42 (stable)
- **Feature:** Added `sapTools.localPackages.deleteNpmrcBeforeBuild`, a default-enabled Configure checkbox that deletes each local package's `.npmrc` before the package install/build step to avoid stale registry overrides.

## 0.10.41 (stable)
- **Fix:** Build All no longer shows the transient "Building & publishing packages…" line or the final published-count summary in the sidebar; package rows still update inline.
- **Fix:** Local package publish versions now use the active CF `space-org` suffix (for example `1.0.0-uat-origin-1700`) instead of carrying older `org-space` prerelease suffixes.
- **Fix:** Empty `sapTools.localRegistry.defaultTag` now derives tags in `space-org` order, such as `cf-uat-finance-services-prod`, to match the local publish-version namespace.

## 0.10.40 (stable)
- **Fix:** Leaving `sapTools.localRegistry.defaultTag` empty now publishes local packages under a tag derived from the active Cloud Foundry space and org, such as `cf-uat-finance-services-prod`, reducing cross-space package mix-ups when package names are reused.
- **Fix:** Duplicate local package names under the selected root folder now fail with a clear error instead of silently choosing one folder.

## 0.10.39 (stable)
- **UI:** The "Build All" button is now simply disabled (without showing a 0% progress indicator) when a single package build is triggered.
- **UI:** During a "Build All" operation, hovering over any package row will no longer reveal the "Build" button. The hover capability is restored only after the entire "Build All" process completes.

## 0.10.38 (stable)
- **Fix:** Fixed a JavaScript ReferenceError (`pkg is not defined`) in `updateSinglePackageBuildUI` that was causing the UI updates to silently crash when clicking the "Build" button or during progress updates.

## 0.10.37 (stable)
- **Feature:** Added the ability to hover over a "Published" package row to reveal the "Build" button again, allowing users to quickly manually trigger rebuilds for already-published packages.

## 0.10.36 (stable)
- **Fix:** Fixed progress calculation exceeding 100% by ensuring only the final 'publish' phase completion is counted toward the total.
- **Fix:** Eliminated visual flickering of previously published package labels by preventing full UI list re-renders during progress ticks.
- **Fix:** Ensure the "Building..." loading spinner displays immediately and stably on the active package row during a "Build All" run.

## 0.10.35 (stable)
- **Fix:** Restored the "Build" button as a disabled button with a spinner during single-package builds, rather than replacing it with plain text.
- **Fix:** Fixed an issue where "Published" labels on previously built packages would disappear when building another package individually.

## 0.10.34 (stable)
- **Feature:** "Building..." UI state now correctly updates on individual packages during the "Build All" flow, providing clearer progress indication.
- **Fix:** Fixed a potential issue where packages missing a `build` script (e.g. dependency-only packages) would fail during publish due to skipped `npm install` for prepublish requirements. `pnpm install` is now guaranteed to run for all packages.
- **Refactoring:** Unified action-cell state rendering logic for Single and Batch package builds in the UI frontend for better maintainability.

## 0.10.33 (stable)
- **Fix:** Fixed issue where the "Build All" button would show a loading state when building a single package.
- **Fix:** "Published" labels are now preserved correctly when building other packages sequentially.
- **Fix:** "Build All" flow now properly applies the "Published" label to each completed package inline.
- **Fix:** Added a 10-minute timeout to `npm run build` and `pnpm install` during the package publish flow to prevent indefinite hangs and surface errors if they stall at ~60%.

## 0.10.32 (stable)
- **Refactoring:** Split `07-render.js` (3385 lines) into 6 focused source modules (`07a` through `07f`) — core render, topology, selection screen, workspace, SQL workbench, and shared utils. Zero code changes; build output remains identical.

## 0.10.31 (stable)
- **Fix:** "Services & Packages" title no longer reverts to "Export Service Artifacts" when the registry badge appears after a build.
- **Fix:** "Published" badge on single package build now stays visible permanently (no longer fades out after 2s).
- **Feature:** Build All button now shows a spinner and real-time `%` progress (e.g. `⟳ Build All – 40%`) during bulk builds.
- **Feature:** Each package that completes during a Build All run immediately shows a permanent ✓ Published badge on its row.
- **Fix (packageBuilder.ts):** Added `--config.node-linker=hoisted` flag alongside `--shamefully-hoist` to pnpm install so the hoisted layout is applied consistently.

## 0.10.30 (stable)
- **UI/UX Tweaks:** Adjusted layout balance in the service export tab so the Packages list takes up to a maximum of 40% height, granting the Apps list a minimum of 60% height.

## 0.10.29 (stable)
- **Refactoring:** Split `prototype.css` into multiple modular source files (`src/styles/`) and integrated CSS compilation into the automated build script to improve maintainability with zero UI regressions.

## 0.10.27 (stable)
- **UI/UX Tweaks:**
  - Prevent package row height jump during build state transitions by normalizing button and status indicator heights.
  - Remove hover shift (`translateY(-1px)`) and reduce width for package "Build" buttons.
  - Add padding to empty packages message.
  - Make package list take up to a maximum of 50% available vertical space, splitting fairly with the App logs list.
  - Rename "Export Service Artifacts" tab title to "Services & Packages".

## 0.10.26 (stable)
- **Refactoring:** Split `prototype.js` into multiple modular source files (`src/`) and added an automated build script to concatenate them back into `assets/prototype.js` to improve maintainability while ensuring zero regression in runtime scope or VS Code webview execution.

## 0.10.25 (stable)
- Fine-tune package list layout to precisely match the app log list styling.



## 0.10.24 (stable)
- Reduce height of "Build All" and "Configure" buttons by 18%.
- Remove "Selected service: ..." and "Selected ... for export." UI lines.
- Move local registry status from a standalone row to a compact inline badge next to "Export Service Artifacts" heading (no more Start/Stop registry button).
- Restyle package list rows to match the service mapping list style (bordered rows, flat background, name-first layout).


- Replace full error text in package list with a compact red ⚠ icon to prevent layout breakage on build errors.
- Hover the error icon to see the full error message via native tooltip.
- Click the error icon to copy the error message to clipboard (brief green flash confirms copy).

## 0.10.22 (stable)
- Fix package list scroll jumping on UI re-renders by explicitly preserving and restoring the scroll position of both the package list and the main view.
- Support local registry state updates dynamically without requiring a full package list redraw.

## 0.10.21 (stable)
- Fix local package list scroll position jumping to the top when initiating a single package build.
- Remove hover transform effect on the single package build button and adjust its width.

## 0.10.20 (stable)
- Fix `pnpm install` during local package build to correctly use the local Verdaccio registry instead of the public npm registry.

## 0.10.19 (stable)
- Fix local package building to run `pnpm i --shamefully-hoist` before `npm run build` to ensure dependencies are present.

## 0.10.18 (stable)
- Hide the package version in the detected packages list (it never changes during normal use, so it added noise).
- Remove the "Mapped x/x services" summary line — the mapping rows already convey that state.
- Per-package **Build** button is now wider (easier hover target) and shows an inline build flow: a loading spinner appears before "Build", the row is disabled while building, then the button is replaced by a green "✓ Built & published" confirmation that auto-hides after ~2s.
- Remove the separate "Build & Publish" panel below the Export Artifacts button; all single-build feedback now happens inline within the package list.
- Building no longer steals focus by auto-opening the "SAP Tools: NPM Build" output channel — logs are still written there and can be opened manually.

## 0.10.16 (stable)
- Remove sensitive internal keywords from the codebase.

## 0.10.15 (stable)
- Generalize `prePublishScript` setting description to emphasize task automation.
- Update default dist-tag for local packages to `local`.
- Adjust Configure button behavior to show all local package and registry settings together.

## 0.10.14 (stable)
- Fix the Configure button targeting a specific setting, now it shows all local packages settings.
- Improve the layout of the package list so the version aligns to the right edge and the Build button overlays perfectly on hover.

## 0.10.12 (stable)
- Fix WebView syntax error preventing the UI from loading.

## 0.10.11 (stable)
- Removed "no build" UI flag; packages without a build script now appear normally.
- Added a "Build" button to each package in the detected local packages list, appearing on hover to build & publish a single package.
- Added `sapTools.localPackages.prePublishScript` configuration to allow running custom JS scripts via Node prior to building/publishing packages.

## 0.10.10 (stable)
- Fix bug where local packages cache was not persisted across VS Code reloads.
- Fix missing loading spinner when updating local packages configuration.

## 0.10.9 (stable)
- Saving `sapTools.localPackages.namePatterns` in VS Code Settings now immediately triggers a re-scan of local packages — no restart required. A loading indicator shows while scanning and the Configure button is disabled during the scan.
- Local package scan results are now cached. On VS Code restart, the cached list is shown instantly while a background re-scan verifies it; if the config has changed, the scan runs fresh.
- Renamed the "NPM Packages" section title to "Packages" and removed the patterns label from the header.
- Renamed the "Build & Publish all" button to "Build All" and matched its height to the "Configure" button.

## 0.10.8 (stable)
- The Apps tab service list now shows only apps actually running on Cloud Foundry (started, instances > 0), matching the Logs tab — stopped and scaled-to-zero apps are no longer listed there.
- Moved "Build & Publish" off the Cloud Foundry app/service rows (those are CF apps, not npm packages). The action now lives on the "NPM Packages" list as a single "Build & Publish all" button that builds and publishes every detected local package to the local registry in dependency order.

## 0.10.7 (stable)
- Fixed the Apps tab layout: the "Search services or mapped paths" box no longer jumps down and breaks the layout. The tab used a fixed-row grid, so inserting the local registry row pushed the flexible (scrollable) row onto the search box; it now uses a flexbox column that is robust to added sections.
- The Apps tab now shows a separate "NPM Packages" list below the services. It scans the selected root folder using `sapTools.localPackages.namePatterns` (you can set multiple comma-separated regexes) and lists each detected local package with its build order (lower builds first) and version, independent of the Cloud Foundry service list. A "Configure" button opens the setting when no pattern is set.
- Removed the "Scope: …" subline under the "Export Service Artifacts" heading and the "Export SQLTools Config" button to declutter the tab.

## 0.10.6 (stable)
- Apps tab service mapping rows are more compact. The long local folder path is no longer shown inline for mapped services, and the "No matching local folder" text is dropped for unmapped ones. The mapped folder path now appears as a tooltip when you hover the "Mapped" badge, so the row no longer wastes space on a long path.

## 0.10.5 (stable)
- Apps tab can now build and publish locally-developed npm packages to a self-hosted local registry. Pick your root folder of sibling repos, set `sapTools.localPackages.namePatterns` (e.g. `@example/`) to mark which repos are packages, and each mapped service shows a **Build & Publish** button. SAP Tools scans the packages, builds a dependency graph, and — in topological order (a package builds only after everything it depends on) — runs each package's `npm run build`, publishes it to a managed Verdaccio registry (auto-installed under `~/.saptools/verdaccio`, started/stopped from the tab), and finally reinstalls them in the service so it picks up the fresh versions. Packages are published under the dist-tag the service requests (e.g. `staging`) with a unique prerelease version each run; the package's own `version` is restored afterward so its git tree stays clean. Build progress and a per-package status list show in the tab; full build/publish logs stream to the `SAP Tools: NPM Build` output channel.

## 0.10.4 (stable)
- CFLogs app filtering now also applies to the sidebar App Logging catalog: the app selection list (where you tick apps and click "Start App Logging") now lists only apps with more than zero running instances, matching the Logs panel selector. The 0.10.3 filter only covered the Logs panel, so stopped and scaled-to-zero apps still appeared in the sidebar catalog. Stopped apps remain available in the Apps workspace (service export).

## 0.10.3 (stable)
- CFLogs now lists only loggable apps in the Logs panel app selector: apps must have more than zero running instances, so stopped and scaled-to-zero apps remain available in the Apps workspace but no longer appear where logs cannot be viewed.

## 0.10.2 (stable)
- SAP Tools SQL Result now uses the full webview width for result tables, removing outer left/right gutters and padding from the result table wrapper and batch result sections.

## 0.10.1 (stable)
- Apps artifact export now also copies remote project metadata files from the resolved app source folder: `package.json`, `.npmrc`, `.cdsrc.json`, and the legacy/typo-compatible `.csdrc.json` when present, alongside `default-env.json` and `pnpm-lock.yaml`, including empty optional files and shell-safe remote paths.

## 0.10.0 (stable)
- Logs/Apps now list every app in a space (including scaled-to-zero apps) from the shared cache, and two-way CF scope sync with the CDS Debug extension works again — changing org/space in one extension follows in the other.

## 0.9.0 (pre-release)
- Fixed CFLogs/Apps no longer following the shared CF scope when it is changed from the sibling CDS Debug extension (and the reverse handoff). The 0.8.8 "list all apps" change made SAP Tools run a blocking Cloud Foundry sync on every space selection — including scope changes handed off from CDS Debug — so both extensions drove the shared `~/.saptools` cf-sync engine at once and contended over its CF config and lock files, breaking the bidirectional scope sync. SAP Tools now serves the app list directly from the shared `cf-structure.json` cache (kept fresh by CDS Debug and by SAP Tools' own confirm-time refresh) and only triggers a sync when that cache has no apps for the space yet (e.g. a SAP-Tools-only install).

## 0.8.8 (stable)
- Fixed CFLogs/Apps showing no apps after selecting a space when the apps are started but scaled to zero (0 running instances) — common in dev subaccounts. The app list now reads from the shared `~/.saptools/cf-structure.json` synced by the CDS Debug extension and lists every app in the space (running, scaled-to-zero, and stopped), matching the CDS Debug app list, instead of only apps with at least one running instance from this extension's own (initially empty) cache.

## 0.8.7 (stable)
- SQL Workbench now runs unlimited INSERT/batch statements (removed the 100-statement cap) and shows a colored progress band at the top of multi-statement results that streams live OK / Failed / Skipped / Pending counts and a progress bar, updating in place without reloading the result view.
- Increased the HANA connection handshake timeout and added automatic retry for cold HANA Cloud instances, so the first query after the database wakes from auto-suspend no longer fails with "No initialization reply received within 5 sec".
- CFLogs serializes CF CLI session preparation on the shared CF home and lets a freshly started log stream re-target and recover automatically, so the first "Start App Logging" no longer surfaces transient "No org targeted" / "Not logged in" / "App not found" errors before working on a retry.

## 0.8.6 (stable)
- CFLogs now shows full Message column content by default, with an optional settings checkbox to restore compact row-local scrolling for long messages.
- Shortened Apps tab artifact export completion text to show only exported artifact filenames while keeping full paths in the Output channel for diagnostics.

## 0.8.5 (stable)
- Added a `sapTools.appFolderMappings` setting so Apps-tab service-folder mapping can resolve apps whose CF name differs too much from the local folder for the automatic `-`↔`_` normalization.
- Explicit mappings take the highest matching priority and are reported as exact matches; `folderName` is a basename searched recursively (depth ≤ 6) for a folder containing a `package.json`.
- Merged these with the CDS Debug extension's `cdsDebug.appFolderMappings` (SAP Tools entries win on conflicting app names), so a single configuration serves both extensions.

## 0.8.4 (stable)
- Added a shared `sapTools.sharedCapDebugConfig.remoteRoot` setting so service artifact export can locate `pnpm-lock.yaml` when it does not live at the standard `/home/vcap/app` path.
- `remoteRoot` accepts a fixed path or a regex (`regex:<pattern>` or `/pattern/flags`) that is resolved per CF app via `cf ssh` against the container's `package.json` folders.
- Reused the CDS Debug extension's `cdsDebug.sharedCapDebugConfig` as an automatic fallback, so a single configuration serves both extensions; SAP Tools-only installs can configure it standalone.

## 0.8.3 (stable)
- Added bottom spacing inside multi-statement SQL Workbench result tables so the horizontal scrollbar no longer sits flush against the last row and stays easy to grab.
- Removed the multi-statement SQL batch summary row and per-statement elapsed chips so batch results focus on individual statement output.
- Aligned SQL result table names with the readable names used in the sidebar table list, including manual statements and quick table SELECT results.
- Narrowed the SQL result `#` row-number column and rendered HANA BOOLEAN columns as `true`/`false` instead of numeric `1`/`0`.

## 0.8.2 (stable)
- Cached HANA table lists per user, endpoint, org, space, and app so SQL Workbench table suggestions reopen quickly without leaking scope data.
- Added explicit table refresh behavior that reloads HANA metadata and updates the scoped cache when users need fresh table lists.
- Hardened table-cache reads and writes, raised quick table SELECT actions to `LIMIT 100`, and increased the HANA query timeout for larger metadata queries.

## 0.8.1 (stable)
- Added multi-statement HANA SQL execution from the SQL Workbench, including sequential batch execution on one connection so session state is preserved.
- Wrapped mutating multi-statement batches in transactions with rollback on failure and skipped-state reporting for remaining statements.
- Added stacked batch result rendering with per-statement result sections and combined CSV/JSON export actions.

## 0.8.0 (stable)
- Added the `eu10-006` (Europe/Frankfurt, AWS) Cloud Foundry landscape to the region catalog and bumped `@saptools/cf-sync` to `0.4.10`, so the region picker and CF cache sync now cover all 50 SAP BTP regions.
- Updated the VS Code Activity Bar and panel icon to use a monochrome isometric cube that matches the Marketplace logo.

## 0.7.56 (pre-release)
- Updated the Marketplace extension icon to use the new isometric cube PNG asset.

## 0.7.55 (pre-release)
- Reopened HANA SQL app contexts when the selected CF region, org, space, or credentials change so same-name apps do not reuse stale database credentials.
- Refreshed expired cached CF sessions before live org or space resolution instead of surfacing generic quick-scope confirmation failures.
- Deferred Quick Org Search scope state updates until CF login and org lookup both succeed, preserving the previous active session on failed confirms.

## 0.7.54 (pre-release)
- Parsed CAP remote request logs in CFLogs so `Endpoint / Event` shows the real request target instead of the generic `remote` logger.
- Filled CFLogs method, tenant, client IP, and request ID columns from structured CAP log metadata when available.
- Updated CFLogs prototype and E2E coverage for Event Mesh/CAP remote request log samples.

## 0.7.53 (pre-release)
- Kept CFLogs Message cells and row-copy output aligned to the raw log body so JSON metadata remains visible and searchable.
- Added compact Endpoint / Event summaries for structured CAP-style JSON, inspect-style messages, and stack traces.
- Updated CFLogs prototype and E2E coverage with synthetic raw JSON, continuation, and endpoint-summary scenarios.

## 0.7.52 (pre-release)
- Restored SAP Tools from external `sapCap.currentScope` changes even before SAP Tools has an active CF region session.
- Established the target region session on demand while keeping cache/test-mode org resolution first.
- Guarded rapid external scope changes so stale restores cannot overwrite the latest shared scope.

## 0.7.51 (pre-release)
- Avoided duplicate S/4HANA SQL Workbench cache invalidation during successful external scope restore.
- Reloaded SQL Workbench table metadata for callers that were waiting while scope invalidation happened.
- Detached CF logs stream listeners before stopping requested log processes.

## 0.7.50 (pre-release)
- Cleared CF logs apps and active logging state immediately when an external shared scope change cannot be restored.
- Invalidated S/4HANA SQL Workbench app credentials and table metadata when the confirmed scope changes.
- Guarded in-flight HANA table preload results so stale tables cannot repopulate after scope invalidation.

## 0.7.49 (pre-release)
- Matched the Quick Org Search Back button width to Confirm Scope in the space selection step.
- Strengthened E2E coverage so Back and Confirm Scope rendered widths must stay aligned.

## 0.7.48 (pre-release)
- Auto-selected the only available space after picking a one-space org in Quick Org Search.
- Added inline Region and Organization search controls inside Custom selection headers.
- Increased the Quick Org Search Back button tap target and covered the updated selection flows with E2E tests.

## 0.7.47 (pre-release)
- Kept Quick-confirmed workspaces showing the selected organization name even when the manual organization list has not been loaded.
- Reworked the Quick Org Search selected-org view to mirror Custom selection with focused Organization and Choose Space sections.
- Removed the extra confirmation card wrapper in both Quick Org Search and Custom selection so Confirm Scope stands on its own.

## 0.7.46 (pre-release)
- Reworked Select SAP BTP Region into Quick Org Search and Custom tabs when synced topology is available.
- Made Quick Org Search org picks instant by resolving spaces from the local topology snapshot and confirming scope only after a space is chosen.
- Fixed Custom selection scrolling on short sidebars and expanded E2E coverage for topology-ready, empty-topology, no-topology, no-space, and quick-confirm flows.

## 0.7.45 (pre-release)
- Added the shared `sapCap.currentScope` VS Code global setting so confirmed SAP BTP scopes can be read by other extensions.
- Restored SAP Tools scope from external `sapCap.currentScope` changes when a CF session is active, reusing the existing confirmed-scope hydration path.
- Hardened service mapping persistence so mapped services are durable before the Apps export table reports them as mapped.

## 0.7.44 (pre-release)
- Removed the transient SQL Workbench `Opening SQL file for app...` status text so app selection relies on the existing animated table-loading indicator.
- Kept SQL status messages reserved for error states while preserving table-load spinner, row rendering, and quick-select feedback behavior.
- Strengthened SQL Workbench E2E coverage to catch transient opening text during delayed table loading.

## 0.7.43 (pre-release)
- Moved the `eu10-004` Europe (Frankfurt) AWS extension landscape into the Europe region group and sorted regions within each area by display name, then region id.
- Renamed the Organization stage heading and added an organization search input that filters org options, clears on empty input, and resets when users choose another region.
- Updated prototype and E2E coverage for Organization search, Europe extension landscape selection, and BR10 organization counts.

## 0.7.42 (pre-release)
- Fixed the Settings screen so Cache Sync Interval and Sync Status use compact natural vertical flow instead of inheriting full-height workspace grid stretching.
- Kept Logs and Apps full-height workspace panels unchanged while adding e2e coverage for Settings from both selection and workspace headers.
- Verified Settings layout in the prototype gallery across dark, light, high-contrast, and narrow viewport states with long account/status text.

## 0.7.41 (pre-release)
- Hardened E2E coverage around login-gate validation, app-catalog failure states, and SAP Tools output-channel log visibility.
- Standardized E2E test titles so they describe user-facing behavior consistently.
- Aligned SQLTools config export success logs with the `[export]` output-channel bucket.

## 0.7.40 (pre-release)
- Kept Quick Org Search visible throughout the selection screen after area/region selection, topology org picks, stage changes, and returning from the workspace with Change Region.
- Added selected-state treatment for Quick Org Search rows so the current topology-picked org is visible while users can still switch to another org in one click.
- Logged live `cf logs <app>` stream commands to the SAP Tools output channel, matching existing sanitized CF CLI command visibility.

## 0.7.39
- Promoted the current SAP Tools workflow surface to a stable release covering scope selection, CFLogs, service artifact exports, SQLTools export, and the S/4HANA SQL Workbench.
- Added the What News prototype page with four release cards for Scope, Logs, Apps, and SQL so the stable feature set is easy to review before publishing.
- Refreshed release-facing documentation for the stable feature set.

## 0.7.38 (pre-release)
- Added a Quick Org Search panel above the area selector that lists every org synced by `@saptools/cf-sync` across regions so users can pick an org by name without first stepping through area, region, and org screens.
- Wired `@saptools/cf-sync` topology into the SAP Tools sidebar with a snapshot push and a refresh after scope confirmation, plus output-channel logs tagged `[topology]` and `[scope]` for visibility into each command.
- Hid the topology panel automatically once a region is selected (or when no `cf-structure.json` snapshot exists) so the legacy area/region/org/space cards stay as the fallback path.
- Validated topology selections against the SAP Tools region catalog and resolved org GUIDs from the cache or live CF API before posting the resolved scope back to the webview.

## 0.7.37 (pre-release)
- Removed the SQL result panel's 250-row render cap so queries display all returned rows in the result table.

## 0.7.36 (pre-release)
- Resolved SQL Workbench manual execution so exact uppercase app table names are schema-qualified against the selected app, matching readable display-name behavior.

## 0.7.35 (pre-release)
- Resolved SQL Workbench manual table execution so lower-case app table references are logged and resolved against the selected app schema before HANA execution.
- Preserved the SQL app-list scroll position when selecting lower apps and when the selected app's table list finishes loading.
- Expanded the Logs and Apps workspace tabs so their main lists use the full available sidebar height.

## 0.7.34 (pre-release)
- Added the missing SAP Help Cloud Foundry extension landscapes `us10-002`, `eu10-002`, `eu10-003`, `eu10-005`, `eu20-001`, and `eu20-002` to the region picker with endpoint coverage.

## 0.7.33 (pre-release)
- Added the `us10-001` Cloud Foundry extension landscape to the Americas region picker with endpoint support for `https://api.cf.us10-001.hana.ondemand.com`.

## 0.7.32 (pre-release)
- Added the `eu10-004` Cloud Foundry extension landscape to the Americas region picker while preserving its Europe (Frankfurt) label and endpoint shape.
- Preserved extension landscape API endpoints such as `https://api.cf.eu10-004.hana.ondemand.com` and restored confirmed `eu10-004` scopes across extension host reloads.
- Added sanitized SAP Tools output logs for CF CLI command execution without logging SAP credentials.

## 0.7.31 (pre-release)
- Expanded the three workspace tabs so `Logs`, `Apps`, and `SQL` divide the full tab bar width evenly after removing Debug.
- Kept the equal-width tab layout in compact sidebars and added e2e layout assertions for full-row coverage.

## 0.7.30 (pre-release)
- Removed the workspace Debug tab from the extension and prototype so the workspace now exposes only `Logs`, `Apps`, and `SQL`.
- Removed the Cloud Foundry debugger service, message bridge, e2e flow, vendoring script, and `@saptools/cf-debugger` runtime dependency from the packaged extension.
- Added focused e2e and manifest coverage to prevent removed Debug UI controls or runtime packaging from returning.

## 0.7.29 (pre-release)
- Reopened saved SQL editor files from their existing workspace file URI instead of recreating an associated `untitled:` document, avoiding `file already exists` errors after save.
- Added e2e coverage for saving an app SQL editor and selecting the same app again without showing a reopen error.

## 0.7.28 (pre-release)
- Fixed successful direct HANA DML callbacks that omit the error argument so `UPDATE`, `DELETE`, and `INSERT` render affected-row/status results instead of generic `hdb exec failed.` errors.
- Kept mutating SQL execution popup-free while preserving sanitized output-channel command logs.
- Isolated e2e VS Code extension hosts with a temporary extensions directory and hardened SQL suggest triggering so unrelated local extensions cannot steal editor focus.

## 0.7.27 (pre-release)
- Changed SQL result metadata to show the resolved table name instead of the app name and removed final `Executed:` timestamp chips from result views.
- Opened app SQL editors with workspace-associated untitled file paths so saving `saptools-*.sql` writes inside the current workspace instead of the filesystem root.
- Executed mutating HANA SQL through direct `hdb` execution without a confirmation popup, rendering affected-row/status results while keeping output logs scrubbed for string literals.
- Updated the SQL prototype, unit tests, and e2e coverage for table metadata, SQL editor save behavior, and direct update execution.

## 0.7.26 (pre-release)
- Added SQL result row hover styling so data rows visibly respond without changing result table sizing.
- Added a right-click result-cell context menu with silent `Copy row object` and `Copy cell value` actions.
- Reused duplicate-safe JSON export keys for row-object copy and logged only copy action metadata, not query result data.
- Updated the SQL prototype, unit tests, and e2e coverage for row/cell context copy behavior.

## 0.7.25 (pre-release)
- Decoded text-like HANA Buffer/LOB result cells as readable UTF-8 text so JSON payloads no longer appear as `0x...` hex.
- Preserved hex rendering for invalid UTF-8 or control-byte binary values to avoid misrepresenting binary data.
- Updated SQL prototype, unit tests, and e2e coverage for readable JSON result rendering and Copy JSON output.

## 0.7.24 (pre-release)
- Removed visible SQL result export/copy feedback text such as `JSON copied to clipboard.` while keeping clipboard and export actions functional.
- Kept SQL result export/copy actions logged to the SAP Tools output channel without rendering transient status messages in the result webview.
- Updated prototype, unit tests, and e2e coverage to verify silent copy behavior while still validating clipboard CSV/JSON output.

## 0.7.23 (pre-release)
- Opened SQL result tabs immediately for manual SQL and table quick-select flows, showing a centered animated loading state before query data returns.
- Added a result export menu with Copy CSV, Copy JSON, Export CSV, and Export JSON actions, backed by CSP-protected webview messaging and output-channel action logs.
- Updated the SQL prototype and e2e coverage for immediate result loading, export-menu visibility, and clipboard CSV/JSON formatting.

## 0.7.22 (pre-release)
- Fixed manual SQL execution for readable table names such as `Demo_App` by schema-qualifying selected-app display references even when the raw HANA name is uppercase-safe.
- Hardened SQL table-reference resolution for quoted schema qualifiers, comma joins, derived-table aliases, CTE references, and ambiguous display/raw table-name collisions.
- Updated prototype/test data so the SQL table list displays `Demo_App` while preserving raw `DEMO_APP`, with focused unit and e2e coverage for selected SQL execution.

## 0.7.21 (pre-release)
- Resolved SQL table display names such as `Demo_App` to schema-qualified quoted HANA identifiers before execution, so selected/manual SQL uses the same app table context as quick `Select`.
- Added output-channel logging for display-name reference resolution and final SQL command shape while keeping string literal redaction.
- Added a direct `Cmd/Ctrl+Shift+Enter` SQL run shortcut and cleaned Command Palette labels so `SAP Tools: Run HANA SQL` is discoverable without duplicated prefixes.
- Expanded unit, prototype, and e2e coverage for mixed-case table names, selected SQL execution, quick-select schema output, and VS Code command fallback behavior.

## 0.7.20 (pre-release)
- Added a per-table SQL quick-select loading state so the clicked `Select` action shows an animated spinner, remains visible while the query is running, and clears in place after completion.
- Updated SQL table completions to use the same readable display names shown in the Tables list, with matching e2e coverage for the VS Code suggestion widget.
- Kept quick-select UI updates scoped to the affected row/button and added e2e delay coverage for stable loading behavior without re-rendering the table list.

## 0.7.19 (pre-release)
- Reworked SQL result opening so repeated manual queries and table quick-selects reuse an existing editor group instead of creating extra vertical splits.
- Resolved the quick-select source editor from the selected app SQL document so results still target the existing result group even after a previous result webview is active.
- Removed the SQL workbench auto-limit note and suppressed transient `Running SELECT * ...` text while keeping output-channel SQL execution logs.
- Preserved the SQL Tables list scroll position after table `Select` actions and expanded e2e coverage for repeated quick-select layout stability.

## 0.7.18 (pre-release)
- Added a SQL safety guard that automatically appends `LIMIT 100` to manual `SELECT` and `WITH ... SELECT` queries when the user has not supplied a top-level row limit.
- Preserved explicit `LIMIT`, `TOP`, and `FETCH FIRST/NEXT` clauses while ignoring misleading limit text in comments, string literals, quoted identifiers, nested subqueries, and branch-local set-query limits.
- Logged the guarded SQL command shape to the SAP Tools output channel with string literals redacted, and exposed the executed SQL in test mode for e2e verification.
- Added a SQL workbench safety note in the prototype/runtime webview and debounced table search refreshes so typing stays focused with large table lists.
- Hardened SQL, Debug, and workspace-frame e2e assertions; full e2e verifies auto-limit behavior, explicit-limit preservation, stable search focus, and workspace restore after login.

## 0.7.17 (pre-release)
- Removed noisy SQL quick-select success text from the SQL tab and removed the visible `SAP Tools SQL Result` heading from result pages.
- Updated SQL result pages to use VS Code theme variables and content-width result tables so wide schemas and long cell values remain readable with horizontal scrolling.
- Added SQL output logs for open-file, table-load, and quick-select flow, plus tighter unit/e2e coverage for result theming, table layout, and overlay table selection.
- Documented the short prototype/MCP Playwright and e2e test commands in `AGENTS.md`.

## 0.7.16 (pre-release)
- Optimized SQL table-list resize performance by replacing per-row text rewrite/binary-search truncation with cached width measurement and cheap overflow-state toggling.
- Reworked SQL table middle-ellipsis rendering into a fixed head/ellipsis/tail layout so the `…` marker stays visually aligned across rows when space is tight.
- Updated SQL table row layout to use full-width table names and moved the `Select` action into a right-side hover overlay instead of reserving a permanent empty column.
- Expanded SQL e2e assertions to cover narrow-width middle truncation, aligned ellipsis behavior, full-width table names with overlay `Select`, and no text-node mutation churn during resize.

## 0.7.15 (pre-release)
- Reworked SQL table-name fitting so long names measure the available row width after render/resize and only middle-truncate when the full readable name cannot fit.
- Kept the hover-only `Select` action in its own right-side grid column while allowing table names to use the remaining width.
- Added e2e coverage for narrow middle truncation, wide full-name rendering, preserved full display metadata, and non-overflowing table text.
- Synced the prototype cache key and standalone table formatter word list so prototype verification matches extension behavior.

## 0.7.14 (pre-release)
- Improved SQL table readable-name formatting so non-acronym uppercase English segments such as `DEMO_BUSINESSAPP_TEST` render as `Demo_BusinessApp_Test` while configured SAP acronyms remain uppercase.
- Hardened the table-name formatter against low-confidence `wordsninja` splits by rejecting single-letter segmentation and preserving mixed alphanumeric identifiers.
- Reworked SQL table middle truncation so long names render a semantic middle ellipsis without relying on browser tail `text-overflow`.
- Expanded unit and e2e coverage for readable uppercase product segments, 105-table test schemas, search filtering, and visible middle truncation layout.

## 0.7.13 (pre-release)
- Matched the SQL Tables selected database heading typography to table names, including body font, size, weight, and line height.
- Tightened SQL e2e layout coverage so table typography is compared against the visible selected database heading, not only app-list rows.
- Bumped the prototype design CSS cache key so `index.html` reflects the latest SQL typography change.

## 0.7.12 (pre-release)
- Replaced the readable SQL table fixture with a neutral purchase-order sample across the extension, prototype, unit tests, and e2e tests.
- Aligned SQL table-name typography with SQL app-name typography so both use the same body font, size, and weight.
- Extended SQL e2e layout coverage to assert matching app/table font family, size, and weight.

## 0.7.11 (pre-release)
- Added readable SQL table display names for compact SAP/HANA identifiers, using `wordsninja` for segmentation and `change-case` for PascalCase formatting while preserving raw table names for SQL execution.
- Updated the SQL Tables search to match readable display fragments such as `PurchaseOrder` as well as raw table identifiers.
- Vendored `wordsninja` and `change-case` into the packaged extension so `vsce --no-dependencies` builds remain self-contained.
- Added unit and e2e coverage for readable table names, raw identifier preservation, long-name truncation, and quick SELECT behavior.

## 0.7.10 (pre-release)
- Hid SQL table `Select` buttons by default so table names stay visually quiet; the action now appears on row hover or keyboard focus.
- Removed the post-open `SQL file opened for app...` status line from the SQL workbench while keeping error and quick SELECT statuses visible.
- Updated SQL e2e coverage to verify the hover-only table action and the hidden open-success status.

## 0.7.9 (pre-release)
- Improved the SQL Tables panel UX with middle-truncated HANA/CDS table names, preserving both the app/schema prefix and the business suffix while keeping full names available through metadata and accessible labels.
- Fixed the Tables search input losing focus after the first typed character by updating only the table count/list during filtering instead of re-rendering the full SQL workspace.
- Centered the table-loading state with a spinner inside the bounded Tables panel and added deterministic e2e coverage for the loading state.
- Increased table-name vertical padding to improve scanability without breaking the compact 100+ table layout.

## 0.7.8 (pre-release)
- Matched the extension SQL tab to the prototype: the app workbench and Tables panel now render from the initial SQL view and share the remaining height in a bounded 50/50 split.
- Added a Tables search input with the same inline search styling as Logs, compact table rows, and leading truncation for long HANA/CDS table names while preserving full names in titles and accessibility labels.
- Fixed HANA table discovery to query the resolved binding schema instead of relying on `CURRENT_SCHEMA`, with output-channel logging for SQL editor open, table discovery, quick SELECT, and manual SQL execution.
- Expanded SQL test-mode data and E2E coverage for large app lists, 104-table schemas, long table names, hidden/empty/error states, table search, and quick SELECT.

## 0.7.7 (pre-release)
- Split the S/4HANA SQL Workbench tab into an upper app picker and a lower tables panel that lists the selected app's HANA tables, each with a dedicated `Select` button that runs `SELECT * FROM <schema>.<table> LIMIT 10` and opens the result panel.
- Replaced the legacy `ORDER_ID` / `STATUS` / `CREATED_AT` / `AMOUNT` demo preview in the SQL tab so the workbench only renders real apps and real table names supplied by the extension.
- Compacted the SQL result panel for status and error outcomes by collapsing the `App:` and `Executed:` lines into a single ellipsis-truncated line and reducing the page padding to 6px.
- Wired new sidebar messages (`hanaTablesLoaded`, `runHanaTableSelect`, `hanaTableSelectResult`) and an idempotent per-app workbench context map so quick selects reuse the already-resolved HANA connection.
- Extended the SQL workbench unit tests with `quoteHanaIdentifier`, `buildQuickTableSelectSql`, and result HTML layout assertions, and added two e2e tests covering the tables panel quick SELECT and the single-line meta header.

## 0.7.6 (pre-release)
- Fixed `Cannot find module 'safer-buffer'` at runtime by walking the full `hdb` dependency tree and copying every transitive package (including `iconv-lite`, `safer-buffer`, and the optional `lz4-wasm-nodejs`) into `dist/vendor/hdb/node_modules/` during build.
- Added a build-time smoke test in `scripts/vendor-hdb.mjs` that spawns Node to `require` the vendored `hdb` entry and assert `createClient` resolves, so any future missing transitive dependency fails the build instead of shipping broken to users.

## 0.7.5 (pre-release)
- Replaced the `hdbsql` CLI executor with the SAP-maintained `hdb` Node.js driver so HANA SQL no longer requires installing the SAP HANA Client locally.
- Vendored the `hdb` and `iconv-lite` packages into `dist/vendor/hdb` so the `--no-dependencies` packaged extension keeps a self-contained driver.
- Connections now default to TLS (`encrypt`, `sslValidateCertificate`) which matches BTP HANA Cloud requirements out of the box.
- Removed the `sapTools.hanaSqlClientPath` setting, the install-guidance card, the `Download SAP HANA Client` notification, and the `hdbsqlDiscovery` module along with their tests.
- Extended the SQL service tests to cover the new client lifecycle: column-metadata mapping, row-key fallback, affected-row status messaging, auth/connection/SQL/timeout error classification, and statement cleanup on failure.
- Added an e2e regression that asserts the SQL result webview no longer surfaces any legacy `hdbsql` / `hdbclient` / `hanaSqlClientPath` strings.

## 0.7.4 (pre-release)
- Detected the SAP HANA Client automatically when `hdbsql` was missing from `PATH` by probing the default install locations on macOS, Linux, and Windows.
- Added the `sapTools.hanaSqlClientPath` VS Code setting so users could pin an explicit absolute path to `hdbsql` when the client lived outside of the standard locations.
- Rendered a dedicated install-guidance card in the SQL result webview when the HANA Client was missing, including the searched paths, the download link, and the setting to configure a custom path.
- Surfaced actionable buttons (`Download SAP HANA Client`, `Configure hdbsql Path`) on the error notification shown after an hdbsql-missing failure.
- Extracted the SQL workbench pure helpers into a dedicated support module and expanded unit coverage across the template, result HTML branches (resultset, status, generic error, hdbsql-missing), HTML escaping, table/keyword filtering, and hdbsql path resolution.

## 0.7.3 (pre-release)
- Reworked SQL tab flow to app-first workbench behavior: click one app to open its dedicated `.sql` editor immediately.
- Added `SAP Tools: Run HANA SQL` command with SQLTools-like keybinding chord (`Cmd/Ctrl+E`, `Cmd/Ctrl+E`) and document-bound execution context.
- Added HANA SQL execution pipeline with single-statement guard, mutating-statement confirmation, connection resolution from CF app env, and table name suggestions.
- Redesigned SQL result webview to table-first UX for query runs, opening a fresh result tab per execution.
- Expanded unit and e2e coverage for SQL workbench flow, command invocation reliability, and result rendering.

## 0.7.2 (pre-release)
- Renamed the 4th workspace tab from `Settings` to `SQL` and turned its placeholder into an interactive SQL integration hub with a three-step explainer and two actions (`Go to Apps tab` and `Open SQLTools in VS Code`).
- Added a new `sapTools.openSqlToolsExtension` webview → extension message and handler that activates the `mtxr.sqltools` extension and opens its activity bar, with a Marketplace fallback when SQLTools is not installed or the command is unavailable.
- Kept the header gear icon and Settings screen labeled `Settings` because they still manage Cache Sync Interval, Sync Status, and Logout.
- Synced e2e expectations to the new tab label and fixed an indentation regression in the region-selector layout test.

## 0.7.1 (pre-release)
- Packaged the `@saptools/cf-debugger` runtime inside the extension so Debug works from the installed `.vsix` without relying on an external `node_modules` tree.
- Added loader coverage that prefers the vendored debugger runtime in packaged builds and falls back to the npm package only in local development.
- Tightened Debug tab e2e assertions around hidden status/error elements and responsive port visibility in narrow sidebars.
- Updated the `index.html` prototype so the Debug layout matches the extension more closely on narrow widths and no longer shows a prototype-only success note for per-app start or stop actions.

## 0.7.0 (pre-release)
- Replaced the placeholder `Targets` workspace tab with a `Debug` tab that lists every started Cloud Foundry app in the confirmed scope.
- Integrated `@saptools/cf-debugger` to open an SSH tunnel to a CF app's Node inspector and attach the VS Code Node debugger automatically.
- Added per-app `Start` / `Stop` controls plus a workspace-wide `Stop all` action and a search input for the Debug tab.
- Surfaced live status transitions (`Starting`, `Tunneling`, `Ready`, `Attached`, `Tunnel closed`, `Error`) and the forwarded local port for each session.
- Added `SAP_TOOLS_TEST_MODE=1` debug runner and debug API fakes so the e2e suite can exercise the full Debug tab flow without real CF infrastructure.
- New unit and e2e coverage for debugger lifecycle, status transitions, error and stop paths, and app search filtering.

## 0.4.0
- Promoted 0.3.0 workspace mapping/search improvements to stable release.

## 0.3.0
- Matched `Export SQLTools Config` button height with `Export Artifacts`.
- Hardened restored workspace flow to rescan service-folder mappings when root folder and apps are restored after reload.
- Matched `Active Apps Log` heading size with `Apps Log Control`.
- Added service search inputs in Logs tab (`Apps Log Control`) and Apps tab (`Export Service Artifacts`) with inline search icons.
- Updated service mapping path column to keep path tail visible under constrained width (front-side truncation).
- Expanded E2E coverage for restored mapping persistence, new search behavior, and UI consistency checks.

## 0.1.0
- Initial project bootstrap with strict quality gates.
