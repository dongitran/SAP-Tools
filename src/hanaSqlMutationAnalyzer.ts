/**
 * Analyzes mutating SQL statements (UPDATE/DELETE/MERGE) to:
 * 1. Identify the target table name and schema.
 * 2. Extract the WHERE clause.
 * 3. Build a backup SELECT query to run BEFORE the mutation.
 *
 * Uses the same token-based approach as hanaSqlLimitGuard to correctly
 * handle string literals, quoted identifiers, and nested parentheses.
 */

export type MutatingStatementType = 'UPDATE' | 'DELETE' | 'MERGE';

export interface MutationAnalysis {
  /** Whether this analysis produced a viable backup query. */
  readonly canBackup: boolean;
  readonly statementType: MutatingStatementType;
  /** Raw table name as extracted from the SQL (may include schema prefix). */
  readonly tableName: string;
  /** WHERE clause text (without the WHERE keyword), or null if absent. */
  readonly whereClause: string | null;
  /**
   * SELECT query to run to capture data before the mutation.
   * Null when no WHERE clause is present (backup would be unbounded).
   */
  readonly backupSelectSql: string | null;
}

interface SqlWordToken {
  readonly upper: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly depth: number;
}

/**
 * Analyze a single SQL statement (already split, no semicolon) to produce
 * a MutationAnalysis. Returns null if the statement is not a supported
 * mutating statement type.
 */
export function analyzeMutatingStatement(
  sql: string,
  schema: string
): MutationAnalysis | null {
  const source = sql.trim();
  const tokens = tokenizeSqlWords(source);
  const firstTop = tokens.find((t) => t.depth === 0);
  if (firstTop === undefined) return null;

  const verb = firstTop.upper;
  if (verb === 'UPDATE') return analyzeUpdate(source, tokens, schema);
  if (verb === 'DELETE') return analyzeDelete(source, tokens, schema);
  if (verb === 'MERGE') return analyzeMerge(source, tokens, schema);
  return null;
}

// ── UPDATE ───────────────────────────────────────────────────────────────────

function analyzeUpdate(
  sql: string,
  tokens: readonly SqlWordToken[],
  schema: string
): MutationAnalysis | null {
  // Syntax: UPDATE [schema.]table SET ... [WHERE ...]
  const updateIdx = tokens.findIndex((t) => t.depth === 0 && t.upper === 'UPDATE');
  if (updateIdx < 0) return null;

  const tableToken = findNextTopLevelToken(tokens, updateIdx);
  if (tableToken === undefined) return null;

  const tableName = resolveFullTableName(tokens, tableToken, sql);
  const whereClause = extractWhereClause(sql, tokens);

  return buildAnalysis('UPDATE', tableName, whereClause, schema);
}

// ── DELETE ───────────────────────────────────────────────────────────────────

function analyzeDelete(
  sql: string,
  tokens: readonly SqlWordToken[],
  schema: string
): MutationAnalysis | null {
  // Syntax: DELETE FROM [schema.]table [WHERE ...]
  //      or DELETE [schema.]table [WHERE ...]  (HANA allows this)
  const deleteIdx = tokens.findIndex((t) => t.depth === 0 && t.upper === 'DELETE');
  if (deleteIdx < 0) return null;

  const afterDelete = findNextTopLevelToken(tokens, deleteIdx);
  if (afterDelete === undefined) return null;

  let tableToken: SqlWordToken;
  if (afterDelete.upper === 'FROM') {
    const next = findNextTopLevelToken(tokens, tokens.indexOf(afterDelete));
    if (next === undefined) return null;
    tableToken = next;
  } else {
    tableToken = afterDelete;
  }

  const tableName = resolveFullTableName(tokens, tableToken, sql);
  const whereClause = extractWhereClause(sql, tokens);

  return buildAnalysis('DELETE', tableName, whereClause, schema);
}

// ── MERGE ────────────────────────────────────────────────────────────────────

