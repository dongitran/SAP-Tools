import { HanaQueryError, findTopLevelSqlSemicolons, stripLeadingSqlComments } from './hanaSqlService';

/**
 * Upper bound on statements in a single batch. Kept high so large INSERT seed
 * scripts run without artificial truncation, while still guarding against a
 * pathological paste that would try to render an unbounded number of result
 * sections in the webview.
 */
export const MAX_HANA_SQL_BATCH_STATEMENTS = 100_000;

export interface SplitHanaStatement {
  readonly sql: string;
  readonly startOffset: number;
}

export function splitHanaSqlStatements(input: string): readonly SplitHanaStatement[] {
  const positions = findTopLevelSqlSemicolons(input);
  const fragments: SplitHanaStatement[] = [];
  let cursor = 0;
  for (const semi of positions) {
    appendFragmentIfMeaningful(fragments, input, cursor, semi);
    cursor = semi + 1;
  }
  if (cursor < input.length) {
    appendFragmentIfMeaningful(fragments, input, cursor, input.length);
  }
  if (fragments.length > MAX_HANA_SQL_BATCH_STATEMENTS) {
    throw new HanaQueryError(
      'sql',
      `Too many SQL statements in one batch (max ${String(MAX_HANA_SQL_BATCH_STATEMENTS)}).`
    );
  }
  return fragments;
}

function appendFragmentIfMeaningful(
  out: SplitHanaStatement[],
  input: string,
  start: number,
  end: number
): void {
  const raw = input.slice(start, end);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (stripLeadingSqlComments(trimmed).trim().length === 0) {
    return;
  }
  out.push({ sql: trimmed, startOffset: start + leadingWhitespace });
}
