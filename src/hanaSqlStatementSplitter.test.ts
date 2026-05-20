import { describe, expect, test } from 'vitest';

import { HanaQueryError } from './hanaSqlService';
import {
  MAX_HANA_SQL_BATCH_STATEMENTS,
  splitHanaSqlStatements,
} from './hanaSqlStatementSplitter';

describe('splitHanaSqlStatements', () => {
  test('returns a single statement when no top-level semicolon is present', () => {
    const statements = splitHanaSqlStatements('SELECT 1 FROM DUMMY');
    expect(statements).toEqual([{ sql: 'SELECT 1 FROM DUMMY', startOffset: 0 }]);
  });

  test('strips a single trailing semicolon and trailing whitespace', () => {
    const statements = splitHanaSqlStatements('SELECT 1 FROM DUMMY ;  \n');
    expect(statements).toEqual([{ sql: 'SELECT 1 FROM DUMMY', startOffset: 0 }]);
  });

  test('splits two statements separated by a top-level semicolon', () => {
    const statements = splitHanaSqlStatements('SELECT 1 FROM DUMMY; SELECT 2 FROM DUMMY');
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toBe('SELECT 1 FROM DUMMY');
    expect(statements[1]?.sql).toBe('SELECT 2 FROM DUMMY');
  });

  test('preserves semicolons inside single-quoted string literals', () => {
    const statements = splitHanaSqlStatements("SELECT 'a;b' FROM DUMMY; SELECT 'c;d' FROM DUMMY");
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toBe("SELECT 'a;b' FROM DUMMY");
    expect(statements[1]?.sql).toBe("SELECT 'c;d' FROM DUMMY");
  });

  test('handles escaped single quotes inside string literals', () => {
    const statements = splitHanaSqlStatements("SELECT 'a''b;c' FROM DUMMY; SELECT 2 FROM DUMMY");
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toBe("SELECT 'a''b;c' FROM DUMMY");
    expect(statements[1]?.sql).toBe('SELECT 2 FROM DUMMY');
  });

  test('preserves semicolons inside double-quoted identifiers', () => {
    const statements = splitHanaSqlStatements('SELECT * FROM "T;X"; SELECT 1 FROM DUMMY');
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toBe('SELECT * FROM "T;X"');
    expect(statements[1]?.sql).toBe('SELECT 1 FROM DUMMY');
  });

  test('preserves semicolons inside line comments', () => {
    const statements = splitHanaSqlStatements('SELECT 1 -- a;b\nFROM DUMMY; SELECT 2 FROM DUMMY');
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain('-- a;b');
    expect(statements[1]?.sql).toBe('SELECT 2 FROM DUMMY');
  });

  test('preserves semicolons inside block comments', () => {
    const statements = splitHanaSqlStatements('SELECT /* a;b */ 1 FROM DUMMY; SELECT 2 FROM DUMMY');
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toBe('SELECT /* a;b */ 1 FROM DUMMY');
    expect(statements[1]?.sql).toBe('SELECT 2 FROM DUMMY');
  });

  test('drops empty fragments between consecutive semicolons', () => {
    const statements = splitHanaSqlStatements('SELECT 1 FROM DUMMY;;SELECT 2 FROM DUMMY;');
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toBe('SELECT 1 FROM DUMMY');
    expect(statements[1]?.sql).toBe('SELECT 2 FROM DUMMY');
  });

  test('drops comment-only fragments', () => {
    const statements = splitHanaSqlStatements(
      'SELECT 1 FROM DUMMY;\n-- only a comment\n;\nSELECT 2 FROM DUMMY'
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toBe('SELECT 1 FROM DUMMY');
    expect(statements[1]?.sql).toBe('SELECT 2 FROM DUMMY');
  });

  test('returns an empty list when input only contains whitespace and semicolons', () => {
    expect(splitHanaSqlStatements('   ;  ;\n  ;')).toEqual([]);
    expect(splitHanaSqlStatements('')).toEqual([]);
  });

  test('records the starting offset of each statement in the original input', () => {
    const input = 'SELECT 1 FROM DUMMY; SELECT 2 FROM DUMMY';
    const statements = splitHanaSqlStatements(input);
    expect(statements[0]?.startOffset).toBe(0);
    expect(statements[1]?.startOffset).toBe(input.indexOf('SELECT 2'));
  });

  test('throws when the number of statements exceeds the hard cap', () => {
    const input = Array.from({ length: MAX_HANA_SQL_BATCH_STATEMENTS + 1 }, () => 'SELECT 1 FROM DUMMY').join(';\n');
    expect(() => splitHanaSqlStatements(input)).toThrowError(HanaQueryError);
  });

  test('accepts exactly the hard cap of statements', () => {
    const input = Array.from({ length: MAX_HANA_SQL_BATCH_STATEMENTS }, () => 'SELECT 1 FROM DUMMY').join(';\n');
    const statements = splitHanaSqlStatements(input);
    expect(statements).toHaveLength(MAX_HANA_SQL_BATCH_STATEMENTS);
  });
});
