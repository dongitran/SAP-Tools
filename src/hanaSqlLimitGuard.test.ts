import { describe, expect, test } from 'vitest';

import {
  HANA_SQL_DEFAULT_SELECT_LIMIT,
  applyDefaultHanaSelectLimit,
} from './hanaSqlLimitGuard';

describe('applyDefaultHanaSelectLimit', () => {
  test('adds the default row limit to a simple SELECT statement', () => {
    expect(applyDefaultHanaSelectLimit('SELECT * FROM ORDERS')).toEqual({
      applied: true,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: 'SELECT * FROM ORDERS LIMIT 100',
    });
  });

  test('adds the default row limit after ORDER BY', () => {
    expect(applyDefaultHanaSelectLimit('SELECT ID FROM ORDERS ORDER BY CREATED_AT DESC')).toEqual({
      applied: true,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: 'SELECT ID FROM ORDERS ORDER BY CREATED_AT DESC LIMIT 100',
    });
  });

  test('inserts the default row limit before trailing HANA select options', () => {
    expect(applyDefaultHanaSelectLimit('SELECT * FROM ORDERS FOR UPDATE WAIT 1')).toEqual({
      applied: true,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: 'SELECT * FROM ORDERS LIMIT 100 FOR UPDATE WAIT 1',
    });

    expect(applyDefaultHanaSelectLimit('SELECT * FROM ORDERS WITH HINT(IGNORE_PLAN_CACHE)')).toEqual({
      applied: true,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: 'SELECT * FROM ORDERS LIMIT 100 WITH HINT(IGNORE_PLAN_CACHE)',
    });
  });

  test('adds the default row limit to the outer query when only a nested query is limited', () => {
    const sql = 'WITH recent AS (SELECT * FROM ORDERS LIMIT 5) SELECT * FROM recent';

    expect(applyDefaultHanaSelectLimit(sql)).toEqual({
      applied: true,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: 'WITH recent AS (SELECT * FROM ORDERS LIMIT 5) SELECT * FROM recent LIMIT 100',
    });
  });

  test('ignores LIMIT text inside comments, strings, and quoted identifiers', () => {
    const sql = [
      '-- LIMIT 5 is only a comment',
      'SELECT "LIMIT" AS LIMIT_NAME, \'limit text\' AS NOTE FROM ORDERS',
    ].join('\n');

    expect(applyDefaultHanaSelectLimit(sql)).toEqual({
      applied: true,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: `${sql} LIMIT 100`,
    });
  });

  test('preserves statements that already include a top-level LIMIT clause', () => {
    const sql = 'SELECT * FROM ORDERS LIMIT 25 OFFSET 10';

    expect(applyDefaultHanaSelectLimit(sql)).toEqual({
      applied: false,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql,
    });
  });

  test('preserves statements that already include TOP or FETCH row limits', () => {
    const topSql = 'SELECT TOP 25 * FROM ORDERS';
    const fetchSql = 'SELECT * FROM ORDERS FETCH FIRST 25 ROWS ONLY';

    expect(applyDefaultHanaSelectLimit(topSql)).toEqual({
      applied: false,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: topSql,
    });
    expect(applyDefaultHanaSelectLimit(fetchSql)).toEqual({
      applied: false,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: fetchSql,
    });
  });

  test('limits set queries when a TOP clause only belongs to the first branch', () => {
    const sql = 'SELECT TOP 5 ID FROM ORDERS UNION ALL SELECT ID FROM ARCHIVED_ORDERS';

    expect(applyDefaultHanaSelectLimit(sql)).toEqual({
      applied: true,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql: `${sql} LIMIT 100`,
    });
  });

  test('preserves set queries that already include a final row limit', () => {
    const sql = 'SELECT ID FROM ORDERS UNION ALL SELECT ID FROM ARCHIVED_ORDERS LIMIT 25';

    expect(applyDefaultHanaSelectLimit(sql)).toEqual({
      applied: false,
      limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
      sql,
    });
  });

  test('leaves mutating and non-select readonly statements unchanged', () => {
    for (const sql of [
      "UPDATE ORDERS SET STATUS = 'OPEN'",
      'INSERT INTO AUDIT_LOG SELECT * FROM ORDERS',
      'EXPLAIN PLAN FOR SELECT * FROM ORDERS',
      'DESCRIBE ORDERS',
    ]) {
      expect(applyDefaultHanaSelectLimit(sql)).toEqual({
        applied: false,
        limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
        sql,
      });
    }
  });

  test('uses a custom row limit when supplied', () => {
    expect(applyDefaultHanaSelectLimit('SELECT * FROM ORDERS', 50)).toEqual({
      applied: true,
      limit: 50,
      sql: 'SELECT * FROM ORDERS LIMIT 50',
    });
  });

  describe('Edge Cases (EOF handling)', () => {
    test('gracefully handles unclosed double quotes at EOF', () => {
      // The double quote opens but never closes before the end of the string
      const sql = 'SELECT * FROM "UNCLOSED_TABLE';
      expect(applyDefaultHanaSelectLimit(sql)).toEqual({
        applied: true,
        limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
        sql: sql + ' LIMIT ' + HANA_SQL_DEFAULT_SELECT_LIMIT,
      });
    });

    test('gracefully handles unclosed block comments at EOF', () => {
      // The block comment opens but never closes
      const sql = 'SELECT * FROM ORDERS /* UNCLOSED COMMENT';
      expect(applyDefaultHanaSelectLimit(sql)).toEqual({
        applied: true, // we still apply it because there is no existing limit outside
        limit: HANA_SQL_DEFAULT_SELECT_LIMIT,
        sql: sql + ' LIMIT ' + HANA_SQL_DEFAULT_SELECT_LIMIT,
      });
    });

    test('should handle missing block comments gracefully without hanging', () => {
      const sql = `SELECT * FROM T1 /* block comment unclosed
WHERE ID = 1`;
      expect(applyDefaultHanaSelectLimit(sql, 20)).toEqual({
        applied: true,
        limit: 20,
        sql: sql + ' LIMIT 20',
      });
    });

    test('should handle unclosed single quotes gracefully without hanging', () => {
      const sql = `SELECT * FROM T1 WHERE NAME = 'unclosed string`;
      expect(applyDefaultHanaSelectLimit(sql, 20)).toEqual({
        applied: true,
        limit: 20,
        sql: sql + ' LIMIT 20',
      });
    });

    test('should handle unclosed double quotes gracefully without hanging', () => {
      const sql = `SELECT * FROM "unclosed_identifier`;
      expect(applyDefaultHanaSelectLimit(sql, 20)).toEqual({
        applied: true,
        limit: 20,
        sql: sql + ' LIMIT 20',
      });
    });

    test('should parse escaped single quotes correctly', () => {
      const sql = `SELECT * FROM T1 WHERE NAME = 'escaped '' quote'`;
      expect(applyDefaultHanaSelectLimit(sql, 20)).toEqual({
        applied: true,
        limit: 20,
        sql: sql + ' LIMIT 20',
      });
    });

    test('should parse escaped double quotes correctly', () => {
      const sql = `SELECT * FROM "escaped "" table"`;
      expect(applyDefaultHanaSelectLimit(sql, 20)).toEqual({
        applied: true,
        limit: 20,
        sql: sql + ' LIMIT 20',
      });
    });
  });
});
