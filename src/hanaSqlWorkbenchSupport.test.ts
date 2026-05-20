import { describe, expect, test } from 'vitest';

import type { HanaQueryResultSet } from './hanaSqlService';
import {
  QUICK_SELECT_ROW_LIMIT,
  SQL_KEYWORDS,
  TABLE_SUGGESTION_LIMIT,
  buildTableDiscoveryQueries,
  buildHanaTableReferenceResolutionMissLog,
  buildHanaSqlResultHtml,
  buildInitialHanaSqlTemplate,
  buildQuickTableSelectSql,
  buildTestModeBatchOutcomes,
  buildTestModeQueryResult,
  createTestModeTableNames,
  escapeHtml,
  formatHanaSqlResultSetCsv,
  formatHanaSqlResultSetJson,
  formatHanaSqlStatementBatchCsv,
  formatHanaSqlStatementBatchJson,
  formatHanaSqlResultRowObjectJson,
  resolveHanaSqlResultCellValue,
  extractTableNames,
  filterKeywordCandidates,
  filterTableEntryCandidates,
  filterTableCandidates,
  formatHanaTableDisplayEntries,
  formatHanaTableDisplayName,
  quoteHanaIdentifier,
  resolveHanaDisplayTableReferences,
  resolveHanaSqlTargetTableName,
  resolveSqlResultTargetColumn,
  sanitizeUntitledFileName,
} from './hanaSqlWorkbenchSupport';

describe('buildInitialHanaSqlTemplate', () => {
  test('includes the trimmed app name in the header comment', () => {
    const template = buildInitialHanaSqlTemplate('  finance-uat-api  ');
    expect(template).toContain('-- SAP Tools SQL for finance-uat-api');
    expect(template).toContain('SELECT CURRENT_USER, CURRENT_SCHEMA FROM DUMMY;');
    expect(template.endsWith('\n')).toBe(true);
  });

  test('falls back to placeholder label when the app name is blank', () => {
    const template = buildInitialHanaSqlTemplate('   ');
    expect(template).toContain('-- SAP Tools SQL for selected-app');
  });
});

describe('sanitizeUntitledFileName', () => {
  test('lowercases and replaces unsafe characters with a hyphen', () => {
    expect(sanitizeUntitledFileName('Finance UAT API!')).toBe('finance-uat-api-');
  });

  test('preserves dots, dashes, and underscores', () => {
    expect(sanitizeUntitledFileName('Finance.API_v2-01')).toBe('finance.api_v2-01');
  });

  test('falls back to hana-query when input is blank', () => {
    expect(sanitizeUntitledFileName('   ')).toBe('hana-query');
    expect(sanitizeUntitledFileName('')).toBe('hana-query');
  });

  test('collapses runs of unsafe characters into a single hyphen', () => {
    expect(sanitizeUntitledFileName('!!!')).toBe('-');
    expect(sanitizeUntitledFileName('a!!!b')).toBe('a-b');
  });
});

describe('filterKeywordCandidates', () => {
  test('returns every keyword when the prefix is empty', () => {
    const candidates = filterKeywordCandidates('');
    expect(candidates).toEqual(SQL_KEYWORDS);
  });

  test('filters keywords by case-insensitive prefix match', () => {
    const candidates = filterKeywordCandidates('se');
    expect([...candidates]).toEqual(['SELECT']);
  });

  test('returns an empty list when no keyword matches the prefix', () => {
    const candidates = filterKeywordCandidates('zzz');
    expect(candidates).toEqual([]);
  });
});

describe('filterTableCandidates', () => {
  const tables = ['ORDERS', 'ORDER_ITEMS', 'AUDIT', 'CUSTOMERS'];

  test('returns every table when the prefix is empty', () => {
    expect(filterTableCandidates(tables, '')).toEqual(tables);
  });

  test('filters tables by case-insensitive prefix match', () => {
    expect(filterTableCandidates(tables, 'ord')).toEqual(['ORDERS', 'ORDER_ITEMS']);
  });

  test('respects the TABLE_SUGGESTION_LIMIT when the table list is large', () => {
    const many = Array.from({ length: TABLE_SUGGESTION_LIMIT + 25 }, (_, index) => {
      return `T_${String(index).padStart(4, '0')}`;
    });
    expect(filterTableCandidates(many, '')).toHaveLength(TABLE_SUGGESTION_LIMIT);
  });
});

describe('filterTableEntryCandidates', () => {
  const entries = [
    {
      displayName: 'Demo_PurchaseOrderItemMapping',
      name: 'DEMO_PURCHASEORDERITEMMAPPING',
    },
    {
      displayName: 'Finance_UAT_API_Orders',
      name: 'FINANCE_UAT_API_ORDERS',
    },
    {
      displayName: 'Dummy',
      name: 'DUMMY',
    },
  ];

  test('matches readable table display names and preserves raw names', () => {
    expect(filterTableEntryCandidates(entries, 'PurchaseOrder')).toEqual([
      {
        displayName: 'Demo_PurchaseOrderItemMapping',
        name: 'DEMO_PURCHASEORDERITEMMAPPING',
      },
    ]);
  });

  test('matches raw table prefixes case-insensitively', () => {
    expect(filterTableEntryCandidates(entries, 'finance_uat')).toEqual([
      {
        displayName: 'Finance_UAT_API_Orders',
        name: 'FINANCE_UAT_API_ORDERS',
      },
    ]);
  });

  test('matches compact readable table names without underscores', () => {
    expect(filterTableEntryCandidates(entries, 'DemoPurchase')).toEqual([
      {
        displayName: 'Demo_PurchaseOrderItemMapping',
        name: 'DEMO_PURCHASEORDERITEMMAPPING',
      },
    ]);
  });

  test('respects the TABLE_SUGGESTION_LIMIT for display entries', () => {
    const many = Array.from({ length: TABLE_SUGGESTION_LIMIT + 25 }, (_, index) => {
      const id = String(index).padStart(4, '0');
      return {
        displayName: `Demo_Table_${id}`,
        name: `DEMO_TABLE_${id}`,
      };
    });
    expect(filterTableEntryCandidates(many, 'Demo')).toHaveLength(TABLE_SUGGESTION_LIMIT);
  });
});

