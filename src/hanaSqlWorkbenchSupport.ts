import {
  formatHanaCellValue,
  type HanaBatchExecutionSummary,
  type HanaQueryResult,
  type HanaQueryResultSet,
  type HanaSqlStatementKind,
  type HanaStatementOutcome,
} from './hanaSqlService';
export {
  buildHanaSqlResultExportFileName,
  formatHanaSqlResultRowObjectJson,
  formatHanaSqlResultSetCsv,
  formatHanaSqlResultSetJson,
  formatHanaSqlStatementBatchCsv,
  formatHanaSqlStatementBatchJson,
  resolveHanaSqlResultCellValue,
  type HanaSqlResultExportFormat,
} from './hanaSqlResultExport';
export {
  buildHanaSqlResultHtml,
  buildSqlBatchSectionUpdate,
  escapeHtml,
  summarizeSqlBatch,
  SQL_BATCH_PROGRESS_MESSAGE_TYPE,
  SQL_BATCH_SECTIONS_MESSAGE_TYPE,
  type RenderSqlResultOptions,
  type SqlBatchSectionUpdate,
  type SqlBatchSummaryView,
  type SqlResultBatchSummary,
  type SqlResultStatementStatus,
  type SqlResultStatementView,
} from './hanaSqlResultHtml';
import type { HanaTableDisplayEntry } from './hanaTableDisplayNameFormatter';
import { resolveHanaSqlTargetTableName } from './hanaSqlTableReferenceResolver';
export {
  buildRawHanaTableDisplayEntries,
  formatHanaTableDisplayEntries,
  formatHanaTableDisplayName,
  type HanaTableDisplayEntry,
} from './hanaTableDisplayNameFormatter';

export const TABLE_SUGGESTION_LIMIT = 500;
export const QUICK_SELECT_ROW_LIMIT = 100;
const TEST_MODE_SAMPLE_JSON_PAYLOAD =
  '{"status":"Success","message":"This is mock data for testing","timestamp":"2026-04-08T03:10:07.482Z"}';

export const SQL_KEYWORDS: readonly string[] = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'LIMIT',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'WITH',
  'EXPLAIN',
  'COMMIT',
  'ROLLBACK',
] as const;

export type SqlResultTargetColumn =
  | {
      readonly kind: 'beside';
    }
  | {
      readonly kind: 'existing';
      readonly viewColumn: number;
    };

export function buildInitialHanaSqlTemplate(appName: string): string {
  const normalizedAppName = appName.trim().length > 0 ? appName.trim() : 'selected-app';
  return [
    `-- SAP Tools SQL for ${normalizedAppName}`,
    'SELECT CURRENT_USER, CURRENT_SCHEMA FROM DUMMY;',
    '',
  ].join('\n');
}

export function sanitizeUntitledFileName(appName: string): string {
  const normalized = appName.trim().toLowerCase().replaceAll(/[^a-z0-9._-]+/g, '-');
  if (normalized.length > 0) {
    return normalized;
  }
  return 'hana-query';
}

export function resolveSqlResultTargetColumn(
  sourceColumn: number | undefined,
  existingColumns: readonly number[]
): SqlResultTargetColumn {
  const columns = [...new Set(existingColumns.filter((column) => column > 0))].sort(
    (left, right) => left - right
  );
  if (columns.length === 0) {
    return { kind: 'beside' };
  }
  if (sourceColumn === undefined || sourceColumn <= 0) {
    if (columns.length > 1) {
      return { kind: 'existing', viewColumn: columns[0] ?? 1 };
    }
    return { kind: 'beside' };
  }

  const rightColumn = columns.find((column) => column > sourceColumn);
  if (rightColumn !== undefined) {
    return { kind: 'existing', viewColumn: rightColumn };
  }

  const leftColumn = [...columns].reverse().find((column) => column < sourceColumn);
  if (leftColumn !== undefined) {
    return { kind: 'existing', viewColumn: leftColumn };
  }

  return { kind: 'beside' };
}

export function buildTestModeQueryResult(
  appName: string,
  statementKind: HanaSqlStatementKind,
  executedSql?: string
): HanaQueryResult {
  if (statementKind === 'readonly') {
    if (isTestModeSampleJsonPayloadQuery(executedSql)) {
      return {
        kind: 'resultset',
        columns: ['APP_NAME', 'CURRENT_SCHEMA', 'SAMPLE_JSON_PAYLOAD'],
        rows: [
          [
            appName,
            'TEST_SCHEMA',
            formatHanaCellValue(Buffer.from(TEST_MODE_SAMPLE_JSON_PAYLOAD, 'utf8')),
          ],
        ],
        rowCount: 1,
        elapsedMs: 5,
      };
    }

    const columns =
      executedSql === undefined
        ? ['APP_NAME', 'CURRENT_SCHEMA']
        : ['APP_NAME', 'CURRENT_SCHEMA', 'EXECUTED_SQL'];
    const row =
      executedSql === undefined ? [appName, 'TEST_SCHEMA'] : [appName, 'TEST_SCHEMA', executedSql];
    return {
      kind: 'resultset',
      columns,
      rows: [row],
      rowCount: 1,
      elapsedMs: 5,
    };
  }

  return {
    kind: 'status',
    message: 'Statement executed in SAP Tools test mode.',
    elapsedMs: 3,
  };
}

