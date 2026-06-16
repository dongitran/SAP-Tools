import * as vscode from 'vscode';
import { buildHanaTableListScopeKey } from './cacheStore';
import type { HanaTableListCacheEntry } from './cacheModels';
import {
  HanaQueryError,
  classifyHanaSqlStatement,
  executeHanaQuery,
  executeHanaQueryBatch,
  isHanaConnectivityError,
  sanitizeHanaErrorMessage,
  type HanaBatchExecutionSummary,
  type HanaConnection,
  type HanaQueryResult,
  type HanaSqlStatementKind,
  type HanaStatementInput,
  type HanaStatementOutcome,
} from './hanaSqlService';
import { fetchStartedAppsViaCfCli } from './cfClient';
import { HanaTunnelManager } from './hanaTunnel';

interface TunnelConnectOverrides {
  readonly connectMaxAttempts?: number;
}
// Bound the connect-retry budget for tunneled attempts so a stalled tunnel
// connect fails fast (~2 attempts) instead of compounding the default 5×.
const TUNNEL_CONNECT_OVERRIDES: TunnelConnectOverrides = { connectMaxAttempts: 2 };
// Cap how many other apps we try as SSH jump-hosts when the in-use app itself
// cannot tunnel, so a large space never triggers a per-app `cf ssh` storm.
const MAX_SSH_FALLBACK_APPS = 4;
// Trivial query used to establish/verify a tunnel in the background without a
// user query (DUMMY is HANA's always-present single-row system table).
const TUNNEL_PROBE_SQL = 'SELECT 1 FROM DUMMY';
import { splitHanaSqlStatements } from './hanaSqlStatementSplitter';
import { HANA_SQL_DEFAULT_SELECT_LIMIT, applyDefaultHanaSelectLimit } from './hanaSqlLimitGuard';
import { resolveHanaConnectionFromApp, type HanaSqlScopeSession } from './hanaSqlConnectionResolver';

export interface HanaTableListCacheGateway {
  getHanaTableList(scopeKey: string): Promise<HanaTableListCacheEntry | null>;
  setHanaTableList(
    scopeKey: string,
    entry: HanaTableListCacheEntry
  ): Promise<HanaTableListCacheEntry>;
  deleteHanaTableList(scopeKey: string): Promise<void>;
  /** Persisted SSH-capable jump-host per HANA host (survives reload). */
  getHanaTunnelJumpApp(host: string): Promise<string | undefined>;
  setHanaTunnelJumpApp(host: string, app: string): Promise<void>;
}
import {
  buildHanaSqlDocumentFileUri,
  resolveHanaSqlDocumentOpenUri,
} from './hanaSqlDocumentUri';
import {
  buildInitialHanaSqlTemplate,
  buildHanaTableReferenceResolutionMissLog,
  buildQuickTableSelectSql,
  buildTableDiscoveryQueries,
  buildTestModeBatchOutcomes,
  buildTestModeQueryResult,
  buildRawHanaTableDisplayEntries,
  createTestModeTableNames,
  extractTableNames,
  filterTableEntryCandidates,
  filterKeywordCandidates,
  formatHanaTableDisplayEntries,
  resolveHanaDisplayTableReferences,
  resolveJumpHostCandidates,
  sanitizeUntitledFileName,
  type HanaResolvedTableReference,
  type HanaTableDisplayEntry,
  type RenderSqlResultOptions,
  type SqlResultBatchSummary,
  type SqlResultStatementStatus,
  type SqlResultStatementView,
} from './hanaSqlWorkbenchSupport';
import {
  delayE2eQuickSelectIfConfigured,
  delayTestModeTableLoadIfConfigured,
  resolveSqlResultTableName,
  sanitizeSqlCommandLogValue,
  sanitizeSqlLogValue,
  toPositiveViewColumnNumber,
} from './hanaSqlWorkbenchRuntime';
import { HanaSqlResultPanelManager, type HanaSqlResultPanelSession } from './hanaSqlResultPanel';
export { buildHanaSqlResultHtml, buildInitialHanaSqlTemplate } from './hanaSqlWorkbenchSupport';
export const RUN_HANA_SQL_COMMAND_ID = 'sapTools.runHanaSql';
const HANA_SQL_EDITOR_CONTEXT_KEY = 'sapTools.hanaSqlEditor';
/**
 * Minimum gap between live batch-progress repaints. Large INSERT batches
 * complete statements faster than the eye can read; coalescing intermediate
 * updates keeps the result panel responsive while the final repaint after the
 * batch always shows the authoritative end state.
 */
const HANA_SQL_BATCH_PROGRESS_INTERVAL_MS = 90;
interface HanaSqlAppContext {
  readonly appId: string;
  readonly appName: string;
  session: HanaSqlScopeSession | null;
  connection: HanaConnection | null;
  schema: string;
  sqlDocumentUri: string;
  sqlDocumentFileUri: string;
  tableNames: readonly string[];
  tableEntries: readonly HanaTableDisplayEntry[];
  tableNamesPromise: Promise<void> | null;
  cacheVersion: number;
  tunnelActive: boolean;
}
export interface OpenHanaSqlFileRequest {
  readonly appId: string;
  readonly appName: string;
  readonly session: HanaSqlScopeSession | null;
}
export interface RunQuickTableSelectRequest {
  readonly appId: string;
  readonly appName: string;
  readonly session: HanaSqlScopeSession | null;
  readonly tableName: string;
}
interface PreparedStatement {
  readonly executionSql: string;
  readonly statementKind: HanaSqlStatementKind;
  readonly tableName: string;
}

function describeBatchCounts(views: readonly SqlResultStatementView[]): string {
  const totals = { success: 0, error: 0, skipped: 0, pending: 0 };
  for (const view of views) {
    totals[view.status] += 1;
  }
  const parts: string[] = [];
  if (totals.success > 0) parts.push(`OK: ${String(totals.success)}`);
  if (totals.error > 0) parts.push(`Failed: ${String(totals.error)}`);
  if (totals.skipped > 0) parts.push(`Skipped: ${String(totals.skipped)}`);
  if (totals.pending > 0) parts.push(`Pending: ${String(totals.pending)}`);
  return parts.join(', ');
}

