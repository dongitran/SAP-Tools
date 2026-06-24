import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {},
  workspace: {},
  Uri: { joinPath: vi.fn() },
  EventEmitter: class {
    fire() { /* noop */ }
  }
}));

import { parseCsvForDisplay } from './hanaSqlHistoryPanel';

describe('hanaSqlHistoryPanel', () => {
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