function analyzeMerge(
  sql: string,
  tokens: readonly SqlWordToken[],
  schema: string
): MutationAnalysis | null {
  // Syntax: MERGE INTO [schema.]table USING ... ON ...
  const mergeIdx = tokens.findIndex((t) => t.depth === 0 && t.upper === 'MERGE');
  if (mergeIdx < 0) return null;

  const afterMerge = findNextTopLevelToken(tokens, mergeIdx);
  if (afterMerge === undefined) return null;

  let tableToken: SqlWordToken;
  if (afterMerge.upper === 'INTO') {
    const next = findNextTopLevelToken(tokens, tokens.indexOf(afterMerge));
    if (next === undefined) return null;
    tableToken = next;
  } else {
    tableToken = afterMerge;
  }

  const tableName = resolveFullTableName(tokens, tableToken, sql);

  // MERGE has no WHERE for pre-backup; extract the ON clause as the condition.
  const onClause = extractMergeOnClause(sql, tokens);

  return buildAnalysis('MERGE', tableName, onClause, schema);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAnalysis(
  statementType: MutatingStatementType,
  tableName: string,
  whereClause: string | null,
  schema: string
): MutationAnalysis {
  if (tableName.length === 0) {
    return { canBackup: false, statementType, tableName: '', whereClause: null, backupSelectSql: null };
  }

  if (whereClause === null || whereClause.trim().length === 0) {
    // No WHERE — cannot safely backup (could be unbounded)
    return { canBackup: false, statementType, tableName, whereClause: null, backupSelectSql: null };
  }

  const qualifiedTable = qualifyTableName(tableName, schema);
  const backupSelectSql = `SELECT * FROM ${qualifiedTable} WHERE ${whereClause.trim()}`;

  return {
    canBackup: true,
    statementType,
    tableName,
    whereClause: whereClause.trim(),
    backupSelectSql,
  };
}

/**
 * Qualify a table name with schema if it does not already contain a dot.
 * HANA system tables (DUMMY) and fully-qualified names are left as-is.
 */
function qualifyTableName(tableName: string, schema: string): string {
  if (tableName.includes('.')) {
    return tableName;
  }
  if (schema.trim().length === 0) {
    return tableName;
  }
  return `${schema}.${tableName}`;
}

/**
 * Given the token that starts a table reference, read the full qualified name
 * including an optional schema prefix (`schema.table` or `"SCHEMA"."TABLE"`).
 */
function resolveFullTableName(
  tokens: readonly SqlWordToken[],
  startToken: SqlWordToken,
  sql: string
): string {
  const startIdx = tokens.indexOf(startToken);
  if (startIdx < 0) return '';

  // Read identifiers separated by dots at depth 0
  let name = extractIdentifierText(sql, startToken);
  let nextIdx = startIdx + 1;

  while (nextIdx < tokens.length) {
    const tok = tokens[nextIdx];
    if (tok?.depth !== 0) break;
    // Check for dot between token and next token in raw SQL
    const prevToken = tokens[nextIdx - 1];
    const between = sql.slice(prevToken?.end ?? 0, tok.start).trim();
    if (between === '.') {
      name += '.' + extractIdentifierText(sql, tok);
      nextIdx += 1;
    } else {
      break;
    }
  }

  return name;
}

/**
 * Extract the raw text of an identifier token, preserving quoted identifiers.
 */
function extractIdentifierText(sql: string, token: SqlWordToken): string {
  // For quoted identifiers, the token text starts/ends with "
  const raw = sql.slice(token.start, token.end);
  return raw;
}

/**
 * Find the WHERE clause start position at top level and return its content.
 * Returns null if no top-level WHERE is present.
 */
function extractWhereClause(
  sql: string,
  tokens: readonly SqlWordToken[]
): string | null {
  // Find the last top-level WHERE (handles UPDATE ... SET ... WHERE ...)
  let whereStart = -1;
  for (const token of tokens) {
    if (token.depth === 0 && token.upper === 'WHERE') {
      whereStart = token.end;
    }
  }
  if (whereStart < 0) return null;

  // Where clause runs to end of statement (trailing ; already stripped by splitter)
  // Strip any ORDER BY / LIMIT / FOR UPDATE / WITH HINT that follows
  const afterWhere = sql.slice(whereStart);
  const trimmed = stripTrailingClauses(afterWhere, tokens, whereStart).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Strip trailing clauses (ORDER BY, LIMIT, FOR, WITH HINT) from the WHERE body.
 * These come after the WHERE conditions and should not be included in the backup SELECT.
 */
function stripTrailingClauses(whereBody: string, tokens: readonly SqlWordToken[], whereBodyStart: number): string {
  const trailingKeywords = new Set(['ORDER', 'LIMIT', 'FETCH', 'FOR', 'OFFSET', 'GROUP', 'HAVING']);
  let cutPoint = whereBody.length;

  for (const token of tokens) {
    if (token.depth !== 0) continue;
    if (token.start <= whereBodyStart) continue;
    if (trailingKeywords.has(token.upper)) {
      const relativePos = token.start - whereBodyStart;
      if (relativePos > 0 && relativePos < cutPoint) {
        cutPoint = relativePos;
      }
    }
  }

  return whereBody.slice(0, cutPoint).trimEnd();
}

/**
 * For MERGE, extract the ON clause condition as the backup filter.
 */
function extractMergeOnClause(sql: string, tokens: readonly SqlWordToken[]): string | null {
  let onStart = -1;
  let usingDepth = -1;

  for (const token of tokens) {
    if (token.depth === 0 && token.upper === 'USING') {
      usingDepth = 0;
    }
    if (usingDepth >= 0 && token.depth === 0 && token.upper === 'ON') {
      onStart = token.end;
      break;
    }
  }

  if (onStart < 0) return null;

  const afterOn = sql.slice(onStart).trimStart();
  const whenIdx = sql.toUpperCase().indexOf('WHEN', onStart);
  if (whenIdx > onStart) {
    return sql.slice(onStart, whenIdx).trim();
  }
  return afterOn.trim();
}

function findNextTopLevelToken(
  tokens: readonly SqlWordToken[],
  fromIndex: number
): SqlWordToken | undefined {
  return tokens.slice(fromIndex + 1).find((t) => t.depth === 0);
}

// ── Tokenizer (same approach as hanaSqlLimitGuard.ts) ────────────────────────

function tokenizeSqlWords(sql: string): SqlWordToken[] {
  const tokens: SqlWordToken[] = [];
  let depth = 0;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';

    if (char === "'") {
      index = skipSingleQuotedString(sql, index);
    } else if (char === '"') {
      const start = index;
      index = skipDoubleQuotedIdentifier(sql, index);
      const text = sql.slice(start, index);
      tokens.push({ upper: text, text, start, end: index, depth });
    } else if (char === '-' && next === '-') {
      index = skipLineComment(sql, index);
    } else if (char === '/' && next === '*') {
      index = skipBlockComment(sql, index);
    } else if (char === '(') {
      depth += 1;
      index += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
    } else if (isSqlWordStart(char)) {
      const start = index;
      index = readSqlWordEnd(sql, index + 1);
      const text = sql.slice(start, index);
      tokens.push({ upper: text.toUpperCase(), text, start, end: index, depth });
    } else {
      index += 1;
    }
  }

  return tokens;
}

function skipSingleQuotedString(sql: string, start: number): number {
  for (let i = start + 1; i < sql.length; i += 1) {
    if (sql[i] !== "'") continue;
    if (sql[i + 1] === "'") { i += 1; continue; }
    return i + 1;
  }
  return sql.length;
}

function skipDoubleQuotedIdentifier(sql: string, start: number): number {
  for (let i = start + 1; i < sql.length; i += 1) {
    if (sql[i] !== '"') continue;
    if (sql[i + 1] === '"') { i += 1; continue; }
    return i + 1;
  }
  return sql.length;
}

function skipLineComment(sql: string, start: number): number {
  const nl = sql.indexOf('\n', start + 2);
  return nl >= 0 ? nl + 1 : sql.length;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf('*/', start + 2);
  return end >= 0 ? end + 2 : sql.length;
}

function readSqlWordEnd(sql: string, start: number): number {
  let i = start;
  while (i < sql.length && isSqlWordPart(sql[i] ?? '')) i += 1;
  return i;
}

function isSqlWordStart(char: string): boolean {
  return /^[A-Za-z_]$/.test(char);
}

function isSqlWordPart(char: string): boolean {
  return /^[A-Za-z0-9_$#]$/.test(char);
}
