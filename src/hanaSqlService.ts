import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { isUtf8 } from 'node:buffer';

const HANA_QUERY_DEFAULT_TIMEOUT_MS = 30_000;
const HANA_QUERY_RESULT_PREVIEW_BYTES = 4096;

export interface HanaConnection {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database?: string;
}

export interface HanaQueryResultSet {
  readonly kind: 'resultset';
  readonly columns: string[];
  readonly rows: string[][];
  readonly rowCount: number;
  readonly elapsedMs: number;
}

export interface HanaQueryStatus {
  readonly kind: 'status';
  readonly message: string;
  readonly elapsedMs: number;
}

export type HanaQueryResult = HanaQueryResultSet | HanaQueryStatus;

export type HanaSqlStatementKind = 'empty' | 'readonly' | 'mutating';

export type HanaQueryErrorKind =
  | 'connection'
  | 'auth'
  | 'sql'
  | 'timeout'
  | 'empty'
  | 'unknown';

export class HanaQueryError extends Error {
  readonly kind: HanaQueryErrorKind;
  readonly exitCode: number | null;

  constructor(kind: HanaQueryErrorKind, message: string, exitCode: number | null = null) {
    super(message);
    this.name = 'HanaQueryError';
    this.kind = kind;
    this.exitCode = exitCode;
  }
}

export interface HdbColumnMetadata {
  readonly columnDisplayName?: string;
  readonly columnName?: string;
  readonly displayName?: string;
}

export interface HdbStatement {
  readonly resultSetMetadata?: readonly HdbColumnMetadata[];
  exec(values: readonly unknown[], callback: HdbExecCallback): void;
  drop(callback?: (err: HdbCallbackError) => void): void;
}

export interface HdbClient {
  connect(callback: (err: HdbCallbackError) => void): void;
  exec?(sql: string, callback: HdbExecCallback): void;
  prepare(
    sql: string,
    callback: (err: HdbCallbackError, statement: HdbStatement | undefined) => void
  ): void;
  disconnect(callback?: (err: HdbCallbackError) => void): void;
  close(): void;
  on?(event: 'error', listener: (error: Error) => void): void;
  setAutoCommit?(autoCommit: boolean): void;
  commit?(callback: (err: HdbCallbackError) => void): void;
  rollback?(callback: (err: HdbCallbackError) => void): void;
}

export type HdbExecCallback = (
  err: HdbCallbackError,
  rowsOrAffected: HdbStatementResult
) => void;

export type HdbCallbackError = Error | null | undefined;
export type HdbRow = Readonly<Record<string, unknown>>;
export type HdbRowsOrAffected = number | readonly HdbRow[];
export type HdbStatementResult = HdbRowsOrAffected | undefined;

export interface HdbCreateClientArgs {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly databaseName?: string;
  readonly encrypt?: boolean;
  readonly sslValidateCertificate?: boolean;
}

export interface HdbModule {
  createClient(args: HdbCreateClientArgs): HdbClient;
}

export type HdbClientFactory = (connection: HanaConnection) => HdbClient;

export interface ExecuteHanaQueryOptions {
  readonly timeoutMs?: number;
  readonly clientFactory?: HdbClientFactory;
  readonly statementKind?: HanaSqlStatementKind;
}

export type HanaStatementOutcomeStatus = 'success' | 'error' | 'skipped';

export interface HanaStatementInput {
  readonly sql: string;
  readonly statementKind: HanaSqlStatementKind;
}

export interface HanaStatementOutcome {
  readonly sql: string;
  readonly statementKind: HanaSqlStatementKind;
  readonly status: HanaStatementOutcomeStatus;
  readonly result?: HanaQueryResult;
  readonly errorMessage?: string;
  readonly errorKind?: HanaQueryErrorKind;
  readonly elapsedMs?: number;
}

export interface HanaBatchExecutionSummary {
  readonly outcomes: readonly HanaStatementOutcome[];
  readonly usedTransaction: boolean;
  readonly committed: boolean;
  readonly rolledBack: boolean;
  readonly transactionUnavailableReason?: string;
  readonly elapsedMs: number;
}

export interface ExecuteHanaQueryBatchOptions {
  readonly timeoutMs?: number;
  readonly clientFactory?: HdbClientFactory;
  readonly onStatementComplete?: (
    index: number,
    outcome: HanaStatementOutcome
  ) => void;
}