describe('buildTestModeQueryResult', () => {
  test('returns a resultset preview for readonly statements', () => {
    const result = buildTestModeQueryResult('finance-uat-api', 'readonly');
    expect(result.kind).toBe('resultset');
    if (result.kind !== 'resultset') return;
    expect(result.columns).toEqual(['APP_NAME', 'CURRENT_SCHEMA']);
    expect(result.rows).toEqual([['finance-uat-api', 'TEST_SCHEMA']]);
  });

  test('returns a status payload for mutating statements', () => {
    const result = buildTestModeQueryResult('finance-uat-api', 'mutating');
    expect(result.kind).toBe('status');
    if (result.kind !== 'status') return;
    expect(result.message).toContain('test mode');
  });

  test('can include executed SQL in readonly test-mode results for e2e verification', () => {
    const result = buildTestModeQueryResult(
      'finance-uat-api',
      'readonly',
      'SELECT * FROM ORDERS LIMIT 100'
    );

    expect(result.kind).toBe('resultset');
    if (result.kind !== 'resultset') return;
    expect(result.columns).toEqual(['APP_NAME', 'CURRENT_SCHEMA', 'EXECUTED_SQL']);
    expect(result.rows).toEqual([
      ['finance-uat-api', 'TEST_SCHEMA', 'SELECT * FROM ORDERS LIMIT 100'],
    ]);
  });

  test('can include readable JSON payload text in readonly test-mode results', () => {
    const result = buildTestModeQueryResult(
      'finance-uat-api',
      'readonly',
      'SELECT SAMPLE_JSON_PAYLOAD FROM DEMO_APP LIMIT 100'
    );

    expect(result.kind).toBe('resultset');
    if (result.kind !== 'resultset') return;
    expect(result.columns).toEqual(['APP_NAME', 'CURRENT_SCHEMA', 'SAMPLE_JSON_PAYLOAD']);
    expect(result.rows).toEqual([
      [
        'finance-uat-api',
        'TEST_SCHEMA',
        '{"status":"Success","message":"This is mock data for testing","timestamp":"2026-04-08T03:10:07.482Z"}',
      ],
    ]);
  });
});

describe('resolveSqlResultTargetColumn', () => {
  test('opens beside when no reusable editor group exists', () => {
    expect(resolveSqlResultTargetColumn(1, [1])).toEqual({ kind: 'beside' });
  });

  test('reuses the nearest editor group to the right of the SQL source', () => {
    expect(resolveSqlResultTargetColumn(1, [1, 2, 3])).toEqual({
      kind: 'existing',
      viewColumn: 2,
    });
  });

  test('reuses the nearest non-source editor group when the source is rightmost', () => {
    expect(resolveSqlResultTargetColumn(3, [1, 2, 3])).toEqual({
      kind: 'existing',
      viewColumn: 2,
    });
  });

  test('ignores duplicate and non-editor columns before selecting a target', () => {
    expect(resolveSqlResultTargetColumn(1, [-2, -1, 1, 1, 4, 4])).toEqual({
      kind: 'existing',
      viewColumn: 4,
    });
  });

  test('uses the first existing editor group when the SQL source column is unknown', () => {
    expect(resolveSqlResultTargetColumn(undefined, [3, 1, 2])).toEqual({
      kind: 'existing',
      viewColumn: 1,
    });
  });
});

describe('createTestModeTableNames', () => {
  test('emits per-app synthetic tables, long table names, and known system tables', () => {
    const tables = createTestModeTableNames('finance-uat-api');
    expect(tables).toContain('DEMO_APP');
    expect(tables).toContain('FINANCE_UAT_API_ORDERS');
    expect(tables).toContain('FINANCE_UAT_API_ITEMS');
    expect(tables).toContain(
      'FINANCE_UAT_API_COM_SAP_S4HANA_FINANCE_GENERAL_LEDGER_ACCOUNTING_DOCUMENT_ITEM'
    );
    expect(tables).toContain(
      'FINANCE_UAT_API_I_BUSINESSPARTNERBANK_0001_TO_SUPPLIERINVOICEPAYMENTBLOCKREASON'
    );
    expect(tables).toContain('DEMO_PURCHASEORDERITEMMAPPING');
    expect(tables).toContain('DEMO_BUSINESSAPP_TEST');
    expect(tables).toContain('DUMMY');
    expect(tables).toContain('M_TABLES');
    expect(tables).toHaveLength(105);
  });

  test('uses the APP fallback prefix when app name is blank', () => {
    const tables = createTestModeTableNames('   ');
    expect(tables[0]).toBe('APP_ORDERS');
  });
});

