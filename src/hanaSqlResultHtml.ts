import type { HanaQueryResult, HanaQueryResultSet } from './hanaSqlService';

export type SqlResultStatementStatus = 'pending' | 'success' | 'error' | 'skipped';

export interface SqlResultStatementView {
  readonly sql: string;
  readonly status: SqlResultStatementStatus;
  readonly tableName?: string;
  readonly result?: HanaQueryResult;
  readonly errorMessage?: string;
  readonly elapsedMs?: number;
}

export interface SqlResultBatchSummary {
  readonly usedTransaction: boolean;
  readonly committed: boolean;
  readonly rolledBack: boolean;
  readonly transactionUnavailableReason?: string;
  readonly commitFailureMessage?: string;
}

export interface RenderSqlResultOptions {
  readonly appName: string;
  readonly tableName?: string;
  readonly sql: string;
  readonly executedAt: string;
  readonly isLoading?: boolean;
  readonly nonce?: string;
  readonly result?: HanaQueryResult;
  readonly errorMessage?: string;
  readonly statements?: readonly SqlResultStatementView[];
  readonly batchSummary?: SqlResultBatchSummary;
}

/** Webview message types used to stream batch progress without reloading the document. */
export const SQL_BATCH_PROGRESS_MESSAGE_TYPE = 'sapTools.sqlBatchProgress';
export const SQL_BATCH_SECTIONS_MESSAGE_TYPE = 'sapTools.sqlBatchSections';

export type SqlBatchSummaryTone = 'running' | 'success' | 'error';

export interface SqlBatchSummaryView {
  readonly total: number;
  readonly success: number;
  readonly error: number;
  readonly skipped: number;
  readonly pending: number;
  readonly done: number;
  readonly finished: boolean;
  readonly title: string;
  readonly note: string;
  readonly tone: SqlBatchSummaryTone;
}

export interface SqlBatchSectionUpdate {
  readonly index: number;
  readonly className: string;
  readonly innerHtml: string;
}

const SHARED_THEME_STYLE = `
      :root {
        color-scheme: light dark;
        font-family: var(--vscode-font-family, "Segoe WPC", "Segoe UI", sans-serif);
        --saptools-bg: var(--vscode-editor-background, #1e1e1e);
        --saptools-fg: var(--vscode-editor-foreground, #cccccc);
        --saptools-border: var(--vscode-panel-border, var(--vscode-editorWidget-border, #3c3c3c));
        --saptools-muted: var(
          --vscode-descriptionForeground,
          var(--vscode-editorLineNumber-foreground, #8b949e)
        );
        --saptools-surface: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.12));
        --saptools-surface-strong: var(--vscode-editor-selectionBackground, rgba(128, 128, 128, 0.18));
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--saptools-bg);
        color: var(--saptools-fg);
      }
`;

const STATE_RESULT_STYLE = `${SHARED_THEME_STYLE}
      :root {
        --saptools-success: var(--vscode-testing-iconPassed, #2ea043);
        --saptools-error: var(--vscode-testing-iconFailed, #f85149);
      }
      .state-layout {
        display: grid;
        grid-template-rows: auto auto auto;
        gap: 6px;
        padding: 6px;
      }
      .state-card {
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        background: var(--saptools-surface);
        padding: 6px 8px;
      }
      .state-card.state-meta {
        padding: 4px 8px;
      }
      .state-card h1 {
        margin: 0;
        font-size: 13px;
      }
      .state-meta-line {
        margin: 0;
        font-size: 12px;
        line-height: 18px;
        color: var(--saptools-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .state-message,
      .state-sql {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.45;
      }
      .state-success h1 { color: var(--saptools-success); }
      .state-error h1 { color: var(--saptools-error); }
`;

const LOADING_RESULT_STYLE = `${SHARED_THEME_STYLE}
      :root {
        --saptools-accent: var(--vscode-progressBar-background, var(--vscode-focusBorder, #0078d4));
      }
      .result-loading-layout {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
      }
      .result-loading-toolbar,
      .result-loading-sql {
        padding: 6px;
        border-bottom: 1px solid var(--saptools-border);
        background: var(--saptools-surface);
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .result-loading-chip {
        border: 1px solid var(--saptools-border);
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 12px;
      }
      .result-loading-state {
        display: grid;
        place-items: center;
        place-content: center;
        gap: 14px;
        min-height: 0;
        color: var(--saptools-muted);
        font-size: 13px;
        font-weight: 600;
      }
      .result-loading-spinner {
        width: 42px;
        height: 42px;
        border: 4px solid color-mix(in oklab, var(--saptools-border) 70%, transparent);
        border-top-color: var(--saptools-accent);
        border-radius: 999px;
        animation: saptools-result-spin 780ms linear infinite;
      }
      .result-loading-sql {
        border-top: 1px solid var(--saptools-border);
        border-bottom: 0;
        color: var(--saptools-muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @keyframes saptools-result-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .result-loading-spinner { animation: none; }
      }
`;

