# SAP Tools VS Code Extension

SAP Tools is a VS Code extension focused on SAP BTP development workflows.

## Current Features
- SAP Tools activity-bar sidebar for login, SAP BTP area/region/org/space selection, Quick Org Search, scope restore, and cache sync controls.
- CFLogs bottom-panel view for app log filtering, recent log fetches, live stream state, column visibility, font-size, and log-limit settings.
- Workspace `Logs`, `Apps`, and `SQL` tabs for app logging, local service-folder mapping, service artifact export, SQLTools config export, and HANA SQL workflows.
- Local npm package build & publish: from the Apps tab, a per-service **Build & Publish** button scans the root folder for locally-developed packages, builds them in dependency order, publishes them to a self-hosted Verdaccio registry (auto-installed and managed under `~/.saptools/verdaccio`), and reinstalls them in the service.
- S/4HANA SQL Workbench for app-scoped SQL files, HANA table discovery, readable table names, SQL completions, quick `SELECT`, manual execution shortcuts (single or multi-statement batches with auto-rollback on failure), and CSV/JSON result export.
- Sanitized SAP Tools output-channel logging for CF CLI and SQL command visibility without exposing credentials.

## Configuration
- `sapTools.sharedCapDebugConfig.remoteRoot` (User settings): remote source root inside the CF app container used to locate exported artifacts such as `pnpm-lock.yaml`. Accepts a fixed path (e.g. `/home/vcap/app`) or a regex (`regex:<pattern>` or `/pattern/flags`) resolved per CF app via `cf ssh` against the container's `package.json` folders. SAP Tools falls back to the CDS Debug extension's `cdsDebug.sharedCapDebugConfig`, so a single configuration serves both extensions.
- `sapTools.appFolderMappings` (User settings): explicit `{ "appName", "folderName" }` entries that map a Cloud Foundry app to a local source folder basename in the Apps tab when the names differ too much for automatic `-`↔`_` matching. Merged with the CDS Debug extension's `cdsDebug.appFolderMappings` (SAP Tools entries win on conflicts), so a single configuration serves both extensions.
- `sapTools.localPackages.namePatterns` (User settings): comma-separated patterns matched against each repo's `package.json` `name` to mark which folders under the root are locally-developed npm packages (e.g. `@example/`). A pattern that is not valid regex is matched literally. Detection keys off the name, not a `build` script, so dependency-only packages are still found. Empty disables local-package scanning.
- `sapTools.localPackages.versionBumpStrategy` (`prerelease-timestamp` | `none`, default `prerelease-timestamp`): make each publish version unique so the local registry accepts the republish, restoring the original `package.json` version afterward.
- `sapTools.localPackages.installInServiceAfterPublish` (default `true`): run `npm install` in the service after publishing so it picks up the fresh package versions.
- `sapTools.localRegistry.port` (default `4873`), `sapTools.localRegistry.scopes` (default derived from `namePatterns`), `sapTools.localRegistry.defaultTag` (default `staging`), and `sapTools.localRegistry.autoStart` (default `true`) configure the self-hosted Verdaccio registry.

## Development
```bash
npm install
npm run build
npm run validate
npm run test:unit
```

To debug the extension, press `F5` in VS Code.