function isTestModeSampleJsonPayloadQuery(executedSql: string | undefined): boolean {
  return executedSql !== undefined && /\bSAMPLE_JSON_PAYLOAD\b/i.test(executedSql);
}

const TEST_MODE_BATCH_ERROR_MARKER = 'SAP_TOOLS_TEST_THROW_ERROR';

export interface TestModeBatchStatement {
  readonly executionSql: string;
  readonly statementKind: HanaSqlStatementKind;
}

export function buildTestModeBatchOutcomes(
  appName: string,
  statements: readonly TestModeBatchStatement[],
  onStatementComplete?: (statementIndex: number, outcome: HanaStatementOutcome) => void
): HanaBatchExecutionSummary {
  const outcomes: HanaStatementOutcome[] = [];
  let errorIndex = -1;
  const hasMutating = statements.some((statement) => statement.statementKind === 'mutating');
  const shouldUseTransaction = hasMutating && statements.length > 1;

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement === undefined) continue;
    if (errorIndex >= 0) {
      const skipped: HanaStatementOutcome = {
        sql: statement.executionSql,
        statementKind: statement.statementKind,
        status: 'skipped',
      };
      outcomes.push(skipped);
      onStatementComplete?.(index, skipped);
      continue;
    }
    if (statement.executionSql.includes(TEST_MODE_BATCH_ERROR_MARKER)) {
      const error: HanaStatementOutcome = {
        sql: statement.executionSql,
        statementKind: statement.statementKind,
        status: 'error',
        errorMessage: 'Simulated SAP Tools test-mode failure.',
        errorKind: 'sql',
        elapsedMs: 4,
      };
      outcomes.push(error);
      onStatementComplete?.(index, error);
      errorIndex = index;
      continue;
    }
    const result = buildTestModeQueryResult(appName, statement.statementKind, statement.executionSql);
    const success: HanaStatementOutcome = {
      sql: statement.executionSql,
      statementKind: statement.statementKind,
      status: 'success',
      result,
      elapsedMs: 5,
    };
    outcomes.push(success);
    onStatementComplete?.(index, success);
  }

  return {
    outcomes,
    usedTransaction: shouldUseTransaction,
    committed: shouldUseTransaction && errorIndex < 0,
    rolledBack: shouldUseTransaction && errorIndex >= 0,
    elapsedMs: outcomes.reduce((sum, outcome) => sum + (outcome.elapsedMs ?? 0), 0),
  };
}

export function createTestModeTableNames(appName: string): readonly string[] {
  const appPrefix = appName.trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');
  const normalizedPrefix = appPrefix.length > 0 ? appPrefix : 'APP';
  const baseTables = [
    `${normalizedPrefix}_ORDERS`,
    `${normalizedPrefix}_ITEMS`,
    `${normalizedPrefix}_AUDIT`,
    `${normalizedPrefix}_SAP_CAP_CDS_INVOICE_RECONCILIATION_DRAFTADMINISTRATIVEDATA`,
    `${normalizedPrefix}_COM_SAP_S4HANA_FINANCE_GENERAL_LEDGER_ACCOUNTING_DOCUMENT_ITEM`,
    `${normalizedPrefix}_VERY_LONG_NAMESPACE_WITH_DEEPLY_NESTED_SERVICE_PROJECTION_FOR_PAYMENT_ALLOCATION_HISTORY`,
    `${normalizedPrefix}_I_BUSINESSPARTNERBANK_0001_TO_SUPPLIERINVOICEPAYMENTBLOCKREASON`,
    'DEMO_APP',
    'DEMO_PURCHASEORDERITEMMAPPING',
    'DEMO_BUSINESSAPP_TEST',
    'DUMMY',
    'M_TABLES',
  ];
  const generatedTables = Array.from({ length: 93 }, (_, index) => {
    return `${normalizedPrefix}_ENTITY_${String(index + 1).padStart(3, '0')}`;
  });

  return [...baseTables, ...generatedTables];
}

function quoteHanaStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildTableDiscoveryQueries(schema: string): readonly string[] {
  const normalizedSchema = schema.trim();
  const schemaExpression =
    normalizedSchema.length > 0
      ? quoteHanaStringLiteral(normalizedSchema)
      : 'CURRENT_SCHEMA';

  return [
    `SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = ${schemaExpression} ORDER BY TABLE_NAME`,
    `SELECT TABLE_NAME FROM SYS.M_TABLES WHERE SCHEMA_NAME = ${schemaExpression} ORDER BY TABLE_NAME`,
  ];
}