const RESULT_SET_STYLE = `${SHARED_THEME_STYLE}
      .result-layout { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
      :root {
        --saptools-row-hover: var(--vscode-list-hoverBackground, var(--saptools-surface-strong));
      }
      .result-toolbar {
        padding: 6px;
        border-bottom: 1px solid var(--saptools-border);
        background: var(--saptools-surface);
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .result-toolbar-spacer { flex: 1 1 auto; }
      .result-chip {
        border: 1px solid var(--saptools-border);
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 12px;
        color: var(--saptools-fg);
        background: var(--saptools-surface-strong);
      }
      .result-chip.note { color: var(--saptools-muted); }
      .result-export-menu { position: relative; flex: 0 0 auto; margin-left: auto; }
      .result-export-trigger,
      .result-export-list button { font: inherit; }
      .result-export-trigger {
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        padding: 3px 9px;
        color: var(--saptools-fg);
        background: var(--saptools-surface-strong);
        cursor: pointer;
      }
      .result-export-trigger:hover { border-color: var(--vscode-focusBorder, var(--saptools-border)); }
      .result-export-list {
        position: absolute;
        z-index: 4;
        top: calc(100% + 5px);
        right: 0;
        display: grid;
        min-width: 132px;
        padding: 5px;
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        background: var(--saptools-bg);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      }
      .result-export-list[hidden] { display: none; }
      .result-export-list button {
        border: 0;
        border-radius: 4px;
        padding: 6px 8px;
        color: var(--saptools-fg);
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .result-export-list button:hover { background: var(--saptools-surface-strong); }
      .result-table-wrap { min-height: 0; overflow: auto; }
      table { width: max-content; min-width: 100%; border-collapse: collapse; table-layout: auto; font-size: 12px; }
      tbody tr { transition: background-color 120ms ease; }
      tbody tr:hover td { background: var(--saptools-row-hover); }
      th,
      td {
        border-bottom: 1px solid var(--saptools-border);
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
        white-space: pre;
        overflow: visible;
        text-overflow: clip;
      }
      th {
        position: sticky;
        top: 0;
        z-index: 1;
        color: var(--saptools-fg);
        background: var(--saptools-bg);
        font-weight: 600;
      }
      tbody tr:nth-child(even) { background: var(--saptools-surface); }
      .row-number { width: 31px; min-width: 31px; max-width: 31px; color: var(--saptools-muted); text-align: right; }
      .result-context-menu {
        position: fixed;
        z-index: 5;
        display: grid;
        min-width: 148px;
        padding: 5px;
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        background: var(--saptools-bg);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      }
      .result-context-menu[hidden] { display: none; }
      .result-context-menu button {
        border: 0;
        border-radius: 4px;
        padding: 6px 8px;
        color: var(--saptools-fg);
        background: transparent;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .result-context-menu button:hover { background: var(--saptools-surface-strong); }
`;

