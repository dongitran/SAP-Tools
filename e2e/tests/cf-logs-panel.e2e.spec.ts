// cspell:words mdglogid reqid vcap
import { test, expect, type ElectronApplication, type Frame } from '@playwright/test';

import {
  AREA_TO_SELECT,
  REGION_TO_SELECT,
  cleanupExtensionHost,
  clickWithFallback,
  findCfLogsPanelFrame,
  getOrgStageOption,
  launchExtensionHost,
  openCfLogsPanel,
  openCustomSelectionMode,
  openSapToolsSidebar,
  selectDefaultScope,
} from './support/sapToolsHarness';

interface StartedCfLogsSession {
  readonly session: Awaited<ReturnType<typeof launchExtensionHost>>;
  readonly logsFrame: Frame;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function openStartedCfLogsSession(): Promise<StartedCfLogsSession> {
  const session = await launchExtensionHost();
  const sidebarFrame = await openSapToolsSidebar(session.window);
  const logsFrame = await openCfLogsPanel(session.window);
  await selectDefaultScope(sidebarFrame);

  const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
  await expect(confirmButton).toBeEnabled({ timeout: 10000 });
  await clickWithFallback(confirmButton);

  await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
  await clickWithFallback(sidebarFrame.getByRole('button', { name: 'Start App Logging' }));
  await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
    timeout: 10000,
  });

  return { session, logsFrame };
}

async function setCfLogsColumnVisible(
  logsFrame: Frame,
  label: string,
  visible: boolean
): Promise<void> {
  const settingsPanel = logsFrame.locator('#settings-panel');
  if (await settingsPanel.isHidden().catch(() => true)) {
    await clickWithFallback(logsFrame.getByLabel('Column settings'));
    await expect(settingsPanel).toBeVisible({ timeout: 5000 });
  }

  const checkbox = logsFrame
    .locator('#settings-column-toggles .settings-column-item')
    .filter({ hasText: label })
    .locator('input[type="checkbox"]');

  if ((await checkbox.isChecked()) !== visible) {
    await clickWithFallback(checkbox);
  }

  if (visible) {
    await expect(checkbox).toBeChecked();
  } else {
    await expect(checkbox).not.toBeChecked();
  }

  await clickWithFallback(logsFrame.getByLabel('Column settings'));
  await expect(settingsPanel).toBeHidden({ timeout: 5000 });
}

async function getActiveCfLogsAppName(logsFrame: Frame): Promise<string> {
  const appName = await logsFrame
    .getByLabel('Select app')
    .evaluate((element) => (element instanceof HTMLSelectElement ? element.value : ''));
  expect(appName.length).toBeGreaterThan(0);
  return appName;
}

async function appendCfLogsLines(logsFrame: Frame, lines: string[]): Promise<void> {
  const appName = await getActiveCfLogsAppName(logsFrame);
  await logsFrame.evaluate(
    ({ targetApp, logLines }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'sapTools.logsAppend',
            appName: targetApp,
            lines: logLines,
          },
        })
      );
    },
    { targetApp: appName, logLines: lines }
  );
}

async function expectSingleRequestText(
  logsFrame: Frame,
  searchTerm: string,
  expectedText: string
): Promise<void> {
  await logsFrame.getByLabel('Search logs').fill(searchTerm);
  await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
    timeout: 5000,
  });
  await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
  await expect(
    logsFrame.locator('#log-table-body tr').first().locator('td.cell-request .cell-request-text')
  ).toHaveText(expectedText);
}

