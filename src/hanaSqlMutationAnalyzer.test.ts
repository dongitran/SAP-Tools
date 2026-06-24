import { describe, expect, it } from 'vitest';
import { analyzeMutatingStatement } from './hanaSqlMutationAnalyzer';

describe('hanaSqlMutationAnalyzer', () => {
  it('should return null for non-mutating statements', () => {
    expect(analyzeMutatingStatement('SELECT * FROM "Employees"', 'schema')).toBeNull();
    expect(analyzeMutatingStatement('CREATE TABLE "Temp" ("ID" INT)', 'schema')).toBeNull();
    expect(analyzeMutatingStatement('ALTER TABLE "Users" ADD "Age" INT', 'schema')).toBeNull();
  });

  describe('UPDATE', () => {
    it('should extract basic UPDATE', () => {
      const sql = 'UPDATE "Employees" SET "Salary" = 50000 WHERE "Department" = \'Sales\'';
      const result = analyzeMutatingStatement(sql, 'MYSCHEMA');
      expect(result).not.toBeNull();
      expect(result?.canBackup).toBe(true);
      expect(result?.statementType).toBe('UPDATE');
      expect(result?.tableName).toBe('"Employees"');
      expect(result?.whereClause).toBe('"Department" = \'Sales\'');
      expect(result?.backupSelectSql).toBe('SELECT * FROM MYSCHEMA."Employees" WHERE "Department" = \'Sales\'');
    });

    it('should handle fully qualified table name', () => {
      const sql = 'UPDATE OTHERSCHEMA."Employees" SET "Status" = 1 WHERE "ID" = 5';
      const result = analyzeMutatingStatement(sql, 'MYSCHEMA');
      expect(result?.tableName).toBe('OTHERSCHEMA."Employees"');
      expect(result?.backupSelectSql).toBe('SELECT * FROM OTHERSCHEMA."Employees" WHERE "ID" = 5');
    });

    it('should refuse backup if no WHERE clause is provided', () => {
      const sql = 'UPDATE "Employees" SET "Salary" = 50000';
      const result = analyzeMutatingStatement(sql, 'MYSCHEMA');
      expect(result?.canBackup).toBe(false);
      expect(result?.backupSelectSql).toBeNull();
    });

    it('should strip trailing clauses (ORDER BY, LIMIT)', () => {
      const sql = 'UPDATE "Employees" SET "Salary" = 50000 WHERE "Department" = \'Sales\' LIMIT 10';
      const result = analyzeMutatingStatement(sql, 'MYSCHEMA');
      expect(result?.whereClause).toBe('"Department" = \'Sales\'');
    });

    it('should ignore WHERE inside nested SELECTs', () => {
      const sql = 'UPDATE "Employees" SET "Salary" = (SELECT MAX("Sal") FROM "T" WHERE "ID"=1) WHERE "Department" = \'Sales\'';
      const result = analyzeMutatingStatement(sql, 'MYSCHEMA');
      expect(result?.whereClause).toBe('"Department" = \'Sales\'');
    });
    
    it('should handle extreme whitespace and comments', () => {
      const sql = 'UPDATE    "Employees" \n /* comment */ \n SET "Salary" = 100 \n -- inline comment \n WHERE \n "ID" = 10';
      const result = analyzeMutatingStatement(sql, 'MYSCHEMA');
      expect(result?.tableName).toBe('"Employees"');
      expect(result?.whereClause).toBe('"ID" = 10');
    });
  });

  describe('DELETE', () => {
    it('should extract basic DELETE FROM', () => {
      const sql = 'DELETE FROM "Logs" WHERE "Timestamp" < \'2023-01-01\'';
      const result = analyzeMutatingStatement(sql, '');
      expect(result?.statementType).toBe('DELETE');
      expect(result?.tableName).toBe('"Logs"');
      expect(result?.backupSelectSql).toBe('SELECT * FROM "Logs" WHERE "Timestamp" < \'2023-01-01\'');
    });

    it('should extract DELETE without FROM (HANA allows this)', () => {
      const sql = 'DELETE "Logs" WHERE "Level" = \'ERROR\'';
      const result = analyzeMutatingStatement(sql, 'SCH');
      expect(result?.tableName).toBe('"Logs"');
      expect(result?.backupSelectSql).toBe('SELECT * FROM SCH."Logs" WHERE "Level" = \'ERROR\'');
    });

    it('should refuse backup if no WHERE clause', () => {
      const sql = 'DELETE FROM "Logs"';
      const result = analyzeMutatingStatement(sql, 'SCH');
      expect(result?.canBackup).toBe(false);
    });
  });

  describe('MERGE', () => {
    it('should extract MERGE INTO and use ON as where condition', () => {
      const sql = 'MERGE INTO "Target" USING "Source" ON "Target"."ID" = "Source"."ID" WHEN MATCHED THEN UPDATE SET "Val" = 1';
      const result = analyzeMutatingStatement(sql, 'SCH');
      expect(result?.statementType).toBe('MERGE');
      expect(result?.tableName).toBe('"Target"');
      expect(result?.whereClause).toBe('"Target"."ID" = "Source"."ID"');
      expect(result?.backupSelectSql).toBe('SELECT * FROM SCH."Target" WHERE "Target"."ID" = "Source"."ID"');
    });

    it('should extract MERGE without INTO (HANA syntax variation)', () => {
      const sql = 'MERGE "Target" USING "Source" ON "Target"."ID" = 1';
      const result = analyzeMutatingStatement(sql, 'SCH');
      expect(result?.tableName).toBe('"Target"');
      expect(result?.whereClause).toBe('"Target"."ID" = 1');
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed SQL missing table gracefully', () => {
      expect(analyzeMutatingStatement('UPDATE ', 'SCH')).toBeNull();
      expect(analyzeMutatingStatement('DELETE FROM ', 'SCH')).toBeNull();
    });
    
    it('should not choke on unmatched quotes', () => {
      const sql = 'UPDATE "Table SET "Val" = 1 WHERE "ID" = 2';
      const result = analyzeMutatingStatement(sql, 'SCH');
      expect(result).toBeDefined();
    });
  });
});
