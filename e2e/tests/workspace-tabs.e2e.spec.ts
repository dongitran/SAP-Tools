import fs from 'node:fs';

import { test, expect, type Frame } from '@playwright/test';

import {
  cleanupExtensionHost,
  clickWithFallback,
  createServiceRootMappingFixture,
  launchExtensionHost,
  openSapToolsSidebar,
  selectDefaultScope,
} from './support/sapToolsHarness';

async function openConfirmedWorkspace(): Promise<{
  readonly session: Awaited<ReturnType<typeof launchExtensionHost>>;
  readonly webviewFrame: Frame;
}> {
  const session = await launchExtensionHost();
  const webviewFrame = await openSapToolsSidebar(session.window);
  await selectDefaultScope(webviewFrame);
  await clickWithFallback(
    webviewFrame.getByRole('button', { name: 'Confirm Scope' })
  );
  await expect(
    webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
  ).toBeVisible();
  return { session, webviewFrame };
}

interface WorkspaceTabHeightSnapshot {
  readonly bodyHeight: number;
  readonly listHeight: number;
  readonly listMaxHeight: string;
  readonly panelHeight: number;
}

interface SettingsLayoutSnapshot {
  readonly bodyClassName: string;
  readonly bodyDisplay: string;
  readonly bodyFlexDirection: string;
  readonly bodyGap: number;
  readonly bodyOverflowX: string;
  readonly bodyOverflowY: string;
  readonly bodyPaddingBottom: number;
  readonly bodyPaddingLeft: number;
  readonly bodyPaddingRight: number;
  readonly bodyPaddingTop: number;
  readonly cacheHeadingToPickerGap: number;
  readonly firstSectionHeightRatio: number;
  readonly firstSectionToSecondGap: number;
  readonly maxInlineOverflow: number;
  readonly sectionCount: number;
  readonly secondSectionBottomToBodyBottom: number;
  readonly statusScrollOverflow: number;
  readonly syncPickerToMetaGap: number;
}

interface ServiceMapIconPositionSnapshot {
  readonly iconLeft: number;
  readonly nameLeft: number;
}

async function readWorkspaceTabHeightSnapshot(
  webviewFrame: Frame,
  selectors: {
    readonly list: string;
    readonly panel: string;
  }
): Promise<WorkspaceTabHeightSnapshot> {
  return webviewFrame.evaluate((input) => {
    const body = document.querySelector('.workspace-body');
    const panel = document.querySelector(input.panel);
    const list = document.querySelector(input.list);
    if (
      !(body instanceof HTMLElement) ||
      !(panel instanceof HTMLElement) ||
      !(list instanceof HTMLElement)
    ) {
      throw new Error('Workspace tab layout elements are missing.');
    }
    return {
      bodyHeight: body.getBoundingClientRect().height,
      listHeight: list.getBoundingClientRect().height,
      listMaxHeight: window.getComputedStyle(list).maxHeight,
      panelHeight: panel.getBoundingClientRect().height,
    };
  }, selectors);
}

async function applyLongSettingsCacheSnapshot(webviewFrame: Frame): Promise<void> {
  const longEmail =
    'integration-settings-layout-verification-user-with-very-long-email-address@example.internal.saptools.dev';
  const longError =
    'Simulated sync failure with a long Cloud Foundry response that should wrap inside the Settings status section without creating horizontal overflow or moving the action toolbar away from the section content.';

  await webviewFrame.evaluate(
    ({ activeUserEmail, lastSyncError }) => {
      window.postMessage(
        {
          type: 'sapTools.cacheState',
          snapshot: {
            activeUserEmail,
            syncInProgress: false,
            lastSyncStartedAt: null,
            lastSyncCompletedAt: null,
            lastSyncError,
            syncIntervalHours: 96,
            nextSyncAt: '2026-05-08T10:00:00.000Z',
            regionAccessById: {},
          },
        },
        '*'
      );
    },
    { activeUserEmail: longEmail, lastSyncError: longError }
  );

  await expect(webviewFrame.locator('.settings-meta')).toContainText(longEmail);
  await expect(webviewFrame.getByRole('status')).toContainText(longError);
}