async function readElectronClipboardText(
  electronApp: ElectronApplication
): Promise<string> {
  return electronApp.evaluate((electron): string => {
    const electronRecord = electron as Record<string, unknown>;
    const clipboard = electronRecord['clipboard'];
    if (typeof clipboard !== 'object' || clipboard === null || Array.isArray(clipboard)) {
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

test.describe('SAP Tools CF logs panel', () => {
  test('User can open CF logs panel with table and filter controls', async () => {
    const session = await launchExtensionHost();

    try {
      await openSapToolsSidebar(session.window);
      const frame = await openCfLogsPanel(session.window);

      // Log table should be rendered.
      await expect(frame.locator('.cf-log-table')).toBeVisible({ timeout: 10000 });

      // All three filter controls should be visible.
      await expect(frame.getByLabel('Search logs')).toBeVisible();
      await expect(frame.getByLabel('Filter by level')).toBeVisible();
      await expect(frame.getByLabel('Select app')).toBeVisible();

      // Initially no scope selected: empty-state row should be shown.
      await expect(
        frame.locator('#log-table-body td.empty-row')
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can keep CF logs app selector empty until app logging starts', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      // Select a scope so the extension sends apps catalog to the panel.
      await selectDefaultScope(sidebarFrame);

      // Until Start App Logging is triggered from sidebar workspace,
      // panel app selector should remain disabled.
      const appSelect = logsFrame.getByLabel('Select app');
      await expect(appSelect).toBeDisabled({ timeout: 10000 });
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toBeVisible({
        timeout: 10000,
      });
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toContainText(
        /Start App Logging/i
      );
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can choose only apps started for logging in CF logs panel', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await expect(
        sidebarFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-worker'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      const appSelect = logsFrame.getByLabel('Select app');
      await expect(appSelect).toBeEnabled({ timeout: 10000 });
      await expect
        .poll(
          async () => appSelect.locator('option').count(),
          { timeout: 15000 }
        ).toBe(2);

      const optionTexts = await appSelect.locator('option').allTextContents();
      expect(optionTexts.some((text) => text.includes('finance-uat-api'))).toBe(true);
      expect(optionTexts.some((text) => text.includes('finance-uat-worker'))).toBe(true);
      expect(optionTexts.some((text) => text.includes('finance-uat-audit'))).toBe(false);

      // Logs should be loaded for one of the selected active apps.
      await expect(
        logsFrame.locator('#log-table-body td.empty-row')
      ).toBeHidden({ timeout: 10000 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can read compact endpoint events while raw log messages stay hidden', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      await expect(logsFrame.locator('#log-table-head th.col-message')).toHaveCount(0);

      const requestCell = logsFrame.locator('#log-table-body td.cell-request .cell-request-text').first();
      await expect(requestCell).toBeVisible({ timeout: 10000 });

      const requestCellStyle = await requestCell.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow,
          overflowWrap: style.overflowWrap,
          wordBreak: style.wordBreak,
        };
      });

      expect(requestCellStyle.whiteSpace).toBe('nowrap');
      expect(requestCellStyle.textOverflow).toBe('ellipsis');
      expect(requestCellStyle.overflowWrap).toBe('anywhere');
      expect(requestCellStyle.wordBreak).toBe('normal');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can read clock-only timestamps in CF logs panel', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const firstTimeCell = logsFrame.locator('#log-table-body tr td').first();
      await expect(firstTimeCell).toBeVisible({ timeout: 10000 });
      await expect(firstTimeCell).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can copy a CF log row message by clicking the row', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      // There should be no copy buttons — row-click-to-copy replaced them.
      await expect(logsFrame.locator('#log-table-body .copy-message-button')).toHaveCount(0);

      // Click the second row — it should select that row and show the toast.
      const secondRow = logsFrame.locator('#log-table-body tr').nth(1);
      await expect(secondRow).toBeVisible({ timeout: 10000 });
      await clickWithFallback(secondRow);

      // The clicked row should become selected.
      await expect(secondRow).toHaveClass(/is-selected/);

      // The copy toast should appear briefly.
      const toast = logsFrame.locator('#copy-toast');
      await expect(toast).toHaveClass(/is-visible/, { timeout: 5000 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can inspect and copy raw JSON metadata from CF log messages', async () => {
    const { session, logsFrame } = await openStartedCfLogsSession();

    try {
      await setCfLogsColumnVisible(logsFrame, 'Message', true);

      const correlationId = 'synthetic-correlation-e2e-001';
      const payload = {
        level: 'info',
        logger: 'SyntheticBatchJob - runSyntheticBatch',
        correlation_id: correlationId,
        remote_user: 'sample-user',
        timestamp: '2026-05-11T11:20:17.839Z',
        layer: 'cds',
        component_type: 'application',
        container_id: '192.0.2.20',
        component_id: '00000000-0000-4000-8000-000000000101',
        component_name: 'synthetic-cap-service',
        component_instance: 0,
        source_instance: 0,
        organization_name: 'synthetic-org',
        organization_id: '00000000-0000-4000-8000-000000000102',
        space_name: 'sandbox',
        space_id: '00000000-0000-4000-8000-000000000103',
        msg: "{\n refID: 'synthetic-ref-e2e-001',\n batchID: 997,\n concurrencyLimit: 5\n}",
        type: 'log',
      };
      const rawJson = JSON.stringify(payload);

      await appendCfLogsLines(logsFrame, [
        `2026-05-11T18:20:17.84+0700 [APP/PROC/WEB/0] OUT ${rawJson}`,
      ]);

      await logsFrame.getByLabel('Search logs').fill(correlationId);
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 5000,
      });
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });

      const row = logsFrame.locator('#log-table-body tr').first();
      const messageText = row.locator('td.cell-message .cell-message-text');
      await expect(messageText).toContainText(`"correlation_id":"${correlationId}"`);
      await expect(messageText).toContainText('"remote_user":"sample-user"');
      await expect(messageText).toContainText('"container_id":"192.0.2.20"');
      await expect(messageText).toContainText('"organization_id":"00000000-0000-4000-8000-000000000102"');
      await expect(messageText).toContainText('"space_id":"00000000-0000-4000-8000-000000000103"');
      await expect(messageText).toContainText('"msg":"{\\n refID');

      await clickWithFallback(row);
      const clipboardText = await waitForElectronClipboardText(
        session.electronApp,
        (text) => text.includes(`"correlation_id":"${correlationId}"`)
      );
      const parsed: unknown = JSON.parse(clipboardText);
      expect(isRecord(parsed)).toBe(true);
      if (!isRecord(parsed)) {
        return;
      }
      expect(parsed['correlation_id']).toBe(correlationId);
      expect(parsed['remote_user']).toBe('sample-user');
      expect(parsed['container_id']).toBe('192.0.2.20');
      expect(parsed['msg']).toContain("refID: 'synthetic-ref-e2e-001'");
    } finally {
      await cleanupExtensionHost(session);
    }
  });


  test('User can read full raw messages by default and opt into compact scrolling', async () => {
    const { session, logsFrame } = await openStartedCfLogsSession();

    try {
      await setCfLogsColumnVisible(logsFrame, 'Message', true);

      const marker = 'full-message-display-e2e-marker';
      const longMessage = Array.from({ length: 14 }, (_, index) =>
        `${marker} line ${String(index + 1).padStart(2, '0')} with enough text to wrap in the message column`
      ).join('\n');

      await appendCfLogsLines(logsFrame, [
        `2026-05-11T18:23:00.00+0700 [APP/PROC/WEB/0] OUT ${JSON.stringify({ level: 'info', logger: 'LongMessageLogger', msg: longMessage, type: 'log' })}`,
      ]);

      await logsFrame.getByLabel('Search logs').fill(`${marker} line 14`);
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 5000,
      });
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });

      const messageText = logsFrame
        .locator('#log-table-body tr')
        .first()
        .locator('td.cell-message .cell-message-text');
      await expect(messageText).toContainText(`${marker} line 14`);

      await expect(logsFrame.getByLabel('Limit message height')).not.toBeChecked();
      await expect(messageText).toHaveCSS('max-height', 'none');
      await expect(messageText).toHaveCSS('overflow-y', 'visible');

      await clickWithFallback(logsFrame.getByLabel('Column settings'));
      await expect(logsFrame.locator('#settings-panel')).toBeVisible({ timeout: 5000 });
      await clickWithFallback(logsFrame.getByLabel('Limit message height'));
      await expect(logsFrame.getByLabel('Limit message height')).toBeChecked();
      await expect(messageText).toHaveCSS('overflow-y', 'auto');
      await expect(messageText).not.toHaveCSS('max-height', 'none');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can keep text and continuation messages faithful in CF logs', async () => {
    const { session, logsFrame } = await openStartedCfLogsSession();

    try {
      await setCfLogsColumnVisible(logsFrame, 'Message', true);

      await appendCfLogsLines(logsFrame, [
        '2026-05-11T18:21:00.00+0700 [APP/PROC/WEB/0] OUT',
        '2026-05-11T18:21:01.00+0700 [RTR/0] OUT app-demo.example.test - [2026-05-11T11:21:01.000Z] "GET /rtr-raw-json-check HTTP/1.1" 200 42 10 "-" "probe/1.0" "10.0.1.1:1001" "10.0.2.1:2001" response_time:0.001',
        '2026-05-11T18:21:02.00+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"ContinuationLogger","msg":"continuation base message","type":"log"}',
        'continuation metadata tail synthetic-tail-marker',
      ]);

      const searchBox = logsFrame.getByLabel('Search logs');
      await searchBox.fill('18:21:00');
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 5000,
      });
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
      await expect(
        logsFrame.locator('#log-table-body tr').first().locator('td.cell-message')
      ).toHaveText('(empty)');

      await searchBox.fill('rtr-raw-json-check');
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 5000,
      });
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
      await expect(
        logsFrame.locator('#log-table-body tr').first().locator('td.cell-message')
      ).toContainText('"GET /rtr-raw-json-check HTTP/1.1" 200');

      await searchBox.fill('synthetic-tail-marker');
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 5000,
      });
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
      const continuationMessage = logsFrame
        .locator('#log-table-body tr')
        .first()
        .locator('td.cell-message .cell-message-text');
      await expect(continuationMessage).toContainText('{"level":"info","logger":"ContinuationLogger"');
      await expect(continuationMessage).toContainText('continuation metadata tail synthetic-tail-marker');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can scan structured CAP events from Endpoint Event summaries', async () => {
    const { session, logsFrame } = await openStartedCfLogsSession();

    try {
      const nestedReason = {
        statusCode: 502,
        reason: {
          message: '',
          name: 'Error',
          request: {
            method: 'POST',
            url: 'http://example.test:44300/odata/v1/SyntheticEntitiesE2e',
          },
          response: {
            status: 503,
            statusText: 'Service Unavailable',
          },
        },
      };
      const inspectMessage = [
        '{',
        "  name: 'syntheticValidationRun - [Info] Sample validation message\\n' +",
        "    'Synthetic detail line',",
        '  error: Error: Error during request to remote service: validation-test-run-marker-unique',
        '      at module.exports.run (/srv/node_modules/@sap/cds/runtime/remote/utils/client.js:196:31),',
        '    statusCode: 502,',
        "    code: 'ERR_BAD_REQUEST'",
        '}',
      ].join('\n');
      const stackMessage = [
        '400 - Error: Synthetic escaped unique character in JSON at position 81',
        '    at SyntheticActionHandler.executeSyntheticAction (/srv/srv/handlers/SyntheticAction.handler.ts:49:18)',
        '    at async RemoteService.on_handler (/srv/node_modules/@sap/cds/lib/srv/Service.js:279:20) {',
        "  code: '400'",
        '}',
      ].join('\n');
      const loggerMessage = [
        '{',
        " refID: 'synthetic-ref-e2e-999',",
        ' batchID: 997,',
        ' concurrencyLimit: 5',
        '}',
      ].join('\n');
      const lines = [
        `2026-05-11T18:22:00.00+0700 [APP/PROC/WEB/0] OUT ${JSON.stringify({ level: 'error', logger: 'SyntheticRemoteService', msg: JSON.stringify(nestedReason), type: 'log' })}`,
        `2026-05-11T18:22:01.00+0700 [APP/PROC/WEB/0] OUT ${JSON.stringify({ level: 'error', logger: 'SyntheticValidationRunner', msg: inspectMessage, type: 'log' })}`,
        `2026-05-11T18:22:02.00+0700 [APP/PROC/WEB/0] OUT ${JSON.stringify({ level: 'error', logger: 'cds', msg: stackMessage, type: 'log' })}`,
        `2026-05-11T18:22:03.00+0700 [APP/PROC/WEB/0] OUT ${JSON.stringify({ level: 'info', logger: 'SyntheticBatchJob - runSyntheticBatch', msg: loggerMessage, type: 'log' })}`,
      ];

      await appendCfLogsLines(logsFrame, lines);

      await expectSingleRequestText(
        logsFrame,
        'SyntheticEntitiesE2e',
        'POST /odata/v1/SyntheticEntitiesE2e'
      );
      await expect(
        logsFrame.locator('#log-table-body tr').first().locator('td.col-status .badge')
      ).toHaveText('502');

      const nestedRequestTitle = await logsFrame
        .locator('#log-table-body tr')
        .first()
        .locator('td.cell-request')
        .getAttribute('title');
      expect(nestedRequestTitle).toContain(
        'POST http://example.test:44300/odata/v1/SyntheticEntitiesE2e'
      );

      await expectSingleRequestText(logsFrame, 'validation-test-run-marker-unique', 'syntheticValidationRun');
      await expectSingleRequestText(
        logsFrame,
        'Synthetic escaped unique character',
        'SyntheticActionHandler.executeSyntheticAction'
      );
      await expectSingleRequestText(logsFrame, 'synthetic-ref-e2e-999', 'runSyntheticBatch');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can scan CAP remote request logs without generic remote logger noise', async () => {
    const { session, logsFrame } = await openStartedCfLogsSession();

    try {
      await setCfLogsColumnVisible(logsFrame, 'Tenant', true);
      await setCfLogsColumnVisible(logsFrame, 'Client IP', true);
      await setCfLogsColumnVisible(logsFrame, 'Request ID', true);

      const mdgLogId = 'a1db2b12-16d3-43e5-b73d-35744ebe2f';
      const requestId = '1758b535-a6bc-4eee-5261-bf740494e2e';
      const tenantId = 'tenant-remote-e2e';
      const clientIp = '192.0.2.44';
      const remoteRequestMessage = [
        `get <srv_process_system>/systemprocessservice/requesttaskeventdata?$top=1&$select=deepdata,reqid,mdglogid&$filter=mdglogid%20eq%20'${mdgLogId}' {`,
        '  headers: {',
        "    accept: 'application/json,text/plain',",
        "    authorization: 'bearer ***',",
        `    'x-correlation-id': '${requestId}'`,
        '  }',
        '}',
      ].join('\n');
      const payload = {
        level: 'debug',
        logger: 'remote',
        correlation_id: requestId,
        tenant_id: tenantId,
        remote_user: 'privileged',
        x_cf_true_client_ip: clientIp,
        x_forwarded_for: `${clientIp}, 198.51.100.10`,
        x_vcap_request_id: requestId,
        request_id: requestId,
        x_correlation_id: requestId,
        timestamp: '2026-05-13T09:51:41.166Z',
        layer: 'cds',
        component_type: 'application',
        component_name: 'synthetic-cap-service',
        organization_name: 'synthetic-org',
        space_name: 'sandbox',
        msg: remoteRequestMessage,
        type: 'log',
      };

      await appendCfLogsLines(logsFrame, [
        `2026-05-13T16:51:41.16+0700 [APP/PROC/WEB/0] OUT ${JSON.stringify(payload)}`,
      ]);

      await logsFrame.getByLabel('Search logs').fill(mdgLogId);
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 5000,
      });
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });

      const row = logsFrame.locator('#log-table-body tr').first();
      await expect(row.locator('td.cell-method')).toHaveText('GET');
      await expect(row.locator('td.cell-request .cell-request-text')).toContainText(
        'GET <srv_process_system>/systemprocessservice/requesttaskeventdata'
      );
      await expect(row.locator('td.cell-request .cell-request-text')).not.toHaveText('remote');
      await expect(row.locator('td.cell-tenant')).toHaveText(tenantId);
      await expect(row.locator('td.cell-client-ip')).toHaveText(clientIp);
      await expect(row.locator('td.cell-request-id')).toHaveText(requestId);

      const requestTitle = await row.locator('td.cell-request').getAttribute('title');
      expect(requestTitle).toContain(mdgLogId);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can inspect dominant endpoint events with compact HTTP details', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const gearButton = logsFrame.getByLabel('Column settings');
      await clickWithFallback(gearButton);

      const sourceCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Source' })
        .locator('input[type="checkbox"]');
      const streamCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Stream' })
        .locator('input[type="checkbox"]');
      const methodCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Method' })
        .locator('input[type="checkbox"]');
      const statusCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Status' })
        .locator('input[type="checkbox"]');
      const latencyCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Latency' })
        .locator('input[type="checkbox"]');
      const messageCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Message' })
        .locator('input[type="checkbox"]');

      if (await sourceCheckbox.isChecked()) {
        await clickWithFallback(sourceCheckbox);
      }
      if (await streamCheckbox.isChecked()) {
        await clickWithFallback(streamCheckbox);
      }
      if (!(await methodCheckbox.isChecked())) {
        await clickWithFallback(methodCheckbox);
      }
      if (!(await statusCheckbox.isChecked())) {
        await clickWithFallback(statusCheckbox);
      }
      if (!(await latencyCheckbox.isChecked())) {
        await clickWithFallback(latencyCheckbox);
      }
      if (await messageCheckbox.isChecked()) {
        await clickWithFallback(messageCheckbox);
      }

      await expect(sourceCheckbox).not.toBeChecked();
      await expect(streamCheckbox).not.toBeChecked();
      await expect(methodCheckbox).toBeChecked();
      await expect(statusCheckbox).toBeChecked();
      await expect(latencyCheckbox).toBeChecked();
      await expect(messageCheckbox).not.toBeChecked();

      const widthSnapshot = await logsFrame.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('.cf-log-table thead th'));
        const widths = headers.map((header) => Math.round(header.getBoundingClientRect().width));
        const total = widths.reduce((sum, width) => sum + width, 0);
        const getHeaderWidth = (selector: string): number => {
          const header = document.querySelector(selector);
          return header instanceof HTMLElement ? header.getBoundingClientRect().width : 0;
        };
        const requestWidth = getHeaderWidth('.cf-log-table thead th.col-request');
        const methodWidth = getHeaderWidth('.cf-log-table thead th.col-method');
        const statusWidth = getHeaderWidth('.cf-log-table thead th.col-status');
        const latencyWidth = getHeaderWidth('.cf-log-table thead th.col-latency');
        const timeWidth = getHeaderWidth('.cf-log-table thead th.col-time');
        const nonRequestWidths = headers
          .filter((header) => !header.classList.contains('col-request'))
          .map((header) => Math.round(header.getBoundingClientRect().width));
        return {
          widths,
          total,
          requestWidth: Math.round(requestWidth),
          methodWidth: Math.round(methodWidth),
          statusWidth: Math.round(statusWidth),
          latencyWidth: Math.round(latencyWidth),
          timeWidth: Math.round(timeWidth),
          widestNonRequestColumn: nonRequestWidths.length > 0 ? Math.max(...nonRequestWidths) : 0,
        };
      });

      const requestRatio = widthSnapshot.total > 0
        ? widthSnapshot.requestWidth / widthSnapshot.total
        : 0;

      expect(widthSnapshot.requestWidth).toBeGreaterThan(0);
      expect(widthSnapshot.methodWidth).toBeGreaterThan(0);
      expect(widthSnapshot.statusWidth).toBeGreaterThan(0);
      expect(widthSnapshot.latencyWidth).toBeGreaterThan(0);
      expect(widthSnapshot.timeWidth).toBeGreaterThan(0);
      expect(requestRatio).toBeGreaterThan(0.34);
      expect(widthSnapshot.requestWidth).toBeGreaterThan(widthSnapshot.widestNonRequestColumn);
      expect(widthSnapshot.methodWidth).toBeLessThanOrEqual(80);
      expect(widthSnapshot.statusWidth).toBeLessThanOrEqual(80);
      expect(widthSnapshot.latencyWidth).toBeLessThanOrEqual(100);
      expect(widthSnapshot.timeWidth).toBeLessThan(70);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can filter CF logs by level and search text', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const levelFilter = logsFrame.getByLabel('Filter by level');
      await levelFilter.selectOption('error');
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0);

      const levelBadges = logsFrame.locator('#log-table-body tr td.col-level .badge');
      const levelBadgeCount = await levelBadges.count();
      expect(levelBadgeCount).toBeGreaterThan(0);

      const levelBadgeTexts = await levelBadges.allTextContents();
      for (const levelText of levelBadgeTexts) {
        expect(levelText.trim()).toBe('ERROR');
      }

      const searchBox = logsFrame.getByLabel('Search logs');
      await searchBox.fill('database retry exhausted');
      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0);

      const visibleRows = logsFrame.locator('#log-table-body tr');
      await expect(visibleRows).toHaveCount(1);
      await expect(logsFrame.locator('#log-table-body td.cell-request').first()).toContainText(
        'database retry exhausted'
      );
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see RTR access logs classified by HTTP status code', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const searchBox = logsFrame.getByLabel('Search logs');

      await searchBox.fill('rtr-health-check');
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
      await expect(
        logsFrame.locator('#log-table-body tr').first().locator('td.col-level .badge')
      ).toHaveText('INFO');

      await searchBox.fill('rtr-not-found');
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
      await expect(
        logsFrame.locator('#log-table-body tr').first().locator('td.col-level .badge')
      ).toHaveText('WARN');

      await searchBox.fill('rtr-upstream-fail');
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
      await expect(
        logsFrame.locator('#log-table-body tr').first().locator('td.col-level .badge')
      ).toHaveText('ERROR');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see multiline stack traces escalated to error level', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const activeAppName = await logsFrame
        .getByLabel('Select app')
        .evaluate((element) => (element instanceof HTMLSelectElement ? element.value : ''));
      expect(activeAppName.length).toBeGreaterThan(0);

      await logsFrame.evaluate((appName) => {
        const lines = [
          '2026-04-15T19:12:40.00+0700 [APP/PROC/WEB/0] OUT Warning while calling MainService/getMaterialMulesoftData',
          '400 - Error: No Valid Data Found. Please check key combination Material and/or Base UoM',
          '    at ActionGetMaterialMulesoftDataHandler.getMaterialMulesoftData (/srv/functions/Main/ActionGetMaterialMulesoftDataHandler.ts:41:20)',
        ];

        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'sapTools.logsAppend',
              appName,
              lines,
            },
          })
        );
      }, activeAppName);

      const searchBox = logsFrame.getByLabel('Search logs');
      await searchBox.fill('No Valid Data Found');
      await expect(logsFrame.locator('#log-table-body tr')).toHaveCount(1, { timeout: 5000 });
      await expect(
        logsFrame.locator('#log-table-body tr').first().locator('td.col-level .badge')
      ).toHaveText('ERROR');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can keep CF CLI infrastructure messages out of the log table', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const searchBox = logsFrame.getByLabel('Search logs');
      await searchBox.fill('Failed to retrieve logs from Log Cache');
      await expect(logsFrame.locator('#log-table-body tr td.empty-row')).toBeVisible({
        timeout: 5000,
      });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can remove a stopped app from the CF logs dropdown', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-worker'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      const appSelect = logsFrame.getByLabel('Select app');
      await expect
        .poll(
          async () => appSelect.locator('option').count(),
          { timeout: 15000 }
        ).toBe(2);

      const apiRow = sidebarFrame.locator('.active-app-row', {
        hasText: 'finance-uat-api',
      });
      await expect(apiRow).toBeVisible({ timeout: 10000 });
      await clickWithFallback(apiRow.getByRole('button', { name: 'Stop' }));

      await expect
        .poll(
          async () => appSelect.locator('option').count(),
          { timeout: 15000 }
        ).toBe(1);

      const optionTexts = await appSelect.locator('option').allTextContents();
      expect(optionTexts.some((text) => text.includes('finance-uat-api'))).toBe(false);
      expect(optionTexts.some((text) => text.includes('finance-uat-worker'))).toBe(true);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see CF logs empty state when selected space has no running apps', async () => {
    const session = await launchExtensionHost();
    const DATA_FOUNDATION_ORG = /data-foundation-prod/i;
    const NOAPPS_SPACE = /^noapps$/i;

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      await openCustomSelectionMode(sidebarFrame);
      await clickWithFallback(sidebarFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(sidebarFrame.getByRole('button', { name: REGION_TO_SELECT }));
      await expect(
        getOrgStageOption(sidebarFrame, DATA_FOUNDATION_ORG)
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(getOrgStageOption(sidebarFrame, DATA_FOUNDATION_ORG));
      await expect(
        sidebarFrame.getByRole('button', { name: NOAPPS_SPACE })
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(sidebarFrame.getByRole('button', { name: NOAPPS_SPACE }));

      // App selector should be disabled with no-apps placeholder text.
      const appSelect = logsFrame.getByLabel('Select app');
      await expect(appSelect).toBeDisabled({ timeout: 10000 });

      // Log table should show exactly one empty-state row — no data rows.
      await expect
        .poll(
          async () => logsFrame.locator('#log-table-body td.empty-row').isVisible(),
          { timeout: 15000 }
        )
        .toBe(true);

      const dataRowCount = await logsFrame
        .locator('#log-table-body tr td:not(.empty-row)')
        .count();
      expect(dataRowCount).toBe(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see CF logs reset to empty state when apps fetch fails', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      await logsFrame.evaluate(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'sapTools.appsUpdate',
              apps: [],
              selectedApp: '',
            },
          })
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'sapTools.activeAppsUpdate',
              appNames: [],
            },
          })
        );
      });

      const appSelect = logsFrame.getByLabel('Select app');
      await expect(appSelect).toBeDisabled({ timeout: 10000 });

      await expect
        .poll(
          async () => logsFrame.locator('#log-table-body td.empty-row').isVisible(),
          { timeout: 15000 }
        )
        .toBe(true);

      const dataRowCount = await logsFrame
        .locator('#log-table-body tr td:not(.empty-row)')
        .count();
      expect(dataRowCount).toBe(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can open CF logs settings with default column state', async () => {
    const session = await launchExtensionHost();

    try {
      await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      // Settings panel is hidden by default.
      await expect(logsFrame.locator('#settings-panel')).toBeHidden({ timeout: 10000 });

      // Gear button should be visible.
      const gearButton = logsFrame.getByLabel('Column settings');
      await expect(gearButton).toBeVisible({ timeout: 10000 });

      // Click gear to open settings panel.
      await clickWithFallback(gearButton);
      await expect(logsFrame.locator('#settings-panel')).toBeVisible({ timeout: 5000 });
      await expect(gearButton).toHaveClass(/is-active/);

      // Default checked: Time, Level, Method, Endpoint / Event, Status, Latency.
      // Default unchecked: Tenant, Client IP, Request ID, Logger, Source, Stream, Message.
      const checkboxState = await logsFrame.evaluate(() => {
        const items = Array.from(
          document.querySelectorAll('#settings-column-toggles .settings-column-item')
        );
        return items.map((item) => {
          const cb = item.querySelector('input[type="checkbox"]');
          const span = item.querySelector('span');
          return {
            label: span?.textContent ?? '',
            checked: cb instanceof HTMLInputElement ? cb.checked : false,
          };
        });
      });

      const byLabel = Object.fromEntries(checkboxState.map((s) => [s.label, s.checked]));
      expect(byLabel['Time']).toBe(true);
      expect(byLabel['Level']).toBe(true);
      expect(byLabel['Method']).toBe(true);
      expect(byLabel['Endpoint / Event']).toBe(true);
      expect(byLabel['Status']).toBe(true);
      expect(byLabel['Latency']).toBe(true);
      expect(byLabel['Tenant']).toBe(false);
      expect(byLabel['Client IP']).toBe(false);
      expect(byLabel['Request ID']).toBe(false);
      expect(byLabel['Logger']).toBe(false);
      expect(byLabel['Source']).toBe(false);
      expect(byLabel['Stream']).toBe(false);
      expect(byLabel['Message']).toBe(false);

      // Clicking gear again should close the panel.
      await clickWithFallback(gearButton);
      await expect(logsFrame.locator('#settings-panel')).toBeHidden({ timeout: 5000 });
      await expect(gearButton).not.toHaveClass(/is-active/);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can keep canonical CF logs header order when toggling Level', async () => {
    const session = await launchExtensionHost();

    try {
      await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      const readHeaderOrder = async (): Promise<string[]> => {
        const texts = await logsFrame.locator('#log-table-head th').allTextContents();
        return texts.map((text) => text.trim()).filter((text) => text.length > 0);
      };

      await expect
        .poll(readHeaderOrder, { timeout: 10000 })
        .toEqual(['Time', 'Level', 'Method', 'Endpoint / Event', 'Status', 'Latency']);

      const gearButton = logsFrame.getByLabel('Column settings');
      await clickWithFallback(gearButton);

      const levelCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Level' })
        .locator('input[type="checkbox"]');

      await expect(levelCheckbox).toBeChecked();

      await clickWithFallback(levelCheckbox);
      await expect(levelCheckbox).not.toBeChecked();
      await expect
        .poll(readHeaderOrder, { timeout: 5000 })
        .toEqual(['Time', 'Method', 'Endpoint / Event', 'Status', 'Latency']);

      await clickWithFallback(levelCheckbox);
      await expect(levelCheckbox).toBeChecked();
      await expect
        .poll(readHeaderOrder, { timeout: 5000 })
        .toEqual(['Time', 'Level', 'Method', 'Endpoint / Event', 'Status', 'Latency']);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can toggle Source and Stream columns in CF logs settings', async () => {
    const session = await launchExtensionHost();

    try {
      await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      const gearButton = logsFrame.getByLabel('Column settings');
      await clickWithFallback(gearButton);

      const sourceCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Source' })
        .locator('input[type="checkbox"]');
      const streamCheckbox = logsFrame
        .locator('#settings-column-toggles .settings-column-item')
        .filter({ hasText: 'Stream' })
        .locator('input[type="checkbox"]');

      if (await sourceCheckbox.isChecked()) {
        await clickWithFallback(sourceCheckbox);
      }
      if (await streamCheckbox.isChecked()) {
        await clickWithFallback(streamCheckbox);
      }

      await expect(sourceCheckbox).not.toBeChecked();
      await expect(streamCheckbox).not.toBeChecked();
      const baselineHeaders = await logsFrame
        .locator('#log-table-head th')
        .allTextContents();
      expect(baselineHeaders.includes('Source')).toBe(false);
      expect(baselineHeaders.includes('Stream')).toBe(false);

      await clickWithFallback(sourceCheckbox);
      await expect(sourceCheckbox).toBeChecked();
      const withSourceHeaders = await logsFrame.locator('#log-table-head th').allTextContents();
      expect(withSourceHeaders.includes('Source')).toBe(true);
      expect(withSourceHeaders.length).toBe(baselineHeaders.length + 1);

      await clickWithFallback(streamCheckbox);
      await expect(streamCheckbox).toBeChecked();
      const withSourceAndStreamHeaders = await logsFrame
        .locator('#log-table-head th')
        .allTextContents();
      expect(withSourceAndStreamHeaders.includes('Source')).toBe(true);
      expect(withSourceAndStreamHeaders.includes('Stream')).toBe(true);
      expect(withSourceAndStreamHeaders.length).toBe(baselineHeaders.length + 2);

      await clickWithFallback(sourceCheckbox);
      await clickWithFallback(streamCheckbox);
      await expect(sourceCheckbox).not.toBeChecked();
      await expect(streamCheckbox).not.toBeChecked();
      const restoredHeaders = await logsFrame.locator('#log-table-head th').allTextContents();
      const restoredSorted = [...restoredHeaders].sort();
      const baselineSorted = [...baselineHeaders].sort();
      expect(restoredSorted).toEqual(baselineSorted);
      expect(restoredHeaders.includes('Source')).toBe(false);
      expect(restoredHeaders.includes('Stream')).toBe(false);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see concise CF logs row count summary', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const summary = logsFrame.locator('#table-summary');
      await expect(summary).toHaveText(/^\d+ of \d+ rows$/, { timeout: 10000 });
      await expect(summary).not.toContainText('visible');
      await expect(summary).not.toContainText('stream=');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can update CF logs table typography from font size settings', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const gearButton = logsFrame.getByLabel('Column settings');
      await clickWithFallback(gearButton);
      await expect(logsFrame.locator('#settings-panel')).toBeVisible({ timeout: 5000 });

      const fontSizeSelect = logsFrame.getByLabel('Log table font size');
      await expect(fontSizeSelect).toBeVisible({ timeout: 5000 });
      await expect(fontSizeSelect).toHaveValue('default');

      const optionLabels = await fontSizeSelect.locator('option').allTextContents();
      expect(optionLabels).toEqual(['Smaller', 'Default', 'Large', 'Extra Large']);

      const getTableFontSize = async (): Promise<number> => {
        const size = await logsFrame.locator('.cf-log-table').evaluate((element) => {
          const parsed = Number.parseFloat(getComputedStyle(element).fontSize);
          return Number.isFinite(parsed) ? parsed : 0;
        });
        return size;
      };

      const defaultFontSize = await getTableFontSize();
      await fontSizeSelect.selectOption('large');
      const largeFontSize = await getTableFontSize();
      await fontSizeSelect.selectOption('smaller');
      const smallerFontSize = await getTableFontSize();

      expect(defaultFontSize).toBeGreaterThan(0);
      expect(largeFontSize).toBeGreaterThan(defaultFontSize);
      expect(smallerFontSize).toBeLessThan(defaultFontSize);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can enforce CF logs row cap from log limit settings', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const gearButton = logsFrame.getByLabel('Column settings');
      await clickWithFallback(gearButton);
      await expect(logsFrame.locator('#settings-panel')).toBeVisible({ timeout: 5000 });

      const logLimitSelect = logsFrame.getByLabel('Log row limit');
      await expect(logLimitSelect).toBeVisible({ timeout: 5000 });
      await expect(logLimitSelect).toHaveValue('300');
      await expect(logLimitSelect.locator('option')).toHaveText(['300', '500', '1000', '3000']);

      const activeAppName = await logsFrame
        .getByLabel('Select app')
        .evaluate((element) => (element instanceof HTMLSelectElement ? element.value : ''));
      expect(activeAppName.length).toBeGreaterThan(0);

      await logsFrame.evaluate((appName) => {
        const lines: string[] = [];
        for (let index = 0; index < 360; index += 1) {
          const second = String(index % 60).padStart(2, '0');
          lines.push(
            `2026-04-12T10:10:${second}.00+0700 [APP/PROC/WEB/0] OUT synthetic burst row ${String(index)}`
          );
        }
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'sapTools.logsAppend',
              appName,
              lines,
            },
          })
        );
      }, activeAppName);

      await expect(logsFrame.locator('#table-summary')).toHaveText('300 of 300 rows', {
        timeout: 10000,
      });

      await logLimitSelect.selectOption('500');

      await logsFrame.evaluate((appName) => {
        const lines: string[] = [];
        for (let index = 0; index < 260; index += 1) {
          const second = String(index % 60).padStart(2, '0');
          lines.push(
            `2026-04-12T10:20:${second}.00+0700 [APP/PROC/WEB/0] OUT synthetic follow-up row ${String(index)}`
          );
        }
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'sapTools.logsAppend',
              appName,
              lines,
            },
          })
        );
      }, activeAppName);

      await expect(logsFrame.locator('#table-summary')).toHaveText('500 of 500 rows', {
        timeout: 10000,
      });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use CF logs filters with compact panel padding', async () => {
    const session = await launchExtensionHost();

    try {
      await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      const layoutSnapshot = await logsFrame.evaluate(() => {
        const panel = document.querySelector('.cf-logs-panel');
        const app = document.querySelector('#filter-app');
        const search = document.querySelector('#filter-search');
        const level = document.querySelector('#filter-level');
        const settings = document.querySelector('#settings-toggle');

        if (
          !(panel instanceof HTMLElement) ||
          !(app instanceof HTMLElement) ||
          !(search instanceof HTMLElement) ||
          !(level instanceof HTMLElement) ||
          !(settings instanceof HTMLElement)
        ) {
          return null;
        }

        const panelStyles = getComputedStyle(panel);
        const bodyStyles = getComputedStyle(document.body);
        const appBox = app.getBoundingClientRect();
        const searchBox = search.getBoundingClientRect();
        const levelBox = level.getBoundingClientRect();
        const settingsBox = settings.getBoundingClientRect();

        return {
          viewportWidth: window.innerWidth,
          bodyPaddingLeft: Number.parseFloat(bodyStyles.paddingLeft),
          bodyPaddingRight: Number.parseFloat(bodyStyles.paddingRight),
          paddingLeft: Number.parseFloat(panelStyles.paddingLeft),
          paddingRight: Number.parseFloat(panelStyles.paddingRight),
          app: { x: appBox.x, y: appBox.y },
          search: { x: searchBox.x, y: searchBox.y },
          level: { x: levelBox.x, y: levelBox.y },
          settings: { x: settingsBox.x, y: settingsBox.y },
        };
      });

      expect(layoutSnapshot).not.toBeNull();
      if (layoutSnapshot === null) {
        return;
      }

      expect(layoutSnapshot.bodyPaddingLeft).toBeLessThanOrEqual(0.5);
      expect(layoutSnapshot.bodyPaddingRight).toBeLessThanOrEqual(0.5);
      expect(layoutSnapshot.paddingLeft).toBeGreaterThanOrEqual(5.5);
      expect(layoutSnapshot.paddingLeft).toBeLessThanOrEqual(6.5);
      expect(layoutSnapshot.paddingRight).toBeGreaterThanOrEqual(5.5);
      expect(layoutSnapshot.paddingRight).toBeLessThanOrEqual(6.5);

      if (layoutSnapshot.viewportWidth <= 900) {
        expect(layoutSnapshot.app.y).toBeCloseTo(layoutSnapshot.level.y, 0);
        expect(layoutSnapshot.level.y).toBeCloseTo(layoutSnapshot.settings.y, 0);
        expect(layoutSnapshot.search.y).toBeGreaterThan(layoutSnapshot.app.y);
      } else {
        expect(layoutSnapshot.app.y).toBeCloseTo(layoutSnapshot.search.y, 0);
        expect(layoutSnapshot.search.y).toBeCloseTo(layoutSnapshot.level.y, 0);
        expect(layoutSnapshot.level.y).toBeCloseTo(layoutSnapshot.settings.y, 0);
        expect(layoutSnapshot.app.x).toBeLessThan(layoutSnapshot.search.x);
        expect(layoutSnapshot.search.x).toBeLessThan(layoutSnapshot.level.x);
        expect(layoutSnapshot.level.x).toBeLessThan(layoutSnapshot.settings.x);
      }
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use CF logs filters across two rows on narrow windows', async () => {
    const session = await launchExtensionHost();

    try {
      await session.window.setViewportSize({ width: 860, height: 900 });
      await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      const layoutSnapshot = await logsFrame.evaluate(() => {
        const app = document.querySelector('#filter-app');
        const search = document.querySelector('#filter-search');
        const level = document.querySelector('#filter-level');
        const settings = document.querySelector('#settings-toggle');

        if (
          !(app instanceof HTMLElement) ||
          !(search instanceof HTMLElement) ||
          !(level instanceof HTMLElement) ||
          !(settings instanceof HTMLElement)
        ) {
          return null;
        }

        const appBox = app.getBoundingClientRect();
        const searchBox = search.getBoundingClientRect();
        const levelBox = level.getBoundingClientRect();
        const settingsBox = settings.getBoundingClientRect();

        return {
          viewportWidth: window.innerWidth,
          app: { x: appBox.x, y: appBox.y },
          search: { x: searchBox.x, y: searchBox.y },
          level: { x: levelBox.x, y: levelBox.y },
          settings: { x: settingsBox.x, y: settingsBox.y },
        };
      });

      expect(layoutSnapshot).not.toBeNull();
      if (layoutSnapshot === null) {
        return;
      }

      expect(layoutSnapshot.viewportWidth).toBeLessThanOrEqual(900);
      expect(layoutSnapshot.app.y).toBeCloseTo(layoutSnapshot.level.y, 0);
      expect(layoutSnapshot.level.y).toBeCloseTo(layoutSnapshot.settings.y, 0);
      expect(layoutSnapshot.search.y).toBeGreaterThan(layoutSnapshot.app.y);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can stream CF log bursts without excessive table rerenders', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const rerenderCount = await logsFrame.evaluate(async () => {
        const tableBody = document.querySelector('#log-table-body');
        const appSelect = document.querySelector('#filter-app');

        if (!(tableBody instanceof HTMLTableSectionElement)) {
          return -1;
        }
        if (!(appSelect instanceof HTMLSelectElement) || appSelect.value.length === 0) {
          return -2;
        }

        const targetApp = appSelect.value;
        const originalReplaceChildren = tableBody.replaceChildren.bind(tableBody);
        let replaceCount = 0;

        tableBody.replaceChildren = (
          ...args: Parameters<typeof tableBody.replaceChildren>
        ): void => {
          replaceCount += 1;
          originalReplaceChildren(...args);
        };

        for (let index = 0; index < 80; index += 1) {
          const second = String(index % 60).padStart(2, '0');
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'sapTools.logsAppend',
                appName: targetApp,
                lines: [
                  `2026-04-12T10:45:${second}.00+0700 [APP/PROC/WEB/0] OUT synthetic burst row ${String(index)}`,
                ],
              },
            })
          );
        }

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });

        tableBody.replaceChildren = originalReplaceChildren;
        return replaceCount;
      });

      expect(rerenderCount).toBeGreaterThan(0);
      expect(rerenderCount).toBeLessThanOrEqual(20);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use full-height CF logs table after opening and closing settings', async () => {
    const session = await launchExtensionHost();

    try {
      await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      const measureHeights = async (): Promise<{
        panelHeight: number;
        tableHeight: number;
        ratio: number;
      } | null> => {
        return logsFrame.evaluate(() => {
          const panel = document.querySelector('.cf-logs-panel');
          const tableShell = document.querySelector('.table-shell');
          if (!(panel instanceof HTMLElement) || !(tableShell instanceof HTMLElement)) {
            return null;
          }

          const panelRect = panel.getBoundingClientRect();
          const tableRect = tableShell.getBoundingClientRect();
          return {
            panelHeight: Math.round(panelRect.height),
            tableHeight: Math.round(tableRect.height),
            ratio: tableRect.height / panelRect.height,
          };
        });
      };

      const beforeOpenSettings = await measureHeights();
      expect(beforeOpenSettings).not.toBeNull();
      if (beforeOpenSettings === null) {
        return;
      }

      expect(beforeOpenSettings.panelHeight).toBeGreaterThan(220);
      expect(beforeOpenSettings.tableHeight).toBeGreaterThan(
        Math.round(beforeOpenSettings.panelHeight * 0.55)
      );
      expect(beforeOpenSettings.ratio).toBeGreaterThan(0.55);

      await clickWithFallback(logsFrame.getByLabel('Column settings'));
      const whileSettingsOpen = await measureHeights();
      expect(whileSettingsOpen).not.toBeNull();
      if (whileSettingsOpen === null) {
        return;
      }
      expect(whileSettingsOpen.tableHeight).toBeLessThan(beforeOpenSettings.tableHeight - 40);

      await clickWithFallback(logsFrame.getByLabel('Column settings'));
      const afterCloseSettings = await measureHeights();
      expect(afterCloseSettings).not.toBeNull();
      if (afterCloseSettings === null) {
        return;
      }

      expect(Math.abs(afterCloseSettings.tableHeight - beforeOpenSettings.tableHeight)).toBeLessThanOrEqual(6);
      expect(afterCloseSettings.ratio).toBeGreaterThan(0.55);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use CF logs table area beyond the legacy half-height limit', async () => {
    const session = await launchExtensionHost();

    try {
      await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);

      const tableShellStyle = await logsFrame.locator('.table-shell').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          maxHeight: style.maxHeight,
          overflowY: style.overflowY,
        };
      });

      expect(tableShellStyle.maxHeight).toBe('none');
      expect(tableShellStyle.overflowY).toBe('auto');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can keep selected CF log row while unrelated stream lines append', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      const logsFrame = await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);

      const confirmButton = sidebarFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await clickWithFallback(sidebarFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        sidebarFrame.getByRole('button', { name: 'Start App Logging' })
      );

      await expect(logsFrame.locator('#log-table-body td.empty-row')).toHaveCount(0, {
        timeout: 10000,
      });

      const levelFilter = logsFrame.getByLabel('Filter by level');
      await levelFilter.selectOption('error');
      const visibleRows = logsFrame.locator('#log-table-body tr');
      await expect
        .poll(async () => visibleRows.count(), { timeout: 5000 })
        .toBeGreaterThanOrEqual(2);
      const initialErrorRowCount = await visibleRows.count();

      const firstRow = visibleRows.first();
      const secondRow = visibleRows.nth(1);

      await clickWithFallback(secondRow);
      await expect(secondRow).toHaveClass(/is-selected/);
      await expect(firstRow).not.toHaveClass(/is-selected/);

      const activeAppName = await logsFrame
        .getByLabel('Select app')
        .evaluate((element) => (element instanceof HTMLSelectElement ? element.value : ''));
      expect(activeAppName.length).toBeGreaterThan(0);

      await logsFrame.evaluate((appName) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'sapTools.logsAppend',
              appName,
              lines: [
                '2026-04-12T10:00:01.00+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","msg":"routine ping","type":"log"}',
                '2026-04-12T10:00:02.00+0700 [APP/PROC/WEB/0] OUT {"level":"info","logger":"cds","msg":"routine ping","type":"log"}',
              ],
            },
          })
        );
      }, activeAppName);

      await logsFrame.evaluate(
        () => new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        })
      );

      await expect(visibleRows).toHaveCount(initialErrorRowCount);
      await expect(secondRow).toHaveClass(/is-selected/);
      await expect(firstRow).not.toHaveClass(/is-selected/);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see CF logs scope update after confirming sidebar workspace', async () => {
    const session = await launchExtensionHost();

    try {
      const sidebarFrame = await openSapToolsSidebar(session.window);
      await openCfLogsPanel(session.window);
      await selectDefaultScope(sidebarFrame);
      const confirmButton = sidebarFrame.getByRole('button', { name: /Confirm Scope/i });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);

      // Scope should reflect region → org → space selected in the sidebar.
      await expect
        .poll(async () => {
          const frame = await findCfLogsPanelFrame(session.window);
          if (frame === undefined) return '';
          const scopeEl = frame.locator('#workspace-scope');
          return scopeEl.textContent();
        }, { timeout: 15000 })
        .toContain('us-10');
      await expect
        .poll(async () => {
          const frame = await findCfLogsPanelFrame(session.window);
          if (frame === undefined) return '';
          return frame.locator('#workspace-scope').textContent();
        }, { timeout: 15000 })
        .toContain('finance-services-prod');
      await expect
        .poll(async () => {
          const frame = await findCfLogsPanelFrame(session.window);
          if (frame === undefined) return '';
          return frame.locator('#workspace-scope').textContent();
        }, { timeout: 15000 })
        .toContain('uat');
    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