function isSameHanaSqlScope(
  previous: HanaSqlScopeSession | null,
  next: HanaSqlScopeSession
): boolean {
  if (previous === null) {
    return false;
  }
  return (
    previous.apiEndpoint === next.apiEndpoint &&
    previous.orgName === next.orgName &&
    previous.spaceName === next.spaceName &&
    previous.email === next.email &&
    previous.password === next.password &&
    previous.cfHomeDir === next.cfHomeDir
  );
}

function buildCacheScopeKeyForContext(
  context: HanaSqlAppContext,
  activeSession: HanaSqlScopeSession | null
): string {
  const session = activeSession ?? context.session;
  if (session === null) {
    return '';
  }
  return buildHanaTableListScopeKey({
    email: session.email,
    apiEndpoint: session.apiEndpoint,
    orgName: session.orgName,
    spaceName: session.spaceName,
    appId: context.appId,
  });
}

function buildSqlKeywordCompletionItems(prefix: string): vscode.CompletionItem[] {
  return filterKeywordCandidates(prefix).map((keyword) => {
    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
    item.detail = 'SAP Tools SQL keyword';
    return item;
  });
}

function buildTableCompletionItems(
  tableEntries: readonly HanaTableDisplayEntry[],
  prefix: string
): vscode.CompletionItem[] {
  return filterTableEntryCandidates(tableEntries, prefix).map((tableEntry) => {
    const item = new vscode.CompletionItem(
      tableEntry.displayName,
      vscode.CompletionItemKind.Struct
    );
    item.detail = 'S/4HANA table';
    item.insertText = tableEntry.displayName;
    return item;
  });
}

function resolveCompletionTableEntries(
  context: HanaSqlAppContext
): readonly HanaTableDisplayEntry[] {
  if (context.tableEntries.length > 0) {
    return context.tableEntries;
  }
  return buildRawHanaTableDisplayEntries(context.tableNames);
}

