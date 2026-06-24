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

test.describe('SAP Tools SQL Backup History', () => {
  test('User can open the SQL Backup History panel and view UI layout', async () => {
    // Generate mock backups to ensure the UI has data to display
    const backupRoot = path.join(os.homedir(), '.saptools', 'sql-backups');
    fs.rmSync(backupRoot, { recursive: true, force: true });
    
    const tsBase = new Date();
    const monthFolder = tsBase.toISOString().slice(0, 7).replace('-', '');
    
    // 1. Extreme UPDATE (Most recent - will be at top of list and auto-clicked)
    const ts1 = new Date(tsBase.getTime());
    const backupId1 = `us10-finance-prod-uat-update-employees-${ts1.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const backupDir1 = path.join(backupRoot, monthFolder, backupId1);
    fs.mkdirSync(backupDir1, { recursive: true });
    
    const extremeUpdateSql = `UPDATE "Employees"




-- Extreme gap between UPDATE and SET as requested by the user

    SET "Salary" = ROUND(
                     50000
                     * 
                     1.1
                   ),
        "Grade"  = 'L4'

/* 
  Bulk update salary
  for the sales department
  handling multiple newlines perfectly
*/

WHERE "Department" = 'Sales'
  AND "Status"     = 'Active';`;

    const csvHeader = 'EmpID,FirstName,LastName,Email,Department,JobTitle,Manager,OfficeLocation,Country,HireDate,Salary,Currency,Status,Grade,CostCenter';
    const csvRow1   = '101,Alice,Johnson,alice@corp.com,Sales,Account Executive,Bob Smith,New York,USA,2021-03-15,45000,USD,Active,L3,CC-001';
    const csvRow2   = '102,Bob,Williams,bob@corp.com,Sales,Senior AE,Carol Davis,Chicago,USA,2019-07-22,48000,USD,Active,L4,CC-002';
    
    fs.writeFileSync(path.join(backupDir1, 'query.sql'), extremeUpdateSql, 'utf8');
    fs.writeFileSync(path.join(backupDir1, 'backup.csv'), [csvHeader, csvRow1, csvRow2].join('\n'), 'utf8');
    fs.writeFileSync(path.join(backupDir1, 'metadata.json'), JSON.stringify({
      id: backupId1, timestamp: ts1.toISOString(),
      timestampLabel: ts1.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      region: 'us10', org: 'finance-prod', space: 'uat', appName: 'finance-worker',
      statementType: 'UPDATE', tableName: 'Employees', rowCount: 2, folderPath: backupDir1
    }), 'utf8');

    // 2. Extreme DELETE Statement
    const ts2 = new Date(tsBase.getTime() - 1000 * 60 * 30);
    const backupId2 = `us10-finance-prod-uat-delete-logs-${ts2.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const backupDir2 = path.join(backupRoot, monthFolder, backupId2);
    fs.mkdirSync(backupDir2, { recursive: true });
    
    const extremeDeleteSql = `DELETE 
    
FROM 
      "Logs"

-- 5 empty lines below





WHERE "Timestamp" < '2023-01-01'
  AND "Level" = 'ERROR';`;

    fs.writeFileSync(path.join(backupDir2, 'query.sql'), extremeDeleteSql, 'utf8');
    fs.writeFileSync(path.join(backupDir2, 'backup.csv'), 'LogID,Timestamp,Level,Message\n1,2022-12-31,ERROR,Old Error', 'utf8');
    fs.writeFileSync(path.join(backupDir2, 'metadata.json'), JSON.stringify({
      id: backupId2, timestamp: ts2.toISOString(),
      timestampLabel: ts2.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      region: 'us10', org: 'finance-prod', space: 'uat', appName: 'finance-worker',
      statementType: 'DELETE', tableName: 'Logs', rowCount: 1, folderPath: backupDir2
    }), 'utf8');

    // 3. Extreme INSERT Statement
    const ts3 = new Date(tsBase.getTime() - 1000 * 60 * 60);
    const backupId3 = `us10-finance-prod-uat-insert-users-${ts3.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}`;
    const backupDir3 = path.join(backupRoot, monthFolder, backupId3);
    fs.mkdirSync(backupDir3, { recursive: true });
    
    const extremeInsertSql = `INSERT     INTO 
"Users" (
    "ID", 
    "Name",
    "CreatedAt"
)
VALUES (
    1, 
    'Test User With Spaces',
    NOW()
);`;

    fs.writeFileSync(path.join(backupDir3, 'query.sql'), extremeInsertSql, 'utf8');
    fs.writeFileSync(path.join(backupDir3, 'backup.csv'), 'ID,Name,CreatedAt\n1,Test User With Spaces,2023-01-01T00:00:00Z', 'utf8');
    fs.writeFileSync(path.join(backupDir3, 'metadata.json'), JSON.stringify({
      id: backupId3, timestamp: ts3.toISOString(),
      timestampLabel: ts3.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      region: 'us10', org: 'finance-prod', space: 'uat', appName: 'finance-api',
      statementType: 'INSERT', tableName: 'Users', rowCount: 1, folderPath: backupDir3
    }), 'utf8');

    const session = await launchExtensionHost();


    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      // Click the history button
      const historyBtn = webviewFrame.locator('[data-action="open-sql-backup-history"]');
      await expect(historyBtn).toBeVisible();
      await clickWithFallback(historyBtn);

      // Wait for the history panel frame to open
      await expect
        .poll(
          async () => {
            const frame = await findSqlHistoryFrame(session.window);
            return frame !== undefined;
          },
          { timeout: 20000 }
        )
        .toBe(true);

      const historyFrame = await findSqlHistoryFrame(session.window);
      if (historyFrame === undefined) throw new Error('History frame not found');

      // 1. Assert basic UI elements and initial state
      await expect(historyFrame.getByRole('heading', { name: 'SQL Backup History' })).toBeVisible();
      
      // Wait for the history panel to load and display all 3 entries
      const entries = historyFrame.locator('.entry-item');
      await expect(entries).toHaveCount(3, { timeout: 10000 });
      
      const firstEntry = entries.nth(0);
      const secondEntry = entries.nth(1);
      
      // 2. Click the first entry (Extreme UPDATE) and take snapshot
      await firstEntry.click();
      await expect(firstEntry).toHaveClass(/is-selected/);
      
      // Wait for the detail pane to render the complex SQL block
      await expect(historyFrame.locator('.detail-pane .sql-block')).toContainText('ROUND( 50000 * 1.1 )', { timeout: 10000, useInnerText: true });

      // Wait for stable render of the detail pane layout
      await session.window.waitForTimeout(1000);

      // Take a screenshot of the entire VS Code window to capture the complex layout
      await expect(session.window).toHaveScreenshot('sql-history-panel-darwin.png', {
        maxDiffPixelRatio: 0.1,
      });

      // 3. Test Interaction: Switch to the second entry (Extreme INSERT)
      await secondEntry.click();
      await expect(secondEntry).toHaveClass(/is-selected/);
      await expect(firstEntry).not.toHaveClass(/is-selected/);
      
      // Detail pane should update immediately
      await expect(historyFrame.locator('.detail-header .detail-title')).toContainText('INSERT Users');
      await expect(historyFrame.locator('.detail-pane .sql-block')).toContainText('INSERT     INTO');

      // 4. Test Clipboard: Copy CSV
      await session.window.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const copyBtn = historyFrame.locator('#copy-btn');
      await expect(copyBtn).toBeVisible();
      await copyBtn.click();
      
      // Wait a bit for the IPC copy message to process
      await session.window.waitForTimeout(500);
      
      const clipboardText = await session.window.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toContain('ID,Name,CreatedAt');
      expect(clipboardText).toContain('1,Test User With Spaces');

    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