async function readSettingsLayoutSnapshot(
  webviewFrame: Frame
): Promise<SettingsLayoutSnapshot> {
  return webviewFrame.evaluate(() => {
    const body = document.querySelector('.settings-body');
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('.settings-body .settings-section')
    );
    const firstSection = sections[0];
    const secondSection = sections[1];
    const cacheHeading = firstSection?.querySelector('h2');
    const syncPicker = document.querySelector('.sync-interval-picker');
    const meta = document.querySelector('.settings-meta');
    const statusMessage = document.querySelector('.settings-status-message');

    if (
      !(body instanceof HTMLElement) ||
      !(firstSection instanceof HTMLElement) ||
      !(secondSection instanceof HTMLElement) ||
      !(cacheHeading instanceof HTMLElement) ||
      !(syncPicker instanceof HTMLElement) ||
      !(meta instanceof HTMLElement) ||
      !(statusMessage instanceof HTMLElement)
    ) {
      throw new Error('Settings layout elements are missing.');
    }

    const bodyRect = body.getBoundingClientRect();
    const firstRect = firstSection.getBoundingClientRect();
    const secondRect = secondSection.getBoundingClientRect();
    const headingRect = cacheHeading.getBoundingClientRect();
    const pickerRect = syncPicker.getBoundingClientRect();
    const metaRect = meta.getBoundingClientRect();
    const statusRect = statusMessage.getBoundingClientRect();
    const bodyStyle = window.getComputedStyle(body);
    const inlineOverflows = [firstSection, secondSection, meta, statusMessage].map(
      (element) => element.scrollWidth - element.clientWidth
    );
    const rightOverflows = [firstRect, secondRect, metaRect, statusRect].map(
      (rect) => rect.right - bodyRect.right
    );
    const maxInlineOverflow = Math.max(...inlineOverflows, ...rightOverflows);

    return {
      bodyClassName: body.className,
      bodyDisplay: bodyStyle.display,
      bodyFlexDirection: bodyStyle.flexDirection,
      bodyGap: Number.parseFloat(bodyStyle.rowGap),
      bodyOverflowX: bodyStyle.overflowX,
      bodyOverflowY: bodyStyle.overflowY,
      bodyPaddingBottom: Number.parseFloat(bodyStyle.paddingBottom),
      bodyPaddingLeft: Number.parseFloat(bodyStyle.paddingLeft),
      bodyPaddingRight: Number.parseFloat(bodyStyle.paddingRight),
      bodyPaddingTop: Number.parseFloat(bodyStyle.paddingTop),
      cacheHeadingToPickerGap: pickerRect.top - headingRect.bottom,
      firstSectionHeightRatio: firstRect.height / bodyRect.height,
      firstSectionToSecondGap: secondRect.top - firstRect.bottom,
      maxInlineOverflow,
      sectionCount: sections.length,
      secondSectionBottomToBodyBottom: bodyRect.bottom - secondRect.bottom,
      statusScrollOverflow: statusMessage.scrollWidth - statusMessage.clientWidth,
      syncPickerToMetaGap: metaRect.top - pickerRect.bottom,
    };
  });
}