const RESULT_BATCH_STYLE = `${SHARED_THEME_STYLE}
      :root {
        --saptools-success: var(--vscode-testing-iconPassed, #2ea043);
        --saptools-error: var(--vscode-testing-iconFailed, #f85149);
        --saptools-skip: var(--saptools-muted);
        --saptools-row-hover: var(--vscode-list-hoverBackground, var(--saptools-surface-strong));
        --saptools-accent: var(--vscode-progressBar-background, var(--vscode-focusBorder, #0078d4));
      }
      .result-batch-layout {
        height: 100vh;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 0;
      }
      .result-batch-scroll { min-height: 0; overflow: auto; }
      .result-batch-summary {
        position: sticky;
        top: 0;
        z-index: 3;
        display: grid;
        gap: 6px;
        padding: 8px 10px;
        background: var(--saptools-surface-strong);
        border-bottom: 1px solid var(--saptools-border);
      }
      .result-batch-summary[data-tone="running"] {
        background: color-mix(in oklab, var(--saptools-accent) 18%, var(--saptools-bg));
        border-bottom-color: var(--saptools-accent);
      }
      .result-batch-summary[data-tone="success"] {
        background: color-mix(in oklab, var(--saptools-success) 16%, var(--saptools-bg));
        border-bottom-color: var(--saptools-success);
      }
      .result-batch-summary[data-tone="error"] {
        background: color-mix(in oklab, var(--saptools-error) 16%, var(--saptools-bg));
        border-bottom-color: var(--saptools-error);
      }
      .batch-summary-line {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .batch-summary-title { font-weight: 600; font-size: 12px; }
      .batch-summary-note { margin: 0; font-size: 12px; color: var(--saptools-muted); }
      .batch-summary-note[hidden] { display: none; }
      progress.batch-summary-progress {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 6px;
        border: 0;
        border-radius: 999px;
        background: var(--saptools-surface);
        overflow: hidden;
      }
      progress.batch-summary-progress::-webkit-progress-bar {
        background: var(--saptools-surface);
        border-radius: 999px;
      }
      progress.batch-summary-progress::-webkit-progress-value {
        background: var(--saptools-accent);
        border-radius: 999px;
        transition: width 140ms ease;
      }
      progress.batch-summary-progress.is-finished::-webkit-progress-value {
        background: var(--saptools-success);
      }
      progress.batch-summary-progress.has-error::-webkit-progress-value {
        background: var(--saptools-error);
      }
      .result-chip {
        border: 1px solid var(--saptools-border);
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 12px;
        color: var(--saptools-fg);
        background: var(--saptools-surface-strong);
      }
      .result-chip-success { color: var(--saptools-success); border-color: var(--saptools-success); }
      .result-chip-error { color: var(--saptools-error); border-color: var(--saptools-error); }
      .result-chip-skip { color: var(--saptools-skip); }
      .result-chip-warn { color: var(--saptools-error); border-color: var(--saptools-error); background: transparent; }
      .result-toolbar-spacer { flex: 1 1 auto; }
      .result-batch-sections {
        display: grid;
        gap: 8px;
        padding: 8px 6px;
      }
      .result-statement-section {
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        background: var(--saptools-bg);
        overflow: hidden;
      }
      .result-statement-section.status-pending { opacity: 0.85; }
      .result-statement-section.status-skipped { opacity: 0.7; }
      .result-statement-section.status-error { border-color: var(--saptools-error); }
      .result-statement-section.status-success { border-color: color-mix(in oklab, var(--saptools-success) 60%, var(--saptools-border)); }
      .result-statement-header {
        padding: 6px 8px;
        background: var(--saptools-surface);
        border-bottom: 1px solid var(--saptools-border);
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        font-size: 12px;
      }
      .result-statement-title { font-weight: 600; }
      .result-statement-body { padding: 0; }
      .result-statement-body .result-table-wrap {
        max-height: 360px;
        overflow: auto;
        /* Keep the horizontal scrollbar off the last row so it stays easy to grab. */
        padding-bottom: 14px;
      }
      .result-statement-body .result-toolbar { padding: 6px 8px; }
      .result-statement-body .state-layout {
        display: grid;
        gap: 6px;
        padding: 6px 8px;
      }
      .result-statement-body .state-card {
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        background: var(--saptools-surface);
        padding: 6px 8px;
      }
      .result-statement-body .state-message,
      .result-statement-body .state-sql {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.45;
      }
      .result-statement-body .state-success h1 { color: var(--saptools-success); margin: 0; font-size: 13px; }
      .result-statement-body .state-error h1 { color: var(--saptools-error); margin: 0; font-size: 13px; }
      .result-statement-body .state-skipped h1 { color: var(--saptools-skip); margin: 0; font-size: 13px; }
      .result-statement-body .state-pending {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        color: var(--saptools-muted);
        font-size: 12px;
      }
      .result-statement-body .result-loading-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid color-mix(in oklab, var(--saptools-border) 70%, transparent);
        border-top-color: var(--saptools-accent);
        border-radius: 999px;
        animation: saptools-result-spin 780ms linear infinite;
      }
      @keyframes saptools-result-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .result-statement-body .result-loading-spinner { animation: none; }
      }
      table { width: max-content; min-width: 100%; border-collapse: collapse; table-layout: auto; font-size: 12px; }
      tbody tr { transition: background-color 120ms ease; }
      tbody tr:hover td { background: var(--saptools-row-hover); }
      th,
      td {
        border-bottom: 1px solid var(--saptools-border);
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
        white-space: pre;
        overflow: visible;
        text-overflow: clip;
      }
      th {
        position: sticky;
        top: 0;
        z-index: 1;
        color: var(--saptools-fg);
        background: var(--saptools-bg);
        font-weight: 600;
      }
      tbody tr:nth-child(even) { background: var(--saptools-surface); }
      .row-number { width: 31px; min-width: 31px; max-width: 31px; color: var(--saptools-muted); text-align: right; }
      .result-export-menu { position: relative; flex: 0 0 auto; }
      .result-export-trigger,
      .result-export-list button { font: inherit; }
      .result-export-trigger {
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        padding: 3px 9px;
        color: var(--saptools-fg);
        background: var(--saptools-surface-strong);
        cursor: pointer;
      }
      .result-export-trigger:hover { border-color: var(--vscode-focusBorder, var(--saptools-border)); }
      .result-export-list {
        position: absolute;
        z-index: 4;
        top: calc(100% + 5px);
        right: 0;
        display: grid;
        min-width: 132px;
        padding: 5px;
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        background: var(--saptools-bg);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      }
      .result-export-list[hidden] { display: none; }
      .result-export-list button {
        border: 0;
        border-radius: 4px;
        padding: 6px 8px;
        color: var(--saptools-fg);
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .result-export-list button:hover { background: var(--saptools-surface-strong); }
      .result-context-menu {
        position: fixed;
        z-index: 5;
        display: grid;
        min-width: 148px;
        padding: 5px;
        border: 1px solid var(--saptools-border);
        border-radius: 6px;
        background: var(--saptools-bg);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      }
      .result-context-menu[hidden] { display: none; }
      .result-context-menu button {
        border: 0;
        border-radius: 4px;
        padding: 6px 8px;
        color: var(--saptools-fg);
        background: transparent;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .result-context-menu button:hover { background: var(--saptools-surface-strong); }
`;