describe('resolveHanaDisplayTableReferences', () => {
  const tableEntries = [
    { displayName: 'Demo_App', name: 'Demo_App' },
    { displayName: 'Demo_CompactName', name: 'DEMOCOMPACTNAME' },
    { displayName: 'Demo_PurchaseOrderItemMapping', name: 'DEMO_PURCHASEORDERITEMMAPPING' },
  ];

  test('resolves mixed-case display table names to schema-qualified quoted identifiers', () => {
    const result = resolveHanaDisplayTableReferences(
      'select * from Demo_App limit 100',
      tableEntries,
      'DEMO_APP_SCHEMA'
    );

    expect(result.sql).toBe('select * from "DEMO_APP_SCHEMA"."Demo_App" limit 100');
    expect(result.replacements).toEqual([
      {
        displayName: 'Demo_App',
        identifier: '"DEMO_APP_SCHEMA"."Demo_App"',
        tableName: 'Demo_App',
      },
    ]);
  });

  test('resolves lower-case raw table names to quoted selected-schema identifiers', () => {
    const result = resolveHanaDisplayTableReferences(
      'select * from table_test LIMIT 100',
      [{ displayName: 'table_test', name: 'table_test' }],
      'db_test'
    );

    expect(result.sql).toBe('select * from "db_test"."table_test" LIMIT 100');
    expect(result.replacements).toEqual([
      {
        displayName: 'table_test',
        identifier: '"db_test"."table_test"',
        tableName: 'table_test',
      },
    ]);
  });

  test('resolves lower-case typed raw names for uppercase tables to the selected app schema', () => {
    const result = resolveHanaDisplayTableReferences(
      'select * from demo_app limit 100',
      [{ displayName: 'Demo_App', name: 'DEMO_APP' }],
      'TEST_SCHEMA'
    );

    expect(result.sql).toBe('select * from "TEST_SCHEMA"."DEMO_APP" limit 100');
  });

  test('resolves readable aliases when the display name uppercases to a different raw table', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT * FROM Demo_CompactName',
      tableEntries,
      'APP_SCHEMA'
    );

    expect(result.sql).toBe('SELECT * FROM "APP_SCHEMA"."DEMOCOMPACTNAME"');
  });

  test('resolves readable display casing even when the raw table name is uppercase-safe', () => {
    const result = resolveHanaDisplayTableReferences(
      'select * from Demo_App limit 100',
      [{ displayName: 'Demo_App', name: 'DEMO_APP' }],
      'APP_SCHEMA'
    );

    expect(result.sql).toBe('select * from "APP_SCHEMA"."DEMO_APP" limit 100');
  });

  test('schema-qualifies exact raw uppercase table references from the selected app', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT * FROM DEMO_APP',
      [{ displayName: 'Demo_App', name: 'DEMO_APP' }],
      'APP_SCHEMA'
    );

    expect(result.sql).toBe('SELECT * FROM "APP_SCHEMA"."DEMO_APP"');
    expect(result.replacements).toEqual([
      {
        displayName: 'Demo_App',
        identifier: '"APP_SCHEMA"."DEMO_APP"',
        tableName: 'DEMO_APP',
      },
    ]);
  });

  test('keeps known unqualified HANA system table references unchanged', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT CURRENT_SCHEMA FROM DUMMY',
      [{ displayName: 'Dummy', name: 'DUMMY' }],
      'APP_SCHEMA'
    );

    expect(result.sql).toBe('SELECT CURRENT_SCHEMA FROM DUMMY');
    expect(result.replacements).toEqual([]);
  });

  test('schema-qualifies readable display names even when HANA could uppercase them', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT * FROM Demo_PurchaseOrderItemMapping',
      tableEntries,
      'APP_SCHEMA'
    );

    expect(result.sql).toBe(
      'SELECT * FROM "APP_SCHEMA"."DEMO_PURCHASEORDERITEMMAPPING"'
    );
    expect(result.replacements).toEqual([
      {
        displayName: 'Demo_PurchaseOrderItemMapping',
        identifier: '"APP_SCHEMA"."DEMO_PURCHASEORDERITEMMAPPING"',
        tableName: 'DEMO_PURCHASEORDERITEMMAPPING',
      },
    ]);
  });

  test('does not rewrite strings, comments, or already quoted identifiers', () => {
    const sql = [
      "SELECT 'Demo_App' AS NAME FROM \"Demo_App\"",
      '-- JOIN Demo_App',
    ].join('\n');
    const result = resolveHanaDisplayTableReferences(sql, tableEntries, 'APP_SCHEMA');

    expect(result.sql).toBe(sql);
    expect(result.replacements).toEqual([]);
  });

  test('preserves explicit schema qualifiers while quoting the resolved table name', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT * FROM CUSTOM_SCHEMA.Demo_App',
      tableEntries,
      'APP_SCHEMA'
    );

    expect(result.sql).toBe('SELECT * FROM CUSTOM_SCHEMA."Demo_App"');
  });

  test('preserves quoted schema qualifiers while quoting the resolved table name', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT * FROM "CUSTOM_SCHEMA".Demo_App',
      tableEntries,
      'APP_SCHEMA'
    );

    expect(result.sql).toBe('SELECT * FROM "CUSTOM_SCHEMA"."Demo_App"');
  });

  test('resolves comma-separated table references', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT * FROM Demo_App a, Demo_CompactName c WHERE c.ID = a.ID',
      tableEntries,
      'APP_SCHEMA'
    );

    expect(result.sql).toBe(
      'SELECT * FROM "APP_SCHEMA"."Demo_App" a, "APP_SCHEMA"."DEMOCOMPACTNAME" c WHERE c.ID = a.ID'
    );
  });

  test('does not rewrite derived-table aliases or CTE references', () => {
    const derivedResult = resolveHanaDisplayTableReferences(
      'SELECT * FROM (SELECT 1 AS ID) Demo_App',
      tableEntries,
      'APP_SCHEMA'
    );
    const cteResult = resolveHanaDisplayTableReferences(
      'WITH Demo_App AS (SELECT 1 AS ID) SELECT * FROM Demo_App',
      tableEntries,
      'APP_SCHEMA'
    );

    expect(derivedResult.sql).toBe('SELECT * FROM (SELECT 1 AS ID) Demo_App');
    expect(cteResult.sql).toBe(
      'WITH Demo_App AS (SELECT 1 AS ID) SELECT * FROM Demo_App'
    );
  });

  test('skips ambiguous display and raw table reference keys', () => {
    const result = resolveHanaDisplayTableReferences(
      'SELECT * FROM Demo_App',
      [
        { displayName: 'Demo_App', name: 'DEMO_APP_RAW' },
        { displayName: 'Demo_App_Raw', name: 'DEMO_APP' },
      ],
      'APP_SCHEMA'
    );

    expect(result.sql).toBe('SELECT * FROM Demo_App');
    expect(result.replacements).toEqual([]);
  });

  test('resolves table references in joins and mutating statements', () => {
    const selectResult = resolveHanaDisplayTableReferences(
      'SELECT * FROM Demo_App d JOIN Demo_CompactName c ON c.ID = d.ID',
      tableEntries,
      'APP_SCHEMA'
    );
    const updateResult = resolveHanaDisplayTableReferences(
      'UPDATE Demo_App SET NAME = \'x\'',
      tableEntries,
      'APP_SCHEMA'
    );

    expect(selectResult.sql).toBe(
      'SELECT * FROM "APP_SCHEMA"."Demo_App" d JOIN "APP_SCHEMA"."DEMOCOMPACTNAME" c ON c.ID = d.ID'
    );
    expect(updateResult.sql).toBe('UPDATE "APP_SCHEMA"."Demo_App" SET NAME = \'x\'');
  });
});

