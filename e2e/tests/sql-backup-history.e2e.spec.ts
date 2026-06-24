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
    const layout = frame.locator('.app-layout').first();
    const visible = await layout.isVisible().catch(() => false);
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

  test('Empty state: shows no backups found message', async () => {
    fs.mkdirSync(getBackupRoot(), { recursive: true });
    
    const session = await launchExtensionHost();
    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      const historyBtn = webviewFrame.locator('[data-action="open-sql-backup-history"]');
      await expect(historyBtn).toBeVisible();
      await clickWithFallback(historyBtn);

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      await expect(historyFrame.locator('.empty-list')).toContainText('No backups found yet');
      
      await session.window.waitForTimeout(1000);
      await expect(session.window).toHaveScreenshot('sql-history-empty-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('Horizontal scrolling: handles many columns gracefully', async () => {
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
      await clickWithFallback(webviewFrame.locator('[data-action="open-sql-backup-history"]'));

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      // Click the entry to load detail
      await historyFrame.locator('.entry-item').first().click();
      
      // Wait for table to load
      await expect(historyFrame.locator('.data-table th').last()).toContainText('Col30');
      
      await session.window.waitForTimeout(1000);
      await expect(session.window).toHaveScreenshot('sql-history-horizontal-scroll-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('Extreme SQL: renders complex highlighting accurately', async () => {
    const ts = new Date();
    const monthFolder = ts.toISOString().slice(0, 7).replace('-', '');
    const backupId = `us10-org-space-app-delete-extreme-${ts.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const backupDir = path.join(getBackupRoot(), monthFolder, backupId);
    fs.mkdirSync(backupDir, { recursive: true });

    const sql = `
  UPDATE 
  
  
  table 
  
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
  );`;

    fs.writeFileSync(path.join(backupDir, 'query.sql'), sql, 'utf8');
    fs.writeFileSync(path.join(backupDir, 'backup.csv'), 'A\n1', 'utf8');
    fs.writeFileSync(path.join(backupDir, 'metadata.json'), JSON.stringify({
      id: backupId, timestamp: ts.toISOString(), timestampLabel: '2026-06-24 11:00 UTC',
      region: 'us10', org: 'org', space: 'space', appName: 'app',
      statementType: 'UPDATE', tableName: 'table', rowCount: 1, folderPath: backupDir
    }), 'utf8');

    const session = await launchExtensionHost();
    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await clickWithFallback(webviewFrame.locator('[data-action="open-sql-backup-history"]'));

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      await historyFrame.locator('.entry-item').first().click();
      
      // Verify highlights exist
      const sqlBlock = historyFrame.locator('.sql-block');
      await expect(sqlBlock.locator('.sql-kw').first()).toContainText('UPDATE');
      await expect(sqlBlock.locator('.sql-cmt').first()).toContainText('Block comment');
      
      await session.window.waitForTimeout(1000);
      await expect(session.window).toHaveScreenshot('sql-history-extreme-sql-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('Interactions: switches between items and copies CSV', async () => {
    const tsBase = new Date();
    const monthFolder = tsBase.toISOString().slice(0, 7).replace('-', '');
    
    // Backup 1
    const ts1 = new Date(tsBase.getTime());
    const id1 = `us10-org-space-app-update-table-${ts1.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const dir1 = path.join(getBackupRoot(), monthFolder, id1);
    fs.mkdirSync(dir1, { recursive: true });
    fs.writeFileSync(path.join(dir1, 'query.sql'), 'UPDATE 1', 'utf8');
    fs.writeFileSync(path.join(dir1, 'backup.csv'), 'Col1\nVal1', 'utf8');
    fs.writeFileSync(path.join(dir1, 'metadata.json'), JSON.stringify({
      id: id1, timestamp: ts1.toISOString(), timestampLabel: 'TS1',
      region: 'r1', org: 'o1', space: 's1', appName: 'a1',
      statementType: 'UPDATE', tableName: 'T1', rowCount: 1, folderPath: dir1
    }), 'utf8');

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

    const session = await launchExtensionHost();
    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await clickWithFallback(webviewFrame.locator('[data-action="open-sql-backup-history"]'));

      await expect.poll(async () => (await findSqlHistoryFrame(session.window)) !== undefined, { timeout: 20000 }).toBe(true);
      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      const entries = historyFrame.locator('.entry-item');
      await expect(entries).toHaveCount(2);

      // Click second item
      await entries.nth(1).click();
      await expect(entries.nth(1)).toHaveClass(/is-selected/);
      await expect(historyFrame.locator('.detail-title')).toContainText('T2');
      
      // Copy CSV
      await session.window.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await historyFrame.locator('#copy-btn').click();
      await session.window.waitForTimeout(500);
      const clip = await session.window.evaluate(() => navigator.clipboard.readText());
      expect(clip).toContain('Col2\nVal2');
      
      await session.window.waitForTimeout(1000);
      await expect(session.window).toHaveScreenshot('sql-history-interactions-darwin.png', { maxDiffPixelRatio: 0.1 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