const RESULT_ACTION_SCRIPT = `
(() => {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const contextMenu = document.querySelector('[data-role="sql-result-context-menu"]');
  if (!(contextMenu instanceof HTMLElement)) return;
  let openTrigger = null;
  let selectedContext = null;
  const closeExportMenu = () => {
    if (openTrigger === null) return;
    const list = openTrigger.parentElement?.querySelector('[data-role="result-export-list"]');
    if (list instanceof HTMLElement) list.hidden = true;
    openTrigger.setAttribute('aria-expanded', 'false');
    openTrigger = null;
  };
  const toggleExportMenu = (trigger) => {
    const list = trigger.parentElement?.querySelector('[data-role="result-export-list"]');
    if (!(list instanceof HTMLElement)) return;
    if (openTrigger === trigger) {
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      openTrigger = null;
      return;
    }
    closeExportMenu();
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openTrigger = trigger;
  };
  const closeContextMenu = () => {
    selectedContext = null;
    contextMenu.hidden = true;
    contextMenu.removeAttribute('data-row-index');
    contextMenu.removeAttribute('data-column-index');
    contextMenu.removeAttribute('data-statement-index');
  };
  const readIndex = (value) => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  const resolveStatementIndex = (element) => {
    const owner = element.closest('[data-statement-index]');
    if (!(owner instanceof HTMLElement)) return null;
    return readIndex(owner.dataset.statementIndex);
  };
  const positionContextMenu = (event) => {
    contextMenu.hidden = false;
    const left = Math.min(event.clientX, Math.max(8, window.innerWidth - contextMenu.offsetWidth - 8));
    const top = Math.min(event.clientY, Math.max(8, window.innerHeight - contextMenu.offsetHeight - 8));
    contextMenu.style.left = String(Math.max(8, left)) + 'px';
    contextMenu.style.top = String(Math.max(8, top)) + 'px';
  };
  document.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest('[data-role="sql-result-cell"]');
    if (!(cell instanceof HTMLElement)) {
      closeContextMenu();
      return;
    }
    const rowIndex = readIndex(cell.dataset.rowIndex);
    const columnIndex = readIndex(cell.dataset.columnIndex);
    if (rowIndex === null || columnIndex === null) return;
    event.preventDefault();
    closeExportMenu();
    const statementIndex = resolveStatementIndex(cell);
    selectedContext = { rowIndex, columnIndex, statementIndex };
    contextMenu.dataset.rowIndex = String(rowIndex);
    contextMenu.dataset.columnIndex = String(columnIndex);
    if (statementIndex !== null) contextMenu.dataset.statementIndex = String(statementIndex);
    positionContextMenu(event);
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const triggerCandidate = target.closest('[data-role="result-export-trigger"]');
    if (triggerCandidate instanceof HTMLButtonElement) {
      closeContextMenu();
      toggleExportMenu(triggerCandidate);
      return;
    }
    const actionButton = target.closest('[data-action]');
    if (actionButton instanceof HTMLButtonElement) {
      const action = actionButton.dataset.action ?? '';
      if (action === 'copyRowObject' || action === 'copyCellValue') {
        if (selectedContext !== null) {
          const payload = { type: 'sapTools.sqlResultExportAction', action, rowIndex: selectedContext.rowIndex, columnIndex: selectedContext.columnIndex };
          if (selectedContext.statementIndex !== null) payload.statementIndex = selectedContext.statementIndex;
          vscode?.postMessage(payload);
        }
        closeContextMenu();
        closeExportMenu();
        return;
      }
      const statementIndex = resolveStatementIndex(actionButton);
      const payload = { type: 'sapTools.sqlResultExportAction', action };
      if (statementIndex !== null) payload.statementIndex = statementIndex;
      closeExportMenu();
      closeContextMenu();
      vscode?.postMessage(payload);
      return;
    }
    closeExportMenu();
    closeContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeExportMenu();
    closeContextMenu();
  });
})();
`;