describe('resolveHanaSqlTargetTableName', () => {
  test('returns the first table from readonly statements', () => {
    expect(resolveHanaSqlTargetTableName('SELECT * FROM DUMMY')).toBe('DUMMY');
    expect(resolveHanaSqlTargetTableName('SELECT * FROM "db-test"."table-test"')).toBe(
      'table-test'
    );
  });

  test('returns the target table from mutating statements', () => {
    expect(
      resolveHanaSqlTargetTableName(
        'update "db-test"."table-test" set CREATED_BY = \'system\' where ID = \'532806ba-15a1-4a0f-9321-31b62d691130\''
      )
    ).toBe('table-test');
    expect(resolveHanaSqlTargetTableName('INSERT INTO ORDERS VALUES (1)')).toBe('ORDERS');
    expect(resolveHanaSqlTargetTableName('DELETE FROM ORDER_ITEMS WHERE ID = 1')).toBe(
      'ORDER_ITEMS'
    );
  });

  test('skips derived tables and common table expressions', () => {
    expect(resolveHanaSqlTargetTableName('SELECT * FROM (SELECT 1 AS ID) local_alias')).toBeNull();
    expect(
      resolveHanaSqlTargetTableName(
        'WITH local_orders AS (SELECT * FROM ORDERS) SELECT * FROM local_orders'
      )
    ).toBeNull();
  });
});

describe('buildHanaTableReferenceResolutionMissLog', () => {
  test('describes unresolved lower-case table references for output diagnostics', () => {
    expect(
      buildHanaTableReferenceResolutionMissLog('select * from table_test LIMIT 100', [])
    ).toBe(
      'no table reference rewrite for target table_test; no matching loaded table entry; loadedTables=0'
    );
  });

  test('stays quiet for exact uppercase table references that HANA can resolve directly', () => {
    expect(
      buildHanaTableReferenceResolutionMissLog('SELECT * FROM DUMMY', [
        { displayName: 'Dummy', name: 'DUMMY' },
      ])
    ).toBeNull();
  });
});

describe('extractTableNames', () => {
  test('deduplicates and drops blank values', () => {
    const rs: HanaQueryResultSet = {
      kind: 'resultset',
      columns: ['TABLE_NAME'],
      rows: [['ORDERS'], ['ORDERS'], ['  '], ['AUDIT  ']],
      rowCount: 4,
      elapsedMs: 0,
    };
    expect(extractTableNames(rs)).toEqual(['ORDERS', 'AUDIT']);
  });
});