function expectCompactSettingsLayout(snapshot: SettingsLayoutSnapshot): void {
  expect(snapshot.bodyClassName.split(/\s+/)).not.toContain('workspace-body');
  expect(snapshot.bodyDisplay).toBe('flex');
  expect(snapshot.bodyFlexDirection).toBe('column');
  expect(snapshot.bodyOverflowX).toBe('hidden');
  expect(['auto', 'scroll']).toContain(snapshot.bodyOverflowY);
  expect(snapshot.sectionCount).toBe(2);
  expect(snapshot.bodyGap).toBeGreaterThanOrEqual(9);
  expect(snapshot.bodyGap).toBeLessThanOrEqual(11);
  expect(snapshot.bodyPaddingTop).toBeGreaterThanOrEqual(9);
  expect(snapshot.bodyPaddingTop).toBeLessThanOrEqual(11);
  expect(snapshot.bodyPaddingRight).toBeGreaterThanOrEqual(9);
  expect(snapshot.bodyPaddingRight).toBeLessThanOrEqual(11);
  expect(snapshot.bodyPaddingBottom).toBeGreaterThanOrEqual(9);
  expect(snapshot.bodyPaddingBottom).toBeLessThanOrEqual(11);
  expect(snapshot.bodyPaddingLeft).toBeGreaterThanOrEqual(9);
  expect(snapshot.bodyPaddingLeft).toBeLessThanOrEqual(11);
  expect(snapshot.cacheHeadingToPickerGap).toBeGreaterThanOrEqual(9);
  expect(snapshot.cacheHeadingToPickerGap).toBeLessThanOrEqual(11);
  expect(snapshot.syncPickerToMetaGap).toBeGreaterThanOrEqual(9);
  expect(snapshot.syncPickerToMetaGap).toBeLessThanOrEqual(11);
  expect(snapshot.firstSectionToSecondGap).toBeGreaterThanOrEqual(9);
  expect(snapshot.firstSectionToSecondGap).toBeLessThanOrEqual(11);
  expect(snapshot.firstSectionHeightRatio).toBeLessThan(0.45);
  expect(snapshot.secondSectionBottomToBodyBottom).toBeGreaterThan(20);
  expect(snapshot.maxInlineOverflow).toBeLessThanOrEqual(1);
  expect(snapshot.statusScrollOverflow).toBeLessThanOrEqual(1);
}

async function readServiceMapIconPositionSnapshot(
  webviewFrame: Frame,
  appName: string
): Promise<ServiceMapIconPositionSnapshot> {
  return webviewFrame.evaluate((targetAppName) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.service-map-row'));
    const row = rows.find((candidate) => {
      const name = candidate.querySelector('.service-map-name');
      return name instanceof HTMLElement && name.textContent.trim() === targetAppName;
    });
    if (!(row instanceof HTMLElement)) {
      throw new Error(`Service row not found for ${targetAppName}.`);
    }

    const icon = row.querySelector('.service-map-status-icon');
    const name = row.querySelector('.service-map-name');
    if (!(icon instanceof HTMLElement) || !(name instanceof HTMLElement)) {
      throw new Error(`Service row icon/name missing for ${targetAppName}.`);
    }

    return {
      iconLeft: icon.getBoundingClientRect().left,
      nameLeft: name.getBoundingClientRect().left,
    };
  }, appName);
}

