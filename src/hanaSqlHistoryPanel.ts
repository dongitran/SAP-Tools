/**
 * SQL Backup History Panel — a VSCode WebviewPanel that shows past mutation
 * backups with a two-pane layout:
 *   Left: scrollable list of backup entries (newest-first)
 *   Right: SQL statement + data table for the selected entry
 *
 * The panel is self-contained (all CSS/JS inline) and adapts to VSCode dark/light themes
 * via CSS variables.
 */

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { HanaSqlBackupStore, HanaSqlBackupEntry } from './hanaSqlBackupStore';
import type { HanaSqlHistoryScope } from './hanaSqlConnectionResolver';

const HISTORY_PANEL_VIEW_TYPE = 'sapTools.hanaSqlHistory';

type HistoryPanelMessage =
  | { readonly type: 'loadEntries' }
  | { readonly type: 'loadDetail'; readonly id: string }
  | { readonly type: 'copyData'; readonly id: string };

interface EntryDetail {
  readonly sql: string;
  readonly csv: string;
  readonly columns: string[];
  readonly rows: string[][];
}

export class HanaSqlHistoryPanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  async openOrReveal(backupStore: HanaSqlBackupStore, session: HanaSqlHistoryScope): Promise<void> {
    if (this.panel !== null) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      HISTORY_PANEL_VIEW_TYPE,
      'SQL Backup History',
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel = panel;
    panel.webview.html = buildHistoryPanelHtml(createWebviewNonce());

    const panelDisposables: vscode.Disposable[] = [];

    panelDisposables.push(
      panel.webview.onDidReceiveMessage(async (raw: unknown) => {
        const msg = raw as HistoryPanelMessage;
        await this.handlePanelMessage(msg, panel, backupStore, session);
      })
    );

    panelDisposables.push(
      panel.onDidDispose(() => {
        this.panel = null;
        for (const d of panelDisposables) d.dispose();
      })
    );

    // Initial load
    const entries = await backupStore.listBackups(200);
    void panel.webview.postMessage({
      type: 'entriesLoaded',
      entries: entries.map(serializeEntry),
      region: session.region,
      org: session.orgName,
      space: session.spaceName
    });
  }

  private async handlePanelMessage(
    msg: HistoryPanelMessage,
    panel: vscode.WebviewPanel,
    backupStore: HanaSqlBackupStore,
    session: HanaSqlHistoryScope
  ): Promise<void> {
    if (msg.type === 'loadEntries') {
      const entries = await backupStore.listBackups(200);
      void panel.webview.postMessage({
        type: 'entriesLoaded',
        entries: entries.map(serializeEntry),
        region: session.region,
        org: session.orgName,
        space: session.spaceName
      });
      return;
    }

    if (msg.type === 'loadDetail') {
      const entries = await backupStore.listBackups(200);
      const entry = entries.find((e) => e.id === msg.id);
      if (entry === undefined) {
        void panel.webview.postMessage({ type: 'detailError', id: msg.id, message: 'Backup entry not found.' });
        return;
      }
      const [sql, csv] = await Promise.all([
        backupStore.readBackupSql(entry),
        backupStore.readBackupCsv(entry),
      ]);
      const { columns, rows } = parseCsvForDisplay(csv ?? '');
      const detail: EntryDetail = { sql: sql ?? '', csv: csv ?? '', columns, rows };
      void panel.webview.postMessage({ type: 'detailLoaded', id: msg.id, detail });
      return;
    }

    const entries = await backupStore.listBackups(200);
    const entry = entries.find((e) => e.id === msg.id);
    if (entry !== undefined) {
      const csv = await backupStore.readBackupCsv(entry);
      if (csv !== null) {
        await vscode.env.clipboard.writeText(csv);
        this.outputChannel.appendLine(`[sql-history] copied backup CSV to clipboard: ${entry.id}`);
        void panel.webview.postMessage({ type: 'copyDone', id: msg.id });
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeEntry(entry: HanaSqlBackupEntry): Record<string, unknown> {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    timestampLabel: entry.timestampLabel,
    region: entry.region,
    org: entry.org,
    space: entry.space,
    appName: entry.appName,
    statementType: entry.statementType,
    tableName: entry.tableName,
    rowCount: entry.rowCount,
  };
}

function createWebviewNonce(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Parse a CSV string into columns + rows for table display.
 * Handles RFC 4180 quoting. Limited to first 500 rows for safety.
 */
export function parseCsvForDisplay(csv: string): { columns: string[]; rows: string[][] } {
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = parseCsvLine(lines[0] ?? '');
  const rows = lines.slice(1, 501).map((line) => parseCsvLine(line));
  return { columns, rows };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let cell = '';
      i += 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (line[i] === '"') { i += 1; break; }
        cell += line[i] ?? ''; i += 1;
      }
      cells.push(cell);
      if (i < line.length && line[i] === ',') {
        i += 1;
        if (i === line.length) cells.push('');
      }
    } else {
      const comma = line.indexOf(',', i);
      if (comma < 0) { cells.push(line.slice(i)); break; }
      cells.push(line.slice(i, comma));
      i = comma + 1;
      if (i === line.length) { cells.push(''); break; }
    }
  }
  return cells;
}

