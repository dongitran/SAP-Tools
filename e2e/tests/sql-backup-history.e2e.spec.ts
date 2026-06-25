import { test, expect, type Frame, type Page } from '@playwright/test';
import {
  cleanupExtensionHost,
  clickWithFallback,
  launchExtensionHost,
  openSapToolsSidebar,
  selectDefaultScope,
} from './support/sapToolsHarness';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

async function openSqlTabForDefaultScope(webviewFrame: Frame): Promise<void> {
  await selectDefaultScope(webviewFrame);
  await clickWithFallback(webviewFrame.getByRole('button', { name: 'Confirm Scope' }));
  await clickWithFallback(webviewFrame.getByRole('tab', { name: 'SQL' }));
  await expect(
    webviewFrame.getByRole('heading', { name: 'S/4HANA SQL Workbench' })
  ).toBeVisible({ timeout: 10000 });
}

async function findSqlHistoryFrame(window: Page): Promise<Frame | undefined> {
  const candidateFrames = window
    .frames()
    .filter((frame) => frame.url().includes('vscode-webview://'));

  for (const frame of [...candidateFrames].reverse()) {
    const navigation = frame.getByRole('navigation', { name: 'Backup entries' });
    const visible = await navigation.isVisible().catch(() => false);
    if (visible) {
      return frame;
    }
  }

  return undefined;
}

function getBackupRoot(): string {
  return path.join(os.homedir(), '.saptools', 'sql-backups');
}