export function extractTableNames(result: HanaQueryResultSet): readonly string[] {
  const names = new Set<string>();
  for (const row of result.rows) {
    const value = row[0]?.trim() ?? '';
    if (value.length > 0) {
      names.add(value);
    }
  }
  return [...names];
}

export function filterKeywordCandidates(prefix: string): readonly string[] {
  const normalizedPrefix = prefix.trim().toUpperCase();
  if (normalizedPrefix.length === 0) {
    return SQL_KEYWORDS;
  }
  return SQL_KEYWORDS.filter((keyword) => keyword.startsWith(normalizedPrefix));
}

export function filterTableCandidates(
  tableNames: readonly string[],
  prefix: string
): readonly string[] {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const matches =
    normalizedPrefix.length === 0
      ? tableNames
      : tableNames.filter((tableName) => tableName.toUpperCase().startsWith(normalizedPrefix));
  return matches.slice(0, TABLE_SUGGESTION_LIMIT);
}

export function filterTableEntryCandidates(
  tableEntries: readonly HanaTableDisplayEntry[],
  prefix: string
): readonly HanaTableDisplayEntry[] {
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (normalizedPrefix.length === 0) {
    return tableEntries.slice(0, TABLE_SUGGESTION_LIMIT);
  }

  const compactPrefix = normalizedPrefix.replaceAll(/[_\s]+/g, '');
  const matches = tableEntries.filter((entry) => {
    return isTableEntryCandidateMatch(entry, normalizedPrefix, compactPrefix);
  });
  return matches.slice(0, TABLE_SUGGESTION_LIMIT);
}

function isTableEntryCandidateMatch(
  entry: HanaTableDisplayEntry,
  normalizedPrefix: string,
  compactPrefix: string
): boolean {
  const rawName = entry.name.toLowerCase();
  const displayName = entry.displayName.toLowerCase();
  const compactDisplayName = displayName.replaceAll('_', '');
  return (
    rawName.includes(normalizedPrefix) ||
    displayName.includes(normalizedPrefix) ||
    compactDisplayName.includes(compactPrefix)
  );
}

export function quoteHanaIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export {
  resolveHanaDisplayTableReferences,
  resolveHanaSqlTargetTableName,
  type HanaResolvedTableReference,
  type HanaTableReferenceResolution,
} from './hanaSqlTableReferenceResolver';

export function buildHanaTableReferenceResolutionMissLog(
  sql: string,
  tableEntries: readonly HanaTableDisplayEntry[]
): string | null {
  const targetTableName = resolveHanaSqlTargetTableName(sql);
  if (targetTableName === null) {
    return null;
  }
  if (!shouldReportHanaTableResolutionMiss(targetTableName, tableEntries)) {
    return null;
  }

  const normalizedTarget = normalizeHanaTableLogKey(targetTableName);
  const matchedEntry = tableEntries.find((entry) => {
    return (
      normalizeHanaTableLogKey(entry.name) === normalizedTarget ||
      normalizeHanaTableLogKey(entry.displayName) === normalizedTarget
    );
  });
  const matchDetail =
    matchedEntry === undefined
      ? 'no matching loaded table entry'
      : `matched loaded table ${matchedEntry.name}`;
  return `no table reference rewrite for target ${targetTableName}; ${matchDetail}; loadedTables=${String(tableEntries.length)}`;
}

function shouldReportHanaTableResolutionMiss(
  targetTableName: string,
  tableEntries: readonly HanaTableDisplayEntry[]
): boolean {
  if (!isUppercaseHanaIdentifierForLog(targetTableName)) {
    return true;
  }
  return tableEntries.some((entry) => {
    return normalizeHanaTableLogKey(entry.name) === targetTableName && entry.name !== targetTableName;
  });
}

function normalizeHanaTableLogKey(value: string): string {
  return value.trim().toUpperCase();
}

function isUppercaseHanaIdentifierForLog(value: string): boolean {
  return /^[A-Z_][A-Z0-9_$#]*$/.test(value);
}

export function buildQuickTableSelectSql(schema: string, tableName: string): string {
  const trimmedTable = tableName.trim();
  if (trimmedTable.length === 0) {
    throw new Error('Table name is required to build a SELECT statement.');
  }
  const tableId = quoteHanaIdentifier(trimmedTable);
  const trimmedSchema = schema.trim();
  if (trimmedSchema.length === 0) {
    return `SELECT * FROM ${tableId} LIMIT ${String(QUICK_SELECT_ROW_LIMIT)}`;
  }
  const schemaId = quoteHanaIdentifier(trimmedSchema);
  return `SELECT * FROM ${schemaId}.${tableId} LIMIT ${String(QUICK_SELECT_ROW_LIMIT)}`;
}