describe('escapeHtml', () => {
  test('escapes tag and quote characters', () => {
    expect(escapeHtml(`<img src="x" onerror='y'>`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;'
    );
  });

  test('escapes ampersand first so downstream entities are not double encoded', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
});

describe('SQL result export formatters', () => {
  test('formats CSV with headers and escaped comma quote and newline values', () => {
    const result: HanaQueryResultSet = {
      kind: 'resultset',
      columns: ['ID', 'DESCRIPTION', 'STATUS'],
      rows: [
        ['1', 'Value with comma, quote " and newline\ninside', 'READY'],
        ['2', 'Plain', 'SYNCED'],
      ],
      rowCount: 2,
      elapsedMs: 4,
    };

    expect(formatHanaSqlResultSetCsv(result)).toBe(
      [
        'ID,DESCRIPTION,STATUS',
        '1,"Value with comma, quote "" and newline\ninside",READY',
        '2,Plain,SYNCED',
      ].join('\n')
    );
  });

  test('formats JSON rows with stable unique keys for repeated columns', () => {
    const result: HanaQueryResultSet = {
      kind: 'resultset',
      columns: ['ID', 'STATUS', 'STATUS', ''],
      rows: [['1', 'OPEN', 'PAID', 'fallback']],
      rowCount: 1,
      elapsedMs: 4,
    };

    expect(formatHanaSqlResultSetJson(result)).toBe(
      JSON.stringify(
        [
          {
            ID: '1',
            STATUS: 'OPEN',
            STATUS_2: 'PAID',
            COLUMN_4: 'fallback',
          },
        ],
        null,
        2
      )
    );
  });

  test('formats a single row object with the same duplicate-column keys as JSON export', () => {
    const result: HanaQueryResultSet = {
      kind: 'resultset',
      columns: ['ID', 'STATUS', 'STATUS', ''],
      rows: [['1', 'OPEN', 'PAID', 'fallback']],
      rowCount: 1,
      elapsedMs: 4,
    };

    expect(formatHanaSqlResultRowObjectJson(result, 0)).toBe(
      JSON.stringify(
        {
          ID: '1',
          STATUS: 'OPEN',
          STATUS_2: 'PAID',
          COLUMN_4: 'fallback',
        },
        null,
        2
      )
    );
    expect(formatHanaSqlResultRowObjectJson(result, 1)).toBeNull();
  });

  test('resolves a single cell value by row and column indexes', () => {
    const result: HanaQueryResultSet = {
      kind: 'resultset',
      columns: ['ID', 'STATUS'],
      rows: [['1', 'OPEN']],
      rowCount: 1,
      elapsedMs: 1,
    };

    expect(resolveHanaSqlResultCellValue(result, 0, 1)).toBe('OPEN');
    expect(resolveHanaSqlResultCellValue(result, 1, 1)).toBeNull();
    expect(resolveHanaSqlResultCellValue(result, 0, 2)).toBeNull();
  });

  test('formats empty result sets safely', () => {
    const result: HanaQueryResultSet = {
      kind: 'resultset',
      columns: ['ID', 'STATUS'],
      rows: [],
      rowCount: 0,
      elapsedMs: 1,
    };

    expect(formatHanaSqlResultSetCsv(result)).toBe('ID,STATUS');
    expect(formatHanaSqlResultSetJson(result)).toBe('[]');
  });
});

describe('buildHanaSqlResultHtml', () => {
  test('renders a centered loading state without showing an error card', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      tableName: 'ORDERS',
      sql: 'SELECT ID FROM ORDERS',
      executedAt: '2026-04-25T00:00:00Z',
      isLoading: true,
      nonce: 'test-nonce',
    });

    expect(html).toContain('result-loading-layout');
    expect(html).toContain('result-loading-spinner');
    expect(html).toContain('Running SQL query');
    expect(html).toContain('role="status"');
    expect(html).toContain('Table: ORDERS');
    expect(html).not.toContain('App: finance-uat-api');
    expect(html).not.toContain('Execution Error');
    expect(html).not.toContain('state-error');
  });

  test('renders a result table with row numbers for a resultset', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      tableName: 'ORDERS',
      sql: 'SELECT ID FROM ORDERS',
      executedAt: '2026-04-25T00:00:00Z',
      nonce: 'test-nonce',
      result: {
        kind: 'resultset',
        columns: ['ID', 'STATUS'],
        rows: [
          ['1', 'OPEN'],
          ['2', 'PAID'],
        ],
        rowCount: 2,
        elapsedMs: 12,
      },
    });

    expect(html).not.toContain('<h1>SAP Tools SQL Result</h1>');
    expect(html).toContain("script-src 'nonce-test-nonce'");
    expect(html).toContain('nonce="test-nonce"');
    expect(html).toContain('Export result');
    expect(html).toContain('Copy CSV');
    expect(html).toContain('Copy JSON');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Export JSON');
    expect(html).toContain('data-action="copyCsv"');
    expect(html).toContain('data-role="sql-result-row" data-row-index="0"');
    expect(html).toContain(
      '<td data-role="sql-result-cell" data-row-index="0" data-column-index="1">OPEN</td>'
    );
    expect(html).toContain('data-role="sql-result-context-menu"');
    expect(html).toContain('Copy row object');
    expect(html).toContain('Copy cell value');
    expect(html).toContain('data-action="copyRowObject"');
    expect(html).toContain('data-action="copyCellValue"');
    expect(html).toContain('tbody tr:hover td');
    expect(html).not.toContain('data-cell-value');
    expect(html).not.toContain('result-export-status');
    expect(html).not.toContain('sapTools.sqlResultExportActionResult');
    expect(html).not.toContain('Copying result');
    expect(html).not.toContain('copied to clipboard');
    expect(html).toContain('Table: ORDERS');
    expect(html).not.toContain('App: finance-uat-api');
    expect(html).not.toContain('Executed: 2026-04-25T00:00:00Z');
    expect(html).toContain('Rows: 2');
    expect(html).toContain('Elapsed: 12 ms');
    expect(html).toContain('<th>ID</th>');
    expect(html).toContain('<th>STATUS</th>');
    expect(html).toContain('>OPEN</td>');
    expect(html).toContain('table-layout: auto;');
    expect(html).toContain('width: max-content;');
    expect(html).toContain('min-width: 100%;');
    expect(html).not.toContain('Showing first');
  });

  test('renders all returned rows without a display cap notice', () => {
    const rows = Array.from({ length: 260 }, (_, index) => [String(index)]);
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'SELECT ID FROM ORDERS',
      executedAt: '2026-04-25T00:00:00Z',
      result: {
        kind: 'resultset',
        columns: ['ID'],
        rows,
        rowCount: rows.length,
        elapsedMs: 42,
      },
    });

    expect(html).not.toContain('Showing first');
    expect(html).toContain('<td class="row-number">260</td>');
    expect(html).toContain('>259</td>');
  });

  test('keeps very long cell content renderable without ellipsis clipping', () => {
    const longValue = 'X'.repeat(10000);
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'SELECT LONG_VALUE FROM SAMPLE_TABLE',
      executedAt: '2026-04-25T00:00:00Z',
      result: {
        kind: 'resultset',
        columns: ['LONG_VALUE'],
        rows: [[longValue]],
        rowCount: 1,
        elapsedMs: 2,
      },
    });

    expect(html).toContain(`>${longValue}</td>`);
    expect(html).toContain('white-space: pre;');
    expect(html).toContain('overflow: visible;');
    expect(html).toContain('text-overflow: clip;');
    expect(html).not.toContain('text-overflow: ellipsis;');
  });

  test('renders readable JSON text cells and still escapes HTML-sensitive characters', () => {
    const payload =
      '{"status":"Success","message":"This is mock data for testing","timestamp":"2026-04-08T03:10:07.482Z","html":"<script>alert(1)</script>"}';
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'SELECT PAYLOAD FROM SAMPLE_MESSAGES',
      executedAt: '2026-04-25T00:00:00Z',
      result: {
        kind: 'resultset',
        columns: ['PAYLOAD'],
        rows: [[payload]],
        rowCount: 1,
        elapsedMs: 3,
      },
    });

    expect(html).toContain('This is mock data for testing');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('0x7b2273746174757322');
  });

  test('renders a success card for status results', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      tableName: 'ORDERS',
      sql: 'UPDATE ORDERS SET STATUS = \'OPEN\'',
      executedAt: '2026-04-25T00:00:00Z',
      result: {
        kind: 'status',
        message: '1 row affected',
        elapsedMs: 7,
      },
    });

    expect(html).toContain('Statement Executed');
    expect(html).toContain('Table: ORDERS');
    expect(html).not.toContain('Executed: 2026-04-25T00:00:00Z');
    expect(html).toContain('state-success');
    expect(html).toContain('1 row affected');
    expect(html).toContain('Elapsed: 7 ms');
    expect(html).not.toContain('Export result');
  });

  test('renders an error card with the supplied message when no result is present', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      tableName: 'DUMMY',
      sql: 'SELECT broken',
      executedAt: '2026-04-25T00:00:00Z',
      errorMessage: 'syntax error near "broken"',
    });

    expect(html).toContain('Execution Error');
    expect(html).toContain('Table: DUMMY');
    expect(html).not.toContain('Executed: 2026-04-25T00:00:00Z');
    expect(html).toContain('state-error');
    expect(html).toContain('syntax error near &quot;broken&quot;');
  });

  test('escapes table name, SQL, and error message to prevent HTML injection', () => {
    const html = buildHanaSqlResultHtml({
      appName: '<script>alert(1)</script>',
      tableName: '<script>alert(4)</script>',
      sql: '<script>alert(2)</script>',
      executedAt: '<evil>',
      errorMessage: '<script>alert(3)</script>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<script>alert(3)</script>');
    expect(html).not.toContain('<script>alert(4)</script>');
    expect(html).toContain('&lt;script&gt;alert(4)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
  });
});