export async function executeHanaQuery(
  connection: HanaConnection,
  sql: string,
  options: ExecuteHanaQueryOptions = {}
): Promise<HanaQueryResult> {
  const trimmedSql = normalizeSingleHanaStatement(sql);
  if (trimmedSql.length === 0) {
    throw new HanaQueryError('empty', 'Query is empty.');
  }

  const timeoutMs = options.timeoutMs ?? HANA_QUERY_DEFAULT_TIMEOUT_MS;
  const factory = options.clientFactory ?? createDefaultHdbClient;
  const statementKind = options.statementKind ?? classifyHanaSqlStatement(trimmedSql);

  let client: HdbClient;
  try {
    client = factory(connection);
  } catch (error) {
    throw toHanaQueryError(error, 'create-client');
  }

  client.on?.('error', () => {
    /* swallow late errors so they don't crash the host */
  });

  const started = Date.now();
  try {
    await connectClient(client, timeoutMs);
  } catch (error) {
    safeClose(client);
    throw toHanaQueryError(error, 'connect');
  }

  let result: HanaQueryResult;
  try {
    result =
      statementKind === 'mutating'
        ? await runDirectStatement(client, trimmedSql, timeoutMs, () => Date.now() - started)
        : await runPreparedStatement(client, trimmedSql, timeoutMs, () => Date.now() - started);
  } catch (error) {
    await safeDisconnect(client);
    throw toHanaQueryError(error, 'exec');
  }

  await safeDisconnect(client);
  return result;
}

export async function executeHanaQueryBatch(
  connection: HanaConnection,
  statements: readonly HanaStatementInput[],
  options: ExecuteHanaQueryBatchOptions = {}
): Promise<HanaBatchExecutionSummary> {
  if (statements.length === 0) {
    throw new HanaQueryError('empty', 'Query is empty.');
  }

  const timeoutMs = options.timeoutMs ?? HANA_QUERY_DEFAULT_TIMEOUT_MS;
  const factory = options.clientFactory ?? createDefaultHdbClient;
  const hasMutating = statements.some((statement) => statement.statementKind === 'mutating');

  let client: HdbClient;
  try {
    client = factory(connection);
  } catch (error) {
    throw toHanaQueryError(error, 'create-client');
  }

  client.on?.('error', () => {
    /* swallow late errors so they don't crash the host */
  });

  try {
    await connectClient(client, timeoutMs);
  } catch (error) {
    safeClose(client);
    throw toHanaQueryError(error, 'connect');
  }

  let usedTransaction = false;
  let transactionUnavailableReason: string | undefined;
  if (hasMutating) {
    if (typeof client.setAutoCommit === 'function' && typeof client.commit === 'function' && typeof client.rollback === 'function') {
      try {
        client.setAutoCommit(false);
        usedTransaction = true;
      } catch (error) {
        usedTransaction = false;
        transactionUnavailableReason = error instanceof Error ? error.message : 'autocommit toggle failed';
      }
    } else {
      transactionUnavailableReason = 'HDB driver does not expose transaction APIs.';
    }
  }

  const outcomes: HanaStatementOutcome[] = [];
  let committed = false;
  let rolledBack = false;
  let errorIndex = -1;
  const batchStartedAt = Date.now();

  try {
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      if (statement === undefined) {
        continue;
      }
      const statementStartedAt = Date.now();
      try {
        const result =
          statement.statementKind === 'mutating'
            ? await runDirectStatement(
                client,
                statement.sql,
                timeoutMs,
                () => Date.now() - statementStartedAt
              )
            : await runPreparedStatement(
                client,
                statement.sql,
                timeoutMs,
                () => Date.now() - statementStartedAt
              );
        const outcome: HanaStatementOutcome = {
          sql: statement.sql,
          statementKind: statement.statementKind,
          status: 'success',
          result,
          elapsedMs: Date.now() - statementStartedAt,
        };
        outcomes.push(outcome);
        options.onStatementComplete?.(index, outcome);
      } catch (error) {
        const mapped = toHanaQueryError(error, 'exec');
        const outcome: HanaStatementOutcome = {
          sql: statement.sql,
          statementKind: statement.statementKind,
          status: 'error',
          errorMessage: mapped.message,
          errorKind: mapped.kind,
          elapsedMs: Date.now() - statementStartedAt,
        };
        outcomes.push(outcome);
        options.onStatementComplete?.(index, outcome);
        errorIndex = index;
        break;
      }
    }

    if (errorIndex >= 0) {
      for (let index = errorIndex + 1; index < statements.length; index += 1) {
        const statement = statements[index];
        if (statement === undefined) {
          continue;
        }
        const skipped: HanaStatementOutcome = {
          sql: statement.sql,
          statementKind: statement.statementKind,
          status: 'skipped',
        };
        outcomes.push(skipped);
        options.onStatementComplete?.(index, skipped);
      }
    }

    if (usedTransaction) {
      if (errorIndex >= 0) {
        await rollbackTransaction(client, timeoutMs).catch(() => {
          /* best effort */
        });
        rolledBack = true;
      } else {
        try {
          await commitTransaction(client, timeoutMs);
          committed = true;
        } catch (error) {
          const mapped = toHanaQueryError(error, 'exec');
          await rollbackTransaction(client, timeoutMs).catch(() => {
            /* best effort */
          });
          rolledBack = true;
          const lastOutcomeIndex = outcomes.length - 1;
          const last = lastOutcomeIndex >= 0 ? outcomes[lastOutcomeIndex] : undefined;
          if (last?.status === 'success') {
            outcomes[lastOutcomeIndex] = {
              ...last,
              status: 'error',
              errorMessage: `Commit failed: ${mapped.message}`,
              errorKind: mapped.kind,
            };
          }
        }
      }
    }
  } finally {
    await safeDisconnect(client);
  }

  const summary: HanaBatchExecutionSummary = transactionUnavailableReason === undefined
    ? {
        outcomes,
        usedTransaction,
        committed,
        rolledBack,
        elapsedMs: Date.now() - batchStartedAt,
      }
    : {
        outcomes,
        usedTransaction,
        committed,
        rolledBack,
        transactionUnavailableReason,
        elapsedMs: Date.now() - batchStartedAt,
      };
  return summary;
}

