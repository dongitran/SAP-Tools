# SAP Tools VS Code Extension

SAP Tools is a VS Code extension focused on SAP BTP development workflows.

## Current Features
- SAP Tools activity-bar sidebar for login, SAP BTP area/region/org/space selection, Quick Org Search, scope restore, and cache sync controls.
- CFLogs bottom-panel view for app log filtering, recent log fetches, live stream state, column visibility, font-size, and log-limit settings.
- Workspace `Logs`, `Apps`, and `SQL` tabs for app logging, local service-folder mapping, service artifact export, SQLTools config export, and HANA SQL workflows.
- S/4HANA SQL Workbench for app-scoped SQL files, HANA table discovery, readable table names, SQL completions, quick `SELECT`, manual execution shortcuts (single or multi-statement batches with auto-rollback on failure), and CSV/JSON result export.
- Sanitized SAP Tools output-channel logging for CF CLI and SQL command visibility without exposing credentials.

## Configuration
- `sapTools.sharedCapDebugConfig.remoteRoot` (User settings): remote source root inside the CF app container used to locate exported artifacts such as `pnpm-lock.yaml`. Accepts a fixed path (e.g. `/home/vcap/app`) or a regex (`regex:<pattern>` or `/pattern/flags`) resolved per CF app via `cf ssh` against the container's `package.json` folders. SAP Tools falls back to the CDS Debug extension's `cdsDebug.sharedCapDebugConfig`, so a single configuration serves both extensions.

## Development
```bash
npm install
npm run build
npm run validate
npm run test:unit
```

To debug the extension, press `F5` in VS Code.