describe('buildHanaSqlResultHtml result meta layout', () => {
  test('renders table metadata without executed time for status results', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      tableName: 'ORDERS',
      sql: 'UPDATE T SET X = 1',
      executedAt: '2026-04-25T01:23:45.000Z',
      result: { kind: 'status', message: '1 row affected', elapsedMs: 4 },
    });

    expect(html).toContain(
      '<p class="state-meta-line">Table: ORDERS</p>'
    );
    expect(html).not.toContain('App: finance-uat-api');
    expect(html).not.toContain('<p class="state-meta-line">Executed: 2026-04-25T01:23:45.000Z</p>');
  });

  test('renders table metadata without executed time for error results', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      tableName: 'DUMMY',
      sql: 'SELECT broken',
      executedAt: '2026-04-25T02:00:00.000Z',
      errorMessage: 'syntax error',
    });

    expect(html).toContain(
      '<p class="state-meta-line">Table: DUMMY</p>'
    );
    expect(html).not.toContain('App: finance-uat-api');
    expect(html).not.toContain('Executed: 2026-04-25T02:00:00.000Z');
  });

  test('uses compact padding to keep the result panel tight', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'SELECT 1 FROM DUMMY',
      executedAt: '2026-04-25T00:00:00Z',
      result: { kind: 'status', message: 'ok', elapsedMs: 1 },
    });

    expect(html).toContain('padding: 6px;');
    expect(html).not.toContain('padding: 14px;');
  });

  test('uses VS Code theme variables instead of fixed dark-only colors', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'SELECT 1 FROM DUMMY',
      executedAt: '2026-04-25T00:00:00Z',
      result: { kind: 'status', message: 'ok', elapsedMs: 1 },
    });

    expect(html).toContain('--vscode-editor-background');
    expect(html).toContain('--vscode-editor-foreground');
    expect(html).toContain('--vscode-panel-border');
    expect(html).not.toContain('background: #0f141d;');
    expect(html).not.toContain('color-scheme: dark;');
  });
});

describe('formatHanaSqlStatementBatchCsv', () => {
  test('emits per-statement headers separating each successful resultset', () => {
    const csv = formatHanaSqlStatementBatchCsv([
      {
        sql: 'SELECT ID FROM T',
        status: 'success',
        tableName: 'T',
        elapsedMs: 5,
        result: {
          kind: 'resultset',
          columns: ['ID'],
          rows: [['1'], ['2']],
          rowCount: 2,
          elapsedMs: 5,
        },
      },
      {
        sql: "UPDATE T SET X = 'bad'",
        status: 'error',
        tableName: 'T',
        elapsedMs: 4,
        errorMessage: 'sql syntax',
      },
    ]);

    expect(csv).toContain('-- Statement 1 (SUCCESS, T, 5 ms)');
    expect(csv).toContain('ID\n1\n2');
    expect(csv).toContain('-- Statement 2 (ERROR, T, 4 ms) - sql syntax');
  });
});

describe('formatHanaSqlStatementBatchJson', () => {
  test('returns a JSON object listing one record per statement with status metadata', () => {
    const json = formatHanaSqlStatementBatchJson([
      {
        sql: 'SELECT ID FROM T',
        status: 'success',
        tableName: 'T',
        elapsedMs: 5,
        result: {
          kind: 'resultset',
          columns: ['ID'],
          rows: [['1']],
          rowCount: 1,
          elapsedMs: 5,
        },
      },
      {
        sql: 'UPDATE T SET X = 1',
        status: 'skipped',
        tableName: 'T',
      },
    ]);

    const parsed = JSON.parse(json) as {
      statements: {
        index: number;
        status: string;
        sql: string;
        rowCount?: number;
      }[];
    };
    expect(parsed.statements).toHaveLength(2);
    expect(parsed.statements[0]?.status).toBe('success');
    expect(parsed.statements[0]?.rowCount).toBe(1);
    expect(parsed.statements[1]?.status).toBe('skipped');
  });
});

