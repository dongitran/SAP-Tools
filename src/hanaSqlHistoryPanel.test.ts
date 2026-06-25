import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {},
  workspace: {},
  Uri: { joinPath: vi.fn() },
  EventEmitter: class {
    fire() { /* noop */ }
  }
}));

import { parseCsvForDisplay, highlightSql } from './hanaSqlHistoryPanel';

describe('hanaSqlHistoryPanel', () => {
  describe('highlightSql', () => {
    it('should highlight basic keywords', () => {
      const sql = 'SELECT * FROM table';
      const result = highlightSql(sql);
      expect(result).toContain('<span class="sql-kw">SELECT</span>');
      expect(result).toContain('<span class="sql-kw">FROM</span>');
    });

    it('should highlight built-in functions', () => {
      const sql = 'SELECT COUNT(id), ROUND(price, 2) FROM sales';
      const result = highlightSql(sql);
      expect(result).toContain('<span class="sql-fn">COUNT</span>');
      expect(result).toContain('<span class="sql-fn">ROUND</span>');
    });

    it('should highlight string literals and handle escape characters safely', () => {
      const sql = 'WHERE name = \'Alice\' AND html = \'<html>\'';
      const result = highlightSql(sql);
      // 'Alice' should be highlighted
      expect(result).toContain(`<span class="sql-str">'Alice'</span>`);
      // '<html>' should be safely escaped
      expect(result).toContain(`<span class="sql-str">'&lt;html&gt;'</span>`);
    });

    it('should correctly escape HTML outside of tokens', () => {
      const sql = 'SELECT id < 5 AND name > "Bob"';
      const result = highlightSql(sql);
      expect(result).toContain(' &lt; <span class="sql-num">5</span> ');
      expect(result).toContain(' &gt; &quot;Bob&quot;');
    });

    it.each([
      ['UPDATE', 'UPDATE "Users" SET "Name" = \'Ada\''],
      ['DELETE', 'DELETE FROM "Users"'],
      ['INSERT', 'INSERT INTO "Users" VALUES (1)'],
      ['UPSERT', 'UPSERT "Users" VALUES (1)'],
      ['MERGE', 'MERGE INTO "Users" USING "Source" ON "Users"."Id" = "Source"."Id"'],
    ])('should highlight %s mutation keyword', (keyword, sql) => {
      const result = highlightSql(sql);
      expect(result).toContain(`<span class="sql-kw">${keyword}</span>`);
    });

    it('should highlight numbers', () => {
      const sql = 'LIMIT 100 OFFSET 20.5';
      const result = highlightSql(sql);
      expect(result).toContain('<span class="sql-num">100</span>');
      expect(result).toContain('<span class="sql-num">20.5</span>');
    });

    it('should highlight line comments', () => {
      const sql = 'SELECT 1 -- this is a comment\nFROM t';
      const result = highlightSql(sql);
      expect(result).toContain('<span class="sql-cmt">-- this is a comment</span>');
    });

    it('should highlight block comments', () => {
      const sql = 'SELECT /* multi\nline */ 1';
      const result = highlightSql(sql);
      expect(result).toContain('<span class="sql-cmt">/* multi\nline */</span>');
    });

    it('should not choke on unclosed string literals', () => {
      const sql = 'SELECT \'unclosed';
      const result = highlightSql(sql);
      expect(result).toContain(`<span class="sql-str">'unclosed</span>`);
    });

    it('should correctly handle string with escaped quotes', () => {
      const sql = 'SELECT \'O\'\'Connor\'';
      const result = highlightSql(sql);
      expect(result).toContain(`<span class="sql-str">'O''Connor'</span>`);
    });
  });

  describe('parseCsvForDisplay', () => {
    it('should parse basic CSV without quotes', () => {
      const csv = 'ID,Name,Age\n1,Alice,30\n2,Bob,25';
      const result = parseCsvForDisplay(csv);
      
      expect(result.columns).toEqual(['ID', 'Name', 'Age']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['1', 'Alice', '30']);
      expect(result.rows[1]).toEqual(['2', 'Bob', '25']);
    });

    it('should handle RFC 4180 quoted strings with commas inside', () => {
      const csv = 'ID,Description\n1,"Hello, World!"\n2,"Comma, separated, values"';
      const result = parseCsvForDisplay(csv);
      
      expect(result.columns).toEqual(['ID', 'Description']);
      expect(result.rows[0]).toEqual(['1', 'Hello, World!']);
      expect(result.rows[1]).toEqual(['2', 'Comma, separated, values']);
    });

    it('should handle escaped quotes inside quoted strings', () => {
      const csv = 'ID,Notes\n1,"He said ""Hello"""\n2,"Double """"Quotes"""""';
      const result = parseCsvForDisplay(csv);
      
      expect(result.rows[0]).toEqual(['1', 'He said "Hello"']);
      expect(result.rows[1]).toEqual(['2', 'Double ""Quotes""']);
    });

    it('should limit to 500 rows for safety', () => {
      // Generate 600 rows
      const lines = ['ID,Val'];
      for (let i = 0; i < 600; i++) {
        lines.push(`${i},Val${i}`);
      }
      
      const result = parseCsvForDisplay(lines.join('\n'));
      expect(result.rows).toHaveLength(500); // Should be truncated
      expect(result.rows[499]).toEqual(['499', 'Val499']);
    });

    it('should handle empty input', () => {
      const result = parseCsvForDisplay('');
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it('should handle trailing newlines gracefully', () => {
      const csv = 'A,B\n1,2\n\n\n';
      const result = parseCsvForDisplay(csv);
      expect(result.columns).toEqual(['A', 'B']);
      expect(result.rows).toHaveLength(1);
    });

    it('should handle rows with fewer columns than header', () => {
      const csv = 'A,B,C\n1,2';
      const result = parseCsvForDisplay(csv);
      // Row has only 2 items, that's fine, the parsing just returns what it has
      expect(result.rows[0]).toEqual(['1', '2']);
    });
  });
});