export function buildHanaSqlResultHtml(options: RenderSqlResultOptions): string {
  if (isBatchView(options)) {
    return buildBatchResultHtml(options);
  }
  if (options.isLoading === true) {
    return buildLoadingResultHtml(options);
  }
  if (options.result?.kind === 'resultset') {
    return buildResultSetHtml(options, options.result);
  }
  return buildStateResultHtml(options);
}

function isBatchView(options: RenderSqlResultOptions): boolean {
  return (options.statements?.length ?? 0) > 1;
}

function buildStateResultHtml(options: RenderSqlResultOptions): string {
  const hasStatusResult = options.result?.kind === 'status';
  const tableName = resolveSqlResultTableName(options);
  const stateTitle = hasStatusResult ? 'Statement Executed' : 'Execution Error';
  const stateMessage = hasStatusResult
    ? escapeHtml(options.result.message)
    : escapeHtml(options.errorMessage ?? 'Query execution failed.');
  const elapsedLine = hasStatusResult
    ? `<p class="state-meta-line">Elapsed: ${String(options.result.elapsedMs)} ms</p>`
    : '';
  const stateToneClass = hasStatusResult ? 'state-success' : 'state-error';

  return wrapResultDocument(options.nonce, STATE_RESULT_STYLE, `
    <main class="state-layout">
      <section class="state-card state-meta">
        <p class="state-meta-line">Table: ${escapeHtml(tableName)}</p>
      </section>
      <section class="state-card ${stateToneClass}">
        <h1>${stateTitle}</h1>
        <p class="state-message">${stateMessage}</p>
        ${elapsedLine}
      </section>
      <section class="state-card">
        <pre class="state-sql">${escapeHtml(options.sql)}</pre>
      </section>
    </main>
  `);
}

function buildLoadingResultHtml(options: RenderSqlResultOptions): string {
  const tableName = resolveSqlResultTableName(options);
  return wrapResultDocument(options.nonce, LOADING_RESULT_STYLE, `
    <main class="result-loading-layout" aria-busy="true">
      <header class="result-loading-toolbar">
        <span class="result-loading-chip">Table: ${escapeHtml(tableName)}</span>
        <span class="result-loading-chip">Started: ${escapeHtml(options.executedAt)}</span>
      </header>
      <section class="result-loading-state" role="status" aria-live="polite">
        <span class="result-loading-spinner" aria-hidden="true"></span>
        <span>Running SQL query…</span>
      </section>
      <footer class="result-loading-sql">${escapeHtml(options.sql)}</footer>
    </main>
  `);
}

function buildResultSetHtml(
  options: RenderSqlResultOptions,
  result: HanaQueryResultSet
): string {
  return wrapResultDocument(
    options.nonce,
    RESULT_SET_STYLE,
    `
    <main class="result-layout">
      ${renderResultToolbar(options, result)}
      <div class="result-table-wrap">
        ${renderResultTable(result.columns, result.rows)}
      </div>
      ${renderResultContextMenu()}
    </main>
    ${buildResultActionScript(options.nonce)}
  `
  );
}

function renderResultToolbar(
  options: RenderSqlResultOptions,
  result: HanaQueryResultSet
): string {
  const tableName = resolveSqlResultTableName(options);

  return `<header class="result-toolbar">
        <span class="result-chip">Table: ${escapeHtml(tableName)}</span>
        <span class="result-chip">Rows: ${String(result.rowCount)}</span>
        <span class="result-chip">Elapsed: ${String(result.elapsedMs)} ms</span>
        <span class="result-toolbar-spacer" aria-hidden="true"></span>
        ${renderResultExportMenu()}
      </header>`;
}

function resolveSqlResultTableName(options: RenderSqlResultOptions): string {
  const tableName = options.tableName?.trim() ?? '';
  return tableName.length > 0 ? tableName : 'SQL statement';
}