describe('buildTestModeBatchOutcomes', () => {
  test('returns a success outcome for every statement when no error marker is present', () => {
    const summary = buildTestModeBatchOutcomes('finance-uat-api', [
      { executionSql: 'SELECT 1 FROM DUMMY', statementKind: 'readonly' },
      { executionSql: 'SELECT 2 FROM DUMMY', statementKind: 'readonly' },
    ]);

    expect(summary.outcomes).toHaveLength(2);
    expect(summary.outcomes.every((outcome) => outcome.status === 'success')).toBe(true);
    expect(summary.usedTransaction).toBe(false);
    expect(summary.committed).toBe(false);
    expect(summary.rolledBack).toBe(false);
  });

  test('marks mutating batches as committed when all statements succeed', () => {
    const summary = buildTestModeBatchOutcomes('finance-uat-api', [
      { executionSql: 'UPDATE T SET X = 1', statementKind: 'mutating' },
      { executionSql: 'UPDATE T SET X = 2', statementKind: 'mutating' },
    ]);

    expect(summary.usedTransaction).toBe(true);
    expect(summary.committed).toBe(true);
    expect(summary.rolledBack).toBe(false);
  });

  test('stops at the first marker error and rolls back when statements are mutating', () => {
    const summary = buildTestModeBatchOutcomes('finance-uat-api', [
      { executionSql: 'UPDATE T SET X = 1', statementKind: 'mutating' },
      {
        executionSql: 'UPDATE T SET X = SAP_TOOLS_TEST_THROW_ERROR',
        statementKind: 'mutating',
      },
      { executionSql: 'UPDATE T SET X = 3', statementKind: 'mutating' },
    ]);

    expect(summary.outcomes.map((outcome) => outcome.status)).toEqual([
      'success',
      'error',
      'skipped',
    ]);
    expect(summary.usedTransaction).toBe(true);
    expect(summary.committed).toBe(false);
    expect(summary.rolledBack).toBe(true);
  });

  test('emits progress callbacks in order for each statement', () => {
    const progress: { index: number; status: string }[] = [];
    buildTestModeBatchOutcomes(
      'finance-uat-api',
      [
        { executionSql: 'SELECT 1 FROM DUMMY', statementKind: 'readonly' },
        { executionSql: 'SELECT 2 FROM DUMMY', statementKind: 'readonly' },
        { executionSql: 'SELECT 3 FROM DUMMY', statementKind: 'readonly' },
      ],
      (index, outcome) => progress.push({ index, status: outcome.status })
    );

    expect(progress.map((entry) => entry.index)).toEqual([0, 1, 2]);
    expect(progress.every((entry) => entry.status === 'success')).toBe(true);
  });
});

describe('buildHanaSqlResultHtml batch view', () => {
  test('renders a stacked layout with one section per statement when there are multiple statements', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'SELECT 1 FROM DUMMY; SELECT 2 FROM DUMMY',
      executedAt: '2026-04-25T00:00:00Z',
      nonce: 'test-nonce',
      statements: [
        {
          sql: 'SELECT 1 FROM DUMMY',
          status: 'success',
          tableName: 'DUMMY',
          elapsedMs: 4,
          result: {
            kind: 'resultset',
            columns: ['ID'],
            rows: [['1']],
            rowCount: 1,
            elapsedMs: 4,
          },
        },
        {
          sql: 'SELECT 2 FROM DUMMY',
          status: 'success',
          tableName: 'DUMMY',
          elapsedMs: 5,
          result: {
            kind: 'resultset',
            columns: ['ID'],
            rows: [['2']],
            rowCount: 1,
            elapsedMs: 5,
          },
        },
      ],
    });

    expect(html).toContain('result-batch-layout');
    expect(html).toContain('Statements: 2');
    expect(html).toContain('OK: 2');
    expect(html).not.toContain('Failed: ');
    expect(html).toContain('Statement 1 / 2');
    expect(html).toContain('Statement 2 / 2');
    expect(html).toContain('data-statement-index="0"');
    expect(html).toContain('data-statement-index="1"');
    expect(html).toContain('Export all');
  });

  test('renders an error card for the failed statement and skipped sections for the rest', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'INSERT; INSERT BAD; INSERT',
      executedAt: '2026-04-25T00:00:00Z',
      nonce: 'test-nonce',
      statements: [
        {
          sql: 'INSERT INTO T VALUES (1)',
          status: 'success',
          tableName: 'T',
          elapsedMs: 4,
          result: { kind: 'status', message: '1 row affected.', elapsedMs: 4 },
        },
        {
          sql: 'INSERT INTO T VALUES (bad)',
          status: 'error',
          tableName: 'T',
          elapsedMs: 6,
          errorMessage: 'sql syntax error near bad',
        },
        {
          sql: 'INSERT INTO T VALUES (3)',
          status: 'skipped',
          tableName: 'T',
        },
      ],
      batchSummary: {
        usedTransaction: true,
        committed: false,
        rolledBack: true,
      },
    });

    expect(html).toContain('Failed: 1');
    expect(html).toContain('Skipped: 1');
    expect(html).toContain('OK: 1');
    expect(html).toContain('Rolled back');
    expect(html).toContain('Execution Error');
    expect(html).toContain('sql syntax error near bad');
    expect(html).toContain('Skipped due to a preceding statement failure');
    expect(html).toContain('status-skipped');
    expect(html).toContain('status-error');
  });

  test('keeps the single-statement layout when there is exactly one statement supplied', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      tableName: 'DUMMY',
      sql: 'SELECT 1 FROM DUMMY',
      executedAt: '2026-04-25T00:00:00Z',
      nonce: 'test-nonce',
      result: {
        kind: 'resultset',
        columns: ['ID'],
        rows: [['1']],
        rowCount: 1,
        elapsedMs: 4,
      },
      statements: [
        {
          sql: 'SELECT 1 FROM DUMMY',
          status: 'success',
          tableName: 'DUMMY',
          elapsedMs: 4,
          result: {
            kind: 'resultset',
            columns: ['ID'],
            rows: [['1']],
            rowCount: 1,
            elapsedMs: 4,
          },
        },
      ],
    });

    expect(html).not.toContain('result-batch-layout');
    expect(html).toContain('result-layout');
    expect(html).toContain('Table: DUMMY');
  });

  test('escapes HTML in batch error messages and SQL fragments', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'app',
      sql: '<script>alert(1)</script>',
      executedAt: '2026-04-25T00:00:00Z',
      nonce: 'test-nonce',
      statements: [
        {
          sql: '<script>alert("a")</script>',
          status: 'error',
          errorMessage: '<script>alert("err")</script>',
        },
        {
          sql: '<script>alert("b")</script>',
          status: 'skipped',
        },
      ],
    });

    expect(html).not.toContain('<script>alert("a")</script>');
    expect(html).not.toContain('<script>alert("err")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;a&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(&quot;err&quot;)&lt;/script&gt;');
  });
});