test.describe('SAP Tools workspace tabs', () => {
  test('User can open the workspace with only the supported tabs', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      const tabs = webviewFrame.getByRole('tab');
      await expect(tabs).toHaveCount(3);
      await expect(tabs.nth(0)).toHaveText('Logs');
      await expect(tabs.nth(1)).toHaveText('Apps');
      await expect(tabs.nth(2)).toHaveText('SQL');
      await expect(
        webviewFrame.getByRole('tab', { name: 'Debug' })
      ).toHaveCount(0);

      const tabLayout = await webviewFrame.evaluate(() => {
        const tablist = document.querySelector('.workspace-tabs');
        const tabs = Array.from(
          document.querySelectorAll<HTMLElement>('.workspace-tabs .tab-button')
        );
        if (!(tablist instanceof HTMLElement) || tabs.length !== 3) {
          return null;
        }
        const tablistRect = tablist.getBoundingClientRect();
        const tabRects = tabs.map((tab) => tab.getBoundingClientRect());
        const styles = window.getComputedStyle(tablist);
        const gapRaw = Number.parseFloat(styles.columnGap);
        const paddingLeftRaw = Number.parseFloat(styles.paddingLeft);
        const paddingRightRaw = Number.parseFloat(styles.paddingRight);
        const gap = Number.isFinite(gapRaw) ? gapRaw : 0;
        const paddingLeft = Number.isFinite(paddingLeftRaw) ? paddingLeftRaw : 0;
        const paddingRight = Number.isFinite(paddingRightRaw) ? paddingRightRaw : 0;
        const innerWidth = tablistRect.width - paddingLeft - paddingRight;
        const expectedTabWidth = (innerWidth - gap * 2) / 3;
        const widths = tabRects.map((rect) => rect.width);
        const firstTabRect = tabRects[0];
        const lastTabRect = tabRects[2];
        if (firstTabRect === undefined || lastTabRect === undefined) {
          return null;
        }
        return {
          firstLeftDelta: Math.abs(firstTabRect.left - (tablistRect.left + paddingLeft)),
          lastRightDelta: Math.abs(lastTabRect.right - (tablistRect.right - paddingRight)),
          maxExpectedDelta: Math.max(
            ...widths.map((width) => Math.abs(width - expectedTabWidth))
          ),
          widthDelta: Math.max(...widths) - Math.min(...widths),
        };
      });

      if (tabLayout === null) {
        throw new Error('Workspace tab layout was not rendered.');
      }
      expect(tabLayout.widthDelta).toBeLessThanOrEqual(2);
      expect(tabLayout.maxExpectedDelta).toBeLessThanOrEqual(2);
      expect(tabLayout.firstLeftDelta).toBeLessThanOrEqual(2);
      expect(tabLayout.lastRightDelta).toBeLessThanOrEqual(2);

      const removedSurface = await webviewFrame.evaluate(() => {
        const selectors = [
          '[data-tab-id="debug"]',
          '.debug-tab',
          '[data-role="debug-row"]',
          '[data-role="debug-status-note"]',
          '[data-action*="debug"]',
          '[data-role*="debug"]',
        ];
        const elementCount = selectors.reduce((count, selector) => {
          return count + document.querySelectorAll(selector).length;
        }, 0);
        const visibleDebugTextCount = Array.from(document.body.querySelectorAll('*')).filter(
          (node) => {
            if (!(node instanceof HTMLElement)) {
              return false;
            }
            if (node.offsetParent === null) {
              return false;
            }
            return /\bDebug\b/.test(node.innerText);
          }
        ).length;
        return { elementCount, visibleDebugTextCount };
      });

      expect(removedSurface).toEqual({
        elementCount: 0,
        visibleDebugTextCount: 0,
      });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can switch between Logs Apps and SQL without removed workspace controls appearing', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Services & Packages' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('tab', { name: 'Debug' })
      ).toHaveCount(0);

      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'SQL' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'HANA SQL Workbench' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('tab', { name: 'Debug' })
      ).toHaveCount(0);

      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Logs' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Apps Log Control' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('tab', { name: 'Debug' })
      ).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can open compact Settings from selection and workspace headers', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Change Region' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Select SAP BTP Region' })
      ).toBeVisible({ timeout: 10000 });

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Open Settings' }));
      await expect(webviewFrame.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await applyLongSettingsCacheSnapshot(webviewFrame);
      await expect(webviewFrame.getByLabel('Cache sync interval')).toHaveValue('96');
      await expect(
        webviewFrame.getByRole('button', { name: 'Close Settings' })
      ).toHaveText('Back');
      expectCompactSettingsLayout(await readSettingsLayoutSnapshot(webviewFrame));

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Close Settings' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Select SAP BTP Region' })
      ).toBeVisible();
      await selectDefaultScope(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Confirm Scope' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Open Settings' }));
      await expect(webviewFrame.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await applyLongSettingsCacheSnapshot(webviewFrame);
      await expect(
        webviewFrame.getByRole('button', { name: 'Close Settings' })
      ).toHaveText('Back');
      expectCompactSettingsLayout(await readSettingsLayoutSnapshot(webviewFrame));

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Sync now' }));
      await expect(webviewFrame.getByRole('status')).toContainText('Sync started');
      expectCompactSettingsLayout(await readSettingsLayoutSnapshot(webviewFrame));

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Close Settings' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        webviewFrame.getByRole('heading', { name: 'Apps Log Control' })
      ).toBeVisible();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use full-height Logs and Apps workspace panels', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      const logsSnapshot = await readWorkspaceTabHeightSnapshot(webviewFrame, {
        list: '[data-role="app-log-catalog"]',
        panel: '.app-logs-panel',
      });
      expect(logsSnapshot.bodyHeight).toBeGreaterThan(120);
      expect(logsSnapshot.panelHeight / logsSnapshot.bodyHeight).toBeGreaterThan(0.95);
      expect(logsSnapshot.listHeight / logsSnapshot.bodyHeight).toBeGreaterThan(0.35);
      expect(logsSnapshot.listMaxHeight).toBe('none');

      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Services & Packages' })
      ).toBeVisible();
      const appsSnapshot = await readWorkspaceTabHeightSnapshot(webviewFrame, {
        list: '[data-role="service-mapping-list"]',
        panel: '.service-export-tab',
      });
      expect(appsSnapshot.bodyHeight).toBeGreaterThan(120);
      expect(appsSnapshot.panelHeight / appsSnapshot.bodyHeight).toBeGreaterThan(0.95);
      expect(appsSnapshot.listHeight / appsSnapshot.bodyHeight).toBeGreaterThan(0.35);
      expect(appsSnapshot.listMaxHeight).toBe('none');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see service mapping icons at row start and use hover actions', async () => {
    const fixtureRootPath = createServiceRootMappingFixture();
    const session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'select',
        SAP_TOOLS_E2E_ROOT_FOLDER_PATH: fixtureRootPath,
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);
      await clickWithFallback(
        webviewFrame.getByRole('button', { name: 'Confirm Scope' })
      );
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible();

      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Services & Packages' })
      ).toBeVisible();

      await expect(webviewFrame.locator('[data-role="workspace-last-sync"]')).toHaveCount(0);
      await expect(webviewFrame.getByText(/^Last sync:/i)).toHaveCount(0);

      const apiRow = webviewFrame.locator('.service-map-row', {
        has: webviewFrame.locator('.service-map-name', { hasText: /^finance-uat-api$/ }),
      });
      await expect(apiRow.getByRole('img', { name: 'Unmapped service' })).toBeVisible();
      await expect(apiRow.locator('.service-map-state', { hasText: /^Unmapped$/i })).toHaveCount(0);

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Select Root Folder' }));
      await expect(
        webviewFrame.getByRole('img', { name: 'Mapped service' })
      ).toHaveCount(3, { timeout: 10000 });
      await expect(webviewFrame.locator('.service-map-state', { hasText: /^Mapped$/i })).toHaveCount(0);

      const mappedApiRow = webviewFrame.locator('.service-map-row', {
        has: webviewFrame.locator('.service-map-name', { hasText: /^finance-uat-api$/ }),
      });
      await expect(
        mappedApiRow.getByRole('img', { name: 'Mapped service' })
      ).toHaveAttribute('title', /\/finance_uat_api$/);

      const position = await readServiceMapIconPositionSnapshot(
        webviewFrame,
        'finance-uat-api'
      );
      expect(position.iconLeft).toBeLessThan(position.nameLeft);

      await mappedApiRow.hover();
      const replaceButton = mappedApiRow.getByRole('button', { name: 'Replace' });
      const exportButton = mappedApiRow.getByRole('button', { name: 'Export' });
      await expect(replaceButton).toBeVisible();
      await expect(exportButton).toBeVisible();
      await clickWithFallback(replaceButton);
      await expect(
        session.window.getByRole('alert').filter({ hasText: /No placeholder configured/i })
      ).toBeVisible({ timeout: 10000 });
      await mappedApiRow.hover();
      await clickWithFallback(exportButton);
      await expect(webviewFrame.getByText(/No active CF scope session/i)).toBeVisible({
        timeout: 20000,
      });
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(fixtureRootPath, { recursive: true, force: true });
    }
  });
});