function renderResultExportMenu(): string {
  return `<div class="result-export-menu" data-role="result-export-menu">
          <button type="button" class="result-export-trigger" data-role="result-export-trigger" aria-haspopup="menu" aria-expanded="false">Export result</button>
          <div class="result-export-list" data-role="result-export-list" role="menu" hidden>
            <button type="button" role="menuitem" data-action="copyCsv">Copy CSV</button>
            <button type="button" role="menuitem" data-action="copyJson">Copy JSON</button>
            <button type="button" role="menuitem" data-action="exportCsv">Export CSV</button>
            <button type="button" role="menuitem" data-action="exportJson">Export JSON</button>
          </div>
        </div>`;
}

function wrapResultDocument(nonce: string | undefined, style: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${buildWebviewCspMeta(nonce)}
    <title>SAP Tools SQL Result</title>
    <style${buildNonceAttribute(nonce)}>${style}
    </style>
  </head>
  <body>${body}
  </body>
</html>`;
}

function buildWebviewCspMeta(nonce: string | undefined): string {
  if (nonce === undefined || nonce.length === 0) {
    return '';
  }
  const escapedNonce = escapeHtml(nonce);
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapedNonce}'; script-src 'nonce-${escapedNonce}';" />`;
}

function buildNonceAttribute(nonce: string | undefined): string {
  if (nonce === undefined || nonce.length === 0) {
    return '';
  }
  return ` nonce="${escapeHtml(nonce)}"`;
}

function buildResultActionScript(nonce: string | undefined): string {
  if (nonce === undefined || nonce.length === 0) {
    return '';
  }
  return `<script nonce="${escapeHtml(nonce)}">${RESULT_ACTION_SCRIPT}</script>`;
}

const RESULT_BATCH_UPDATE_SCRIPT = `
(() => {
  const summaryBar = document.querySelector('[data-role="batch-summary"]');
  const summaryTitle = document.querySelector('[data-role="batch-summary-title"]');
  const summaryNote = document.querySelector('[data-role="batch-summary-note"]');
  const progress = document.querySelector('[data-role="batch-progress"]');
  const sectionsRoot = document.querySelector('[data-role="batch-sections"]');
  const counts = {
    success: document.querySelector('[data-role="batch-count-success"]'),
    error: document.querySelector('[data-role="batch-count-error"]'),
    skipped: document.querySelector('[data-role="batch-count-skipped"]'),
    pending: document.querySelector('[data-role="batch-count-pending"]'),
  };
  const setText = (element, text) => { if (element instanceof HTMLElement) element.textContent = text; };
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data === null || typeof data !== 'object') return;
    if (data.type === 'sapTools.sqlBatchProgress') {
      setText(summaryTitle, typeof data.title === 'string' ? data.title : '');
      setText(counts.success, 'OK ' + String(data.success ?? 0));
      setText(counts.error, 'Failed ' + String(data.error ?? 0));
      setText(counts.skipped, 'Skipped ' + String(data.skipped ?? 0));
      setText(counts.pending, 'Pending ' + String(data.pending ?? 0));
      if (summaryBar instanceof HTMLElement && typeof data.tone === 'string') {
        summaryBar.dataset.tone = data.tone;
      }
      if (summaryNote instanceof HTMLElement) {
        const note = typeof data.note === 'string' ? data.note : '';
        summaryNote.textContent = note;
        summaryNote.hidden = note.length === 0;
      }
      if (progress instanceof HTMLProgressElement) {
        progress.max = Math.max(Number(data.total) || 0, 1);
        progress.value = Number(data.done) || 0;
        progress.classList.toggle('is-finished', data.finished === true && data.tone !== 'error');
        progress.classList.toggle('has-error', data.finished === true && data.tone === 'error');
      }
      return;
    }
    if (data.type === 'sapTools.sqlBatchSections' && Array.isArray(data.sections) && sectionsRoot instanceof HTMLElement) {
      for (const section of data.sections) {
        if (section === null || typeof section !== 'object') continue;
        const target = sectionsRoot.querySelector('[data-statement-index="' + String(section.index) + '"]');
        if (target instanceof HTMLElement) {
          if (typeof section.className === 'string') target.className = section.className;
          if (typeof section.innerHtml === 'string') target.innerHTML = section.innerHtml;
        }
      }
    }
  });
})();
`;

function buildBatchResultScript(nonce: string | undefined): string {
  if (nonce === undefined || nonce.length === 0) {
    return '';
  }
  const escapedNonce = escapeHtml(nonce);
  return `<script nonce="${escapedNonce}">${RESULT_ACTION_SCRIPT}</script><script nonce="${escapedNonce}">${RESULT_BATCH_UPDATE_SCRIPT}</script>`;
}

