import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { HanaQueryResultSet } from './hanaSqlService';
import {
  buildHanaSqlResultExportFileName,
  buildHanaSqlResultHtml,
  buildSqlBatchSectionUpdate,
  formatHanaSqlResultRowObjectJson,
  formatHanaSqlResultSetCsv,
  formatHanaSqlResultSetJson,
  formatHanaSqlStatementBatchCsv,
  formatHanaSqlStatementBatchJson,
  resolveHanaSqlResultCellValue,
  resolveSqlResultTargetColumn,
  summarizeSqlBatch,
  SQL_BATCH_PROGRESS_MESSAGE_TYPE,
  SQL_BATCH_SECTIONS_MESSAGE_TYPE,
  type HanaSqlResultExportFormat,
  type RenderSqlResultOptions,
  type SqlBatchSectionUpdate,
  type SqlResultStatementStatus,
  type SqlResultStatementView,
} from './hanaSqlWorkbenchSupport';

const SQL_RESULT_VIEW_TYPE = 'sapTools.hanaSqlResult';
const SQL_RESULT_EXPORT_ACTION_MESSAGE_TYPE = 'sapTools.sqlResultExportAction';

type SqlResultExportActionName =
  | 'copyCsv'
  | 'copyJson'
  | 'exportCsv'
  | 'exportJson'
  | 'copyAllCsv'
  | 'copyAllJson'
  | 'exportAllCsv'
  | 'exportAllJson';
type SqlResultContextCopyActionName = 'copyRowObject' | 'copyCellValue';

interface SqlResultExportAction {
  readonly name: SqlResultExportActionName;
  readonly format: HanaSqlResultExportFormat;
  readonly mode: 'copy' | 'export';
  readonly scope: 'single' | 'all';
}

interface SqlResultContextCopyAction {
  readonly name: SqlResultContextCopyActionName;
  readonly logLabel: string;
}

export interface HanaSqlResultPanelSession {
  readonly panel: vscode.WebviewPanel;
  update(options: RenderSqlResultOptions): void;
}

