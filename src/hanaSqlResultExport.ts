import type { HanaQueryResultSet } from './hanaSqlService';
import type { SqlResultStatementView } from './hanaSqlResultHtml';

export type HanaSqlResultExportFormat = 'csv' | 'json';

export function formatHanaSqlResultSetCsv(result: HanaQueryResultSet): string {
  return [
    result.columns.map(formatCsvCell).join(','),
    ...result.rows.map((row) => {
      return result.columns.map((_, index) => formatCsvCell(row[index] ?? '')).join(',');
    }),
  ].join('\n');
}

function formatCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function formatHanaSqlResultSetJson(result: HanaQueryResultSet): string {
  const columnKeys = buildUniqueColumnKeys(result.columns);
  const rows = result.rows.map((row) => {
    return buildRowObject(columnKeys, row);
  });
  return JSON.stringify(rows, null, 2);
}

export function formatHanaSqlResultRowObjectJson(
  result: HanaQueryResultSet,
  rowIndex: number
): string | null {
  const row = resolveResultRow(result, rowIndex);
  if (row === null) {
    return null;
  }
  return JSON.stringify(buildRowObject(buildUniqueColumnKeys(result.columns), row), null, 2);
}

export function resolveHanaSqlResultCellValue(
  result: HanaQueryResultSet,
  rowIndex: number,
  columnIndex: number
): string | null {
  const row = resolveResultRow(result, rowIndex);
  if (row === null || !isValidIndex(columnIndex) || columnIndex >= result.columns.length) {
    return null;
  }
  return row[columnIndex] ?? '';
}

function buildRowObject(
  columnKeys: readonly string[],
  row: readonly string[]
): Record<string, string> {
  return Object.fromEntries(columnKeys.map((columnKey, index) => [columnKey, row[index] ?? '']));
}

function resolveResultRow(
  result: HanaQueryResultSet,
  rowIndex: number
): readonly string[] | null {
  if (!isValidIndex(rowIndex)) {
    return null;
  }
  return result.rows[rowIndex] ?? null;
}

function isValidIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function buildUniqueColumnKeys(columns: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  return columns.map((column, index) => {
    const baseKey = column.trim().length > 0 ? column.trim() : `COLUMN_${String(index + 1)}`;
    const count = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, count);
    return count === 1 ? baseKey : `${baseKey}_${String(count)}`;
  });
}

export function buildHanaSqlResultExportFileName(
  appName: string,
  executedAt: string,
  format: HanaSqlResultExportFormat
): string {
  const appSlug = appName.trim().toLowerCase().replaceAll(/[^a-z0-9._-]+/g, '-');
  const safeAppSlug = appSlug.length > 0 ? appSlug : 'hana-query';
  const timestamp = executedAt.replaceAll(/[^0-9a-z]+/gi, '-').replaceAll(/^-+|-+$/g, '');
  const safeTimestamp = timestamp.length > 0 ? timestamp : 'result';
  return `sap-tools-${safeAppSlug}-${safeTimestamp}.${format}`;
}

export function formatHanaSqlStatementBatchCsv(
  statements: readonly SqlResultStatementView[]
): string {
  const sections: string[] = [];
  statements.forEach((statement, index) => {
    sections.push(buildBatchSectionHeaderCsv(statement, index));
    if (statement.status === 'success' && statement.result?.kind === 'resultset') {
      sections.push(formatHanaSqlResultSetCsv(statement.result));
    }
    sections.push('');
  });
  return sections.join('\n');
}

export function formatHanaSqlStatementBatchJson(
  statements: readonly SqlResultStatementView[]
): string {
  return JSON.stringify(
    {
      statements: statements.map((statement, index) => buildBatchStatementJsonRecord(statement, index)),
    },
    null,
    2
  );
}

function buildBatchSectionHeaderCsv(
  statement: SqlResultStatementView,
  index: number
): string {
  const status = statement.status.toUpperCase();
  const trimmedTableName = statement.tableName?.trim() ?? '';
  const tableLabel = trimmedTableName.length > 0 ? trimmedTableName : 'SQL statement';
  const elapsed = statement.elapsedMs ?? 0;
  if (statement.status === 'success' && statement.result?.kind === 'resultset') {
    return `-- Statement ${String(index + 1)} (${status}, ${tableLabel}, ${String(elapsed)} ms)`;
  }
  if (statement.status === 'success' && statement.result?.kind === 'status') {
    return `-- Statement ${String(index + 1)} (${status}, ${tableLabel}, ${String(elapsed)} ms) - ${statement.result.message}`;
  }
  if (statement.status === 'error') {
    return `-- Statement ${String(index + 1)} (${status}, ${tableLabel}, ${String(elapsed)} ms) - ${statement.errorMessage ?? 'error'}`;
  }
  return `-- Statement ${String(index + 1)} (${status}, ${tableLabel}) - no result`;
}

function buildBatchStatementJsonRecord(
  statement: SqlResultStatementView,
  index: number
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    index: index + 1,
    sql: statement.sql,
    status: statement.status,
  };
  if (statement.tableName !== undefined) record['tableName'] = statement.tableName;
  if (statement.elapsedMs !== undefined) record['elapsedMs'] = statement.elapsedMs;
  if (statement.errorMessage !== undefined) record['errorMessage'] = statement.errorMessage;
  const result = statement.result;
  if (result?.kind === 'resultset') {
    record['columns'] = result.columns;
    record['rowCount'] = result.rowCount;
    record['rows'] = buildResultSetRows(result);
  } else if (result?.kind === 'status') {
    record['message'] = result.message;
  }
  return record;
}

function buildResultSetRows(result: HanaQueryResultSet): readonly Record<string, string>[] {
  const columnKeys = buildUniqueColumnKeys(result.columns);
  return result.rows.map((row) => buildRowObject(columnKeys, row));
}
