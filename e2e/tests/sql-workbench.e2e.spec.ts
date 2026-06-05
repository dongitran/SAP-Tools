import fs from 'node:fs';
import path from 'node:path';

import {
  test,
  expect,
  type ElectronApplication,
  type Frame,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  cleanupExtensionHost,
  clickWithFallback,
  launchExtensionHost,
  openSapToolsSidebar,
  runWorkbenchCommand,
  selectDefaultScope,
} from './support/sapToolsHarness';

async function openSqlTabForDefaultScope(webviewFrame: Frame): Promise<void> {
  await selectDefaultScope(webviewFrame);
  await clickWithFallback(webviewFrame.getByRole('button', { name: 'Confirm Scope' }));
  await clickWithFallback(webviewFrame.getByRole('tab', { name: 'SQL' }));
  await expect(
    webviewFrame.getByRole('heading', { name: 'S/4HANA SQL Workbench' })
  ).toBeVisible({ timeout: 10000 });
}

async function findSqlResultFrame(window: Page): Promise<Frame | undefined> {
  const candidateFrames = window
    .frames()
    .filter((frame) => frame.url().includes('vscode-webview://'));

  for (const frame of [...candidateFrames].reverse()) {
    const resultLayout = frame
      .locator('.result-layout, .state-layout, .result-loading-layout, .result-batch-layout')
      .first();
    const visible = await resultLayout.isVisible().catch(() => false);
    if (visible) {
      return frame;
    }
  }

  return undefined;
}

async function readElectronClipboardText(
  electronApp: ElectronApplication
): Promise<string> {
  return electronApp.evaluate((electron): string => {
    const electronRecord = electron as Record<string, unknown>;
    const clipboard = electronRecord['clipboard'];
    if (typeof clipboard !== 'object' || clipboard === null) {
      return '';
    }

    const clipboardRecord = clipboard as Record<string, unknown>;
    const readText = clipboardRecord['readText'];
    if (typeof readText !== 'function') {
      return '';
    }

    const text = (readText as () => unknown)();
    return typeof text === 'string' ? text : '';
  });
}

async function waitForElectronClipboardText(
  electronApp: ElectronApplication,
  isExpectedText: (text: string) => boolean
): Promise<string> {
  let latestText = '';
  await expect
    .poll(
      async () => {
        latestText = await readElectronClipboardText(electronApp);
        return isExpectedText(latestText);
      },
      { timeout: 10000 }
    )
    .toBe(true);
  return latestText;
}

async function resolveSqlResultFrame(window: Page, timeoutMs = 20000): Promise<Frame> {
  await expect
    .poll(
      async () => {
        const frame = await findSqlResultFrame(window);
        return frame?.url() ?? '';
      },
      { timeout: timeoutMs }
    )
    .toContain('vscode-webview://');

  const frame = await findSqlResultFrame(window);
  if (frame === undefined) {
    throw new Error('SQL result webview frame was not found.');
  }

  return frame;
}

async function focusActiveSqlEditor(window: Page): Promise<void> {
  const editorSurface = window
    .locator('.part.editor .editor-group-container.active .monaco-editor .view-lines')
    .first();
  await expect(editorSurface).toBeVisible({ timeout: 10000 });
  await clickWithFallback(editorSurface);
}

async function replaceActiveSqlEditorText(window: Page, sql: string): Promise<void> {
  await focusActiveSqlEditor(window);
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await window.keyboard.insertText(sql);
}

function resolveExpectedSqlFilePath(workspaceDir: string, appName: string): string {
  return path.join(workspaceDir, `saptools-${appName}.sql`);
}

async function saveActiveSqlEditor(window: Page, targetPath: string): Promise<string> {
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
  await expect
    .poll(
      () => {
        return fs.existsSync(targetPath);
      },
      { timeout: 10000 }
    )
    .toBe(true);
  return fs.readFileSync(targetPath, 'utf8');
}

async function selectActiveSqlEditorText(window: Page): Promise<void> {
  await focusActiveSqlEditor(window);
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
}

async function runActiveSqlEditorCommand(window: Page): Promise<void> {
  await window.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter'
  );
}

async function runActiveSqlEditorAndWaitForNewResult(window: Page): Promise<void> {
  const resultTabsBeforeRun = await window
    .getByRole('tab', { name: /SAP Tools SQL Result/i })
    .count();
  await runActiveSqlEditorCommand(window);
  await expect
    .poll(
      async () => {
        return window.getByRole('tab', { name: /SAP Tools SQL Result/i }).count();
      },
      { timeout: 20000 }
    )
    .toBe(resultTabsBeforeRun + 1)
    .catch(async () => {
      await runWorkbenchCommand(window, 'Run HANA SQL');
      await expect
        .poll(
          async () => {
            return window.getByRole('tab', { name: /SAP Tools SQL Result/i }).count();
          },
          { timeout: 20000 }
        )
        .toBe(resultTabsBeforeRun + 1);
    });
}

async function runTriggerSuggestCommand(window: Page): Promise<void> {
  await window.keyboard.press('F1');
  const quickInputWidget = window.locator('.quick-input-widget:visible').first();
  await expect(quickInputWidget).toBeVisible({ timeout: 10000 });
  const quickInputField = quickInputWidget.locator('input[type="text"]').first();
  await expect(quickInputField).toBeVisible({ timeout: 10000 });
  await quickInputField.fill('');
  await window.keyboard.type('>Trigger Suggest');
  const commandItem = quickInputWidget.getByText('Trigger Suggest', { exact: true }).first();
  await expect(commandItem).toBeVisible({ timeout: 10000 });
  await clickWithFallback(commandItem);
}

async function triggerActiveEditorSuggest(window: Page): Promise<Locator> {
  await focusActiveSqlEditor(window);
  await window.keyboard.press('Control+Space');
  const suggestWidget = window.locator('.suggest-widget:visible').first();
  const visibleFromShortcut = await suggestWidget
    .isVisible({ timeout: 3000 })
    .catch((): false => false);
  if (visibleFromShortcut) {
    return suggestWidget;
  }

  await runTriggerSuggestCommand(window);
  return suggestWidget;
}

async function selectSqlApp(webviewFrame: Frame, appName: string): Promise<void> {
  await clickWithFallback(webviewFrame.getByRole('button', { name: appName }));
}

function tableRows(tablesPanel: Locator): Locator {
  return tablesPanel.locator('[data-role="hana-table-row"]');
}

async function readVisibleEditorGroupCount(window: Page): Promise<number> {
  return window.evaluate(() => {
    return Array.from(document.querySelectorAll('.editor-group-container')).filter((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    }).length;
  });
}

async function installSqlWorkbenchTextRecorder(webviewFrame: Frame): Promise<void> {
  await webviewFrame.evaluate(() => {
    const targetWindow = window as typeof window & {
      __sapToolsSqlTextObserver?: MutationObserver;
      __sapToolsSqlTextRecords?: string[];
    };
    targetWindow.__sapToolsSqlTextObserver?.disconnect();
    targetWindow.__sapToolsSqlTextRecords = [];
    const recordText = (): void => {
      targetWindow.__sapToolsSqlTextRecords?.push(document.body.innerText);
    };
    recordText();
    const observer = new MutationObserver(recordText);
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    targetWindow.__sapToolsSqlTextObserver = observer;
  });
}

async function readSqlWorkbenchTextRecords(webviewFrame: Frame): Promise<readonly string[]> {
  return webviewFrame.evaluate(() => {
    const targetWindow = window as typeof window & {
      __sapToolsSqlTextObserver?: MutationObserver;
      __sapToolsSqlTextRecords?: string[];
    };
    targetWindow.__sapToolsSqlTextObserver?.disconnect();
    return targetWindow.__sapToolsSqlTextRecords ?? [];
  });
}