test.describe('SAP Tools SQL Backup History', () => {
  
  test.beforeEach(() => {
    fs.rmSync(getBackupRoot(), { recursive: true, force: true });
  });

  test('User can see the empty backup history state', async () => {
    fs.mkdirSync(getBackupRoot(), { recursive: true });
    
    const session = await launchExtensionHost();
    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      const historyBtn = webviewFrame.getByRole('button', { name: 'View SQL backup history' });
      await expect(historyBtn).toBeVisible();
      await clickWithFallback(historyBtn);

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      await expect(historyFrame.getByText('No backups found yet.', { exact: false })).toBeVisible();
      await expect(session.window).toHaveScreenshot('sql-history-empty-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can inspect backups with many columns', async () => {
    const ts = new Date();
    const monthFolder = ts.toISOString().slice(0, 7).replace('-', '');
    const backupId = `us10-org-space-app-update-table-${ts.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const backupDir = path.join(getBackupRoot(), monthFolder, backupId);
    fs.mkdirSync(backupDir, { recursive: true });

    // Generate 30 columns
    const columns = Array.from({ length: 30 }, (_, i) => `Col${String(i + 1)}`);
    const values = Array.from({ length: 30 }, (_, i) => `Value${String(i + 1)}`);
    
    fs.writeFileSync(path.join(backupDir, 'query.sql'), 'UPDATE "Table" SET "A" = 1', 'utf8');
    fs.writeFileSync(path.join(backupDir, 'backup.csv'), [columns.join(','), values.join(',')].join('\n'), 'utf8');
    fs.writeFileSync(path.join(backupDir, 'metadata.json'), JSON.stringify({
      id: backupId, timestamp: ts.toISOString(), timestampLabel: '2026-06-24 10:00 UTC',
      region: 'us10', org: 'org', space: 'space', appName: 'app',
      statementType: 'UPDATE', tableName: 'Table', rowCount: 1, folderPath: backupDir
    }), 'utf8');

    const session = await launchExtensionHost();
    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'View SQL backup history' }));

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      // Click the entry to load detail
      await historyFrame.getByRole('option').first().click();
      
      await expect(historyFrame.getByRole('columnheader', { name: 'Col30' })).toBeVisible();
      await expect(session.window).toHaveScreenshot('sql-history-horizontal-scroll-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can inspect highlighted SQL mutation variants', async () => {
    const ts = new Date();
    const monthFolder = ts.toISOString().slice(0, 7).replace('-', '');
    const backups = [
      {
        id: `us10-org-space-app-update-extreme-${ts.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`,
        type: 'UPDATE',
        table: 'table1',
        ts: ts,
        sql: `
  UPDATE 
  
  
  "table1" 
  
  SET 
     "Level" = 'ERROR',
     "Details" = '<html>\n</html>'
  WHERE 
  
  "Timestamp" < '2023-01-01'
  /* 
    Block comment
    spanning multiple lines
  */
  -- Inline comment
  AND "Code" IN (
     SELECT "C" FROM "Codes" WHERE "Cat" = 5.5
  );`
      },
      {
        id: `us10-org-space-app-delete-extreme-${new Date(ts.getTime()-1000).toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`,
        type: 'DELETE',
        table: 'table2',
        ts: new Date(ts.getTime()-1000),
        sql: `
  DELETE 
  
  FROM
  
  "table2"
  
  WHERE "Id" = 1;
  `
      },
      {
        id: `us10-org-space-app-insert-extreme-${new Date(ts.getTime()-2000).toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`,
        type: 'INSERT',
        table: 'table3',
        ts: new Date(ts.getTime()-2000),
        sql: `
  INSERT 
  INTO
  
  
  "table3" (
    "A", "B"
  ) VALUES (
    1, 2
  );
  `
      },
      {
        id: `us10-org-space-app-upsert-extreme-${new Date(ts.getTime()-3000).toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`,
        type: 'UPSERT',
        table: 'table4',
        ts: new Date(ts.getTime()-3000),
        sql: `
  UPSERT 
  "table4"
  
  VALUES ( 1, 2, 'hello' )
  
  
  WHERE "ID" = 1;
  `
      },
      {
        id: `us10-org-space-app-merge-extreme-${new Date(ts.getTime()-4000).toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`,
        type: 'MERGE',
        table: 'table5',
        ts: new Date(ts.getTime()-4000),
        sql: `
  MERGE 
  
  INTO 
  "table5" 
  
  USING "source"
  
  ON "table5"."id" = "source"."id"
  
  WHEN MATCHED THEN UPDATE SET "val" = 1;
  `
      }
    ];

    for (const b of backups) {
      const backupDir = path.join(getBackupRoot(), monthFolder, b.id);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'query.sql'), b.sql, 'utf8');
      fs.writeFileSync(path.join(backupDir, 'backup.csv'), 'A\n1', 'utf8');
      fs.writeFileSync(path.join(backupDir, 'metadata.json'), JSON.stringify({
        id: b.id, timestamp: b.ts.toISOString(), timestampLabel: '2026-06-24 11:00 UTC',
        region: 'us10', org: 'org', space: 'space', appName: 'app',
        statementType: b.type, tableName: b.table, rowCount: 1, folderPath: backupDir
      }), 'utf8');
    }

    const session = await launchExtensionHost();
    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'View SQL backup history' }));

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      // Click each item one by one and assert to test all SQL variation syntaxes
      const items = historyFrame.getByRole('option');
      await expect(items).toHaveCount(5);
      
      // Update is the newest (first)
      await items.nth(0).click();
      await expect(historyFrame.getByText('UPDATE', { exact: true }).last()).toBeVisible();
      await expect(historyFrame.getByText('Block comment', { exact: false })).toBeVisible();
      
      // Delete
      await items.nth(1).click();
      await expect(historyFrame.getByText('DELETE', { exact: true }).last()).toBeVisible();

      // Insert
      await items.nth(2).click();
      await expect(historyFrame.getByText('INSERT', { exact: true }).last()).toBeVisible();

      // Upsert
      await items.nth(3).click();
      await expect(historyFrame.getByText('UPSERT', { exact: true }).last()).toBeVisible();

      // Merge
      await items.nth(4).click();
      await expect(historyFrame.getByText('MERGE', { exact: true }).last()).toBeVisible();

      await expect(session.window).toHaveScreenshot('sql-history-extreme-sql-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can switch backup entries and copy CSV data', async () => {
    const tsBase = new Date();
    const monthFolder = tsBase.toISOString().slice(0, 7).replace('-', '');
    
    // Backup 1 (Tests fallback parser by omitting metadata.json)
    const ts1 = tsBase;
    const id1 = `us10-org-space-app-update-table-${ts1.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const dir1 = path.join(getBackupRoot(), monthFolder, id1);
    fs.mkdirSync(dir1, { recursive: true });
    fs.writeFileSync(path.join(dir1, 'query.sql'), 'UPDATE T1 SET Col1 = 1', 'utf8');
    fs.writeFileSync(path.join(dir1, 'backup.csv'), 'Col1\nVal1', 'utf8');
    // Deliberately omitting metadata.json to test `parseFolderNameToEntry` fallback

    // Backup 2
    const ts2 = new Date(tsBase.getTime() - 1000);
    const id2 = `us10-org-space-app-delete-table-${ts2.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const dir2 = path.join(getBackupRoot(), monthFolder, id2);
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, 'query.sql'), 'DELETE 2', 'utf8');
    fs.writeFileSync(path.join(dir2, 'backup.csv'), 'Col2\nVal2', 'utf8');
    fs.writeFileSync(path.join(dir2, 'metadata.json'), JSON.stringify({
      id: id2, timestamp: ts2.toISOString(), timestampLabel: 'TS2',
      region: 'r2', org: 'o2', space: 's2', appName: 'a2',
      statementType: 'DELETE', tableName: 'T2', rowCount: 1, folderPath: dir2
    }), 'utf8');

    // Backup 3 (UPSERT Simulation)
    const ts3 = new Date(tsBase.getTime() - 2000);
    const id3 = `us10-org-space-app-upsert-table-${ts3.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const dir3 = path.join(getBackupRoot(), monthFolder, id3);
    fs.mkdirSync(dir3, { recursive: true });
    fs.writeFileSync(path.join(dir3, 'query.sql'), 'UPSERT "Users" VALUES (1)', 'utf8');
    fs.writeFileSync(path.join(dir3, 'backup.csv'), 'Col3\nVal3', 'utf8');
    fs.writeFileSync(path.join(dir3, 'metadata.json'), JSON.stringify({
      id: id3, timestamp: ts3.toISOString(), timestampLabel: 'TS3',
      region: 'r3', org: 'o3', space: 's3', appName: 'a3',
      statementType: 'UPSERT', tableName: 'T3', rowCount: 1, folderPath: dir3
    }), 'utf8');

    const session = await launchExtensionHost();
    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'View SQL backup history' }));

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      // The entries are now globally sorted by timestamp descending.
      // ts1 (UPDATE, T1) is newest -> index 0
      // ts2 (DELETE, T2) is next   -> index 1
      // ts3 (UPSERT, T3) is oldest -> index 2
      
      const entries = historyFrame.getByRole('option');
      await expect(entries).toHaveCount(3);

      // Click middle item (which is T2 / DELETE)
      await entries.nth(1).click();
      await expect(entries.nth(1)).toHaveAttribute('aria-selected', 'true');
      await expect(historyFrame.getByText('T2', { exact: true })).toBeVisible();
      
      // Copy CSV for T2
      await session.window.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await historyFrame.getByRole('button', { name: 'Copy CSV' }).click();
      await expect.poll(
        async () => session.window.evaluate(() => navigator.clipboard.readText())
      ).toContain('Col2\nVal2');
      
      // Click last item (which is T3 / UPSERT)
      await entries.nth(2).click();
      await expect(historyFrame.getByText('T3', { exact: true })).toBeVisible();
      await expect(historyFrame.getByText('UPSERT', { exact: true }).last()).toBeVisible();

      await expect(session.window).toHaveScreenshot('sql-history-interactions-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