function renderResultTable(columns: readonly string[], rows: readonly string[][]): string {
  const headerCells = [
    '<th class="row-number">#</th>',
    ...columns.map((column) => `<th>${escapeHtml(column)}</th>`),
  ].join('');
  const bodyRows = rows.map(renderResultRow(columns)).join('');

  return `
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function renderResultRow(columns: readonly string[]): (row: readonly string[], index: number) => string {
  return (row, rowIndex) => {
    const rowCells = columns
      .map((_, index) => {
        return `<td data-role="sql-result-cell" data-row-index="${String(rowIndex)}" data-column-index="${String(index)}">${escapeHtml(row[index] ?? '')}</td>`;
      })
      .join('');
    return `<tr data-role="sql-result-row" data-row-index="${String(rowIndex)}"><td class="row-number">${String(rowIndex + 1)}</td>${rowCells}</tr>`;
  };
}

function renderResultContextMenu(): string {
  return `<div class="result-context-menu" data-role="sql-result-context-menu" role="menu" hidden>
        <button type="button" role="menuitem" data-action="copyRowObject">Copy row object</button>
        <button type="button" role="menuitem" data-action="copyCellValue">Copy cell value</button>
      </div>`;
}

function buildBatchResultHtml(options: RenderSqlResultOptions): string {
  const statements = options.statements ?? [];
  const summary = summarizeSqlBatch(statements, options.batchSummary);
  return wrapResultDocument(
    options.nonce,
    RESULT_BATCH_STYLE,
    `
    <main class="result-batch-layout">
      ${renderBatchSummaryBar(summary)}
      <div class="result-batch-scroll">
        <div class="result-batch-sections" data-role="batch-sections">
          ${statements
            .map((statement, index) => renderStatementSection(statement, index, statements.length))
            .join('')}
        </div>
      </div>
      ${renderResultContextMenu()}
    </main>
    ${buildBatchResultScript(options.nonce)}
  `
  );
}

/**
 * Aggregate per-statement outcomes into the headline progress shown in the
 * coloured summary band. Shared by the full render and the incremental
 * postMessage updates so both views stay consistent.
 */
export function summarizeSqlBatch(
  statements: readonly SqlResultStatementView[],
  batchSummary?: SqlResultBatchSummary
): SqlBatchSummaryView {
  let success = 0;
  let error = 0;
  let skipped = 0;
  let pending = 0;
  for (const statement of statements) {
    if (statement.status === 'success') success += 1;
    else if (statement.status === 'error') error += 1;
    else if (statement.status === 'skipped') skipped += 1;
    else pending += 1;
  }
  const total = statements.length;
  const done = success + error + skipped;
  const finished = batchSummary !== undefined;
  const hadFailure = error > 0 || skipped > 0 || batchSummary?.rolledBack === true;
  const tone: SqlBatchSummaryTone = finished ? (hadFailure ? 'error' : 'success') : 'running';
  const title = finished
    ? hadFailure
      ? `Completed with ${String(error)} error${error === 1 ? '' : 's'} · ${String(done)} / ${String(total)}`
      : `Completed ${String(total)} statement${total === 1 ? '' : 's'}`
    : `Running… ${String(done)} / ${String(total)}`;

  return {
    total,
    success,
    error,
    skipped,
    pending,
    done,
    finished,
    title,
    note: buildBatchSummaryNote(batchSummary),
    tone,
  };
}

function buildBatchSummaryNote(batchSummary?: SqlResultBatchSummary): string {
  if (batchSummary === undefined) {
    return '';
  }
  if (batchSummary.commitFailureMessage !== undefined) {
    return `Commit failed and the transaction was rolled back: ${batchSummary.commitFailureMessage}`;
  }
  if (batchSummary.rolledBack) {
    return 'A statement failed — the transaction was rolled back.';
  }
  if (batchSummary.committed) {
    return 'All statements committed in a single transaction.';
  }
  if (batchSummary.transactionUnavailableReason !== undefined) {
    return `Ran without a transaction: ${batchSummary.transactionUnavailableReason}`;
  }
  return '';
}

function renderBatchSummaryBar(summary: SqlBatchSummaryView): string {
  const progressStateClass = summary.finished
    ? summary.tone === 'error'
      ? ' has-error'
      : ' is-finished'
    : '';
  return `
      <header class="result-batch-summary" data-role="batch-summary" data-tone="${summary.tone}">
        <div class="batch-summary-line">
          <span class="batch-summary-title" data-role="batch-summary-title">${escapeHtml(summary.title)}</span>
          <span class="result-toolbar-spacer" aria-hidden="true"></span>
          <span class="result-chip result-chip-success" data-role="batch-count-success">OK ${String(summary.success)}</span>
          <span class="result-chip result-chip-error" data-role="batch-count-error">Failed ${String(summary.error)}</span>
          <span class="result-chip result-chip-skip" data-role="batch-count-skipped">Skipped ${String(summary.skipped)}</span>
          <span class="result-chip" data-role="batch-count-pending">Pending ${String(summary.pending)}</span>
        </div>
        <progress class="batch-summary-progress${progressStateClass}" data-role="batch-progress" max="${String(Math.max(summary.total, 1))}" value="${String(summary.done)}"></progress>
        <p class="batch-summary-note" data-role="batch-summary-note"${summary.note.length > 0 ? '' : ' hidden'}>${escapeHtml(summary.note)}</p>
      </header>
    `;
}

/**
 * Build the class + inner HTML for a single statement section so the panel can
 * patch just the sections that changed instead of reloading the whole document.
 */
export function buildSqlBatchSectionUpdate(
  statement: SqlResultStatementView,
  index: number,
  total: number
): SqlBatchSectionUpdate {
  return {
    index,
    className: resolveBatchSectionClass(statement.status),
    innerHtml: renderStatementSectionInner(statement, index, total),
  };
}

function resolveBatchSectionClass(status: SqlResultStatementStatus): string {
  return `result-statement-section status-${status}`;
}

function renderStatementSection(
  statement: SqlResultStatementView,
  index: number,
  total: number
): string {
  return `
      <section class="${resolveBatchSectionClass(statement.status)}" data-statement-index="${String(index)}">${renderStatementSectionInner(statement, index, total)}</section>
    `;
}

function renderStatementSectionInner(
  statement: SqlResultStatementView,
  index: number,
  total: number
): string {
  const trimmedTableName = (statement.tableName ?? '').trim();
  const tableName = trimmedTableName.length > 0 ? trimmedTableName : 'SQL statement';
  const statusBadge = renderStatementStatusBadge(statement.status);
  const tableChip = `<span class="result-chip">Table: ${escapeHtml(tableName)}</span>`;
  const exportMenu =
    statement.status === 'success' && statement.result?.kind === 'resultset'
      ? renderResultExportMenu()
      : '';

  return `
        <header class="result-statement-header">
          <span class="result-statement-title">Statement ${String(index + 1)} / ${String(total)}</span>
          ${statusBadge}
          ${tableChip}
          <span class="result-toolbar-spacer" aria-hidden="true"></span>
          ${exportMenu}
        </header>
        <div class="result-statement-body">
          ${renderStatementBody(statement)}
        </div>`;
}

function renderStatementStatusBadge(status: SqlResultStatementStatus): string {
  if (status === 'success') {
    return '<span class="result-chip result-chip-success">Success</span>';
  }
  if (status === 'error') {
    return '<span class="result-chip result-chip-error">Failed</span>';
  }
  if (status === 'skipped') {
    return '<span class="result-chip result-chip-skip">Skipped</span>';
  }
  return '<span class="result-chip">Pending</span>';
}

function renderStatementBody(statement: SqlResultStatementView): string {
  if (statement.status === 'pending') {
    return `
      <div class="state-pending" role="status" aria-live="polite">
        <span class="result-loading-spinner" aria-hidden="true"></span>
        <span>Queued…</span>
      </div>
    `;
  }
  if (statement.status === 'skipped') {
    return `
      <section class="state-layout">
        <section class="state-card state-skipped">
          <h1>Skipped</h1>
          <p class="state-message">Skipped due to a preceding statement failure. The transaction was rolled back.</p>
        </section>
        <section class="state-card">
          <pre class="state-sql">${escapeHtml(statement.sql)}</pre>
        </section>
      </section>
    `;
  }
  if (statement.status === 'error') {
    return `
      <section class="state-layout">
        <section class="state-card state-error">
          <h1>Execution Error</h1>
          <p class="state-message">${escapeHtml(statement.errorMessage ?? 'Query execution failed.')}</p>
        </section>
        <section class="state-card">
          <pre class="state-sql">${escapeHtml(statement.sql)}</pre>
        </section>
      </section>
    `;
  }
  const result = statement.result;
  if (result === undefined) {
    return '';
  }
  if (result.kind === 'status') {
    return `
      <section class="state-layout">
        <section class="state-card state-success">
          <h1>Statement Executed</h1>
          <p class="state-message">${escapeHtml(result.message)}</p>
        </section>
        <section class="state-card">
          <pre class="state-sql">${escapeHtml(statement.sql)}</pre>
        </section>
      </section>
    `;
  }
  return `
    <div class="result-table-wrap">
      ${renderResultTable(result.columns, result.rows)}
    </div>
  `;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