function commitTransaction(client: HdbClient, timeoutMs: number): Promise<undefined> {
  if (typeof client.commit !== 'function') {
    return Promise.reject(new Error('HDB client does not support commit.'));
  }
  return runWithTimeout<undefined>(
    'Commit',
    timeoutMs,
    new Promise<undefined>((resolve, reject) => {
      try {
        client.commit?.((err) => {
          if (hasHdbCallbackError(err)) {
            reject(err);
            return;
          }
          resolve(undefined);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })
  );
}

function rollbackTransaction(client: HdbClient, timeoutMs: number): Promise<undefined> {
  if (typeof client.rollback !== 'function') {
    return Promise.reject(new Error('HDB client does not support rollback.'));
  }
  return runWithTimeout<undefined>(
    'Rollback',
    timeoutMs,
    new Promise<undefined>((resolve, reject) => {
      try {
        client.rollback?.((err) => {
          if (hasHdbCallbackError(err)) {
            reject(err);
            return;
          }
          resolve(undefined);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })
  );
}

export function classifyHanaSqlStatement(sql: string): HanaSqlStatementKind {
  const normalized = stripLeadingSqlComments(sql).trim().toUpperCase();
  if (normalized.length === 0) {
    return 'empty';
  }

  const firstToken = /^[A-Z]+/.exec(normalized)?.[0] ?? '';
  if (['SELECT', 'WITH', 'EXPLAIN', 'DESCRIBE'].includes(firstToken)) {
    return 'readonly';
  }

  return 'mutating';
}

export function normalizeSingleHanaStatement(sql: string): string {
  const trimmedSql = sql.trim().replace(/;\s*$/, '').trim();
  if (trimmedSql.length === 0) {
    return '';
  }
  if (hasSqlDelimiterOutsideLiteral(trimmedSql)) {
    throw new HanaQueryError('sql', 'Only one SQL statement can be executed at a time.');
  }
  return trimmedSql;
}

export function sanitizeHanaErrorMessage(
  message: string,
  secrets: readonly string[] = []
): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    sanitized = sanitized.split(secret).join('[redacted]');
  }
  return sanitized
    .replace(/(password\s*[=:]\s*)\S+/gi, '$1[redacted]')
    .replace(/(token\s*[=:]\s*)\S+/gi, '$1[redacted]')
    .replace(/(secret\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

export function formatHanaCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return formatHanaBufferCellValue(value);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return Object.prototype.toString.call(value);
}

function formatHanaBufferCellValue(value: Buffer): string {
  const textValue = decodeTextLikeHanaBuffer(value);
  if (textValue !== null) {
    return textValue;
  }

  const head = value.subarray(0, HANA_QUERY_RESULT_PREVIEW_BYTES);
  const suffix =
    value.length > HANA_QUERY_RESULT_PREVIEW_BYTES
      ? `… (${String(value.length)} bytes)`
      : '';
  return `0x${head.toString('hex')}${suffix}`;
}

function decodeTextLikeHanaBuffer(value: Buffer): string | null {
  if (!isUtf8(value)) {
    return null;
  }

  const textValue = value.toString('utf8');
  if (!isDisplayableText(textValue)) {
    return null;
  }
  return textValue;
}

function isDisplayableText(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }
    if (char === '\n' || char === '\r' || char === '\t') {
      continue;
    }
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return false;
    }
  }
  return true;
}

export function extractColumnNames(
  statement: HdbStatement,
  rows: readonly HdbRow[]
): string[] {
  const metadata = statement.resultSetMetadata ?? [];
  if (metadata.length > 0) {
    return metadata.map((column, index) => {
      return (
        column.columnDisplayName ??
        column.displayName ??
        column.columnName ??
        `COL_${String(index + 1)}`
      );
    });
  }
  if (rows.length === 0) {
    return [];
  }
  return Object.keys(rows[0] ?? {});
}

async function connectClient(client: HdbClient, timeoutMs: number): Promise<void> {
  await runWithTimeout(
    'Connect',
    timeoutMs,
    new Promise<undefined>((resolve, reject) => {
      try {
        client.connect((err) => {
          if (hasHdbCallbackError(err)) {
            reject(err);
            return;
          }
          resolve(undefined);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })
  );
}

function runPreparedStatement(
  client: HdbClient,
  sql: string,
  timeoutMs: number,
  elapsedAtCompletion: () => number
): Promise<HanaQueryResult> {
  return runWithTimeout<HanaQueryResult>(
    'Query',
    timeoutMs,
    new Promise<HanaQueryResult>((resolve, reject) => {
      try {
        client.prepare(sql, (prepareErr, statement) => {
          if (hasHdbCallbackError(prepareErr)) {
            reject(prepareErr);
            return;
          }
          if (statement === undefined) {
            reject(new Error('hdb prepare returned no statement.'));
            return;
          }
          statement.exec([], (execErr, rowsOrAffected) => {
            const finishElapsed = elapsedAtCompletion();
            if (hasHdbCallbackError(execErr)) {
              statement.drop(() => {
                reject(execErr);
              });
              return;
            }
            const final = buildHanaQueryResult(statement, rowsOrAffected, finishElapsed);
            statement.drop(() => {
              resolve(final);
            });
          });
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })
  );
}

function runDirectStatement(
  client: HdbClient,
  sql: string,
  timeoutMs: number,
  elapsedAtCompletion: () => number
): Promise<HanaQueryResult> {
  return runWithTimeout<HanaQueryResult>(
    'Query',
    timeoutMs,
    new Promise<HanaQueryResult>((resolve, reject) => {
      if (client.exec === undefined) {
        reject(new Error('hdb direct exec is unavailable.'));
        return;
      }
      try {
        client.exec(sql, (execErr, rowsOrAffected) => {
          if (hasHdbCallbackError(execErr)) {
            reject(execErr);
            return;
          }
          resolve(buildHanaQueryResult(undefined, rowsOrAffected, elapsedAtCompletion()));
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })
  );
}

function buildHanaQueryResult(
  statement: HdbStatement | undefined,
  rowsOrAffected: HdbStatementResult,
  elapsedMs: number
): HanaQueryResult {
  if (rowsOrAffected === undefined) {
    return { kind: 'status', message: 'Statement executed.', elapsedMs };
  }
  if (typeof rowsOrAffected === 'number') {
    const message =
      rowsOrAffected === 1
        ? '1 row affected.'
        : `${String(rowsOrAffected)} rows affected.`;
    return { kind: 'status', message, elapsedMs };
  }

  const columns =
    statement === undefined
      ? extractColumnNamesFromRows(rowsOrAffected)
      : extractColumnNames(statement, rowsOrAffected);
  const rows = rowsOrAffected.map((row) => {
    return columns.map((column) => formatHanaCellValue(row[column]));
  });
  return {
    kind: 'resultset',
    columns,
    rows,
    rowCount: rows.length,
    elapsedMs,
  };
}

function extractColumnNamesFromRows(rows: readonly HdbRow[]): string[] {
  if (rows.length === 0) {
    return [];
  }
  return Object.keys(rows[0] ?? {});
}

function runWithTimeout<T>(
  label: string,
  timeoutMs: number,
  operation: Promise<T>
): Promise<T> {
  if (timeoutMs <= 0) {
    return operation;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HanaQueryError('timeout', `${label} timed out after ${String(timeoutMs)} ms.`));
    }, timeoutMs);
  });
  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

async function safeDisconnect(client: HdbClient): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      safeClose(client);
      resolve();
    };
    try {
      client.disconnect((err) => {
        if (hasHdbCallbackError(err)) {
          finish();
          return;
        }
        finish();
      });
    } catch {
      finish();
    }
    setTimeout(finish, 1500);
  });
}

function safeClose(client: HdbClient): void {
  try {
    client.close();
  } catch {
    /* ignore double close */
  }
}

function hasHdbCallbackError(error: HdbCallbackError): error is Error {
  return error !== null && error !== undefined;
}

function toHanaQueryError(
  error: unknown,
  stage: 'create-client' | 'connect' | 'exec'
): HanaQueryError {
  if (error instanceof HanaQueryError) {
    return error;
  }
  if (error !== null && typeof error === 'object') {
    const detail = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly sqlState?: unknown;
    };
    const messageText =
      typeof detail.message === 'string' && detail.message.length > 0
        ? detail.message
        : `hdb ${stage} failed.`;
    const numericCode = typeof detail.code === 'number' ? detail.code : null;
    const stringCode = typeof detail.code === 'string' ? detail.code : '';
    if (isAuthError(numericCode, messageText, stringCode)) {
      return new HanaQueryError('auth', messageText, numericCode);
    }
    if (isConnectionError(stage, stringCode, messageText)) {
      return new HanaQueryError('connection', messageText, numericCode);
    }
    if (stage === 'exec') {
      return new HanaQueryError('sql', messageText, numericCode);
    }
    return new HanaQueryError('unknown', messageText, numericCode);
  }
  return new HanaQueryError('unknown', `hdb ${stage} failed.`);
}

function isAuthError(
  numericCode: number | null,
  message: string,
  stringCode: string
): boolean {
  if (numericCode === 10 || numericCode === 414 || numericCode === 332) {
    return true;
  }
  if (stringCode === 'EAUTH') {
    return true;
  }
  return /authentication failed|invalid user name or password|user is locked|password.*expired/i.test(
    message
  );
}

function isConnectionError(
  stage: 'create-client' | 'connect' | 'exec',
  stringCode: string,
  message: string
): boolean {
  if (stage === 'connect' || stage === 'create-client') {
    return true;
  }
  if (
    stringCode === 'ECONNREFUSED' ||
    stringCode === 'ECONNRESET' ||
    stringCode === 'ETIMEDOUT' ||
    stringCode === 'ENOTFOUND' ||
    stringCode === 'EHOSTUNREACH' ||
    stringCode === 'EAI_AGAIN'
  ) {
    return true;
  }
  return /cannot connect|connection refused|network|host not found|unreachable|socket closed/i.test(
    message
  );
}

export function stripLeadingSqlComments(sql: string): string {
  let remaining = sql.trimStart();
  let didStrip = true;
  while (didStrip) {
    didStrip = false;
    if (remaining.startsWith('--')) {
      const newlineIndex = remaining.indexOf('\n');
      remaining = newlineIndex >= 0 ? remaining.slice(newlineIndex + 1).trimStart() : '';
      didStrip = true;
    }
    if (remaining.startsWith('/*')) {
      const endIndex = remaining.indexOf('*/');
      remaining = endIndex >= 0 ? remaining.slice(endIndex + 2).trimStart() : '';
      didStrip = true;
    }
  }
  return remaining;
}

export function findTopLevelSqlSemicolons(sql: string): readonly number[] {
  const positions: number[] = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
    } else if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') inLineComment = true;
      else if (char === '/' && next === '*') inBlockComment = true;
      else if (char === "'") inSingleQuote = true;
      else if (char === '"') inDoubleQuote = true;
      else if (char === ';') positions.push(index);
    } else if (inSingleQuote && char === "'") {
      if (next === "'") index += 1;
      else inSingleQuote = false;
    } else if (inDoubleQuote && char === '"') {
      inDoubleQuote = false;
    }
  }

  return positions;
}

function hasSqlDelimiterOutsideLiteral(sql: string): boolean {
  return findTopLevelSqlSemicolons(sql).length > 0;
}

let cachedHdbModule: HdbModule | undefined;

export function loadHdbModule(distDir: string = __dirname): HdbModule {
  if (cachedHdbModule !== undefined) {
    return cachedHdbModule;
  }
  const requireFromHere = createRequire(__filename);
  const vendoredEntry = join(distDir, 'vendor', 'hdb', 'index.js');
  const specifier = existsSync(vendoredEntry) ? vendoredEntry : 'hdb';
  cachedHdbModule = requireFromHere(specifier) as HdbModule;
  return cachedHdbModule;
}

function createDefaultHdbClient(connection: HanaConnection): HdbClient {
  const hdbModule = loadHdbModule();
  const args: HdbCreateClientArgs = {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    encrypt: true,
    sslValidateCertificate: true,
  };
  if (connection.database !== undefined && connection.database.length > 0) {
    return hdbModule.createClient({ ...args, databaseName: connection.database });
  }
  return hdbModule.createClient(args);
}