export class HanaSqlWorkbench
  implements vscode.Disposable, vscode.CompletionItemProvider
{
  private readonly isTestMode: boolean;
  private readonly appContextsByAppId = new Map<string, HanaSqlAppContext>();
  private readonly appIdByDocumentUri = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly resultPanelManager: HanaSqlResultPanelManager;
  private readonly forceTableRefreshAppIds = new Set<string>();
  private appContextCacheVersion = 0;
  private activeSessionProvider: (() => HanaSqlScopeSession | null) | null = null;
  private tunnelManager: HanaTunnelManager | null = null;
  private tunnelStateListener: ((appId: string, active: boolean) => void) | null = null;

  registerActiveSessionProvider(provider: () => HanaSqlScopeSession | null): void {
    this.activeSessionProvider = provider;
  }

  /** Notified when an app's HANA connection starts (or stops) using a tunnel. */
  registerTunnelStateListener(listener: (appId: string, active: boolean) => void): void {
    this.tunnelStateListener = listener;
  }

  /** Whether the given app's HANA connection is currently routed via a tunnel. */
  isAppTunneled(appId: string): boolean {
    return this.appContextsByAppId.get(appId)?.tunnelActive === true;
  }

  private getActiveSession(): HanaSqlScopeSession | null {
    return this.activeSessionProvider !== null ? this.activeSessionProvider() : null;
  }

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    private readonly cacheStore: HanaTableListCacheGateway | null = null
  ) {
    this.isTestMode = process.env['SAP_TOOLS_TEST_MODE'] === '1';
    this.resultPanelManager = new HanaSqlResultPanelManager(outputChannel);

    this.disposables.push(
      vscode.commands.registerCommand(RUN_HANA_SQL_COMMAND_ID, async () => {
        await this.handleRunHanaSqlCommand();
      }),
      vscode.languages.registerCompletionItemProvider(
        [
          { language: 'sql', scheme: 'untitled' },
          { language: 'sql', scheme: 'file' },
        ],
        this
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateSqlEditorContextKey(editor);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.appIdByDocumentUri.delete(document.uri.toString());
        this.updateSqlEditorContextKey(vscode.window.activeTextEditor);
      })
    );

    this.updateSqlEditorContextKey(vscode.window.activeTextEditor);
  }

  dispose(): void {
    this.resultPanelManager.dispose();
    this.tunnelManager?.dispose();
    this.tunnelManager = null;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.appContextsByAppId.clear();
    this.appIdByDocumentUri.clear();
  }

  invalidateAllAppContexts(): void {
    for (const context of this.appContextsByAppId.values()) {
      this.resetAppContextCache(context);
    }
    // Scope changed (region/org/space selection, scope confirm — including when
    // driven externally by the CDS Debug extension, or logout): close every
    // tunnel. They belong to the previous scope's apps and must not linger.
    if (this.tunnelManager !== null) {
      this.tunnelManager.dispose();
      this.tunnelManager = null;
    }
  }

  private resetAppContextCache(context: HanaSqlAppContext): void {
    this.appContextCacheVersion += 1;
    context.cacheVersion = this.appContextCacheVersion;
    context.connection = null;
    context.schema = '';
    context.session = null;
    context.tableNames = [];
    context.tableEntries = [];
    context.tableNamesPromise = null;
    context.tunnelActive = false;
  }

  async openSqlDocumentForApp(options: OpenHanaSqlFileRequest): Promise<void> {
    this.logSql(`open editor for app ${sanitizeSqlLogValue(options.appName)}`);
    const fileName = sanitizeUntitledFileName(options.appName);
    const fileUri = buildHanaSqlDocumentFileUri(fileName);
    const uri = resolveHanaSqlDocumentOpenUri(fileUri);
    let document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== 'sql') {
      document = await vscode.languages.setTextDocumentLanguage(document, 'sql');
    }

    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });

    if (document.getText().trim().length === 0) {
      await editor.edit((editBuilder) => {
        editBuilder.insert(
          new vscode.Position(0, 0),
          buildInitialHanaSqlTemplate(options.appName)
        );
      });
    }

    const context = this.ensureAppContext(options);
    context.sqlDocumentUri = document.uri.toString();
    context.sqlDocumentFileUri = fileUri.toString();
    this.appIdByDocumentUri.set(document.uri.toString(), context.appId);
    this.appIdByDocumentUri.set(fileUri.toString(), context.appId);
    this.updateSqlEditorContextKey(vscode.window.activeTextEditor);
    this.logSql(`editor ready for app ${sanitizeSqlLogValue(context.appName)}`);
    void this.prefetchTableNames(context.appId);
  }

  async loadTableNamesForApp(options: OpenHanaSqlFileRequest): Promise<readonly string[]> {
    const context = this.ensureAppContext(options);
    await this.prefetchTableNames(context.appId);
    return context.tableNames;
  }

  async loadTableEntriesForApp(
    options: OpenHanaSqlFileRequest
  ): Promise<readonly HanaTableDisplayEntry[]> {
    const context = this.ensureAppContext(options);
    await this.prefetchTableNames(context.appId);
    if (context.tableNames.length > 0 && context.tableEntries.length === 0) {
      context.tableEntries = await this.formatTableEntries(context.tableNames);
    }
    return context.tableEntries;
  }

  async refreshTableEntriesForApp(
    options: OpenHanaSqlFileRequest
  ): Promise<readonly HanaTableDisplayEntry[]> {
    const context = this.ensureAppContext(options);
    const inflight = context.tableNamesPromise;
    if (inflight !== null) {
      await inflight.catch(() => undefined);
    }
    this.forceTableRefreshAppIds.add(context.appId);
    this.resetAppContextCache(context);
    const cacheVersion = context.cacheVersion;
    try {
      await this.loadTableNames(context, cacheVersion);
    } finally {
      this.forceTableRefreshAppIds.delete(context.appId);
    }
    if (context.tableNames.length > 0 && context.tableEntries.length === 0) {
      context.tableEntries = await this.formatTableEntries(context.tableNames);
    }
    return context.tableEntries;
  }

  async runQuickTableSelectForApp(
    options: RunQuickTableSelectRequest
  ): Promise<void> {
    const context = this.ensureAppContext({
      appId: options.appId,
      appName: options.appName,
      session: options.session,
    });

    const statementKind: HanaSqlStatementKind = 'readonly';
    let sql = '';
    const displayTableName =
      findHanaTableDisplayName(context.tableEntries, options.tableName) ?? options.tableName;
    const resultPanel = this.openLoadingResultPanel(
      context.appName,
      displayTableName,
      options.tableName,
      this.resolveSqlSourceViewColumn(context)
    );

    try {
      if (!this.isTestMode) {
        await this.ensureConnection(context);
      }
      sql = buildQuickTableSelectSql(context.schema, options.tableName);
      this.updateLoadingResultPanel(resultPanel, context.appName, displayTableName, sql);
      this.logSql(
        `run quick SELECT for app ${sanitizeSqlLogValue(context.appName)} table ${sanitizeSqlLogValue(options.tableName)}: ${sanitizeSqlLogValue(sql)}`
      );
      await delayE2eQuickSelectIfConfigured();
      const result = await this.executeSqlForContext(context, sql, statementKind);
      this.logSql(
        `quick SELECT completed for app ${sanitizeSqlLogValue(context.appName)} table ${sanitizeSqlLogValue(options.tableName)} result ${result.kind}`
      );
      resultPanel.update({
        appName: context.appName,
        tableName: displayTableName,
        sql,
        executedAt: new Date().toISOString(),
        result,
      });
    } catch (error) {
      const message = this.toSafeErrorMessage(error, context);
      this.logSql(
        `quick SELECT failed for app ${sanitizeSqlLogValue(context.appName)}: ${sanitizeSqlLogValue(message)}`
      );
      void vscode.window.showErrorMessage(message);
      resultPanel.update({
        appName: context.appName,
        tableName: displayTableName,
        sql: sql.length > 0 ? sql : options.tableName,
        executedAt: new Date().toISOString(),
        errorMessage: message,
      });
    }
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const appId = this.appIdByDocumentUri.get(document.uri.toString());
    if (appId === undefined) {
      return undefined;
    }
    const context = this.appContextsByAppId.get(appId);
    if (context === undefined) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    const prefix = wordRange === undefined ? '' : document.getText(wordRange);

    void this.prefetchTableNames(context.appId);

    return [
      ...buildTableCompletionItems(resolveCompletionTableEntries(context), prefix),
      ...buildSqlKeywordCompletionItems(prefix),
    ];
  }

  private ensureAppContext(options: OpenHanaSqlFileRequest): HanaSqlAppContext {
    const existing = this.appContextsByAppId.get(options.appId);
    if (existing !== undefined) {
      if (options.session !== null) {
        if (!isSameHanaSqlScope(existing.session, options.session)) {
          this.resetAppContextCache(existing);
        }
        existing.session = options.session;
      }
      return existing;
    }

    const created: HanaSqlAppContext = {
      appId: options.appId,
      appName: options.appName,
      session: options.session,
      connection: null,
      schema: '',
      sqlDocumentUri: '',
      sqlDocumentFileUri: '',
      tableNames: [],
      tableEntries: [],
      tableNamesPromise: null,
      cacheVersion: this.appContextCacheVersion,
      tunnelActive: false,
    };
    this.appContextsByAppId.set(options.appId, created);
    return created;
  }

  private async handleRunHanaSqlCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showWarningMessage('Open a SQL editor before running a query.');
      return;
    }

    const appId = this.appIdByDocumentUri.get(editor.document.uri.toString());
    const context = appId === undefined ? undefined : this.appContextsByAppId.get(appId);
    if (context === undefined) {
      void vscode.window.showWarningMessage(
        'Open SQL file from SAP Tools SQL tab before running a query.'
      );
      return;
    }

    const selectedSql = editor.selection.isEmpty ? '' : editor.document.getText(editor.selection);
    const sqlInput = selectedSql.trim().length > 0 ? selectedSql : editor.document.getText();

    let splitStatements;
    try {
      splitStatements = splitHanaSqlStatements(sqlInput);
    } catch (error) {
      const message = this.toSafeErrorMessage(error, context);
      void vscode.window.showErrorMessage(message);
      this.resultPanelManager.openResultPanel(
        {
          appName: context.appName,
          tableName: resolveSqlResultTableName(sqlInput),
          sql: sqlInput,
          executedAt: new Date().toISOString(),
          errorMessage: message,
        },
        toPositiveViewColumnNumber(editor.viewColumn)
      );
      return;
    }

    if (splitStatements.length === 0) {
      void vscode.window.showWarningMessage('Query is empty.');
      return;
    }

    let tableName = resolveSqlResultTableName(splitStatements[0]?.sql ?? '');
    const resultPanel = this.openLoadingResultPanel(
      context.appName,
      tableName,
      sqlInput,
      toPositiveViewColumnNumber(editor.viewColumn)
    );

    try {
      await this.prefetchTableNames(context.appId);
      const tableEntries = resolveCompletionTableEntries(context);
      this.logSql(
        `manual statement table context app ${sanitizeSqlLogValue(context.appName)} schema ${sanitizeSqlLogValue(context.schema)} loadedTables=${String(tableEntries.length)}`
      );

      const prepared = splitStatements.map((entry) => this.prepareStatement(context, entry.sql, tableEntries));
      tableName = prepared[0]?.tableName ?? resolveSqlResultTableName(prepared[0]?.executionSql ?? '');

      const pendingViews: SqlResultStatementView[] = prepared.map((statement) => ({
        sql: statement.executionSql,
        status: 'pending' as SqlResultStatementStatus,
        tableName: statement.tableName,
      }));

      resultPanel.update({
        appName: context.appName,
        tableName,
        sql: sqlInput,
        executedAt: new Date().toISOString(),
        isLoading: prepared.length === 1,
        statements: pendingViews,
      });

      const batchLabel = prepared.length > 1 ? `batch (${String(prepared.length)} stmts)` : prepared[0]?.statementKind ?? 'statement';
      this.logSql(
        `run ${batchLabel} for app ${sanitizeSqlLogValue(context.appName)} first-table ${sanitizeSqlLogValue(tableName)}`
      );
      for (const [index, statement] of prepared.entries()) {
        this.logSql(
          `  [${String(index + 1)}/${String(prepared.length)}] ${statement.statementKind} ${sanitizeSqlCommandLogValue(statement.executionSql)}`
        );
      }

      let lastProgressUpdateAt = 0;
      const batchOutcome = await this.executeBatchForContext(context, prepared, (statementIndex, outcome) => {
        pendingViews[statementIndex] = this.toStatementView(prepared[statementIndex], outcome);
        if (prepared.length === 1) {
          return;
        }
        const now = Date.now();
        if (now - lastProgressUpdateAt < HANA_SQL_BATCH_PROGRESS_INTERVAL_MS) {
          return;
        }
        lastProgressUpdateAt = now;
        resultPanel.update({
          appName: context.appName,
          tableName,
          sql: sqlInput,
          executedAt: new Date().toISOString(),
          statements: pendingViews.slice(),
        });
      });

      const finalViews = batchOutcome.outcomes.map((outcome, index) =>
        this.toStatementView(prepared[index], outcome)
      );
      const summary: SqlResultBatchSummary = {
        usedTransaction: batchOutcome.usedTransaction,
        committed: batchOutcome.committed,
        rolledBack: batchOutcome.rolledBack,
        ...(batchOutcome.transactionUnavailableReason === undefined
          ? {}
          : { transactionUnavailableReason: batchOutcome.transactionUnavailableReason }),
        ...(batchOutcome.commitFailureMessage === undefined
          ? {}
          : { commitFailureMessage: batchOutcome.commitFailureMessage }),
      };

      this.logSql(
        `batch completed for app ${sanitizeSqlLogValue(context.appName)} (${describeBatchCounts(finalViews)})`
      );

      const finalOptions: RenderSqlResultOptions = {
        appName: context.appName,
        tableName,
        sql: sqlInput,
        executedAt: new Date().toISOString(),
        statements: finalViews,
        batchSummary: summary,
      };
      const onlyView = finalViews.length === 1 ? finalViews[0] : undefined;
      if (onlyView?.result !== undefined) {
        (finalOptions as { result?: HanaQueryResult }).result = onlyView.result;
      }
      if (onlyView?.errorMessage !== undefined) {
        (finalOptions as { errorMessage?: string }).errorMessage = onlyView.errorMessage;
      }
      resultPanel.update(finalOptions);
    } catch (error) {
      const message = this.toSafeErrorMessage(error, context);
      this.logSql(
        `statement failed for app ${sanitizeSqlLogValue(context.appName)}: ${sanitizeSqlLogValue(message)}`
      );
      void vscode.window.showErrorMessage(message);
      resultPanel.update({
        appName: context.appName,
        tableName,
        sql: sqlInput,
        executedAt: new Date().toISOString(),
        errorMessage: message,
      });
    }
  }

  private prepareStatement(
    context: HanaSqlAppContext,
    rawSql: string,
    tableEntries: readonly HanaTableDisplayEntry[]
  ): PreparedStatement {
    const statementKind = classifyHanaSqlStatement(rawSql);
    const guarded =
      statementKind === 'readonly'
        ? applyDefaultHanaSelectLimit(rawSql)
        : { sql: rawSql, applied: false, limit: HANA_SQL_DEFAULT_SELECT_LIMIT };
    if (guarded.applied) {
      this.logSql(
        `applied default LIMIT ${String(guarded.limit)} for app ${sanitizeSqlLogValue(context.appName)}`
      );
    }
    const resolution = resolveHanaDisplayTableReferences(guarded.sql, tableEntries, context.schema);
    const executionSql = resolution.sql;
    if (resolution.replacements.length > 0) {
      const preview = resolution.replacements.slice(0, 4).map((replacement) => {
        return `${sanitizeSqlLogValue(replacement.displayName)} -> ${sanitizeSqlLogValue(replacement.identifier)}`;
      });
      const suffix = resolution.replacements.length > preview.length
        ? `, +${String(resolution.replacements.length - preview.length)} more`
        : '';
      this.logSql(
        `resolved ${String(resolution.replacements.length)} table display reference(s) for app ${sanitizeSqlLogValue(context.appName)}: ${preview.join(', ')}${suffix}`
      );
    } else {
      const missLog = buildHanaTableReferenceResolutionMissLog(executionSql, tableEntries);
      if (missLog !== null) {
        this.logSql(sanitizeSqlLogValue(missLog));
      }
    }
    return {
      executionSql,
      statementKind,
      tableName: resolvePreparedStatementTableName(
        executionSql,
        resolution.replacements,
        tableEntries
      ),
    };
  }

  private toStatementView(
    prepared: PreparedStatement | undefined,
    outcome: HanaStatementOutcome
  ): SqlResultStatementView {
    const tableName = prepared?.tableName ?? resolveSqlResultTableName(outcome.sql);
    const base = {
      sql: outcome.sql,
      tableName,
    };
    if (outcome.status === 'success') {
      const success: SqlResultStatementView = {
        ...base,
        status: 'success',
        elapsedMs: outcome.elapsedMs ?? 0,
      };
      if (outcome.result !== undefined) {
        (success as { result?: HanaQueryResult }).result = outcome.result;
      }
      return success;
    }
    if (outcome.status === 'error') {
      return {
        ...base,
        status: 'error',
        errorMessage: outcome.errorMessage ?? 'Query execution failed.',
        elapsedMs: outcome.elapsedMs ?? 0,
      };
    }
    return {
      ...base,
      status: 'skipped',
    };
  }

  /**
   * Run a HANA operation, transparently falling back to a cf-ssh tunnel when the
   * direct connection is unreachable (stopped instance / IP allowlist / network
   * reset). The direct attempt — the normal, non-tunnel path — is run first and
   * unchanged; tunneling only ever engages after it fails with a connectivity
   * error and only when enabled. Once a tunnel is open for the host, later calls
   * use it straight away.
   */
  private async withTunnelFallback<T>(
    context: HanaSqlAppContext,
    run: (connection: HanaConnection, overrides?: TunnelConnectOverrides) => Promise<T>
  ): Promise<T> {
    const direct = context.connection;
    if (direct === null) {
      throw new Error('Unable to resolve HANA connection.');
    }

    const activeManager = this.tunnelManager;
    if (activeManager?.isActive(direct.host) === true) {
      try {
        const result = await run(
          activeManager.buildTunneledConnection(direct),
          TUNNEL_CONNECT_OVERRIDES
        );
        this.markTunnelActive(context);
        return result;
      } catch (error) {
        // A non-connectivity error (e.g. SQL syntax) is the real result — surface
        // it. A connectivity error means the tunnel went stale (keep-alive ended
        // or SSH dropped).
        if (!isHanaConnectivityError(error)) {
          throw error;
        }
        activeManager.invalidate(direct.host);
        // The host is unreachable directly (that's why a tunnel existed), so skip
        // the slow direct attempt and rebuild the tunnel straight away.
        const session = context.session;
        if (!this.isAutoTunnelEnabled() || session === null) {
          throw error;
        }
        return this.runViaTunnel(context, direct, session, run, error);
      }
    }

    try {
      const result = await run(direct);
      // Direct connection works → this app does not (any longer) need a tunnel;
      // clear the badge and the persisted flag follows on the next cache write.
      this.clearTunnelState(context);
      return result;
    } catch (error) {
      const session = context.session;
      if (!this.isAutoTunnelEnabled() || session === null || !isHanaConnectivityError(error)) {
        throw error;
      }
      return this.runViaTunnel(context, direct, session, run, error);
    }
  }

  private async runViaTunnel<T>(
    context: HanaSqlAppContext,
    direct: HanaConnection,
    session: HanaSqlScopeSession,
    run: (connection: HanaConnection, overrides?: TunnelConnectOverrides) => Promise<T>,
    originalError: unknown
  ): Promise<T> {
    const manager = this.getTunnelManager();
    // SSH access is per-app, and apps sharing a HANA instance can differ: some
    // allow `cf ssh`, some don't. Try, in order: the app that already opened a
    // working forward for this host (if any — others on the instance may have no
    // SSH of their own), then the clicked/in-use app (its container is the
    // natural jump-host for its OWN binding), then a small bounded set of other
    // running apps. This avoids spawning a `cf ssh` for every app in a large
    // space while still finding the one app that can reach the instance.
    // In-memory hint (this session) falls back to the persisted one (survives
    // reload), so the SSH-capable app for this instance is reused even on the
    // first refresh after a restart.
    const rememberedApp =
      manager.preferredJumpApp(direct.host) ?? (await this.loadPersistedJumpApp(direct.host));
    const primaryCandidates = resolveJumpHostCandidates(rememberedApp, context.appName);
    let tunnel = await manager.ensureTunnel(session, direct.host, primaryCandidates);
    if (tunnel === null) {
      const fallbacks = await this.listSshFallbackApps(session, context.appName);
      if (fallbacks.length > 0) {
        tunnel = await manager.ensureTunnel(session, direct.host, fallbacks);
      }
    }
    if (tunnel === null) {
      throw originalError;
    }

    // The tunneled connection disables HANA Cloud's redirect (see
    // buildTunneledConnection), so it stays on the gateway endpoint reachable
    // through this single forward — no second forward / redirect discovery.
    const result = await run(manager.buildTunneledConnection(direct), TUNNEL_CONNECT_OVERRIDES);
    this.markTunnelActive(context);
    // Persist the jump-host that worked when it is newly discovered/changed, so
    // a future session reuses it instead of failing on a non-SSH sibling app.
    const workingApp = manager.preferredJumpApp(direct.host);
    if (workingApp !== undefined && workingApp !== rememberedApp) {
      void this.persistJumpApp(direct.host, workingApp);
    }
    return result;
  }

  private async loadPersistedJumpApp(host: string): Promise<string | undefined> {
    try {
      return (await this.cacheStore?.getHanaTunnelJumpApp(host)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async persistJumpApp(host: string, app: string): Promise<void> {
    try {
      // Best-effort: the gateway method is always present, but the backing
      // globalState write can still throw (disk/JSON), so guard it.
      await this.cacheStore?.setHanaTunnelJumpApp(host, app);
    } catch {
      /* best-effort persistence */
    }
  }

  /**
   * Re-establish a tunnel in the background for an app whose tables were served
   * from cache (so no connection was made) but which is known to have used a
   * tunnel before. Goes straight to the tunnel path — the host is known to be
   * unreachable directly — so the tunnel is live before the user runs a query.
   * Best-effort: any failure just leaves the lazy fallback to handle the first
   * real query.
   */
  private async proactivelyEstablishTunnel(context: HanaSqlAppContext): Promise<void> {
    if (this.isTestMode || !this.isAutoTunnelEnabled()) {
      return;
    }
    try {
      await this.ensureConnection(context);
    } catch {
      return;
    }
    const direct = context.connection;
    const session = context.session;
    if (direct === null || session === null) {
      return;
    }
    if (this.tunnelManager?.isActive(direct.host) === true) {
      this.markTunnelActive(context);
      return;
    }
    try {
      await this.runViaTunnel(
        context,
        direct,
        session,
        (connection, overrides) =>
          executeHanaQuery(connection, TUNNEL_PROBE_SQL, { timeoutMs: 15_000, ...overrides }),
        new Error('proactive tunnel establishment')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logSql(
        `proactive tunnel setup failed for app ${sanitizeSqlLogValue(context.appName)}: ${sanitizeSqlLogValue(message)}`
      );
    }
  }

  private getTunnelManager(): HanaTunnelManager {
    this.tunnelManager ??= new HanaTunnelManager(
      (message) => {
        this.outputChannel.appendLine(message);
      },
      (mainHost) => {
        this.handleTunnelClosed(mainHost);
      }
    );
    return this.tunnelManager;
  }

  private handleTunnelClosed(mainHost: string): void {
    for (const context of this.appContextsByAppId.values()) {
      if (context.tunnelActive && context.connection?.host === mainHost) {
        this.clearTunnelState(context);
      }
    }
  }

  private isAutoTunnelEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('sapTools')
      .get<boolean>('hanaSqlAutoTunnel', true);
  }

  private async listSshFallbackApps(
    session: HanaSqlScopeSession,
    excludeApp: string
  ): Promise<string[]> {
    try {
      const apps = await fetchStartedAppsViaCfCli({
        apiEndpoint: session.apiEndpoint,
        email: session.email,
        password: session.password,
        orgName: session.orgName,
        spaceName: session.spaceName,
        cfHomeDir: session.cfHomeDir,
      });
      const names: string[] = [];
      for (const app of apps) {
        if (app.name !== excludeApp) {
          names.push(app.name);
          if (names.length >= MAX_SSH_FALLBACK_APPS) {
            break;
          }
        }
      }
      return names;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logSql(`tunnel fallback app discovery failed: ${sanitizeSqlLogValue(message)}`);
      return [];
    }
  }

  /**
   * Probe the DIRECT connection (bypassing any tunnel) to decide whether a
   * tunnel is still needed. A connectivity failure means "still unreachable
   * directly" (keep tunneling); anything else means the host answered, so it is
   * reachable again. One short attempt — this runs on an explicit refresh.
   */
  private async isHostDirectlyReachable(connection: HanaConnection): Promise<boolean> {
    if (this.isTestMode) {
      return true;
    }
    try {
      await executeHanaQuery(connection, TUNNEL_PROBE_SQL, {
        timeoutMs: 8000,
        connectMaxAttempts: 1,
      });
      return true;
    } catch (error) {
      return !isHanaConnectivityError(error);
    }
  }

  private markTunnelActive(context: HanaSqlAppContext): void {
    if (context.tunnelActive) {
      return;
    }
    context.tunnelActive = true;
    this.logSql(`HANA tunnel active for app ${sanitizeSqlLogValue(context.appName)}`);
    this.tunnelStateListener?.(context.appId, true);
  }

  private clearTunnelState(context: HanaSqlAppContext): void {
    if (!context.tunnelActive) {
      return;
    }
    context.tunnelActive = false;
    this.tunnelStateListener?.(context.appId, false);
  }

  private async executeSqlForContext(
    context: HanaSqlAppContext,
    sql: string,
    statementKind: HanaSqlStatementKind
  ): Promise<HanaQueryResult> {
    if (this.isTestMode) {
      return buildTestModeQueryResult(context.appName, statementKind, sql);
    }

    await this.ensureConnection(context);
    if (context.connection === null) {
      throw new Error('Unable to resolve HANA connection.');
    }

    return this.withTunnelFallback(context, (connection, overrides) =>
      executeHanaQuery(connection, sql, { statementKind, ...overrides })
    );
  }

  private async executeBatchForContext(
    context: HanaSqlAppContext,
    prepared: readonly PreparedStatement[],
    onStatementComplete: (statementIndex: number, outcome: HanaStatementOutcome) => void
  ): Promise<HanaBatchExecutionSummary> {
    if (this.isTestMode) {
      return buildTestModeBatchOutcomes(context.appName, prepared, onStatementComplete);
    }

    await this.ensureConnection(context);
    if (context.connection === null) {
      throw new Error('Unable to resolve HANA connection.');
    }

    const inputs: HanaStatementInput[] = prepared.map((statement) => ({
      sql: statement.executionSql,
      statementKind: statement.statementKind,
    }));

    return this.withTunnelFallback(context, (connection, overrides) =>
      executeHanaQueryBatch(connection, inputs, {
        onStatementComplete,
        ...overrides,
      })
    );
  }

  private async prefetchTableNames(appId: string): Promise<void> {
    const context = this.appContextsByAppId.get(appId);
    if (context === undefined) {
      return;
    }

    while (context.tableNamesPromise != null) {
      const cacheVersionBeforeWait = context.cacheVersion;
      await context.tableNamesPromise;
      if (this.appContextsByAppId.get(appId) !== context) {
        return;
      }
      if (context.cacheVersion === cacheVersionBeforeWait) {
        return;
      }
    }

    const cacheVersion = context.cacheVersion;
    const tableNamesPromise = this.loadTableNames(context, cacheVersion)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logSql(`table suggestion preload failed: ${sanitizeSqlLogValue(message)}`);
      })
      .finally(() => {
        if (context.tableNamesPromise === tableNamesPromise) {
          context.tableNamesPromise = null;
        }
      });
    context.tableNamesPromise = tableNamesPromise;

    await context.tableNamesPromise;
  }

  private async loadTableNames(
    context: HanaSqlAppContext,
    cacheVersion: number
  ): Promise<void> {
    if (this.isTestMode) {
      await delayTestModeTableLoadIfConfigured();
      if (!this.isAppContextCurrent(context, cacheVersion)) {
        return;
      }
      context.schema = 'TEST_SCHEMA';
      context.tableNames = createTestModeTableNames(context.appName);
      context.tableEntries = await this.formatTableEntries(context.tableNames);
      this.logSql(
        `loaded ${String(context.tableNames.length)} test tables for app ${sanitizeSqlLogValue(context.appName)}`
      );
      return;
    }

    const forceRefresh = this.forceTableRefreshAppIds.delete(context.appId);
    const activeSession = this.activeSessionProvider !== null
      ? this.getActiveSession()
      : context.session;
    const cacheScopeKey = buildCacheScopeKeyForContext(context, activeSession);

    if (!forceRefresh && cacheScopeKey.length > 0 && this.cacheStore !== null) {
      const cachedEntry = await this.safeReadCachedTableList(cacheScopeKey, context);
      if (cachedEntry !== null && this.isAppContextCurrent(context, cacheVersion)) {
        context.schema = cachedEntry.schema;
        context.tableNames = cachedEntry.tableNames;
        context.tableEntries = cachedEntry.displayEntries.map((entry) => ({
          name: entry.name,
          displayName: entry.displayName,
        }));
        this.logSql(
          `loaded ${String(cachedEntry.tableNames.length)} tables from cache for app ${sanitizeSqlLogValue(context.appName)} (updated ${sanitizeSqlLogValue(cachedEntry.updatedAt)})`
        );
        if (cachedEntry.tunnelActive === true) {
          // Tables came from cache (no connection was made), but this app needed
          // a tunnel last time. Show the badge immediately and re-establish the
          // tunnel in the background so it is live before the user runs a query.
          context.tunnelActive = true;
          void this.proactivelyEstablishTunnel(context);
        }
        return;
      }
    }

    await this.ensureConnection(context, cacheVersion);
    if (forceRefresh && context.connection !== null) {
      const host = context.connection.host;
      if (this.tunnelManager?.isActive(host) === true) {
        // A manual refresh re-probes the direct connection — but must NOT tear
        // down a tunnel that other apps sharing this HANA instance depend on
        // (SSH access is per-app; they may have no way to reopen it). Only drop
        // the tunnel if the host is reachable directly again; otherwise keep it
        // so the discovery below reuses it.
        if (await this.isHostDirectlyReachable(context.connection)) {
          this.tunnelManager.invalidate(host);
          this.clearTunnelState(context);
        }
      } else {
        this.clearTunnelState(context);
      }
    }
    if (!this.isAppContextCurrent(context, cacheVersion) || context.connection === null) {
      return;
    }

    const discoverySchema = context.schema;
    const queries = buildTableDiscoveryQueries(discoverySchema);
    let hadSuccessfulDiscoveryQuery = false;
    let lastErrorMessage = '';
    for (const [index, query] of queries.entries()) {
      this.logSql(
        `run table discovery query ${String(index + 1)} for app ${sanitizeSqlLogValue(context.appName)}: ${sanitizeSqlLogValue(query)}`
      );
      try {
        const result = await this.withTunnelFallback(context, (connection, overrides) =>
          executeHanaQuery(connection, query, {
            timeoutMs: 15_000,
            ...overrides,
          })
        );
        if (result.kind !== 'resultset') {
          continue;
        }
        hadSuccessfulDiscoveryQuery = true;
        const tableNames = extractTableNames(result);
        const tableEntries = await this.formatTableEntries(tableNames);
        if (!this.isAppContextCurrent(context, cacheVersion)) {
          return;
        }
        context.tableNames = tableNames;
        context.tableEntries = tableEntries;
        if (tableNames.length > 0) {
          this.logSql(
            `loaded ${String(tableNames.length)} tables for app ${sanitizeSqlLogValue(context.appName)}`
          );
          await this.safeWriteCachedTableList(
            cacheScopeKey,
            context,
            cacheVersion,
            discoverySchema,
            tableNames,
            tableEntries
          );
          return;
        }
      } catch (error) {
        const message = this.toSafeErrorMessage(error, context);
        lastErrorMessage = message;
        this.logSql(
          `table discovery query ${String(index + 1)} failed for app ${sanitizeSqlLogValue(context.appName)}: ${sanitizeSqlLogValue(message)}`
        );
      }
    }
    if (!hadSuccessfulDiscoveryQuery && lastErrorMessage.length > 0) {
      throw new Error(`Failed to discover tables: ${lastErrorMessage}`);
    }
    if (!this.isAppContextCurrent(context, cacheVersion)) {
      return;
    }
    this.logSql(`no tables found for app ${sanitizeSqlLogValue(context.appName)}`);
    context.tableEntries = [];
    await this.safeWriteCachedTableList(
      cacheScopeKey,
      context,
      cacheVersion,
      discoverySchema,
      [],
      []
    );
  }

  private async safeReadCachedTableList(
    scopeKey: string,
    context: HanaSqlAppContext
  ): Promise<HanaTableListCacheEntry | null> {
    if (this.cacheStore === null) {
      return null;
    }
    try {
      return await this.cacheStore.getHanaTableList(scopeKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logSql(
        `failed to read cached tables for app ${sanitizeSqlLogValue(context.appName)}: ${sanitizeSqlLogValue(message)}`
      );
      return null;
    }
  }

  private async safeWriteCachedTableList(
    scopeKey: string,
    context: HanaSqlAppContext,
    cacheVersion: number,
    schema: string,
    tableNames: readonly string[],
    tableEntries: readonly HanaTableDisplayEntry[]
  ): Promise<void> {
    if (this.cacheStore === null || scopeKey.length === 0) {
      return;
    }
    if (!this.isAppContextCurrent(context, cacheVersion)) {
      return;
    }
    if (schema.length === 0 && tableNames.length === 0) {
      return;
    }
    try {
      await this.cacheStore.setHanaTableList(scopeKey, {
        schema,
        tableNames,
        displayEntries: tableEntries.map((entry) => ({
          name: entry.name,
          displayName: entry.displayName,
        })),
        updatedAt: new Date().toISOString(),
        tunnelActive: context.tunnelActive,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logSql(
        `failed to cache tables for app ${sanitizeSqlLogValue(context.appName)}: ${sanitizeSqlLogValue(message)}`
      );
    }
  }

  private async formatTableEntries(
    tableNames: readonly string[]
  ): Promise<readonly HanaTableDisplayEntry[]> {
    try {
      return await formatHanaTableDisplayEntries(tableNames);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logSql(`table display name formatter failed: ${sanitizeSqlLogValue(message)}`);
      return buildRawHanaTableDisplayEntries(tableNames);
    }
  }

  private async ensureConnection(
    context: HanaSqlAppContext,
    cacheVersion = context.cacheVersion
  ): Promise<void> {
    const activeSession = this.activeSessionProvider !== null
      ? this.getActiveSession()
      : context.session;

    if (context.connection !== null) {
      if (activeSession !== null && isSameHanaSqlScope(context.session, activeSession)) {
        return;
      }
      context.connection = null;
      context.schema = '';
      this.clearTunnelState(context);
    }

    if (activeSession === null) {
      throw new Error('No active CF scope session. Confirm scope and choose app again.');
    }

    const resolved = await resolveHanaConnectionFromApp({
      appName: context.appName,
      session: activeSession,
    });
    if (!this.isAppContextCurrent(context, cacheVersion)) {
      return;
    }
    context.connection = resolved.connection;
    context.schema = resolved.schema;
    context.session = activeSession;
    this.logSql(
      `resolved HANA connection for app ${sanitizeSqlLogValue(context.appName)} schema ${sanitizeSqlLogValue(context.schema)}`
    );
  }

  private isAppContextCurrent(context: HanaSqlAppContext, cacheVersion: number): boolean {
    return (
      this.appContextsByAppId.get(context.appId) === context &&
      context.cacheVersion === cacheVersion
    );
  }

  private resolveSqlSourceViewColumn(
    context: HanaSqlAppContext
  ): number | undefined {
    if (context.sqlDocumentUri.length > 0) {
      const visibleSqlEditor = vscode.window.visibleTextEditors.find((editor) => {
        const uri = editor.document.uri.toString();
        return uri === context.sqlDocumentUri || uri === context.sqlDocumentFileUri;
      });
      const visibleColumn = toPositiveViewColumnNumber(visibleSqlEditor?.viewColumn);
      if (visibleColumn !== undefined) {
        return visibleColumn;
      }
    }
    return toPositiveViewColumnNumber(vscode.window.activeTextEditor?.viewColumn);
  }

  private openLoadingResultPanel(
    appName: string,
    tableName: string,
    sql: string,
    sourceViewColumn: number | undefined
  ): HanaSqlResultPanelSession {
    this.logSql(`show loading result panel for app ${sanitizeSqlLogValue(appName)}`);
    return this.resultPanelManager.openResultPanel(
      { appName, tableName, sql, executedAt: new Date().toISOString(), isLoading: true },
      sourceViewColumn
    );
  }

  private updateLoadingResultPanel(
    resultPanel: HanaSqlResultPanelSession,
    appName: string,
    tableName: string,
    sql: string
  ): void {
    resultPanel.update({
      appName,
      tableName,
      sql,
      executedAt: new Date().toISOString(),
      isLoading: true,
    });
  }

  private toSafeErrorMessage(error: unknown, context: HanaSqlAppContext): string {
    const secrets: string[] = [];
    if (context.connection !== null) {
      secrets.push(context.connection.password);
    }
    const session = this.activeSessionProvider !== null
      ? this.getActiveSession()
      : context.session;
    if (session !== null) {
      secrets.push(session.password);
    }

    if (error instanceof HanaQueryError) {
      return sanitizeHanaErrorMessage(error.message, secrets);
    }
    if (error instanceof Error) {
      return sanitizeHanaErrorMessage(error.message, secrets);
    }
    return sanitizeHanaErrorMessage(String(error), secrets);
  }

  private updateSqlEditorContextKey(
    editor: vscode.TextEditor | undefined
  ): void {
    const enabled =
      editor !== undefined &&
      this.appIdByDocumentUri.has(editor.document.uri.toString());
    void vscode.commands.executeCommand('setContext', HANA_SQL_EDITOR_CONTEXT_KEY, enabled);
  }

  private logSql(message: string): void {
    this.outputChannel.appendLine(`[sql] ${message}`);
  }
}

function resolvePreparedStatementTableName(
  executionSql: string,
  replacements: readonly HanaResolvedTableReference[],
  tableEntries: readonly HanaTableDisplayEntry[]
): string {
  const targetTableName = resolveSqlResultTableName(executionSql);
  if (targetTableName === 'SQL statement') {
    return targetTableName;
  }
  const replacement = replacements.find((entry) => {
    return isSameHanaTableName(entry.tableName, targetTableName);
  });
  if (replacement !== undefined) {
    return replacement.displayName;
  }
  return findHanaTableDisplayName(tableEntries, targetTableName) ?? targetTableName;
}

function findHanaTableDisplayName(
  tableEntries: readonly HanaTableDisplayEntry[],
  tableName: string
): string | undefined {
  const entry = tableEntries.find((candidate) => {
    return (
      isSameHanaTableName(candidate.name, tableName) ||
      isSameHanaTableName(candidate.displayName, tableName)
    );
  });
  return entry?.displayName;
}

function isSameHanaTableName(left: string, right: string): boolean {
  return normalizeHanaTableName(left) === normalizeHanaTableName(right);
}

function normalizeHanaTableName(value: string): string {
  return value.trim().toUpperCase();
}