// ── HTML Builder ──────────────────────────────────────────────────────────────

function buildHistoryPanelHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SQL Backup History</title>
  <style nonce="${nonce}">${buildHistoryPanelCss()}</style>
</head>
<body>
  <div id="app" class="app-layout">
    <aside class="sidebar" id="sidebar" role="navigation" aria-label="Backup entries">
      <header class="sidebar-header">
        <h1 class="sidebar-title">
          <span class="sidebar-icon" aria-hidden="true">🕐</span>
          SQL Backup History
        </h1>
        <button class="refresh-btn" id="refresh-btn" type="button" title="Refresh list" aria-label="Refresh backup list">↻</button>
      </header>
      <div class="entry-list" id="entry-list" role="listbox" aria-label="Backup entries">
        <div class="loading-msg" id="loading-msg">Loading…</div>
      </div>
    </aside>
    <main class="detail-pane" id="detail-pane" aria-live="polite">
      <div class="empty-detail" id="empty-detail">
        <div class="empty-icon" aria-hidden="true">📋</div>
        <p>Select a backup entry from the left panel to view details.</p>
      </div>
    </main>
  </div>
  <script nonce="${nonce}">${buildHistoryPanelJs()}</script>
</body>
</html>`;
}

function buildHistoryPanelCss(): string {
  return `
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --border: var(--vscode-panel-border, #3c3c3c);
      --muted: var(--vscode-descriptionForeground, #8b949e);
      --surface: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.1));
      --surface-hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.16));
      --selected: var(--vscode-list-activeSelectionBackground, #0e639c);
      --selected-fg: var(--vscode-list-activeSelectionForeground, #ffffff);
      --accent: var(--vscode-button-background, #0e639c);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --success: var(--vscode-testing-iconPassed, #2ea043);
      --error: var(--vscode-testing-iconFailed, #f85149);
      --warn: var(--vscode-editorWarning-foreground, #cca700);
      --font: var(--vscode-font-family, "Segoe WPC", "Segoe UI", sans-serif);
      --mono: var(--vscode-editor-font-family, "Cascadia Code", Menlo, Consolas, monospace);
      --font-size: var(--vscode-font-size, 13px);
      --radius: 6px;

      /* SQL highlight colors — hardcoded because vscode-symbolIcon vars are
         not injected into webviews; these match VS Code Dark+ token colors. */
      --sql-keyword: #569cd6;
      --sql-builtin: #4ec9b0;
      --sql-string: #ce9178;
      --sql-number: #b5cea8;
      --sql-comment: #6a9955;
      --sql-punctuation: var(--vscode-editor-foreground, #cccccc);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: var(--font-size); height: 100vh; overflow: hidden; }

    /* ── Layout ─────────────────────────────────────────────────────── */
    .app-layout { display: grid; grid-template-columns: 280px 1fr; height: 100vh; }

    /* ── Sidebar ─────────────────────────────────────────────────────── */
    .sidebar { display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--surface); overflow: hidden; }
    .sidebar-header { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--border); min-height: 44px; flex-shrink: 0; }
    .sidebar-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); flex: 1; display: flex; align-items: center; gap: 6px; }
    .sidebar-icon { font-size: 14px; }
    .refresh-btn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 4px 6px; border-radius: var(--radius); font-size: 16px; line-height: 1; transition: color 0.15s, background 0.15s; }
    .refresh-btn:hover { color: var(--fg); background: var(--surface-hover); }

    .entry-list { flex: 1; overflow-y: auto; padding: 4px 0; }
    .loading-msg { padding: 16px 12px; color: var(--muted); font-size: 12px; }
    .empty-list-msg { padding: 16px 12px; color: var(--muted); font-size: 12px; }

    .entry-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; cursor: pointer; border-left: 3px solid transparent; transition: background 0.1s, border-color 0.1s; }
    .entry-item:hover { background: var(--surface-hover); }
    .entry-item.is-selected { background: var(--selected); color: var(--selected-fg); border-left-color: var(--accent); }
    .entry-item.is-selected .entry-meta, .entry-item.is-selected .entry-ts { color: var(--selected-fg); opacity: 0.85; }
    .entry-top { display: flex; align-items: center; gap: 6px; }
    .entry-badge { font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0; }
    .badge-update { background: rgba(14, 99, 156, 0.25); color: #4db8ff; }
    .badge-delete { background: rgba(248, 81, 73, 0.18); color: #f85149; }
    .badge-insert { background: rgba(46, 160, 67, 0.18); color: #3fb950; }
    .badge-merge  { background: rgba(46, 160, 67, 0.18); color: #2ea043; }
    .entry-table { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .entry-meta { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .entry-ts { font-size: 11px; color: var(--muted); }
    .entry-divider { height: 1px; background: var(--border); margin: 2px 0; opacity: 0.5; }

    /* ── Detail pane ─────────────────────────────────────────────────── */
    .detail-pane { display: flex; flex-direction: column; overflow: hidden; }
    .empty-detail { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--muted); }
    .empty-icon { font-size: 48px; opacity: 0.5; }

    .detail-layout { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    /* Header: badge + table name left, timestamp right */
    .detail-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; }
    .detail-title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .detail-scope { font-size: 11px; color: var(--muted); margin-top: 4px; }
    .detail-ts { font-size: 12px; color: var(--muted); white-space: nowrap; flex-shrink: 0; }

    .detail-body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 14px; }

    .section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin-bottom: 6px; }

    /* Section label row with inline button */
    .section-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .section-label-row .section-label { margin-bottom: 0; }

    /* ── SQL highlighted block ───────────────────────────────────────── */
    .sql-block { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; line-height: 1.6; }
    .sql-kw  { color: var(--sql-keyword, #569cd6); font-weight: 700; }
    .sql-fn  { color: var(--sql-builtin, #4ec9b0); }
    .sql-str { color: var(--sql-string, #ce9178); }
    .sql-num { color: var(--sql-number, #b5cea8); }
    .sql-cmt { color: var(--sql-comment, #6a9955); font-style: italic; }

    .copy-btn { padding: 4px 10px; border-radius: var(--radius); background: var(--accent); color: var(--accent-fg); border: none; cursor: pointer; font-size: 11px; font-weight: 600; white-space: nowrap; transition: opacity 0.15s; flex-shrink: 0; }
    .copy-btn:hover { opacity: 0.88; }
    .copy-btn.is-copied { background: var(--success); }

    /* ── Data table ─────────────────────────────────────────────────── */
    /* overflow-x: auto enables horizontal scrolling when many columns */
    .table-wrap { overflow-x: auto; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); max-height: calc(100vh - 360px); }
    .data-table { border-collapse: collapse; min-width: 100%; font-size: 12px; }
    .data-table th, .data-table td { padding: 5px 9px; border-bottom: 1px solid var(--border); white-space: nowrap; text-align: left; }
    .data-table th { background: var(--surface); font-weight: 700; position: sticky; top: 0; z-index: 1; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .data-table td.row-num { color: var(--muted); user-select: none; }
    .data-table tr:hover td { background: var(--surface-hover); }
    .data-table tr:last-child td { border-bottom: none; }
    .no-data-msg { color: var(--muted); font-size: 12px; padding: 12px 0; }
    .row-count-label { font-size: 11px; color: var(--muted); margin-top: 4px; }
  `;
}

function buildHistoryPanelJs(): string {
  return `
    (function() {
      const vscode = acquireVsCodeApi();
      let entries = [];
      let selectedId = null;
      let copyTimeout = null;

      const entryList = document.getElementById('entry-list');
      const detailPane = document.getElementById('detail-pane');
      const refreshBtn = document.getElementById('refresh-btn');

      refreshBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'loadEntries' });
        entryList.innerHTML = '<div class="loading-msg">Loading…</div>';
      });

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'entriesLoaded') {
          entries = msg.entries;
          renderEntryList();
        } else if (msg.type === 'detailLoaded') {
          renderDetail(msg.id, msg.detail);
        } else if (msg.type === 'detailError') {
          renderDetailError(msg.message);
        } else if (msg.type === 'copyDone') {
          onCopyDone();
        }
      });

      function renderEntryList() {
        if (entries.length === 0) {
          entryList.innerHTML = '<p class="empty-list">No backups found yet.<br/>Backups are created automatically when you run UPDATE or DELETE statements with a WHERE clause.</p>';
          return;
        }
        entryList.innerHTML = entries.map((entry, i) => {
          const badgeClass = 'badge-' + entry.statementType.toLowerCase();
          const isSelected = entry.id === selectedId;
          const divider = i > 0 ? '<div class="entry-divider"></div>' : '';
          // List item: only show org below the badge + table name line
          return divider + '<div class="entry-item' + (isSelected ? ' is-selected' : '') + '" role="option" aria-selected="' + isSelected + '" data-id="' + escapeAttr(entry.id) + '" tabindex="0">' +
            '<div class="entry-top">' +
              '<span class="entry-badge ' + badgeClass + '">' + escapeHtml(entry.statementType) + '</span>' +
              '<span class="entry-table">' + escapeHtml(entry.tableName) + '</span>' +
            '</div>' +
            '<div class="entry-meta">' + escapeHtml(entry.org) + '</div>' +
            '<div class="entry-ts">' + escapeHtml(entry.timestampLabel) + '</div>' +
          '</div>';
        }).join('');

        entryList.querySelectorAll('.entry-item').forEach((el) => {
          el.addEventListener('click', () => selectEntry(el.dataset.id));
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') selectEntry(el.dataset.id); });
        });
      }

      function selectEntry(id) {
        if (!id) return;
        selectedId = id;
        renderEntryList();
        detailPane.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;">Loading…</div>';
        vscode.postMessage({ type: 'loadDetail', id });
      }

      function renderDetail(id, detail) {
        const entry = entries.find((e) => e.id === id);
        if (!entry) return;

        const badgeClass = 'badge-' + entry.statementType.toLowerCase();
        const rowLabel = detail.rows.length === 500 ? '500+ rows (showing first 500)' : detail.rows.length + ' row' + (detail.rows.length !== 1 ? 's' : '');

        const tableHtml = detail.columns.length > 0
          ? '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th class="row-num">#</th>' +
              detail.columns.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') +
            '</tr></thead><tbody>' +
              detail.rows.map((row, i) =>
                '<tr><td class="row-num">' + (i + 1) + '</td>' +
                detail.columns.map((_, ci) => '<td>' + escapeHtml(row[ci] ?? '') + '</td>').join('') +
                '</tr>'
              ).join('') +
            '</tbody></table></div>' +
            '<div class="row-count-label">' + escapeHtml(rowLabel) + '</div>'
          : '<p class="no-data-msg">No rows were captured in this backup.</p>';

        const scopeLabel = 'Region: ' + escapeHtml(entry.region) + ' &mdash; Org: ' + escapeHtml(entry.org) + ' &mdash; Space: ' + escapeHtml(entry.space);

        detailPane.innerHTML =
          '<div class="detail-layout">' +
            '<div class="detail-header">' +
              '<div>' +
                '<div class="detail-title">' +
                  '<span class="entry-badge ' + badgeClass + '">' + escapeHtml(entry.statementType) + '</span> ' +
                  escapeHtml(entry.tableName) +
                '</div>' +
                '<div class="detail-scope">' + scopeLabel + '</div>' +
              '</div>' +
              '<div class="detail-ts">' + escapeHtml(entry.timestampLabel) + '</div>' +
            '</div>' +
            '<div class="detail-body">' +
              '<div>' +
                '<div class="section-label">SQL Statement</div>' +
                '<pre class="sql-block">' + highlightSql(detail.sql || 'Not available') + '</pre>' +
              '</div>' +
              '<div>' +
                '<div class="section-label-row">' +
                  '<div class="section-label">Backed-up Data</div>' +
                  '<button class="copy-btn" id="copy-btn" type="button">Copy CSV</button>' +
                '</div>' +
                tableHtml +
              '</div>' +
            '</div>' +
          '</div>';

        const copyBtn = document.getElementById('copy-btn');
        if (copyBtn) {
          copyBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'copyData', id });
          });
        }
      }

      function renderDetailError(message) {
        detailPane.innerHTML = '<div style="padding:16px;"><p style="color:var(--error);">' + escapeHtml(message) + '</p></div>';
      }

      function onCopyDone() {
        const btn = document.getElementById('copy-btn');
        if (!btn) return;
        btn.textContent = 'Copied!';
        btn.classList.add('is-copied');
        if (copyTimeout) clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
          btn.textContent = 'Copy CSV';
          btn.classList.remove('is-copied');
        }, 2000);
      }

      /**
       * Minimal SQL syntax highlighter.
       * Tokenizes the SQL string and wraps known token types in <span> tags.
       * Handles: keywords, built-in functions, string literals, numbers, line/block comments.
       */
      function highlightSql(sql) {
        const KEYWORDS = new Set([
          'SELECT','FROM','WHERE','AND','OR','NOT','IN','EXISTS','BETWEEN','LIKE','IS','NULL',
          'INSERT','INTO','VALUES','UPDATE','SET','DELETE','MERGE','USING','MATCHED','WHEN',
          'CREATE','ALTER','DROP','TABLE','VIEW','INDEX','ON','AS','JOIN','LEFT','RIGHT',
          'INNER','OUTER','FULL','CROSS','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET',
          'DISTINCT','ALL','UNION','EXCEPT','INTERSECT','CASE','WHEN','THEN','ELSE','END',
          'WITH','TOP','FETCH','NEXT','ROWS','ONLY','REPLACE','TRUNCATE','COLUMN','ADD',
          'PRIMARY','KEY','FOREIGN','REFERENCES','CONSTRAINT','DEFAULT','UNIQUE','CHECK',
          'SCHEMA','DATABASE','IF','BEGIN','COMMIT','ROLLBACK','TRANSACTION','DECLARE',
          'PROCEDURE','FUNCTION','RETURN','CALL','EXEC','EXECUTE','TRIGGER','FOR','EACH',
          'ROW','AFTER','BEFORE','INSTEAD','OF','ASC','DESC','NULL','TRUE','FALSE'
        ]);
        const BUILTINS = new Set([
          'COUNT','SUM','AVG','MIN','MAX','COALESCE','NULLIF','ISNULL','NVL','DECODE',
          'CAST','CONVERT','TO_CHAR','TO_DATE','TO_NUMBER','TRIM','LTRIM','RTRIM',
          'UPPER','LOWER','SUBSTR','SUBSTRING','LENGTH','LEN','REPLACE','CHARINDEX',
          'INSTR','CONCAT','NOW','SYSDATE','GETDATE','DATEADD','DATEDIFF','ROUND',
          'FLOOR','CEIL','CEILING','ABS','MOD','ROW_NUMBER','RANK','DENSE_RANK',
          'LAG','LEAD','FIRST_VALUE','LAST_VALUE','OVER','PARTITION'
        ]);

        const result = [];
        let i = 0;

        while (i < sql.length) {
          // Line comment --
          if (sql[i] === '-' && sql[i+1] === '-') {
            const end = sql.indexOf('\\n', i);
            const chunk = end < 0 ? sql.slice(i) : sql.slice(i, end);
            result.push('<span class="sql-cmt">' + escHtml(chunk) + '</span>');
            i = end < 0 ? sql.length : end;
            continue;
          }
          // Block comment /* */
          if (sql[i] === '/' && sql[i+1] === '*') {
            const end = sql.indexOf('*/', i + 2);
            const chunk = end < 0 ? sql.slice(i) : sql.slice(i, end + 2);
            result.push('<span class="sql-cmt">' + escHtml(chunk) + '</span>');
            i = end < 0 ? sql.length : end + 2;
            continue;
          }
          // Single-quoted string
          if (sql[i] === "'") {
            let j = i + 1;
            while (j < sql.length) {
              if (sql[j] === "'" && sql[j+1] === "'") { j += 2; continue; }
              if (sql[j] === "'") { j++; break; }
              j++;
            }
            result.push('<span class="sql-str">' + escHtml(sql.slice(i, j)) + '</span>');
            i = j;
            continue;
          }
          // Double-quoted identifier
          if (sql[i] === '"') {
            let j = i + 1;
            while (j < sql.length && sql[j] !== '"') j++;
            result.push(escHtml(sql.slice(i, j + 1)));
            i = j + 1;
            continue;
          }
          // Number
          if (/[0-9]/.test(sql[i]) || (sql[i] === '.' && /[0-9]/.test(sql[i+1] || ''))) {
            let j = i;
            while (j < sql.length && /[0-9.]/.test(sql[j])) j++;
            result.push('<span class="sql-num">' + escHtml(sql.slice(i, j)) + '</span>');
            i = j;
            continue;
          }
          // Word (keyword / builtin / identifier)
          if (/[A-Za-z_]/.test(sql[i])) {
            let j = i;
            while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
            const word = sql.slice(i, j);
            const upper = word.toUpperCase();
            if (KEYWORDS.has(upper)) {
              result.push('<span class="sql-kw">' + escHtml(word) + '</span>');
            } else if (BUILTINS.has(upper)) {
              result.push('<span class="sql-fn">' + escHtml(word) + '</span>');
            } else {
              result.push(escHtml(word));
            }
            i = j;
            continue;
          }
          // Operators / punctuation
          result.push(escHtml(sql[i]));
          i++;
        }
        return result.join('');
      }

      function escHtml(str) {
        return String(str)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;');
      }

      function escapeHtml(str) {
        return String(str)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;');
      }

      function escapeAttr(str) {
        return String(str).replaceAll('"', '&quot;');
      }

      // Trigger initial load
      vscode.postMessage({ type: 'loadEntries' });
    })();
  `;
}