export class HanaSqlResultPanelManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private resultSequence = 0;

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  openResultPanel(
    options: RenderSqlResultOptions,
    sourceViewColumn: number | undefined
  ): HanaSqlResultPanelSession {
    this.resultSequence += 1;
    const target = resolveResultTargetViewColumn(sourceViewColumn);
    const tableName = options.tableName?.trim() ?? '';
    const titleTarget = tableName.length > 0 ? tableName : options.appName;
    this.log(`open result panel ${target.logLabel} for app ${sanitizeLogValue(options.appName)}`);
    const panel = vscode.window.createWebviewPanel(
      SQL_RESULT_VIEW_TYPE,
      `SAP Tools SQL Result ${String(this.resultSequence)} · ${titleTarget}`,
      { preserveFocus: false, viewColumn: target.viewColumn },
      { enableScripts: true }
    );
    const nonce = createWebviewNonce();
    let currentOptions = { ...options, nonce };
    let renderedBatchCount: number | null = null;
    let renderedStatuses: SqlResultStatementStatus[] | null = null;
    const fullRender = (): void => {
      panel.webview.html = buildHanaSqlResultHtml(currentOptions);
      const statements = currentOptions.statements ?? [];
      if (statements.length > 1) {
        renderedBatchCount = statements.length;
        renderedStatuses = statements.map((statement) => statement.status);
      } else {
        renderedBatchCount = null;
        renderedStatuses = null;
      }
    };
    const messageSubscription = panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handlePanelMessage(currentOptions, message);
    });
    panel.onDidDispose(() => {
      messageSubscription.dispose();
    }, null, this.disposables);
    fullRender();
    return {
      panel,
      update: (nextOptions: RenderSqlResultOptions): void => {
        const next = { ...nextOptions, nonce };
        const statements = next.statements ?? [];
        const canStream =
          statements.length > 1 &&
          next.batchSummary === undefined &&
          renderedBatchCount === statements.length &&
          renderedStatuses !== null;
        currentOptions = next;
        if (canStream && renderedStatuses !== null) {
          this.streamBatchProgress(panel, statements, renderedStatuses);
          renderedStatuses = statements.map((statement) => statement.status);
          return;
        }
        fullRender();
      },
    };
  }

  /**
   * Push live batch progress to an already-rendered batch document without
   * reloading it: a single summary message plus only the statement sections
   * whose status changed since the previous update. This keeps large INSERT
   * batches responsive (no full-document reflow or scroll reset per statement).
   */
  private streamBatchProgress(
    panel: vscode.WebviewPanel,
    statements: readonly SqlResultStatementView[],
    previousStatuses: readonly SqlResultStatementStatus[]
  ): void {
    const summary = summarizeSqlBatch(statements);
    void panel.webview.postMessage({
      type: SQL_BATCH_PROGRESS_MESSAGE_TYPE,
      total: summary.total,
      done: summary.done,
      success: summary.success,
      error: summary.error,
      skipped: summary.skipped,
      pending: summary.pending,
      finished: summary.finished,
      title: summary.title,
      note: summary.note,
      tone: summary.tone,
    });

    const changedSections: SqlBatchSectionUpdate[] = [];
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      if (statement === undefined) {
        continue;
      }
      if (previousStatuses[index] !== statement.status) {
        changedSections.push(buildSqlBatchSectionUpdate(statement, index, statements.length));
      }
    }
    if (changedSections.length > 0) {
      void panel.webview.postMessage({
        type: SQL_BATCH_SECTIONS_MESSAGE_TYPE,
        sections: changedSections,
      });
    }
  }

  private async handlePanelMessage(
    options: RenderSqlResultOptions,
    message: unknown
  ): Promise<void> {
    if (!isRecord(message) || message['type'] !== SQL_RESULT_EXPORT_ACTION_MESSAGE_TYPE) {
      return;
    }
    const action = parseExportAction(message['action']);
    if (action !== null) {
      await this.handleExportAction(options, action, message);
      return;
    }
    const copyAction = parseContextCopyAction(message['action']);
    if (copyAction === null) {
      return;
    }
    await this.handleContextCopyAction(options, copyAction, message);
  }

  private async handleExportAction(
    options: RenderSqlResultOptions,
    action: SqlResultExportAction,
    message: Record<string, unknown>
  ): Promise<void> {
    if (action.scope === 'all') {
      const statements = options.statements ?? [];
      if (statements.length === 0) {
        return;
      }
      const content = formatStatementBatch(statements, action.format);
      if (action.mode === 'copy') {
        await this.copyResult(options.appName, action, content);
        return;
      }
      await this.exportResult(options, action, content);
      return;
    }
    const resultSet = resolveTargetResultSet(options, message['statementIndex']);
    if (resultSet === null) {
      return;
    }
    const content = formatResultSet(resultSet, action.format);
    if (action.mode === 'copy') {
      await this.copyResult(options.appName, action, content);
      return;
    }
    await this.exportResult(options, action, content);
  }

  private async handleContextCopyAction(
    options: RenderSqlResultOptions,
    action: SqlResultContextCopyAction,
    message: Record<string, unknown>
  ): Promise<void> {
    const resultSet = resolveTargetResultSet(options, message['statementIndex']);
    if (resultSet === null) {
      return;
    }
    const rowIndex = parseNonNegativeInteger(message['rowIndex']);
    const columnIndex = parseNonNegativeInteger(message['columnIndex']);
    const content = resolveContextCopyContent(resultSet, action, rowIndex, columnIndex);
    if (content === null || rowIndex === null) {
      this.log(`ignored invalid ${action.logLabel} copy request for app ${sanitizeLogValue(options.appName)}`);
      return;
    }
    await this.copyContextResult(options.appName, action, content, rowIndex, columnIndex);
  }

  private async copyContextResult(
    appName: string,
    action: SqlResultContextCopyAction,
    content: string,
    rowIndex: number,
    columnIndex: number | null
  ): Promise<void> {
    const cellSuffix = columnIndex === null ? '' : ` column ${String(columnIndex + 1)}`;
    try {
      await vscode.env.clipboard.writeText(content);
      this.log(
        `copied ${action.logLabel} for app ${sanitizeLogValue(appName)} row ${String(rowIndex + 1)}${cellSuffix}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy SQL result value.';
      this.log(
        `failed to copy ${action.logLabel} for app ${sanitizeLogValue(appName)}: ${sanitizeLogValue(message)}`
      );
    }
  }

  private async copyResult(
    appName: string,
    action: SqlResultExportAction,
    content: string
  ): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(content);
      this.log(`copied ${action.format.toUpperCase()} result for app ${sanitizeLogValue(appName)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy SQL result.';
      this.log(
        `failed to copy ${action.format.toUpperCase()} result for app ${sanitizeLogValue(appName)}: ${sanitizeLogValue(message)}`
      );
    }
  }

  private async exportResult(
    options: RenderSqlResultOptions,
    action: SqlResultExportAction,
    content: string
  ): Promise<void> {
    const fileName = buildHanaSqlResultExportFileName(options.appName, options.executedAt, action.format);
    const defaultUri = buildDefaultExportUri(fileName);
    const saveOptions: vscode.SaveDialogOptions = {
      filters: { [action.format.toUpperCase()]: [action.format] },
      saveLabel: `Export ${action.format.toUpperCase()}`,
    };
    if (defaultUri !== undefined) {
      saveOptions.defaultUri = defaultUri;
    }
    try {
      const targetUri = await vscode.window.showSaveDialog(saveOptions);
      if (targetUri === undefined) {
        this.log(`cancelled ${action.format.toUpperCase()} result export for app ${sanitizeLogValue(options.appName)}`);
        return;
      }
      await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(content));
      this.log(`exported ${action.format.toUpperCase()} result for app ${sanitizeLogValue(options.appName)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export SQL result.';
      this.log(
        `failed to export ${action.format.toUpperCase()} result for app ${sanitizeLogValue(options.appName)}: ${sanitizeLogValue(message)}`
      );
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[sql] ${message}`);
  }
}

function resolveResultTargetViewColumn(
  sourceViewColumn: number | undefined
): { readonly logLabel: string; readonly viewColumn: vscode.ViewColumn } {
  const existingColumns = vscode.window.tabGroups.all
    .map((group) => toPositiveViewColumnNumber(group.viewColumn))
    .filter((column): column is number => column !== undefined);
  const target = resolveSqlResultTargetColumn(sourceViewColumn, existingColumns);
  if (target.kind === 'existing') {
    return {
      logLabel: `in existing editor column ${String(target.viewColumn)}`,
      viewColumn: target.viewColumn as vscode.ViewColumn,
    };
  }
  return { logLabel: 'beside the SQL editor', viewColumn: vscode.ViewColumn.Beside };
}

function parseExportAction(rawAction: unknown): SqlResultExportAction | null {
  if (rawAction === 'copyCsv') return { name: rawAction, format: 'csv', mode: 'copy', scope: 'single' };
  if (rawAction === 'copyJson') return { name: rawAction, format: 'json', mode: 'copy', scope: 'single' };
  if (rawAction === 'exportCsv') return { name: rawAction, format: 'csv', mode: 'export', scope: 'single' };
  if (rawAction === 'exportJson') return { name: rawAction, format: 'json', mode: 'export', scope: 'single' };
  if (rawAction === 'copyAllCsv') return { name: rawAction, format: 'csv', mode: 'copy', scope: 'all' };
  if (rawAction === 'copyAllJson') return { name: rawAction, format: 'json', mode: 'copy', scope: 'all' };
  if (rawAction === 'exportAllCsv') return { name: rawAction, format: 'csv', mode: 'export', scope: 'all' };
  if (rawAction === 'exportAllJson') return { name: rawAction, format: 'json', mode: 'export', scope: 'all' };
  return null;
}

function resolveTargetResultSet(
  options: RenderSqlResultOptions,
  rawStatementIndex: unknown
): HanaQueryResultSet | null {
  const statements = options.statements ?? [];
  if (statements.length > 0) {
    const index = parseNonNegativeInteger(rawStatementIndex);
    const fallbackIndex =
      index ?? statements.findIndex((statement) => statement.result?.kind === 'resultset');
    if (fallbackIndex < 0 || fallbackIndex >= statements.length) {
      return null;
    }
    const result = statements[fallbackIndex]?.result;
    return result?.kind === 'resultset' ? result : null;
  }
  if (options.result?.kind === 'resultset') {
    return options.result;
  }
  return null;
}

function formatStatementBatch(
  statements: readonly SqlResultStatementView[],
  format: HanaSqlResultExportFormat
): string {
  return format === 'csv'
    ? formatHanaSqlStatementBatchCsv(statements)
    : formatHanaSqlStatementBatchJson(statements);
}

function parseContextCopyAction(rawAction: unknown): SqlResultContextCopyAction | null {
  if (rawAction === 'copyRowObject') return { name: rawAction, logLabel: 'row object' };
  if (rawAction === 'copyCellValue') return { name: rawAction, logLabel: 'cell value' };
  return null;
}

function resolveContextCopyContent(
  result: HanaQueryResultSet,
  action: SqlResultContextCopyAction,
  rowIndex: number | null,
  columnIndex: number | null
): string | null {
  if (rowIndex === null) {
    return null;
  }
  if (action.name === 'copyRowObject') {
    return formatHanaSqlResultRowObjectJson(result, rowIndex);
  }
  if (columnIndex === null) {
    return null;
  }
  return resolveHanaSqlResultCellValue(result, rowIndex, columnIndex);
}

function formatResultSet(
  result: HanaQueryResultSet,
  format: HanaSqlResultExportFormat
): string {
  return format === 'csv'
    ? formatHanaSqlResultSetCsv(result)
    : formatHanaSqlResultSetJson(result);
}

function buildDefaultExportUri(fileName: string): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder?.uri.scheme !== 'file') {
    return undefined;
  }
  return vscode.Uri.joinPath(workspaceFolder.uri, fileName);
}

function createWebviewNonce(): string {
  return randomBytes(16).toString('base64url');
}

function toPositiveViewColumnNumber(
  viewColumn: vscode.ViewColumn | undefined
): number | undefined {
  if (viewColumn === undefined) {
    return undefined;
  }
  const column: number = viewColumn;
  return column > 0 ? column : undefined;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function sanitizeLogValue(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