test.describe('SAP Tools SQL workbench', () => {
  test('User can review SQL app list with initial tables panel state', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await expect(
        webviewFrame.getByText('Manual SELECT queries without a row limit run with LIMIT 100.')
      ).toHaveCount(0);
      const appSearch = webviewFrame.getByRole('searchbox', {
        name: 'Search apps in S/4HANA SQL Workbench',
      });
      await expect(appSearch).toBeVisible();
      await expect(appSearch).toHaveAttribute('placeholder', 'Search apps by name');

      const appSearchLayout = await webviewFrame.locator('.sql-workbench-header').evaluate(() => {
        const title = document.querySelector<HTMLElement>('.sql-workbench-header h2');
        const input = document.querySelector<HTMLElement>('[data-role="sql-app-search"]');
        const icon = document.querySelector<HTMLElement>('.sql-app-search-row .search-input-icon');
        if (title === null || input === null || icon === null) {
          throw new Error('SQL app search header controls are missing.');
        }
        const titleBox = title.getBoundingClientRect();
        const inputBox = input.getBoundingClientRect();
        const inputStyles = window.getComputedStyle(input);
        const iconStyles = window.getComputedStyle(icon);
        return {
          inputLeft: inputBox.left,
          inputPaddingLeft: inputStyles.paddingLeft,
          iconLeft: iconStyles.left,
          titleRight: titleBox.right,
        };
      });
      expect(appSearchLayout.inputLeft).toBeGreaterThanOrEqual(appSearchLayout.titleRight);
      expect(appSearchLayout.inputPaddingLeft).toBe('31px');
      expect(appSearchLayout.iconLeft).toBe('12px');

      await expect(webviewFrame.locator('.sql-service-row')).toHaveCount(3);
      await expect(webviewFrame.locator('.sql-service-open-indicator')).toHaveCount(3);

      await appSearch.fill('audit');
      await expect(webviewFrame.locator('.sql-service-row')).toHaveCount(1);
      await expect(webviewFrame.getByRole('button', { name: 'finance-uat-audit' })).toBeVisible();
      await expect(webviewFrame.getByRole('button', { name: 'finance-uat-api' })).toHaveCount(0);

      await appSearch.fill('not-found');
      await expect(webviewFrame.locator('.sql-service-row')).toHaveCount(0);
      await expect(webviewFrame.getByText('No apps match current search.')).toBeVisible();

      await appSearch.fill('');
      await expect(webviewFrame.locator('.sql-service-row')).toHaveCount(3);
      await expect(webviewFrame.locator('.sql-service-open-indicator')).toHaveCount(3);
      await expect(webviewFrame.locator('.sql-service-panel')).toHaveCount(0);
      await expect(webviewFrame.locator('.sql-result-preview')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-result-preview"]')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-service-meta"]')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-service-select"]')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-action="open-hana-sql-file"]')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-action="refresh-hana-services"]')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-action="open-sqltools-extension"]')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      await expect(tablesPanel).toBeVisible();
      await expect(tablesPanel.getByRole('heading', { name: 'Tables' })).toBeVisible();
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('0');
      await expect(tablesPanel.getByRole('searchbox', { name: 'Search tables' })).toBeDisabled();
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveText(
        'Select an app above to load tables.'
      );
      await expect(tableRows(tablesPanel)).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);

      const bodyText = await webviewFrame.locator('body').innerText();
      expect(bodyText).not.toContain('Scope: uat');
      expect(bodyText).not.toContain('running instance');
      expect(bodyText).not.toContain('Click to open SQL file for this app');
      expect(bodyText).not.toContain('Click one app below to open SQL file for that app.');
      expect(bodyText).not.toContain('Manual SELECT queries without a row limit run with LIMIT 100.');
      expect(bodyText).not.toContain('ORDER_ID');
      expect(bodyText).not.toContain('CREATED_AT');
      expect(bodyText).not.toContain('Failed to load tables.');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can open app SQL editor and run SQL command in a stable result group', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await selectSqlApp(webviewFrame, 'finance-uat-api');
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden({
        timeout: 10000,
      });
      await expect(webviewFrame.locator('[data-role="hana-tables-count"]')).toHaveText('105', {
        timeout: 15000,
      });
      await expect(webviewFrame.locator('body')).not.toContainText('SQL file opened for app');

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });
      await clickWithFallback(sqlEditorTab);
      await expect(sqlEditorTab).toHaveAttribute('aria-selected', 'true', {
        timeout: 10000,
      });
      const expectedSqlPath = resolveExpectedSqlFilePath(
        session.workspaceDir,
        'finance-uat-api'
      );
      const savedSql = await saveActiveSqlEditor(session.window, expectedSqlPath);
      expect(savedSql).toContain('-- SAP Tools SQL for finance-uat-api');
      await expect(session.window.getByText(/Unable to write file/i)).toHaveCount(0);
      await selectSqlApp(webviewFrame, 'finance-uat-api');
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden({
        timeout: 10000,
      });
      await expect(webviewFrame.locator('body')).not.toContainText(/file already exists/i);
      await expect(session.window.getByText(/file already exists/i)).toHaveCount(0);
      await clickWithFallback(sqlEditorTab);
      await expect(sqlEditorTab).toHaveAttribute('aria-selected', 'true', {
        timeout: 10000,
      });
      await focusActiveSqlEditor(session.window);
      await replaceActiveSqlEditorText(session.window, 'SELECT * FROM Demo');
      const suggestWidget = await triggerActiveEditorSuggest(session.window);
      await expect(suggestWidget).toBeVisible({ timeout: 10000 });
      await expect(suggestWidget).toContainText('Demo_PurchaseOrderItemMapping');
      await expect(suggestWidget).not.toContainText('DEMO_PURCHASEORDERITEMMAPPING');
      await session.window.keyboard.press('Escape');
      await replaceActiveSqlEditorText(
        session.window,
        'SELECT CURRENT_USER, CURRENT_SCHEMA FROM DUMMY;'
      );

      const editorGroupCountBeforeFirstResult = await readVisibleEditorGroupCount(session.window);
      await runActiveSqlEditorCommand(session.window);
      const resultFrame = await resolveSqlResultFrame(session.window, 7000).catch(async () => {
        await runWorkbenchCommand(session.window, 'Run HANA SQL');
        return resolveSqlResultFrame(session.window, 30000);
      });
      const editorGroupCountAfterFirstResult = await readVisibleEditorGroupCount(session.window);
      if (editorGroupCountBeforeFirstResult === 1) {
        expect(editorGroupCountAfterFirstResult).toBe(2);
      } else {
        expect(editorGroupCountAfterFirstResult).toBe(editorGroupCountBeforeFirstResult);
      }
      await expect(
        resultFrame.getByRole('heading', { name: 'SAP Tools SQL Result' })
      ).toHaveCount(0);
      await expect(resultFrame.getByText(/^Table:\s*Dummy$/)).toBeVisible();
      await expect(resultFrame.getByRole('table')).toBeVisible();
      await expect(resultFrame.getByRole('columnheader', { name: '#' })).toBeVisible();
      await expect(
        resultFrame.getByRole('cell', { name: 'TEST_SCHEMA', exact: true })
      ).toBeVisible();
      await expect(
        resultFrame
          .getByRole('cell')
          .filter({ hasText: /SELECT CURRENT_USER, CURRENT_SCHEMA FROM DUMMY LIMIT 100/i })
          .first()
      ).toBeVisible();

      const resultHtml = await resultFrame.content();
      expect(resultHtml).not.toContain('<h1>SAP Tools SQL Result</h1>');
      expect(resultHtml).toContain('table-layout: auto;');
      expect(resultHtml).toContain('width: max-content;');
      expect(resultHtml).toContain('min-width: 100%;');
      expect(resultHtml).toContain('--vscode-editor-background');
      expect(resultHtml).not.toContain('SAP HANA Client Not Found');
      expect(resultHtml).not.toContain('Install the SAP HANA Client');
      expect(resultHtml).not.toMatch(/hdbsql/i);
      expect(resultHtml).not.toMatch(/hdbclient/i);
      expect(resultHtml).not.toContain('hanaSqlClientPath');
      const tableLayout = await resultFrame.getByRole('table').evaluate((table) => {
        const firstCell = table.querySelector('td');
        const wrapper = table.closest('.result-table-wrap');
        const layout = table.closest('.result-layout');
        if (!(table instanceof HTMLElement) || !(firstCell instanceof HTMLElement)) {
          throw new Error('Result table or first cell is missing.');
        }
        if (!(wrapper instanceof HTMLElement)) {
          throw new Error('Result table wrapper is missing.');
        }
        if (!(layout instanceof HTMLElement)) {
          throw new Error('Result layout is missing.');
        }
        const tableStyles = window.getComputedStyle(table);
        const cellStyles = window.getComputedStyle(firstCell);
        const bodyStyles = window.getComputedStyle(document.body);
        const wrapperStyles = window.getComputedStyle(wrapper);
        const layoutStyles = window.getComputedStyle(layout);
        const wrapperBox = wrapper.getBoundingClientRect();
        const layoutBox = layout.getBoundingClientRect();
        return {
          cellOverflow: cellStyles.overflow,
          cellTextOverflow: cellStyles.textOverflow,
          cellWhiteSpace: cellStyles.whiteSpace,
          bodyMarginLeft: bodyStyles.marginLeft,
          bodyPaddingLeft: bodyStyles.paddingLeft,
          layoutPaddingLeft: layoutStyles.paddingLeft,
          tableLayout: tableStyles.tableLayout,
          tableWidth: table.getBoundingClientRect().width,
          viewportWidth: window.innerWidth,
          wrapperLeft: wrapperBox.left,
          wrapperPaddingLeft: wrapperStyles.paddingLeft,
          wrapperPaddingRight: wrapperStyles.paddingRight,
          wrapperRight: wrapperBox.right,
          wrapperWidth: wrapper.getBoundingClientRect().width,
          layoutLeft: layoutBox.left,
          layoutRight: layoutBox.right,
        };
      });
      expect(tableLayout.bodyMarginLeft).toBe('0px');
      expect(tableLayout.bodyPaddingLeft).toBe('0px');
      expect(tableLayout.layoutPaddingLeft).toBe('0px');
      expect(tableLayout.wrapperPaddingLeft).toBe('0px');
      expect(tableLayout.wrapperPaddingRight).toBe('0px');
      expect(tableLayout.wrapperLeft).toBe(0);
      expect(tableLayout.layoutLeft).toBe(0);
      expect(Math.abs(tableLayout.wrapperRight - tableLayout.viewportWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(tableLayout.layoutRight - tableLayout.viewportWidth)).toBeLessThanOrEqual(1);
      expect(tableLayout.tableLayout).toBe('auto');
      expect(tableLayout.cellWhiteSpace).toBe('pre');
      expect(tableLayout.cellOverflow).toBe('visible');
      expect(tableLayout.cellTextOverflow).toBe('clip');
      expect(tableLayout.tableWidth).toBeGreaterThanOrEqual(tableLayout.wrapperWidth);
      const toolbarChips = resultFrame.locator('.result-toolbar .result-chip');
      await expect(toolbarChips.filter({ hasText: 'Table: Dummy' })).toBeVisible();
      await expect(toolbarChips.filter({ hasText: 'App: finance-uat-api' })).toHaveCount(0);
      await expect(toolbarChips.filter({ hasText: /^Executed: /i })).toHaveCount(0);

      await clickWithFallback(sqlEditorTab);
      await replaceActiveSqlEditorText(session.window, 'SELECT ID FROM DUMMY LIMIT 7');

      const resultTabsBeforeExplicitLimit = await session.window
        .getByRole('tab', { name: /SAP Tools SQL Result/i })
        .count();
      const editorGroupCountBeforeExplicitLimit = await readVisibleEditorGroupCount(
        session.window
      );
      await runActiveSqlEditorCommand(session.window);
      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(resultTabsBeforeExplicitLimit + 1)
        .catch(async () => {
          await runWorkbenchCommand(session.window, 'Run HANA SQL');
          await expect
            .poll(
              async () => {
                return session.window
                  .getByRole('tab', { name: /SAP Tools SQL Result/i })
                  .count();
              },
              { timeout: 20000 }
            )
            .toBe(resultTabsBeforeExplicitLimit + 1);
        });
      await expect
        .poll(
          async () => {
            return readVisibleEditorGroupCount(session.window);
          },
          { timeout: 20000 }
        )
        .toBe(editorGroupCountBeforeExplicitLimit);

      const explicitLimitResultFrame = await resolveSqlResultFrame(session.window, 20000);
      const explicitLimitSqlCell = explicitLimitResultFrame
        .getByRole('cell')
        .filter({ hasText: /SELECT ID FROM DUMMY LIMIT 7/i })
        .first();
      await expect(explicitLimitSqlCell).toBeVisible();
      const explicitLimitSqlText = await explicitLimitSqlCell.innerText();
      expect(explicitLimitSqlText.match(/\bLIMIT\b/g) ?? []).toHaveLength(1);
      expect(explicitLimitSqlText).not.toContain('LIMIT 100');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can run selected SQL with a readable table name from the selected app', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await selectSqlApp(webviewFrame, 'finance-uat-api');

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      await expect(tableRows(tablesPanel)).toHaveCount(105, { timeout: 15000 });
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveCount(0);

      const searchInput = tablesPanel.getByRole('searchbox', { name: 'Search tables' });
      await searchInput.fill('Demo_App');
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('1/105');
      const readableTableRow = tablesPanel.locator(
        '[data-role="hana-table-row"][data-table-name="DEMO_APP"]'
      );
      await expect(readableTableRow).toBeVisible();
      await expect(readableTableRow.locator('[data-role="hana-table-name"]')).toHaveAttribute(
        'data-full-display-name',
        'Demo_App'
      );

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });
      await clickWithFallback(sqlEditorTab);
      await replaceActiveSqlEditorText(session.window, 'select * from Demo_App limit 100;');
      await selectActiveSqlEditorText(session.window);

      const resultTabsBeforeRun = await session.window
        .getByRole('tab', { name: /SAP Tools SQL Result/i })
        .count();
      await runActiveSqlEditorCommand(session.window);
      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(resultTabsBeforeRun + 1)
        .catch(async () => {
          await runWorkbenchCommand(session.window, 'Run HANA SQL');
          await expect
            .poll(
              async () => {
                return session.window
                  .getByRole('tab', { name: /SAP Tools SQL Result/i })
                  .count();
              },
              { timeout: 20000 }
            )
            .toBe(resultTabsBeforeRun + 1);
        });

      const resultFrame = await resolveSqlResultFrame(session.window, 20000);
      await expect(resultFrame.getByText('Table: Demo_App')).toBeVisible();
      await expect(resultFrame.getByText('App: finance-uat-api')).toHaveCount(0);
      await expect(resultFrame.getByText(/^Executed: /i)).toHaveCount(0);
      await expect(resultFrame.getByRole('table')).toBeVisible();
      await expect(
        resultFrame.getByRole('cell', { name: 'TEST_SCHEMA', exact: true })
      ).toBeVisible();
      await expect(
        resultFrame
          .getByRole('cell')
          .filter({ hasText: /select \* from "TEST_SCHEMA"\."DEMO_APP" limit 100/i })
          .first()
      ).toBeVisible();
      await expect(
        resultFrame
          .getByRole('cell')
          .filter({ hasText: /select \* from Demo_App limit 100/i })
          .first()
      ).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can run manual SQL with lower-case app table references in selected schema', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await selectSqlApp(webviewFrame, 'finance-uat-api');

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      await expect(tableRows(tablesPanel)).toHaveCount(105, { timeout: 15000 });
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveCount(0);

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });
      await clickWithFallback(sqlEditorTab);
      await replaceActiveSqlEditorText(session.window, 'select * from demo_app LIMIT 100');
      await selectActiveSqlEditorText(session.window);

      const resultTabsBeforeRun = await session.window
        .getByRole('tab', { name: /SAP Tools SQL Result/i })
        .count();
      await runActiveSqlEditorCommand(session.window);
      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(resultTabsBeforeRun + 1)
        .catch(async () => {
          await runWorkbenchCommand(session.window, 'Run HANA SQL');
          await expect
            .poll(
              async () => {
                return session.window
                  .getByRole('tab', { name: /SAP Tools SQL Result/i })
                  .count();
              },
              { timeout: 20000 }
            )
            .toBe(resultTabsBeforeRun + 1);
        });

      const resultFrame = await resolveSqlResultFrame(session.window, 20000);
      await expect(resultFrame.getByText('Table: Demo_App')).toBeVisible();
      await expect(resultFrame.getByText('App: finance-uat-api')).toHaveCount(0);
      await expect(resultFrame.getByText('Execution Error')).toHaveCount(0);
      await expect(resultFrame.getByRole('table')).toBeVisible();
      await expect(
        resultFrame
          .getByRole('cell')
          .filter({ hasText: /select \* from "TEST_SCHEMA"\."DEMO_APP" LIMIT 100/i })
          .first()
      ).toBeVisible();
      await expect(
        resultFrame
          .getByRole('cell')
          .filter({ hasText: /select \* from demo_app LIMIT 100/i })
          .first()
      ).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can run manual SQL with uppercase app table references in selected schema', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await selectSqlApp(webviewFrame, 'finance-uat-api');

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      await expect(tableRows(tablesPanel)).toHaveCount(105, { timeout: 15000 });
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveCount(0);

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });
      await clickWithFallback(sqlEditorTab);
      await replaceActiveSqlEditorText(session.window, 'select * from DEMO_APP LIMIT 100');
      await selectActiveSqlEditorText(session.window);
      await runActiveSqlEditorAndWaitForNewResult(session.window);

      const resultFrame = await resolveSqlResultFrame(session.window, 20000);
      await expect(resultFrame.getByText('Table: Demo_App')).toBeVisible();
      await expect(resultFrame.getByText('Execution Error')).toHaveCount(0);
      await expect(resultFrame.getByRole('table')).toBeVisible();
      await expect(
        resultFrame
          .getByRole('cell')
          .filter({ hasText: /select \* from "TEST_SCHEMA"\."DEMO_APP" LIMIT 100/i })
          .first()
      ).toBeVisible();
      await expect(
        resultFrame
          .getByRole('cell')
          .filter({ hasText: /select \* from DEMO_APP LIMIT 100/i })
          .first()
      ).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can save an app SQL editor and run a mutating statement to a status result', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await selectSqlApp(webviewFrame, 'finance-uat-api');
      await expect(webviewFrame.locator('[data-role="hana-tables-count"]')).toHaveText('105', {
        timeout: 15000,
      });

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });
      await clickWithFallback(sqlEditorTab);

      const expectedSqlPath = resolveExpectedSqlFilePath(
        session.workspaceDir,
        'finance-uat-api'
      );
      const savedSql = await saveActiveSqlEditor(session.window, expectedSqlPath);
      expect(savedSql).toContain('-- SAP Tools SQL for finance-uat-api');
      await expect(session.window.getByText(/Unable to write file/i)).toHaveCount(0);

      await replaceActiveSqlEditorText(
        session.window,
        'update "TEST_SCHEMA"."DEMO_APP" set CREATED_BY = \'system\' where ID = \'532806ba-15a1-4a0f-9321-31b62d691130\';'
      );
      await selectActiveSqlEditorText(session.window);

      const resultTabsBeforeRun = await session.window
        .getByRole('tab', { name: /SAP Tools SQL Result/i })
        .count();
      await runActiveSqlEditorCommand(session.window);
      await expect(
        session.window.getByText(/Run mutating SQL statement for app "finance-uat-api"/)
      ).toHaveCount(0, { timeout: 1000 });
      await expect(session.window.getByRole('button', { name: 'Run SQL' })).toHaveCount(0, {
        timeout: 1000,
      });
      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(resultTabsBeforeRun + 1);

      const resultFrame = await resolveSqlResultFrame(session.window, 20000);
      await expect(resultFrame.getByText('Table: Demo_App')).toBeVisible();
      await expect(resultFrame.getByText('App: finance-uat-api')).toHaveCount(0);
      await expect(resultFrame.getByText(/^Executed: /i)).toHaveCount(0);
      await expect(
        resultFrame.getByRole('heading', { name: 'Statement Executed' })
      ).toBeVisible();
      await expect(resultFrame.getByText('Statement executed in SAP Tools test mode.')).toBeVisible();
      await expect(resultFrame.getByText('Execution Error')).toHaveCount(0);
      await expect(resultFrame.getByText(/hdb exec failed/i)).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can view readable JSON text returned from SQL results', async () => {
    const session = await launchExtensionHost();
    const expectedPayload =
      '{"status":"Success","message":"This is mock data for testing","timestamp":"2026-04-08T03:10:07.482Z"}';

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await selectSqlApp(webviewFrame, 'finance-uat-api');
      await expect(webviewFrame.locator('[data-role="hana-tables-count"]')).toHaveText('105', {
        timeout: 15000,
      });

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });
      await clickWithFallback(sqlEditorTab);
      await replaceActiveSqlEditorText(
        session.window,
        'SELECT SAMPLE_JSON_PAYLOAD FROM Demo_App LIMIT 100;'
      );
      await selectActiveSqlEditorText(session.window);

      const resultTabsBeforeRun = await session.window
        .getByRole('tab', { name: /SAP Tools SQL Result/i })
        .count();
      await runActiveSqlEditorCommand(session.window);
      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(resultTabsBeforeRun + 1)
        .catch(async () => {
          await runWorkbenchCommand(session.window, 'Run HANA SQL');
          await expect
            .poll(
              async () => {
                return session.window
                  .getByRole('tab', { name: /SAP Tools SQL Result/i })
                  .count();
              },
              { timeout: 20000 }
            )
            .toBe(resultTabsBeforeRun + 1);
        });

      const resultFrame = await resolveSqlResultFrame(session.window, 20000);
      await expect(resultFrame.getByText('Table: Demo_App')).toBeVisible();
      await expect(resultFrame.getByText('App: finance-uat-api')).toHaveCount(0);
      await expect(resultFrame.getByText(/^Executed: /i)).toHaveCount(0);
      await expect(resultFrame.getByRole('table')).toBeVisible();
      await expect(resultFrame.getByRole('cell', { name: expectedPayload })).toBeVisible();
      await expect(resultFrame.getByText('0x7b2273746174757322')).toHaveCount(0);

      const exportButton = resultFrame.getByRole('button', { name: 'Export result' });
      await clickWithFallback(exportButton);
      await clickWithFallback(resultFrame.getByRole('menuitem', { name: 'Copy JSON' }));
      const jsonClipboardText = await waitForElectronClipboardText(
        session.electronApp,
        (text) => {
          try {
            JSON.parse(text);
            return text.includes('SAMPLE_JSON_PAYLOAD');
          } catch {
            return false;
          }
        }
      );
      const parsedJson = JSON.parse(jsonClipboardText) as unknown;
      expect(parsedJson).toEqual([
        {
          APP_NAME: 'finance-uat-api',
          CURRENT_SCHEMA: 'TEST_SCHEMA',
          SAMPLE_JSON_PAYLOAD: expectedPayload,
        },
      ]);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can copy a SQL result row object and cell value from the context menu', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await selectSqlApp(webviewFrame, 'finance-uat-api');
      await expect(webviewFrame.locator('[data-role="hana-tables-count"]')).toHaveText('105', {
        timeout: 15000,
      });

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });
      await clickWithFallback(sqlEditorTab);
      await replaceActiveSqlEditorText(
        session.window,
        'SELECT CURRENT_USER, CURRENT_SCHEMA FROM DUMMY;'
      );
      await selectActiveSqlEditorText(session.window);

      const resultTabsBeforeRun = await session.window
        .getByRole('tab', { name: /SAP Tools SQL Result/i })
        .count();
      await runActiveSqlEditorCommand(session.window);
      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(resultTabsBeforeRun + 1)
        .catch(async () => {
          await runWorkbenchCommand(session.window, 'Run HANA SQL');
          await expect
            .poll(
              async () => {
                return session.window
                  .getByRole('tab', { name: /SAP Tools SQL Result/i })
                  .count();
              },
              { timeout: 20000 }
            )
            .toBe(resultTabsBeforeRun + 1);
        });

      const resultFrame = await resolveSqlResultFrame(session.window, 20000);
      const schemaCell = resultFrame.getByRole('cell', { name: 'TEST_SCHEMA', exact: true });
      await expect(schemaCell).toBeVisible();
      await schemaCell.click({ button: 'right' });
      await expect(resultFrame.getByRole('menu')).toBeVisible();
      await expect(resultFrame.getByRole('menuitem', { name: 'Copy row object' })).toBeVisible();
      await expect(resultFrame.getByRole('menuitem', { name: 'Copy cell value' })).toBeVisible();

      await schemaCell.hover();
      const hoveredBackground = await schemaCell.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('SQL result cell is missing.');
        }
        return window.getComputedStyle(element).backgroundColor;
      });
      expect(hoveredBackground).not.toBe('rgba(0, 0, 0, 0)');

      await clickWithFallback(resultFrame.getByRole('menuitem', { name: 'Copy row object' }));
      await expect(resultFrame.getByRole('menu')).toHaveCount(0);
      const rowObjectClipboardText = await waitForElectronClipboardText(
        session.electronApp,
        (text) => text.includes('"CURRENT_SCHEMA": "TEST_SCHEMA"')
      );
      const parsedRowObject = JSON.parse(rowObjectClipboardText) as unknown;
      expect(parsedRowObject).toEqual({
        APP_NAME: 'finance-uat-api',
        CURRENT_SCHEMA: 'TEST_SCHEMA',
        EXECUTED_SQL: 'SELECT CURRENT_USER, CURRENT_SCHEMA FROM DUMMY LIMIT 100',
      });
      expect(rowObjectClipboardText).toContain('\n  "CURRENT_SCHEMA": "TEST_SCHEMA"');

      await schemaCell.click({ button: 'right' });
      await clickWithFallback(resultFrame.getByRole('menuitem', { name: 'Copy cell value' }));
      await expect(resultFrame.getByRole('menu')).toHaveCount(0);
      const cellClipboardText = await waitForElectronClipboardText(
        session.electronApp,
        (text) => text === 'TEST_SCHEMA'
      );
      expect(cellClipboardText).toBe('TEST_SCHEMA');
      await expect(resultFrame.getByText('copied to clipboard')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can search selected app tables and run a quick SELECT', async () => {
    const session = await launchExtensionHost({
      extraEnv: { SAP_TOOLS_E2E_QUICK_SELECT_DELAY_MS: '2500' },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await selectSqlApp(webviewFrame, 'finance-uat-api');

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      await expect(tablesPanel).toBeVisible({ timeout: 15000 });
      await expect(tablesPanel.getByRole('heading', { name: /Tables · finance-uat-api/i })).toBeVisible();
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('105');

      const searchInput = tablesPanel.getByRole('searchbox', { name: 'Search tables' });
      await expect(searchInput).toBeEnabled();
      await expect(tableRows(tablesPanel)).toHaveCount(105, { timeout: 15000 });
      await expect(tablesPanel.getByRole('button', { name: /^Select first 100 rows of / })).toHaveCount(105);
      await tablesPanel.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('Tables panel is missing.');
        }
        element.style.width = '360px';
        element.style.maxWidth = '360px';
        element.style.justifySelf = 'start';
        window.dispatchEvent(new Event('resize'));
      });
      await expect(
        tablesPanel.locator('[data-role="hana-table-name"].is-middle-truncated').first()
      ).toBeVisible();

      const defaultTableNameLayout = await tablesPanel.evaluate((element) => {
        const ellipsisLefts: number[] = [];
        const truncatedNames = Array.from(
          element.querySelectorAll('[data-role="hana-table-name"].is-middle-truncated')
        );
        for (const nameElement of truncatedNames) {
          const ellipsis = nameElement.querySelector('.sql-table-name-ellipsis');
          if (ellipsis instanceof HTMLElement) {
            ellipsisLefts.push(Math.round(ellipsis.getBoundingClientRect().left));
          }
          if (ellipsisLefts.length >= 3) {
            break;
          }
        }
        const ellipsisLeftRange =
          ellipsisLefts.length > 0
            ? Math.max(...ellipsisLefts) - Math.min(...ellipsisLefts)
            : Number.NaN;
        return {
          ellipsisCount: ellipsisLefts.length,
          ellipsisLeftRange,
          truncatedCount: truncatedNames.length,
        };
      });
      expect(defaultTableNameLayout.truncatedCount).toBeGreaterThanOrEqual(3);
      expect(defaultTableNameLayout.ellipsisCount).toBeGreaterThanOrEqual(3);
      expect(defaultTableNameLayout.ellipsisLeftRange).toBeLessThanOrEqual(1);

      const readableTableName = 'DEMO_PURCHASEORDERITEMMAPPING';
      await searchInput.click();
      await searchInput.pressSequentially('PurchaseOrder');
      await expect(searchInput).toHaveValue('PurchaseOrder');
      await expect(searchInput).toBeFocused();
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('1/105');
      await expect(tableRows(tablesPanel)).toHaveCount(1);

      const readableTableRow = tablesPanel.locator(`[data-full-table-name="${readableTableName}"]`);
      await expect(readableTableRow).toBeVisible();
      await expect(readableTableRow).toHaveAttribute('title', readableTableName);
      await expect(readableTableRow).toHaveAttribute('data-table-name', readableTableName);
      const readableTableNameElement = readableTableRow.locator('[data-role="hana-table-name"]');
      await expect(readableTableNameElement).toHaveAttribute(
        'data-full-display-name',
        'Demo_PurchaseOrderItemMapping'
      );
      const readableTableLayout = await readableTableNameElement.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('Table name is missing.');
        }
        return {
          scrollWidth: element.scrollWidth,
          text: element.innerText,
          width: element.clientWidth,
        };
      });
      expect(readableTableLayout.text.startsWith('Demo_Purchase')).toBe(true);
      expect(readableTableLayout.text.endsWith('ItemMapping')).toBe(true);
      expect(readableTableLayout.scrollWidth).toBeLessThanOrEqual(readableTableLayout.width);

      const productTableName = 'DEMO_BUSINESSAPP_TEST';
      await searchInput.fill('BusinessApp');
      await expect(searchInput).toHaveValue('BusinessApp');
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('1/105');
      const productTableRow = tablesPanel.locator(`[data-full-table-name="${productTableName}"]`);
      await expect(productTableRow).toBeVisible();
      await expect(productTableRow.locator('[data-role="hana-table-name"]')).not.toHaveClass(
        /is-middle-truncated/
      );
      await expect(productTableRow.locator('.sql-table-name-full')).toHaveText(
        'Demo_BusinessApp_Test'
      );

      const longTableName =
        'FINANCE_UAT_API_I_BUSINESSPARTNERBANK_0001_TO_SUPPLIERINVOICEPAYMENTBLOCKREASON';
      const longTableFullDisplayName =
        'Finance_UAT_API_I_BusinessPartnerBank_0001_To_SupplierInvoicePaymentBlockReason';
      await searchInput.fill('BusinessPartnerBank');
      await expect(searchInput).toHaveValue('BusinessPartnerBank');
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('1/105');
      await expect(tableRows(tablesPanel)).toHaveCount(1);

      const longTableRow = tablesPanel.locator(`[data-full-table-name="${longTableName}"]`);
      await expect(longTableRow).toBeVisible();
      await expect(longTableRow).toHaveAttribute('title', longTableName);
      await expect(longTableRow).toHaveAttribute('aria-label', `Table ${longTableName}`);
      const longTableNameElement = longTableRow.locator('[data-role="hana-table-name"]');
      await expect(longTableNameElement).toHaveClass(/is-middle-truncated/);
      const narrowTableDisplayName = await longTableNameElement.innerText();
      expect(narrowTableDisplayName.startsWith('Finance_UAT_API')).toBe(true);
      expect(narrowTableDisplayName).toContain('…');
      expect(narrowTableDisplayName.endsWith('BlockReason')).toBe(true);
      const longTableNameLayout = await longTableNameElement.evaluate((element) => {
        const styles = window.getComputedStyle(element);
        const row = element.closest('[data-role="hana-table-row"]');
        const selectButton = row?.querySelector('[data-action="run-hana-table-select"]');
        if (!(row instanceof HTMLElement) || !(selectButton instanceof HTMLElement)) {
          throw new Error('Table row or select button is missing.');
        }
        const rowBox = row.getBoundingClientRect();
        const rowStyles = window.getComputedStyle(row);
        const nameBox = element.getBoundingClientRect();
        const selectBox = selectButton.getBoundingClientRect();
        const rowContentRight =
          rowBox.right -
          Number.parseFloat(rowStyles.borderRightWidth) -
          Number.parseFloat(rowStyles.paddingRight);
        return {
          clientWidth: element.clientWidth,
          nameRightGap: rowContentRight - nameBox.right,
          selectOverlapsName: selectBox.left < nameBox.right,
          selectWidth: selectBox.width,
          scrollWidth: element.scrollWidth,
          textOverflow: styles.textOverflow,
        };
      });
      expect(longTableNameLayout.textOverflow).toBe('clip');
      expect(longTableNameLayout.scrollWidth).toBeLessThanOrEqual(
        longTableNameLayout.clientWidth
      );
      expect(longTableNameLayout.nameRightGap).toBeLessThanOrEqual(2);
      expect(longTableNameLayout.selectOverlapsName).toBe(true);
      expect(longTableNameLayout.selectWidth).toBeGreaterThan(0);

      await tablesPanel.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('Tables panel is missing.');
        }
        element.style.width = '1120px';
        element.style.maxWidth = '1120px';
        window.dispatchEvent(new Event('resize'));
      });
      await expect(longTableNameElement).not.toHaveClass(/is-middle-truncated/);
      await expect(longTableNameElement.locator('.sql-table-name-full')).toHaveText(
        longTableFullDisplayName
      );
      const wideTableNameLayout = await longTableNameElement.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('Table name is missing.');
        }
        const row = element.closest('[data-role="hana-table-row"]');
        const selectButton = row?.querySelector('[data-action="run-hana-table-select"]');
        if (!(row instanceof HTMLElement) || !(selectButton instanceof HTMLElement)) {
          throw new Error('Table row or select button is missing.');
        }
        const nameBox = element.getBoundingClientRect();
        const selectBox = selectButton.getBoundingClientRect();
        return {
          clientWidth: element.clientWidth,
          hasMiddleEllipsis: element.innerText.includes('…'),
          nameRightGap: row.getBoundingClientRect().right -
            Number.parseFloat(window.getComputedStyle(row).borderRightWidth) -
            Number.parseFloat(window.getComputedStyle(row).paddingRight) -
            nameBox.right,
          scrollWidth: element.scrollWidth,
          selectOverlapsName: selectBox.left < nameBox.right,
          selectButtonWidth: selectBox.width,
        };
      });
      expect(wideTableNameLayout.hasMiddleEllipsis).toBe(false);
      expect(wideTableNameLayout.scrollWidth).toBeLessThanOrEqual(
        wideTableNameLayout.clientWidth
      );
      expect(wideTableNameLayout.selectButtonWidth).toBeGreaterThan(0);
      expect(wideTableNameLayout.nameRightGap).toBeLessThanOrEqual(2);
      expect(wideTableNameLayout.selectOverlapsName).toBe(true);

      const resizeMutationSnapshot = await longTableNameElement.evaluate(async (element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('Table name is missing.');
        }
        const tablesPanelElement = element.closest('[data-role="hana-tables-panel"]');
        if (!(tablesPanelElement instanceof HTMLElement)) {
          throw new Error('Tables panel is missing.');
        }
        let characterMutationCount = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === 'childList' || record.type === 'characterData') {
              characterMutationCount += 1;
            }
          }
        });
        const waitForTwoFrames = async (): Promise<void> => {
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                resolve();
              });
            });
          });
        };
        observer.observe(element, {
          characterData: true,
          childList: true,
          subtree: true,
        });
        tablesPanelElement.style.width = '720px';
        tablesPanelElement.style.maxWidth = '720px';
        window.dispatchEvent(new Event('resize'));
        await waitForTwoFrames();
        tablesPanelElement.style.width = '1120px';
        tablesPanelElement.style.maxWidth = '1120px';
        window.dispatchEvent(new Event('resize'));
        await waitForTwoFrames();
        observer.disconnect();
        return {
          characterMutationCount,
          text: element.innerText,
        };
      });
      expect(resizeMutationSnapshot.characterMutationCount).toBe(0);
      expect(resizeMutationSnapshot.text).toContain('Finance_UAT_API');
      await tablesPanel.evaluate((element) => {
        if (element instanceof HTMLElement) {
          element.style.width = '';
          element.style.maxWidth = '';
          element.style.justifySelf = '';
        }
        window.dispatchEvent(new Event('resize'));
      });

      await searchInput.fill('');
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('105');
      await expect(tableRows(tablesPanel)).toHaveCount(105);
      const tablesList = tablesPanel.locator('[data-role="hana-tables-list"]');
      const targetTableName = 'FINANCE_UAT_API_ENTITY_090';
      const targetDisplayTableName = 'Finance_UAT_API_Entity_090';
      const targetTableRow = tablesPanel.locator(
        `[data-role="hana-table-row"][data-table-name="${targetTableName}"]`
      );
      await expect(targetTableRow).toBeVisible();
      await expect(targetTableRow.locator('[data-role="hana-table-name"]')).toHaveCSS(
        'pointer-events',
        'none'
      );
      const targetSelectButton = targetTableRow.getByRole('button', {
        name: `Select first 100 rows of ${targetTableName}`,
      });
      await expect(targetSelectButton).toHaveCSS('opacity', '0');
      await expect(targetSelectButton).toHaveCSS('pointer-events', 'none');

      const sqlEditorTab = session.window.getByRole('tab', {
        name: /finance-uat-api\.sql/i,
      });
      await expect(sqlEditorTab).toBeVisible({ timeout: 15000 });

      const initialResultTabs = session.window.getByRole('tab', {
        name: /SAP Tools SQL Result/i,
      });
      const initialResultCount = await initialResultTabs.count();
      const editorGroupCountBeforeFirstQuickSelect = await readVisibleEditorGroupCount(
        session.window
      );

      await installSqlWorkbenchTextRecorder(webviewFrame);
      await targetTableRow.scrollIntoViewIfNeeded();
      const scrollTopBeforeQuickSelect = await tablesList.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('Tables list is missing.');
        }
        return element.scrollTop;
      });
      expect(scrollTopBeforeQuickSelect).toBeGreaterThan(0);
      await targetTableRow.hover();
      await expect(targetSelectButton).toHaveCSS('opacity', '1');
      await expect(targetSelectButton).toHaveCSS('pointer-events', 'auto');
      await clickWithFallback(targetSelectButton);
      const targetSelectAction = targetTableRow.locator(
        '[data-action="run-hana-table-select"]'
      );
      await expect(targetTableRow).toHaveClass(/is-select-loading/);
      await expect(targetSelectAction).toHaveClass(/is-loading/);
      await expect(targetSelectAction).toHaveAttribute(
        'aria-label',
        `Loading first 100 rows of ${targetTableName}`
      );
      await expect(targetSelectAction).toHaveAttribute('aria-busy', 'true');
      await expect(targetSelectAction).toBeDisabled();
      await expect(targetSelectAction.locator('.sql-table-select-spinner')).toBeVisible();

      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { intervals: [100, 150, 250], timeout: 1000 }
        )
        .toBe(initialResultCount + 1);

      const loadingResultFrame = await resolveSqlResultFrame(session.window, 3000);
      await expect(
        loadingResultFrame.getByRole('status').filter({ hasText: 'Running SQL query' })
      ).toBeVisible();
      await expect(loadingResultFrame.locator('.result-loading-spinner')).toBeVisible();
      await expect(loadingResultFrame.getByRole('table')).toHaveCount(0);

      const secondTargetTableName = 'FINANCE_UAT_API_ENTITY_091';
      const secondTargetTableRow = tablesPanel.locator(
        `[data-role="hana-table-row"][data-table-name="${secondTargetTableName}"]`
      );
      await expect(secondTargetTableRow).toBeVisible();
      await secondTargetTableRow.hover();
      await expect(targetSelectAction).toHaveCSS('opacity', '1');
      await expect(targetSelectAction).toHaveCSS('pointer-events', 'auto');

      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(initialResultCount + 1);
      const editorGroupCountAfterFirstQuickSelect = await readVisibleEditorGroupCount(
        session.window
      );
      if (editorGroupCountBeforeFirstQuickSelect === 1) {
        expect(editorGroupCountAfterFirstQuickSelect).toBe(2);
      } else {
        expect(editorGroupCountAfterFirstQuickSelect).toBe(
          editorGroupCountBeforeFirstQuickSelect
        );
      }

      await expect
        .poll(
          async () => {
            return tablesList.evaluate((element) => {
              if (!(element instanceof HTMLElement)) {
                throw new Error('Tables list is missing.');
              }
              return element.scrollTop;
            });
          },
          { timeout: 10000 }
        )
        .toBeGreaterThanOrEqual(scrollTopBeforeQuickSelect - 2);
      const sqlWorkbenchTextRecords = await readSqlWorkbenchTextRecords(webviewFrame);
      expect(sqlWorkbenchTextRecords.join('\n')).not.toContain('Running SELECT *');
      await expect(targetTableRow).not.toHaveClass(/is-select-loading/);
      await expect(targetSelectAction).not.toHaveClass(/is-loading/);
      await expect(targetSelectAction).toHaveAttribute('aria-busy', 'false');
      await expect(targetSelectAction).toHaveAttribute(
        'aria-label',
        `Select first 100 rows of ${targetTableName}`
      );
      await expect(targetSelectAction).toBeEnabled();
      await expect(targetSelectAction.locator('.sql-table-select-spinner')).toBeHidden();
      await expect(targetSelectAction).toHaveCSS('pointer-events', 'none');

      const resultFrame = await resolveSqlResultFrame(session.window, 20000);
      await expect(
        resultFrame.getByRole('heading', { name: 'SAP Tools SQL Result' })
      ).toHaveCount(0);
      await expect(resultFrame.getByText(`Table: ${targetDisplayTableName}`)).toBeVisible();
      await expect(resultFrame.getByText('App: finance-uat-api')).toHaveCount(0);
      await expect(resultFrame.getByText(/^Executed: /i)).toHaveCount(0);
      await expect(resultFrame.getByRole('table')).toBeVisible();
      await expect(
        resultFrame.getByRole('cell', { name: 'TEST_SCHEMA', exact: true })
      ).toBeVisible();

      const exportButton = resultFrame.getByRole('button', { name: 'Export result' });
      await expect(exportButton).toBeVisible();
      await expect(exportButton).toHaveAttribute('aria-expanded', 'false');
      await clickWithFallback(exportButton);
      await expect(exportButton).toHaveAttribute('aria-expanded', 'true');
      await expect(resultFrame.getByRole('menuitem', { name: 'Copy CSV' })).toBeVisible();
      await expect(resultFrame.getByRole('menuitem', { name: 'Copy JSON' })).toBeVisible();
      await expect(resultFrame.getByRole('menuitem', { name: 'Export CSV' })).toBeVisible();
      await expect(resultFrame.getByRole('menuitem', { name: 'Export JSON' })).toBeVisible();

      await clickWithFallback(resultFrame.getByRole('menuitem', { name: 'Copy CSV' }));
      await expect(resultFrame.getByText('CSV copied to clipboard.')).toHaveCount(0);
      const csvClipboardText = await waitForElectronClipboardText(
        session.electronApp,
        (text) =>
          text.includes('APP_NAME,CURRENT_SCHEMA,EXECUTED_SQL') &&
          text.includes('finance-uat-api,TEST_SCHEMA')
      );
      expect(csvClipboardText).toContain('APP_NAME,CURRENT_SCHEMA,EXECUTED_SQL');
      expect(csvClipboardText).toContain('finance-uat-api,TEST_SCHEMA');

      await clickWithFallback(exportButton);
      await clickWithFallback(resultFrame.getByRole('menuitem', { name: 'Copy JSON' }));
      await expect(resultFrame.getByText('JSON copied to clipboard.')).toHaveCount(0);
      const jsonClipboardText = await waitForElectronClipboardText(
        session.electronApp,
        (text) => {
          try {
            JSON.parse(text);
            return text.includes('EXECUTED_SQL');
          } catch {
            return false;
          }
        }
      );
      const parsedJson = JSON.parse(jsonClipboardText) as unknown;
      expect(parsedJson).toEqual([
        {
          APP_NAME: 'finance-uat-api',
          CURRENT_SCHEMA: 'TEST_SCHEMA',
          EXECUTED_SQL: `SELECT * FROM "TEST_SCHEMA"."${targetTableName}" LIMIT 100`,
        },
      ]);

      const secondTargetSelectButton = secondTargetTableRow.getByRole('button', {
        name: `Select first 100 rows of ${secondTargetTableName}`,
      });
      const resultCountBeforeSecondQuickSelect = await session.window
        .getByRole('tab', { name: /SAP Tools SQL Result/i })
        .count();
      const editorGroupCountBeforeSecondQuickSelect = await readVisibleEditorGroupCount(
        session.window
      );
      await secondTargetTableRow.scrollIntoViewIfNeeded();
      await secondTargetTableRow.hover();
      await expect(secondTargetSelectButton).toHaveCSS('pointer-events', 'auto');
      await clickWithFallback(secondTargetSelectButton);
      await expect
        .poll(
          async () => {
            return session.window
              .getByRole('tab', { name: /SAP Tools SQL Result/i })
              .count();
          },
          { timeout: 20000 }
        )
        .toBe(resultCountBeforeSecondQuickSelect + 1);
      await expect
        .poll(
          async () => {
            return readVisibleEditorGroupCount(session.window);
          },
          { timeout: 10000 }
        )
        .toBe(editorGroupCountBeforeSecondQuickSelect);

      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden({
        timeout: 10000,
      });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use SQL workbench with bounded app and table lists', async () => {
    const session = await launchExtensionHost({
      extraEnv: { SAP_TOOLS_E2E_SQL_MANY_APPS: '1' },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await expect(webviewFrame.locator('.sql-service-row')).toHaveCount(12);

      await selectSqlApp(webviewFrame, 'finance-uat-api');

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      await expect(tableRows(tablesPanel)).toHaveCount(105, { timeout: 15000 });

      const layoutSnapshot = await webviewFrame.locator('body').evaluate(() => {
        const readElement = (selector: string): HTMLElement => {
          const element = document.querySelector<HTMLElement>(selector);
          if (element === null) {
            throw new Error(`${selector} is missing`);
          }
          return element;
        };
        const workbench = readElement('.sql-workbench');
        const serviceList = readElement('[data-role="hana-service-list"]');
        const tablesPanelElement = readElement('[data-role="hana-tables-panel"]');
        const tablesList = readElement('[data-role="hana-tables-list"]');
        const firstTableRow = readElement('[data-role="hana-table-row"]');
        const firstServiceName = readElement('.sql-service-name');
        const selectedDatabaseHeading = readElement('.sql-tables-head h3');
        const firstTableName = readElement('[data-role="hana-table-name"]');
        const tableSearch = readElement('[data-role="sql-table-search"]');
        const searchIcon = readElement('.sql-table-search-row .search-input-icon');
        const searchStyles = window.getComputedStyle(tableSearch);
        const iconStyles = window.getComputedStyle(searchIcon);
        const serviceNameStyles = window.getComputedStyle(firstServiceName);
        const selectedDatabaseHeadingStyles = window.getComputedStyle(selectedDatabaseHeading);
        const tableNameStyles = window.getComputedStyle(firstTableName);

        return {
          firstTableRowHeight: firstTableRow.getBoundingClientRect().height,
          heightRatio: workbench.getBoundingClientRect().height /
            tablesPanelElement.getBoundingClientRect().height,
          selectedDatabaseHeadingText: selectedDatabaseHeading.textContent.trim(),
          selectedDatabaseHeadingFontFamily: selectedDatabaseHeadingStyles.fontFamily,
          selectedDatabaseHeadingFontSize: selectedDatabaseHeadingStyles.fontSize,
          selectedDatabaseHeadingFontWeight: selectedDatabaseHeadingStyles.fontWeight,
          selectedDatabaseHeadingLineHeight: selectedDatabaseHeadingStyles.lineHeight,
          serviceNameFontFamily: serviceNameStyles.fontFamily,
          serviceNameFontSize: serviceNameStyles.fontSize,
          serviceNameFontWeight: serviceNameStyles.fontWeight,
          tableNameFontFamily: tableNameStyles.fontFamily,
          tableNameFontSize: tableNameStyles.fontSize,
          tableNameFontWeight: tableNameStyles.fontWeight,
          tableNameLineHeight: tableNameStyles.lineHeight,
          tableNamePaddingBottom: window.getComputedStyle(
            firstTableRow.querySelector('[data-role="hana-table-name"]') ?? firstTableRow
          ).paddingBottom,
          tableNamePaddingTop: window.getComputedStyle(
            firstTableRow.querySelector('[data-role="hana-table-name"]') ?? firstTableRow
          ).paddingTop,
          serviceListCanScroll: serviceList.scrollHeight > serviceList.clientHeight,
          tableSearchHeight: tableSearch.getBoundingClientRect().height,
          tableSearchPaddingLeft: searchStyles.paddingLeft,
          tablesListCanScroll: tablesList.scrollHeight > tablesList.clientHeight,
          workbenchHeight: workbench.getBoundingClientRect().height,
          tablesPanelHeight: tablesPanelElement.getBoundingClientRect().height,
          iconLeft: iconStyles.left,
        };
      });

      expect(layoutSnapshot.workbenchHeight).toBeGreaterThan(100);
      expect(layoutSnapshot.tablesPanelHeight).toBeGreaterThan(100);
      expect(layoutSnapshot.heightRatio).toBeGreaterThan(0.95);
      expect(layoutSnapshot.heightRatio).toBeLessThan(1.05);
      expect(layoutSnapshot.serviceListCanScroll).toBe(true);
      expect(layoutSnapshot.tablesListCanScroll).toBe(true);
      expect(layoutSnapshot.firstTableRowHeight).toBeLessThanOrEqual(30);
      expect(layoutSnapshot.tableNameFontFamily).toBe(layoutSnapshot.serviceNameFontFamily);
      expect(layoutSnapshot.tableNameFontSize).toBe(layoutSnapshot.serviceNameFontSize);
      expect(layoutSnapshot.tableNameFontWeight).toBe(layoutSnapshot.serviceNameFontWeight);
      expect(layoutSnapshot.selectedDatabaseHeadingText).toContain('finance-uat-api');
      expect(layoutSnapshot.tableNameFontFamily).toBe(
        layoutSnapshot.selectedDatabaseHeadingFontFamily
      );
      expect(layoutSnapshot.tableNameFontSize).toBe(layoutSnapshot.selectedDatabaseHeadingFontSize);
      expect(layoutSnapshot.tableNameFontWeight).toBe(
        layoutSnapshot.selectedDatabaseHeadingFontWeight
      );
      expect(layoutSnapshot.tableNameLineHeight).toBe(
        layoutSnapshot.selectedDatabaseHeadingLineHeight
      );
      expect(layoutSnapshot.tableNamePaddingTop).toBe('3px');
      expect(layoutSnapshot.tableNamePaddingBottom).toBe('3px');
      expect(layoutSnapshot.tableSearchHeight).toBeGreaterThanOrEqual(30);
      expect(layoutSnapshot.tableSearchHeight).toBeLessThanOrEqual(32);
      expect(layoutSnapshot.tableSearchPaddingLeft).toBe('31px');
      expect(layoutSnapshot.iconLeft).toBe('12px');
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can select a lower SQL app while preserving the app list position', async () => {
    const session = await launchExtensionHost({
      extraEnv: { SAP_TOOLS_E2E_SQL_MANY_APPS: '1' },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);
      await expect(webviewFrame.locator('.sql-service-row')).toHaveCount(12);

      const serviceList = webviewFrame.getByRole('region', { name: 'Discovered apps' });
      const scrollBeforeSelection = await serviceList.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('SQL service list is missing.');
        }
        element.scrollTop = element.scrollHeight;
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
        };
      });
      expect(scrollBeforeSelection.scrollHeight).toBeGreaterThan(
        scrollBeforeSelection.clientHeight
      );
      expect(scrollBeforeSelection.scrollTop).toBeGreaterThan(0);

      const targetAppName = 'finance-uat-archive';
      await clickWithFallback(webviewFrame.getByRole('button', { name: targetAppName }));
      const scrollAfterSelection = await serviceList.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('SQL service list is missing.');
        }
        return element.scrollTop;
      });
      expect(scrollAfterSelection).toBeGreaterThanOrEqual(
        scrollBeforeSelection.scrollTop - 2
      );

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      await expect(
        tablesPanel.getByRole('heading', { name: /Tables · finance-uat-archive/i })
      ).toBeVisible();
      await expect(tablesPanel.locator('[data-role="hana-tables-count"]')).toHaveText('105', {
        timeout: 15000,
      });
      await expect(tableRows(tablesPanel)).toHaveCount(105);
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);

      const scrollAfterTablesLoaded = await serviceList.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('SQL service list is missing.');
        }
        const selectedRow = element.querySelector('.sql-service-row.is-selected');
        return {
          selectedText: selectedRow instanceof HTMLElement ? selectedRow.innerText.trim() : '',
          scrollTop: element.scrollTop,
        };
      });
      expect(scrollAfterTablesLoaded.selectedText).toContain(targetAppName);
      expect(scrollAfterTablesLoaded.scrollTop).toBeGreaterThanOrEqual(
        scrollBeforeSelection.scrollTop - 2
      );
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see centered loading state while selected app tables load', async () => {
    const session = await launchExtensionHost({
      extraEnv: { SAP_TOOLS_E2E_TESTMODE_TABLES_DELAY_MS: '1200' },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openSqlTabForDefaultScope(webviewFrame);

      await installSqlWorkbenchTextRecorder(webviewFrame);
      await selectSqlApp(webviewFrame, 'finance-uat-api');

      const tablesPanel = webviewFrame.locator('[data-role="hana-tables-panel"]');
      const loadingState = tablesPanel.locator('[data-role="hana-tables-loading"]');
      await expect(loadingState).toBeVisible();
      await expect(loadingState).toHaveText('Loading tables…');
      await expect(loadingState.locator('.sql-tables-spinner')).toBeVisible();
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toHaveText('');
      await expect(webviewFrame.locator('body')).not.toContainText('Opening SQL file for app');
      await expect(tableRows(tablesPanel)).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);

      const loadingSnapshot = await loadingState.evaluate((element) => {
        const list = element.closest('[data-role="hana-tables-list"]');
        if (!(list instanceof HTMLElement)) {
          throw new Error('Tables list is missing.');
        }
        const listBox = list.getBoundingClientRect();
        const loadingBox = element.getBoundingClientRect();
        return {
          centerDelta: Math.abs(
            loadingBox.top + loadingBox.height / 2 - (listBox.top + listBox.height / 2)
          ),
          listClass: list.className,
        };
      });
      expect(loadingSnapshot.centerDelta).toBeLessThanOrEqual(2);
      expect(loadingSnapshot.listClass).toContain('is-loading');

      await expect(tableRows(tablesPanel)).toHaveCount(105, { timeout: 15000 });
      await expect(loadingState).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-error"]')).toHaveCount(0);
      await expect(tablesPanel.locator('[data-role="hana-tables-empty"]')).toHaveCount(0);
      await expect(webviewFrame.locator('[data-role="hana-query-status"]')).toBeHidden();
      const sqlWorkbenchTextRecords = await readSqlWorkbenchTextRecords(webviewFrame);
      expect(sqlWorkbenchTextRecords.join('\n')).not.toContain('Opening SQL file for app');
    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
