import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HanaSqlBackupStore, extractRegionFromEndpoint, type HanaSqlBackupEntry } from './hanaSqlBackupStore';
import * as fs from 'node:fs/promises';
import type { HanaSqlScopeSession } from './hanaSqlConnectionResolver';

vi.mock('node:fs/promises');
vi.mock('node:os', () => ({
  homedir: () => '/mock/home'
}));

describe('hanaSqlBackupStore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('extractRegionFromEndpoint', () => {
    it('should extract region correctly from standard CF endpoints', () => {
      expect(extractRegionFromEndpoint('https://api.cf.eu10.hana.ondemand.com')).toBe('eu10');
      expect(extractRegionFromEndpoint('https://api.cf.us10-001.hana.ondemand.com')).toBe('us10-001');
    });

    it('should handle missing prefixes or unusual endpoints gracefully', () => {
      expect(extractRegionFromEndpoint('https://some-weird-endpoint.com')).toBe('unknown');
      expect(extractRegionFromEndpoint('not-a-url')).toBe('unknown');
    });
  });

  describe('HanaSqlBackupStore.saveBackup', () => {
    it('should save backup files to the correct folder structure and return entry', async () => {
      const store = new HanaSqlBackupStore();
      const mockDate = new Date('2026-06-24T19:42:00Z');
      
      const mockSession: HanaSqlScopeSession = {
        apiEndpoint: 'https://api.cf.eu10.hana.ondemand.com',
        orgName: 'finance-prod',
        spaceName: 'uat',
        appName: 'my-app',
        userEmail: 'test@sap.com',
        credentialId: 'cred-1',
        accessToken: 'token',
        tokenExpiresAt: 0,
        orgGuid: '1',
        spaceGuid: '2',
        serviceInstanceGuid: '3'
      };

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await store.saveBackup({
        session: mockSession,
        appName: 'my-app',
        statementType: 'UPDATE',
        tableName: '"Employees"',
        originalSql: 'UPDATE "Employees" SET A=1',
        csvContent: 'A\n1',
        rowCount: 1,
        timestamp: mockDate
      });

      expect(result).not.toBeNull();
      expect(result?.region).toBe('eu10');
      expect(result?.org).toBe('finance-prod');
      expect(result?.statementType).toBe('UPDATE');
      expect(result?.tableName).toBe('"Employees"');
      expect(result?.rowCount).toBe(1);

      // Verify that fs methods were called with expected paths
      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('202606'), expect.any(Object));
      expect(fs.writeFile).toHaveBeenCalledTimes(3); // query.sql, backup.csv, metadata.json
    });

    it('should catch errors and return null instead of throwing', async () => {
      const store = new HanaSqlBackupStore();
      vi.mocked(fs.mkdir).mockRejectedValue(new Error('Disk full'));

      const result = await store.saveBackup({
        session: { apiEndpoint: '', orgName: '', spaceName: '' } as HanaSqlScopeSession,
        appName: '',
        statementType: 'UPDATE',
        tableName: '',
        originalSql: '',
        csvContent: '',
        rowCount: 0,
        timestamp: new Date()
      });

      expect(result).toBeNull();
    });
  });

  describe('HanaSqlBackupStore.listBackups', () => {
    it('should return empty array if root directory does not exist', async () => {
      const store = new HanaSqlBackupStore();
      vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));
      
      const list = await store.listBackups();
      expect(list).toEqual([]);
    });

    it('should list and sort backups newest-first', async () => {
      const store = new HanaSqlBackupStore();
      
      // Mock month buckets
      vi.mocked(fs.readdir).mockResolvedValueOnce(['202606', '202605'] as unknown as string[]);
      
      // Mock backups inside 202606 bucket
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'eu10-org-space-app-update-table-20260624T100000',
        'eu10-org-space-app-delete-table-20260624T120000'
      ] as unknown as string[]);

      // Mock backups inside 202605 bucket
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'eu10-org-space-app-update-table-20260501T000000'
      ] as unknown as string[]);

      // Mock readFile for metadata.json for the 3 entries
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ id: '20260624T120000' }))
        .mockResolvedValueOnce(JSON.stringify({ id: '20260624T100000' }))
        .mockResolvedValueOnce(JSON.stringify({ id: '20260501T000000' }));

      const list = await store.listBackups();
      expect(list).toHaveLength(3);
      
      // Sorted by folder name descending (which implies newest first if they share prefixes,
      // but the exact order depends on the mocked metadata ids)
      expect(list[0]?.id).toBe('20260624T120000');
      expect(list[1]?.id).toBe('20260624T100000');
      expect(list[2]?.id).toBe('20260501T000000');
    });
  });

  describe('HanaSqlBackupStore.readBackupCsv', () => {
    it('should read csv file content', async () => {
      const store = new HanaSqlBackupStore();
      vi.mocked(fs.readFile).mockResolvedValueOnce('col1\nval1');

      const content = await store.readBackupCsv({ folderPath: '/fake/path' } as unknown as HanaSqlBackupEntry);
      expect(content).toBe('col1\nval1');
    });

    it('should return null on read failure', async () => {
      const store = new HanaSqlBackupStore();
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const content = await store.readBackupCsv({ folderPath: '/fake/path' } as unknown as HanaSqlBackupEntry);
      expect(content).toBeNull();
    });
  });
});