describe('buildHanaSqlResultHtml (no install card)', () => {
  test('does not surface the legacy SAP HANA Client install card for connection errors', () => {
    const html = buildHanaSqlResultHtml({
      appName: 'finance-uat-api',
      sql: 'SELECT 1 FROM DUMMY',
      executedAt: '2026-04-25T00:00:00Z',
      errorMessage: 'connect ECONNREFUSED 1.2.3.4:443',
    });

    expect(html).not.toContain('SAP HANA Client Not Found');
    expect(html).not.toContain('Install the SAP HANA Client');
    expect(html).not.toContain('hdbsql');
    expect(html).not.toContain('hdbclient');
    expect(html).not.toContain('hanaSqlClientPath');
    expect(html).toContain('Execution Error');
    expect(html).toContain('connect ECONNREFUSED');
  });
});

describe('formatHanaTableDisplayName', () => {
  test('formats compact uppercase English table segments into readable PascalCase', async () => {
    await expect(formatHanaTableDisplayName('DEMO_PURCHASEORDERITEMMAPPING')).resolves.toBe(
      'Demo_PurchaseOrderItemMapping'
    );
  });

  test('formats common uppercase product segments without treating every letter as an acronym', async () => {
    await expect(formatHanaTableDisplayName('DEMO_BUSINESSAPP_TEST')).resolves.toBe(
      'Demo_BusinessApp_Test'
    );
  });

  test('keeps SAP acronyms and numeric segments readable', async () => {
    await expect(
      formatHanaTableDisplayName(
        'FINANCE_UAT_API_I_BUSINESSPARTNERBANK_0001_TO_SUPPLIERINVOICEPAYMENTBLOCKREASON'
      )
    ).resolves.toBe(
      'Finance_UAT_API_I_BusinessPartnerBank_0001_To_SupplierInvoicePaymentBlockReason'
    );
  });

  test('does not split common SAP acronyms into mixed-case words', async () => {
    await expect(
      formatHanaTableDisplayName(
        'SAP_CAP_CDS_INVOICE_RECONCILIATION_DRAFTADMINISTRATIVEDATA'
      )
    ).resolves.toBe('SAP_CAP_CDS_Invoice_Reconciliation_DraftAdministrativeData');
  });

  test('formats display entries while preserving the raw executable table name', async () => {
    const entries = await formatHanaTableDisplayEntries([
      'DEMO_PURCHASEORDERITEMMAPPING',
      'DUMMY',
    ]);

    expect(entries).toEqual([
      {
        displayName: 'Demo_PurchaseOrderItemMapping',
        name: 'DEMO_PURCHASEORDERITEMMAPPING',
      },
      { displayName: 'Dummy', name: 'DUMMY' },
    ]);
  });

  test('keeps unknown alphanumeric segments safe instead of blocking formatting', async () => {
    await expect(formatHanaTableDisplayName('XYZ123ABC')).resolves.toBe('XYZ123ABC');
  });
});

describe('quoteHanaIdentifier', () => {
  test('wraps simple identifiers in double quotes', () => {
    expect(quoteHanaIdentifier('ORDERS')).toBe('"ORDERS"');
  });

  test('escapes embedded double quotes by doubling them', () => {
    expect(quoteHanaIdentifier('WEIRD"NAME')).toBe('"WEIRD""NAME"');
  });
});

describe('buildQuickTableSelectSql', () => {
  test('builds a schema-qualified SELECT with a row limit', () => {
    expect(buildQuickTableSelectSql('TEST_SCHEMA', 'ORDERS')).toBe(
      `SELECT * FROM "TEST_SCHEMA"."ORDERS" LIMIT ${String(QUICK_SELECT_ROW_LIMIT)}`
    );
  });

  test('falls back to the unqualified table name when the schema is blank', () => {
    expect(buildQuickTableSelectSql('   ', 'ORDERS')).toBe(
      `SELECT * FROM "ORDERS" LIMIT ${String(QUICK_SELECT_ROW_LIMIT)}`
    );
  });

  test('escapes injection attempts inside the table identifier', () => {
    const sql = buildQuickTableSelectSql('SCHEMA', 'BAD"; DROP TABLE');
    expect(sql).toContain('"SCHEMA"."BAD""; DROP TABLE"');
    expect(sql.endsWith(`LIMIT ${String(QUICK_SELECT_ROW_LIMIT)}`)).toBe(true);
  });

  test('throws when the table name is empty', () => {
    expect(() => buildQuickTableSelectSql('SCHEMA', '   ')).toThrow(/required/i);
  });
});

describe('buildTableDiscoveryQueries', () => {
  test('queries the resolved binding schema before falling back to M_TABLES', () => {
    const queries = buildTableDiscoveryQueries('FINANCE_SCHEMA');

    expect(queries[0]).toBe(
      "SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = 'FINANCE_SCHEMA' ORDER BY TABLE_NAME"
    );
    expect(queries[1]).toBe(
      "SELECT TABLE_NAME FROM SYS.M_TABLES WHERE SCHEMA_NAME = 'FINANCE_SCHEMA' ORDER BY TABLE_NAME"
    );
    for (const query of queries) {
      expect(query).not.toContain('CURRENT_SCHEMA');
    }
  });

  test('escapes quotes in schema names as SQL string literals', () => {
    const queries = buildTableDiscoveryQueries("FINANCE'SCHEMA");

    expect(queries[0]).toContain("SCHEMA_NAME = 'FINANCE''SCHEMA'");
    expect(queries[1]).toContain("SCHEMA_NAME = 'FINANCE''SCHEMA'");
    expect(queries[0]).not.toContain("SCHEMA_NAME = 'FINANCE'SCHEMA'");
  });

  test('falls back to CURRENT_SCHEMA only when no binding schema is available', () => {
    const queries = buildTableDiscoveryQueries('   ');

    expect(queries[0]).toBe(
      'SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY TABLE_NAME'
    );
    expect(queries[1]).toBe(
      'SELECT TABLE_NAME FROM SYS.M_TABLES WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY TABLE_NAME'
    );
  });
});
