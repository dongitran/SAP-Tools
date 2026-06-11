import fs from 'node:fs';
import path from 'node:path';

import { test, expect, type Frame, type Locator } from '@playwright/test';

import {
  AREA_TO_SELECT,
  BR10_REGION_TO_SELECT,
  EU10004_REGION_TO_SELECT,
  EU20002_REGION_TO_SELECT,
  EUROPE_AREA_TO_SELECT,
  ORG_TO_SELECT,
  PROOF_ORG_TO_SELECT,
  REGION_TO_SELECT,
  SPACE_TO_SELECT,
  THEME_SCENARIOS,
  US10001_REGION_TO_SELECT,
  US10002_REGION_TO_SELECT,
  cleanupExtensionHost,
  clickWithFallback,
  createHeavyServiceRootMappingFixture,
  createLongServiceRootMappingFixture,
  createServiceRootMappingFixture,
  expectNoOuterGutter,
  getCustomSelectionPanel,
  getOrgStageOption,
  getOrgSearchInput,
  getSelectionTab,
  launchExtensionHost,
  openCfLogsPanel,
  openCustomSelectionMode,
  openSapToolsSidebar,
  readPaletteSnapshot,
  readViewportGutterSnapshot,
  readWebviewBodyClasses,
  relaunchExtensionHost,
  resolveSapToolsLoginFrame,
  resolveSapToolsWorkspaceFrame,
  selectDefaultScope,
  type ShellNodeStabilitySnapshot,
} from './support/sapToolsHarness';

function getQuickOrgSearchPanel(webviewFrame: Frame): Locator {
  return webviewFrame.getByRole('tabpanel', { name: 'Quick Org Search' });
}

function getQuickOrgSearchInput(webviewFrame: Frame): Locator {
  return getQuickOrgSearchPanel(webviewFrame).getByRole('searchbox', {
    name: 'Search synced organizations',
  });
}

function getRegionSearchInput(webviewFrame: Frame): Locator {
  return webviewFrame
    .getByRole('region', { name: 'Region list' })
    .getByRole('searchbox', { name: 'Search regions' });
}

function getTopologyOrgRow(
  webviewFrame: Frame,
  orgName: string,
  regionKey: RegExp
): Locator {
  const regionTextPattern = new RegExp(
    regionKey.source.replace(/^\^/, ''),
    regionKey.flags
  );
  return webviewFrame
    .getByRole('button', {
      name: new RegExp(`Quick org search pick ${orgName} in`, 'i'),
    })
    .filter({ hasText: regionTextPattern })
    .first();
}

function getOrgStageButtons(webviewFrame: Frame): Locator {
  return webviewFrame
    .getByRole('region', { name: 'Organization list' })
    .getByTestId('org-option');
}

function getMappedServiceIcons(webviewFrame: Frame): Locator {
  return webviewFrame.getByRole('img', { name: 'Mapped service' });
}

function getMappedServiceIconForApp(webviewFrame: Frame, appName: string): Locator {
  return webviewFrame
    .locator('.service-map-row', {
      has: webviewFrame.locator('.service-map-name', { hasText: appName }),
    })
    .getByRole('img', { name: 'Mapped service' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readUserSettings(userDataDir: string): Record<string, unknown> {
  const settingsPath = path.join(userDataDir, 'User', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  return isRecord(parsed) ? parsed : {};
}

function writeUserSettings(
  userDataDir: string,
  settings: Record<string, unknown>
): void {
  const settingsPath = path.join(userDataDir, 'User', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

test.describe('SAP Tools region selector', () => {
  for (const scenario of THEME_SCENARIOS) {
    test(`User can open selector and pick region in ${scenario.id} theme`, async () => {
      const session = await launchExtensionHost({ colorTheme: scenario.colorTheme });

      try {
        const webviewFrame = await openSapToolsSidebar(session.window);
        const bodyClasses = await readWebviewBodyClasses(webviewFrame);
        expect(bodyClasses).toEqual(
          expect.arrayContaining([
            scenario.expectedBodyThemeClass,
            'prototype-page',
            'pattern-bars',
            'theme-34',
          ])
        );

        const gutterSnapshot = await readViewportGutterSnapshot(webviewFrame);
        expectNoOuterGutter(gutterSnapshot);

        const palette = await readPaletteSnapshot(webviewFrame);
        if (scenario.maxShellBrightness !== undefined) {
          expect(palette.shellBrightness).toBeLessThan(scenario.maxShellBrightness);
        }
        if (scenario.minShellBrightness !== undefined) {
          expect(palette.shellBrightness).toBeGreaterThan(scenario.minShellBrightness);
        }

        await openCustomSelectionMode(webviewFrame);
        await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
        await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
        await expect(
          getOrgStageOption(webviewFrame, ORG_TO_SELECT)
        ).toBeVisible({ timeout: 10000 });
      } finally {
        await cleanupExtensionHost(session);
      }
    });
  }

  test('User can keep VS Code webview theme classes during interactions', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      const initialClasses = await readWebviewBodyClasses(webviewFrame);
      const initialThemeClasses = initialClasses.filter((className) =>
        className.startsWith('vscode-')
      );

      expect(initialThemeClasses.length).toBeGreaterThan(0);
      expect(initialThemeClasses).toContain('vscode-dark');
      expect(initialClasses).toEqual(
        expect.arrayContaining(['prototype-page', 'pattern-bars', 'theme-34'])
      );

      const initialPalette = await readPaletteSnapshot(webviewFrame);
      expect(initialPalette.bodyBrightness).toBeLessThan(0.2);
      expect(initialPalette.shellBrightness).toBeLessThan(0.2);

      await openCustomSelectionMode(webviewFrame);
      await webviewFrame.getByRole('button', { name: AREA_TO_SELECT }).click();
      await webviewFrame.getByRole('button', { name: REGION_TO_SELECT }).click();

      const classesAfterSelection = await readWebviewBodyClasses(webviewFrame);
      expect(classesAfterSelection).toEqual(
        expect.arrayContaining(['prototype-page', 'pattern-bars', 'theme-34'])
      );
      expect(classesAfterSelection).toEqual(
        expect.arrayContaining(initialThemeClasses)
      );
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see code-first region labels without cloud provider suffix', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));

      const regionButton = webviewFrame.getByRole('button', { name: REGION_TO_SELECT });
      await expect(regionButton).toBeVisible({ timeout: 10000 });
      await expect(
        webviewFrame.getByRole('button', { name: US10001_REGION_TO_SELECT })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('button', { name: US10002_REGION_TO_SELECT })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('button', { name: EU10004_REGION_TO_SELECT })
      ).toHaveCount(0);
      const regionLabel = await regionButton.innerText();
      expect(regionLabel).toMatch(/^\s*us-10\s+US East \(VA\)/i);
      expect(regionLabel).not.toMatch(/\b(aws|azure|gcp)\b/i);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can select EU10 extension landscape from Europe area', async () => {
    let session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(
        webviewFrame.getByRole('button', { name: EUROPE_AREA_TO_SELECT })
      );

      const regionButton = webviewFrame.getByRole('button', {
        name: EU10004_REGION_TO_SELECT,
      });
      await expect(regionButton).toBeVisible({ timeout: 10000 });
      await expect(regionButton).toBeEnabled();
      await clickWithFallback(regionButton);
      await expect(
        getOrgStageOption(webviewFrame, ORG_TO_SELECT)
      ).toBeVisible({ timeout: 10000 });
      await expect(webviewFrame.locator('.stage-loading')).toHaveCount(0);

      const selectedRegionState = await webviewFrame.evaluate(() => {
        const selectedRegionElement = document.querySelector('.region-option.is-selected');
        const selectedRegionText =
          selectedRegionElement === null
            ? ''
            : selectedRegionElement.textContent.replace(/\s+/g, ' ').trim();
        return {
          selectedRegionId:
            selectedRegionElement?.getAttribute('data-region-id') ?? '',
          visibleRegionCount: document.querySelectorAll(
            '.region-option:not(.is-hidden)'
          ).length,
          hiddenRegionCount: document.querySelectorAll('.region-option.is-hidden')
            .length,
          stageErrorCount: document.querySelectorAll('.stage-error').length,
          loadingCount: document.querySelectorAll('.stage-loading').length,
          selectedRegionText,
        };
      });
      expect(selectedRegionState).toEqual({
        selectedRegionId: 'eu10-004',
        visibleRegionCount: 1,
        hiddenRegionCount: 15,
        stageErrorCount: 0,
        loadingCount: 0,
        selectedRegionText: 'eu10-004 Europe (Frankfurt) Extension',
      });

      await expect(
        getOrgStageOption(webviewFrame, ORG_TO_SELECT)
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(getOrgStageOption(webviewFrame, ORG_TO_SELECT));
      await expect(
        webviewFrame.getByRole('button', { name: SPACE_TO_SELECT })
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(webviewFrame.getByRole('button', { name: SPACE_TO_SELECT }));

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });
      await expect(webviewFrame.locator('.workspace-context')).toContainText(
        'Region: eu10-004. Org: finance-services-prod. Space: uat'
      );
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);

      session = await relaunchExtensionHost(session);
      const reopenedFrame = await openSapToolsSidebar(session.window, 60000);
      await expect(
        reopenedFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 20000 });
      await expect(reopenedFrame.locator('.workspace-context')).toContainText(
        'Region: eu10-004. Org: finance-services-prod. Space: uat'
      );
      await expect(reopenedFrame.getByRole('button', { name: 'Confirm Scope' })).toHaveCount(0);
      await expect(reopenedFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can select EU20 extension landscape from Europe area', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(
        webviewFrame.getByRole('button', { name: EUROPE_AREA_TO_SELECT })
      );

      const regionButton = webviewFrame.getByRole('button', {
        name: EU20002_REGION_TO_SELECT,
      });
      await expect(regionButton).toBeVisible({ timeout: 10000 });
      await expect(regionButton).toBeEnabled();
      await clickWithFallback(regionButton);
      await expect(
        getOrgStageOption(webviewFrame, ORG_TO_SELECT)
      ).toBeVisible({ timeout: 10000 });
      await expect(webviewFrame.locator('.stage-loading')).toHaveCount(0);

      const selectedRegionState = await webviewFrame.evaluate(() => {
        const selectedRegionElement = document.querySelector('.region-option.is-selected');
        const selectedRegionText =
          selectedRegionElement === null
            ? ''
            : selectedRegionElement.textContent.replace(/\s+/g, ' ').trim();
        return {
          selectedRegionId:
            selectedRegionElement?.getAttribute('data-region-id') ?? '',
          visibleRegionCount: document.querySelectorAll(
            '.region-option:not(.is-hidden)'
          ).length,
          hiddenRegionCount: document.querySelectorAll('.region-option.is-hidden')
            .length,
          stageErrorCount: document.querySelectorAll('.stage-error').length,
          loadingCount: document.querySelectorAll('.stage-loading').length,
          selectedRegionText,
        };
      });
      expect(selectedRegionState).toEqual({
        selectedRegionId: 'eu20-002',
        visibleRegionCount: 1,
        hiddenRegionCount: 15,
        stageErrorCount: 0,
        loadingCount: 0,
        selectedRegionText: 'eu20-002 Europe (Netherlands) Extension',
      });

      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test(
    'User can select area region and organization without recreating selection shell nodes',
    async () => {
      const session = await launchExtensionHost();

      try {
        const webviewFrame = await openSapToolsSidebar(session.window);
        await openCustomSelectionMode(webviewFrame);
        const hasInitialStageSlots = await webviewFrame.evaluate(() => {
          const shellElement = document.querySelector('.prototype-shell');
          const headerElement = document.querySelector('.shell-header');
          const groupsElement = document.querySelector('.groups');
          const areaSlotElement = document.querySelector('[data-stage-slot="area"]');
          const regionSlotElement = document.querySelector(
            '[data-stage-slot="region"]'
          );
          const orgSlotElement = document.querySelector('[data-stage-slot="org"]');

          if (
            !(shellElement instanceof HTMLElement) ||
            !(headerElement instanceof HTMLElement) ||
            !(groupsElement instanceof HTMLElement) ||
            !(areaSlotElement instanceof HTMLElement) ||
            !(regionSlotElement instanceof HTMLElement) ||
            !(orgSlotElement instanceof HTMLElement)
          ) {
            return false;
          }

          const runtimeWindow = window as Window & {
            __sapToolsSelectionRefs?: {
              shell: HTMLElement;
              header: HTMLElement;
              groups: HTMLElement;
              areaSlot: HTMLElement;
              regionSlot: HTMLElement;
              orgSlot: HTMLElement;
            };
          };

          runtimeWindow.__sapToolsSelectionRefs = {
            shell: shellElement,
            header: headerElement,
            groups: groupsElement,
            areaSlot: areaSlotElement,
            regionSlot: regionSlotElement,
            orgSlot: orgSlotElement,
          };

          return true;
        });
        expect(hasInitialStageSlots).toBe(true);

        await webviewFrame.getByRole('button', { name: AREA_TO_SELECT }).click();
        await webviewFrame.getByRole('button', { name: REGION_TO_SELECT }).click();
        await expect(
          getOrgStageOption(webviewFrame, ORG_TO_SELECT)
        ).toBeVisible({ timeout: 10000 });
        await getOrgStageOption(webviewFrame, ORG_TO_SELECT).click();

        const shellNodeStability = await webviewFrame.evaluate(() => {
          const runtimeWindow = window as Window & {
            __sapToolsSelectionRefs?: {
              shell: HTMLElement;
              header: HTMLElement;
              groups: HTMLElement;
              areaSlot: HTMLElement;
              regionSlot: HTMLElement;
              orgSlot: HTMLElement;
            };
          };

          const refs = runtimeWindow.__sapToolsSelectionRefs;
          if (refs === undefined) {
            throw new Error('Selection shell references are missing.');
          }

          const shellElement = document.querySelector('.prototype-shell');
          const headerElement = document.querySelector('.shell-header');
          const groupsElement = document.querySelector('.groups');
          const areaSlotElement = document.querySelector('[data-stage-slot="area"]');
          const regionSlotElement = document.querySelector(
            '[data-stage-slot="region"]'
          );
          const orgSlotElement = document.querySelector('[data-stage-slot="org"]');

          return {
            sameShellNode: shellElement === refs.shell,
            sameHeaderNode: headerElement === refs.header,
            sameGroupsNode: groupsElement === refs.groups,
            sameAreaSlotNode: areaSlotElement === refs.areaSlot,
            sameRegionSlotNode: regionSlotElement === refs.regionSlot,
            sameOrgSlotNode: orgSlotElement === refs.orgSlot,
          };
        });

        const expectedStabilitySnapshot: ShellNodeStabilitySnapshot = {
          sameShellNode: true,
          sameHeaderNode: true,
          sameGroupsNode: true,
          sameAreaSlotNode: true,
          sameRegionSlotNode: true,
          sameOrgSlotNode: true,
        };
        expect(shellNodeStability).toEqual(expectedStabilitySnapshot);
      } finally {
        await cleanupExtensionHost(session);
      }
    }
  );

  test('User can load fourteen organizations when selecting br-10 from local fixtures', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: BR10_REGION_TO_SELECT }));
      await expect(getOrgSearchInput(webviewFrame)).toBeVisible({ timeout: 10000 });
      await expect(getOrgSearchInput(webviewFrame)).toHaveValue('');

      await expect
        .poll(
          async () => {
            return getOrgStageButtons(webviewFrame).count();
          },
          { timeout: 10000 }
        )
        .toBe(14);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can filter organizations and reset search after changing region', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: BR10_REGION_TO_SELECT }));

      const orgSearchInput = getOrgSearchInput(webviewFrame);
      await expect(orgSearchInput).toBeVisible({ timeout: 10000 });
      await expect(orgSearchInput).toHaveValue('');
      const orgSearchLayout = await webviewFrame.evaluate(() => {
        const stage = document.querySelector('[data-stage-id="org"]');
        const head = stage?.querySelector('.group-head');
        const heading = head?.querySelector('h2');
        const search = head?.querySelector('[data-role="org-search"]');
        const changeButton = head?.querySelector('[data-action="reset-org-selection"]');
        const directStageSearch = Array.from(stage?.children ?? []).some((child) => {
          return (
            child instanceof HTMLInputElement &&
            child.getAttribute('data-role') === 'org-search'
          );
        });

        return {
          hasInlineSearch:
            search instanceof HTMLInputElement &&
            search.closest('.group-head-search-wrapper') instanceof HTMLElement,
          isBetweenHeadingAndChange:
            heading instanceof HTMLElement &&
            search instanceof HTMLElement &&
            changeButton instanceof HTMLElement &&
            heading.compareDocumentPosition(search) === Node.DOCUMENT_POSITION_FOLLOWING &&
            search.compareDocumentPosition(changeButton) === Node.DOCUMENT_POSITION_FOLLOWING,
          hasDirectStageSearch: directStageSearch,
        };
      });
      expect(orgSearchLayout).toEqual({
        hasInlineSearch: true,
        isBetweenHeadingAndChange: true,
        hasDirectStageSearch: false,
      });
      await expect(webviewFrame.getByRole('heading', { name: 'Organization' })).toBeVisible();
      await expect(
        webviewFrame.getByRole('heading', { name: 'Choose Organization' })
      ).toHaveCount(0);
      await expect(webviewFrame.locator('.stage-loading')).toHaveCount(0);
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);

      await orgSearchInput.fill('billing');
      await expect(
        getOrgStageOption(webviewFrame, /billing-reconciliation-prod/i)
      ).toBeVisible();
      await expect(getOrgStageButtons(webviewFrame)).toHaveCount(1);
      await expect(getOrgStageOption(webviewFrame, /finance-services-prod/i)).toHaveCount(0);

      await orgSearchInput.fill('');
      await expect(getOrgStageButtons(webviewFrame)).toHaveCount(14);
      await expect(getOrgStageOption(webviewFrame, /finance-services-prod/i)).toBeVisible();

      await orgSearchInput.fill('billing');
      await clickWithFallback(
        webviewFrame
          .getByRole('region', { name: 'Region list' })
          .getByRole('button', { name: 'Change' })
      );
      await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));

      const resetSearchInput = getOrgSearchInput(webviewFrame);
      await expect(resetSearchInput).toBeVisible({ timeout: 10000 });
      await expect(resetSearchInput).toHaveValue('');
      await expect(getOrgStageButtons(webviewFrame)).toHaveCount(5);
      await expect(webviewFrame.locator('.stage-loading')).toHaveCount(0);
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can filter regions inline while choosing a custom region', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));

      const regionSearchInput = getRegionSearchInput(webviewFrame);
      await expect(regionSearchInput).toBeVisible({ timeout: 10000 });
      await expect(regionSearchInput).toHaveValue('');
      const regionSearchLayout = await webviewFrame.evaluate(() => {
        const stage = document.querySelector('[data-stage-id="region"]');
        const head = stage?.querySelector('.group-head');
        const heading = head?.querySelector('h2');
        const search = head?.querySelector('[data-role="region-search"]');
        const changeButton = head?.querySelector('[data-action="reset-region-selection"]');
        const regionLabels = Array.from(
          stage?.querySelectorAll('.region-layout .region-option') ?? []
        ).map((element) => element.textContent.replace(/\s+/g, ' ').trim());

        return {
          hasInlineSearch:
            search instanceof HTMLInputElement &&
            search.closest('.group-head-search-wrapper') instanceof HTMLElement,
          isBetweenHeadingAndChange:
            heading instanceof HTMLElement &&
            search instanceof HTMLElement &&
            changeButton instanceof HTMLElement &&
            heading.compareDocumentPosition(search) === Node.DOCUMENT_POSITION_FOLLOWING &&
            search.compareDocumentPosition(changeButton) === Node.DOCUMENT_POSITION_FOLLOWING,
          firstFiveRegionLabels: regionLabels.slice(0, 5),
        };
      });
      expect(regionSearchLayout).toEqual({
        hasInlineSearch: true,
        isBetweenHeadingAndChange: true,
        firstFiveRegionLabels: [
          'br-10 Brazil (Sao Paulo)',
          'br-20 Brazil (Sao Paulo)',
          'br-30 Brazil (Sao Paulo)',
          'ca-10 Canada (Montreal)',
          'ca-20 Canada Central (Toronto)',
        ],
      });

      await regionSearchInput.fill('extension');
      await expect(
        webviewFrame.getByRole('button', { name: US10001_REGION_TO_SELECT })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('button', { name: US10002_REGION_TO_SELECT })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('button', { name: REGION_TO_SELECT })
      ).toHaveCount(0);
      await expect(
        webviewFrame.getByRole('button', { name: /US East \(VA\) Extension/i })
      ).toHaveCount(2);
      await expect(webviewFrame.locator('.stage-loading')).toHaveCount(0);
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);

      await clickWithFallback(
        webviewFrame.getByRole('button', { name: US10001_REGION_TO_SELECT })
      );
      await expect(getRegionSearchInput(webviewFrame)).toHaveCount(0);
      await clickWithFallback(
        webviewFrame
          .getByRole('region', { name: 'Region list' })
          .getByRole('button', { name: 'Change' })
      );

      const resetRegionSearchInput = getRegionSearchInput(webviewFrame);
      await expect(resetRegionSearchInput).toBeVisible({ timeout: 10000 });
      await expect(resetRegionSearchInput).toHaveValue('');
      await expect(
        webviewFrame.getByRole('button', { name: REGION_TO_SELECT })
      ).toBeVisible();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see stable selection cards without entry animation while choosing scope', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
      await expect(
        getOrgStageOption(webviewFrame, ORG_TO_SELECT)
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(getOrgStageOption(webviewFrame, ORG_TO_SELECT));

      const animationSnapshot = await webviewFrame.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.groups .group-card'));
        if (cards.length === 0) {
          return {
            cardCount: 0,
            hasAnimatedCard: true,
          };
        }

        const hasAnimatedCard = cards.some((card) => {
          if (!(card instanceof HTMLElement)) {
            return false;
          }
          const animationName = getComputedStyle(card).animationName;
          return animationName !== 'none';
        });

        return {
          cardCount: cards.length,
          hasAnimatedCard,
        };
      });

      expect(animationSnapshot.cardCount).toBeGreaterThan(0);
      expect(animationSnapshot.hasAnimatedCard).toBe(false);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see app catalog from extension host data for selected space', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
      await expect(
        getOrgStageOption(webviewFrame, PROOF_ORG_TO_SELECT)
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(
        getOrgStageOption(webviewFrame, PROOF_ORG_TO_SELECT)
      );

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled({ timeout: 10000 });
      await clickWithFallback(confirmButton);

      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible();
      await expect(webviewFrame.getByText('proof-gateway')).toBeVisible({
        timeout: 10000,
      });
      await expect(
        webviewFrame.getByText('apps-proof-prod-proofspace-api')
      ).toHaveCount(0);
      await expect(
        webviewFrame.getByText('apps-proof-prod-proofspace-worker')
      ).toHaveCount(0);
      await expect(
        webviewFrame.getByText('apps-proof-prod-proofspace-jobs')
      ).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see app catalog failure state for an unreachable selected space', async () => {
    const session = await launchExtensionHost();
    const DATA_FOUNDATION_ORG = /data-foundation-prod/i;
    const FAILSPACE_TO_SELECT = /^failspace$/i;

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
      await expect(getOrgStageOption(webviewFrame, DATA_FOUNDATION_ORG)).toBeVisible({
        timeout: 10000,
      });
      await clickWithFallback(getOrgStageOption(webviewFrame, DATA_FOUNDATION_ORG));
      await expect(
        webviewFrame.getByRole('button', { name: FAILSPACE_TO_SELECT })
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(webviewFrame.getByRole('button', { name: FAILSPACE_TO_SELECT }));

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });

      const appError = webviewFrame.getByRole('alert').filter({
        hasText: /Simulated CF CLI failure/i,
      });
      await expect(appError).toBeVisible({ timeout: 10000 });
      await expect(webviewFrame.locator('.app-log-item')).toHaveCount(0);
      await expect(
        webviewFrame.getByRole('button', { name: 'Start App Logging' })
      ).toBeDisabled();
      await expect(webviewFrame.getByText('finance-uat-api')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can select one SAP BTP region in webview and output log is emitted', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await webviewFrame.getByRole('button', { name: AREA_TO_SELECT }).click();
      await webviewFrame.getByRole('button', { name: REGION_TO_SELECT }).click();

      const selectionNotification = session.window
        .getByText(/Selected SAP BTP region: .*\(us-10\)/i)
        .first();
      await expect(selectionNotification).toBeVisible({ timeout: 20000 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can complete selection flow and reset via Change buttons only', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);

      await openCustomSelectionMode(webviewFrame);
      await webviewFrame.getByRole('button', { name: AREA_TO_SELECT }).click();
      await webviewFrame.getByRole('button', { name: REGION_TO_SELECT }).click();

      const regionStateAfterSelect = await webviewFrame.evaluate(() => {
        return {
          selectedRegionId:
            document
              .querySelector('.region-option.is-selected')
              ?.getAttribute('data-region-id') ?? '',
          hiddenRegionCount: document.querySelectorAll('.region-option.is-hidden')
            .length,
          visibleRegionCount: document.querySelectorAll(
            '.region-option:not(.is-hidden)'
          ).length,
        };
      });
      expect(regionStateAfterSelect.selectedRegionId).toBe('us10');
      expect(regionStateAfterSelect.hiddenRegionCount).toBeGreaterThan(0);
      expect(regionStateAfterSelect.visibleRegionCount).toBe(1);

      await webviewFrame.getByRole('button', { name: REGION_TO_SELECT }).click();
      const regionStateAfterSecondClick = await webviewFrame.evaluate(() => {
        return {
          selectedRegionId:
            document
              .querySelector('.region-option.is-selected')
              ?.getAttribute('data-region-id') ?? '',
          hiddenRegionCount: document.querySelectorAll('.region-option.is-hidden')
            .length,
        };
      });
      expect(regionStateAfterSecondClick.selectedRegionId).toBe('us10');
      expect(regionStateAfterSecondClick.hiddenRegionCount).toBe(
        regionStateAfterSelect.hiddenRegionCount
      );

      await expect(
        getOrgStageOption(webviewFrame, ORG_TO_SELECT)
      ).toBeVisible({ timeout: 10000 });
      await getOrgStageOption(webviewFrame, ORG_TO_SELECT).click();
      await expect(
        webviewFrame.getByRole('button', { name: SPACE_TO_SELECT })
      ).toBeVisible({ timeout: 10000 });
      await webviewFrame.getByRole('button', { name: SPACE_TO_SELECT }).click();

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();

      await webviewFrame
        .getByRole('button', { name: 'Change', exact: true })
        .nth(1)
        .click();

      const stateAfterRegionReset = await webviewFrame.evaluate(() => {
        return {
          selectedRegionId:
            document
              .querySelector('.region-option.is-selected')
              ?.getAttribute('data-region-id') ?? '',
          orgStageVisible:
            document.querySelector('[data-stage-id="org"]') !== null,
          spaceStageVisible:
            document.querySelector('[data-stage-id="space"]') !== null,
          visibleRegionCount: document.querySelectorAll(
            '.region-option:not(.is-hidden)'
          ).length,
        };
      });

      expect(stateAfterRegionReset.selectedRegionId).toBe('');
      expect(stateAfterRegionReset.orgStageVisible).toBe(false);
      expect(stateAfterRegionReset.spaceStageVisible).toBe(false);
      expect(stateAfterRegionReset.visibleRegionCount).toBeGreaterThan(1);
      await expect(confirmButton).toBeDisabled();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can confirm scope, view monitoring workspace, and switch back to selection', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await confirmButton.click();

      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('heading', { name: 'Active Apps Log' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('heading', { name: 'Apps Log Control' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('button', { name: 'Start App Logging' })
      ).toBeVisible();
      await expect(webviewFrame.getByText('finance-uat-api')).toBeVisible({
        timeout: 10000,
      });
      await expect(webviewFrame.getByRole('tab', { name: 'Logs' })).toBeVisible();
      await expect(webviewFrame.getByRole('tab', { name: 'Apps' })).toBeVisible();
      await expect(
        webviewFrame.getByRole('tab', { name: 'SQL' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('tab', { name: 'Debug' })
      ).toHaveCount(0);

      const workspaceHeaderLayout = await webviewFrame.evaluate(() => {
        const headerRow = document.querySelector('.workspace-header .shell-header-row');
        if (!(headerRow instanceof HTMLElement)) {
          return {
            hasChangeRegionInHeader: false,
            hasSettingsInHeader: false,
            isChangeBeforeSettings: false,
            hasFooterChangeButton: false,
          };
        }

        const changeRegionButton = headerRow.querySelector('[data-action="change-region"]');
        const settingsButton = headerRow.querySelector('[data-action="open-settings"]');
        const footerChangeButton = document.querySelector(
          '.workspace-footer [data-action="change-region"]'
        );
        const isChangeBeforeSettings =
          changeRegionButton instanceof HTMLElement &&
          settingsButton instanceof HTMLElement &&
          changeRegionButton.compareDocumentPosition(settingsButton) ===
            Node.DOCUMENT_POSITION_FOLLOWING;

        return {
          hasChangeRegionInHeader: changeRegionButton instanceof HTMLElement,
          hasSettingsInHeader: settingsButton instanceof HTMLElement,
          isChangeBeforeSettings,
          hasFooterChangeButton: footerChangeButton instanceof HTMLElement,
        };
      });

      expect(workspaceHeaderLayout).toEqual({
        hasChangeRegionInHeader: true,
        hasSettingsInHeader: true,
        isChangeBeforeSettings: true,
        hasFooterChangeButton: false,
      });

      await webviewFrame.getByRole('button', { name: 'Change Region' }).click();
      await expect(
        webviewFrame.getByRole('heading', { name: 'Select SAP BTP Region' })
      ).toBeVisible();
      await expect(confirmButton).toBeEnabled();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can keep confirmed scope after closing and reopening extension host', async () => {
    let session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);

      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });

      session = await relaunchExtensionHost(session);

      const reopenedFrame = await openSapToolsSidebar(session.window, 60000);
      await expect(
        reopenedFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 20000 });
      await expect(reopenedFrame.locator('.workspace-context')).toContainText(
        'Region: us-10. Org: finance-services-prod. Space: uat'
      );
      await expect(
        reopenedFrame.getByRole('button', { name: 'Confirm Scope' })
      ).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can sync confirmed scope through the global SAP CAP setting', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });
      await expect(webviewFrame.locator('.workspace-context')).toContainText(
        'Region: us-10. Org: finance-services-prod. Space: uat'
      );

      await expect
        .poll(() => readUserSettings(session.userDataDir)['sapCap.currentScope'], {
          timeout: 10000,
        })
        .toEqual({
          regionCode: 'us10',
          orgName: 'finance-services-prod',
          spaceName: 'uat',
        });

      const currentSettings = readUserSettings(session.userDataDir);
      writeUserSettings(session.userDataDir, {
        ...currentSettings,
        'sapCap.currentScope': {
          regionCode: 'br10',
          orgName: 'billing-reconciliation-prod',
          spaceName: 'etl',
        },
      });

      await expect(webviewFrame.locator('.workspace-context')).toContainText(
        'Region: br-10. Org: billing-reconciliation-prod. Space: etl',
        { timeout: 20000 }
      );
      await expect(webviewFrame.getByText('etl-scheduler')).toBeVisible({
        timeout: 20000,
      });
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
      await expect(
        webviewFrame.getByRole('button', { name: 'Confirm Scope' })
      ).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can follow external SAP CAP scope before selecting a SAP Tools region', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await expect(
        webviewFrame.getByRole('heading', { name: 'Select SAP BTP Region' })
      ).toBeVisible({ timeout: 10000 });

      const currentSettings = readUserSettings(session.userDataDir);
      writeUserSettings(session.userDataDir, {
        ...currentSettings,
        'sapCap.currentScope': {
          regionCode: 'br10',
          orgName: 'billing-reconciliation-prod',
          spaceName: 'etl',
        },
      });

      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 20000 });
      await expect(webviewFrame.locator('.workspace-context')).toContainText(
        'Region: br-10. Org: billing-reconciliation-prod. Space: etl',
        { timeout: 20000 }
      );
      await expect(webviewFrame.getByText('etl-scheduler')).toBeVisible({
        timeout: 20000,
      });
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
      await expect(
        webviewFrame.getByRole('button', { name: 'Confirm Scope' })
      ).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can clear active logging state when an external scope cannot be restored', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });

      const logsFrame = await openCfLogsPanel(session.window);
      await clickWithFallback(webviewFrame.getByLabel('Select finance-uat-api'));
      await clickWithFallback(
        webviewFrame.getByRole('button', { name: 'Start App Logging' })
      );

      const appSelect = logsFrame.getByLabel('Select app');
      await expect(appSelect).toBeEnabled({ timeout: 10000 });
      await expect(appSelect.locator('option')).toContainText(['finance-uat-api (1)']);

      const currentSettings = readUserSettings(session.userDataDir);
      writeUserSettings(session.userDataDir, {
        ...currentSettings,
        'sapCap.currentScope': {
          regionCode: 'us10',
          orgName: 'missing-external-org',
          spaceName: 'uat',
        },
      });

      await expect(appSelect).toBeDisabled({ timeout: 20000 });
      await expect(appSelect.locator('option')).toHaveText(['— no active app logging —']);
      await expect(webviewFrame.locator('.app-log-catalog')).toContainText(
        'No apps found in current space.',
        { timeout: 20000 }
      );
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test(
    'User can reopen extension and reach monitoring workspace before delayed app hydration completes',
    async () => {
      let session = await launchExtensionHost();

      try {
        const webviewFrame = await openSapToolsSidebar(session.window);
        await selectDefaultScope(webviewFrame);

        const confirmButton = webviewFrame.getByRole('button', {
          name: 'Confirm Scope',
        });
        await expect(confirmButton).toBeEnabled();
        await clickWithFallback(confirmButton);
        await expect(
          webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
        ).toBeVisible({ timeout: 10000 });

        session = await relaunchExtensionHost(session, {
          extraEnv: {
            SAP_TOOLS_E2E_TESTMODE_APPS_DELAY_MS: '5000',
          },
        });

        const reopenedFrame = await openSapToolsSidebar(session.window);
        const restoreStartedAt = Date.now();
        await expect(
          reopenedFrame.getByRole('heading', { name: 'Monitoring Workspace' })
        ).toBeVisible({ timeout: 1500 });
        const restoreDurationMs = Date.now() - restoreStartedAt;
        expect(restoreDurationMs).toBeLessThan(1500);
        await expect(
          reopenedFrame.getByRole('heading', { name: 'Select SAP BTP Region' })
        ).toHaveCount(0);

        await expect(
          reopenedFrame.locator('.app-log-catalog').getByText(/Loading apps/i)
        ).toBeVisible({ timeout: 2000 });
      } finally {
        await cleanupExtensionHost(session);
      }
    }
  );

  test('User can restore confirmed scope after logging out and logging in again in same session', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);

      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Open Settings' }));
      await expect(webviewFrame.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Logout' }));

      const loginFrame = await resolveSapToolsLoginFrame(session.window);
      await expect(loginFrame.getByRole('heading', { name: 'SAP Tools Login' })).toBeVisible({
        timeout: 15000,
      });
      await loginFrame.getByLabel('SAP Email').fill('test@example.com');
      await loginFrame.getByLabel('SAP Password').fill('test-password');
      await clickWithFallback(loginFrame.getByRole('button', { name: 'Save and Continue' }));

      const reloadedFrame = await resolveSapToolsWorkspaceFrame(session.window);
      await expect(
        reloadedFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 20000 });
      await expect(reloadedFrame.locator('.workspace-context')).toContainText(
        'Region: us-10. Org: finance-services-prod. Space: uat'
      );
      await expect(
        reloadedFrame.getByRole('button', { name: 'Confirm Scope' })
      ).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see smooth region hover without notch clipping artifacts', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));

      const regionOption = webviewFrame.locator('.region-layout .region-option').first();
      await expect(regionOption).toBeVisible();
      await clickWithFallback(regionOption);
      await regionOption.hover();
      await expect
        .poll(async () => {
          return regionOption.evaluate((element) => element.matches(':hover'));
        })
        .toBe(true);

      const styleSnapshot = await regionOption.evaluate((element) => {
        const areaOption = document.querySelector('.area-option');
        const regionLayout = element.closest('.region-layout');
        if (
          !(areaOption instanceof HTMLElement) ||
          !(regionLayout instanceof HTMLElement) ||
          !(element instanceof HTMLElement)
        ) {
          return null;
        }

        const areaStyle = getComputedStyle(areaOption);
        const regionStyle = getComputedStyle(element);
        const layoutRect = regionLayout.getBoundingClientRect();
        const optionRect = element.getBoundingClientRect();
        return {
          areaClipPath: areaStyle.clipPath,
          regionBorderTopColor: regionStyle.borderTopColor,
          regionTopDelta: optionRect.top - layoutRect.top,
          regionTransform: regionStyle.transform,
        };
      });

      expect(styleSnapshot).not.toBeNull();
      if (styleSnapshot === null) {
        return;
      }

      expect(styleSnapshot.areaClipPath).toBe('none');
      expect(styleSnapshot.regionBorderTopColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.regionTopDelta).toBeGreaterThanOrEqual(0.4);
      expect(styleSnapshot.regionTransform).not.toBe('none');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see smooth organization and space hover without top border clipping', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await openCustomSelectionMode(webviewFrame);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
      await clickWithFallback(getOrgStageOption(webviewFrame, ORG_TO_SELECT));
      await expect(
        webviewFrame.locator('.org-picker .org-option:not(.is-hidden)').first()
      ).toBeVisible();
      await expect(
        webviewFrame.locator('.space-picker .space-option:not(.is-hidden)').first()
      ).toBeVisible();

      const orgOption = webviewFrame.locator('.org-picker .org-option:not(.is-hidden)').first();
      const spaceOption = webviewFrame.locator('.space-picker .space-option:not(.is-hidden)').first();

      await orgOption.hover();
      await expect
        .poll(async () => {
          return orgOption.evaluate((element) => element.matches(':hover'));
        })
        .toBe(true);

      const orgSnapshot = await orgOption.evaluate((element) => {
        const orgPicker = element.closest('.org-picker');
        if (!(orgPicker instanceof HTMLElement) || !(element instanceof HTMLElement)) {
          return null;
        }

        const orgPickerRect = orgPicker.getBoundingClientRect();
        const orgOptionRect = element.getBoundingClientRect();
        const orgStyle = getComputedStyle(element);
        return {
          borderTopColor: orgStyle.borderTopColor,
          topDelta: orgOptionRect.top - orgPickerRect.top,
          transform: orgStyle.transform,
        };
      });

      await spaceOption.hover();
      await expect
        .poll(async () => {
          return spaceOption.evaluate((element) => element.matches(':hover'));
        })
        .toBe(true);

      const spaceSnapshot = await spaceOption.evaluate((element) => {
        const spacePicker = element.closest('.space-picker');
        if (!(spacePicker instanceof HTMLElement) || !(element instanceof HTMLElement)) {
          return null;
        }

        const spacePickerRect = spacePicker.getBoundingClientRect();
        const spaceOptionRect = element.getBoundingClientRect();
        const spaceStyle = getComputedStyle(element);
        return {
          borderTopColor: spaceStyle.borderTopColor,
          topDelta: spaceOptionRect.top - spacePickerRect.top,
          transform: spaceStyle.transform,
        };
      });

      const styleSnapshot =
        orgSnapshot === null || spaceSnapshot === null
          ? null
          : {
              orgBorderTopColor: orgSnapshot.borderTopColor,
              orgTopDelta: orgSnapshot.topDelta,
              orgTransform: orgSnapshot.transform,
              spaceBorderTopColor: spaceSnapshot.borderTopColor,
              spaceTopDelta: spaceSnapshot.topDelta,
              spaceTransform: spaceSnapshot.transform,
            };

      expect(styleSnapshot).not.toBeNull();
      if (styleSnapshot === null) {
        return;
      }

      expect(styleSnapshot.orgBorderTopColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.spaceBorderTopColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.orgTopDelta).toBeGreaterThanOrEqual(3);
      expect(styleSnapshot.spaceTopDelta).toBeGreaterThanOrEqual(3);
      expect(styleSnapshot.orgTransform).not.toBe('none');
      expect(styleSnapshot.spaceTransform).not.toBe('none');
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can toggle app selection by clicking app row in Apps Log Control', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);

      const appRow = webviewFrame.locator('.app-log-item', {
        hasText: 'finance-uat-api',
      });
      const appCheckbox = appRow.locator('[data-role="log-app-checkbox"]');
      const startLoggingButton = webviewFrame.getByRole('button', {
        name: 'Start App Logging',
      });

      await expect(appCheckbox).not.toBeChecked();
      await expect(startLoggingButton).toBeDisabled();

      await clickWithFallback(appRow);
      await expect(appCheckbox).toBeChecked();
      await expect(startLoggingButton).toBeEnabled();

      await clickWithFallback(appRow);
      await expect(appCheckbox).not.toBeChecked();
      await expect(startLoggingButton).toBeDisabled();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can open Apps tab and view service artifact export controls', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);

      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Services & Packages' })
      ).toBeVisible({ timeout: 10000 });

      await expect(
        webviewFrame.getByRole('button', { name: 'Select Root Folder' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('button', { name: 'Refresh Mapping' })
      ).toHaveCount(0);

      await expect(
        webviewFrame.getByRole('button', { name: 'Export Artifacts' })
      ).toHaveCount(0);

      await expect(webviewFrame.locator('.service-export-root-row')).toHaveCount(1);
      await expect(
        webviewFrame.locator('.service-export-root-row .service-export-path')
      ).toHaveCount(1);
      await expect(
        webviewFrame.getByRole('button', { name: 'Export default-env.json' })
      ).toHaveCount(0);
      await expect(
        webviewFrame.getByRole('button', { name: 'Export pnpm-lock.yaml' })
      ).toHaveCount(0);

      await expect(webviewFrame.getByText('Root: Not selected')).toBeVisible();
      await expect(webviewFrame.getByText('finance-uat-api')).toBeVisible();
      await expect(webviewFrame.getByText('finance-uat-worker')).toBeVisible();
      await expect(webviewFrame.getByText('finance-uat-audit')).toBeVisible();
      await expect(
        webviewFrame.locator('.service-map-row.is-unmapped')
      ).toHaveCount(3);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can reveal artifact actions on mapped service rows', async () => {
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

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));

      const selectRootFolderButton = webviewFrame.getByRole('button', {
        name: 'Select Root Folder',
      });
      await clickWithFallback(selectRootFolderButton);

      await expect(
        webviewFrame.getByRole('button', { name: 'Export Artifacts' })
      ).toHaveCount(0);
      await expect(getMappedServiceIcons(webviewFrame)).toHaveCount(3, { timeout: 10000 });

      const apiRow = webviewFrame
        .locator('.service-map-row')
        .filter({ hasText: 'finance-uat-api' })
        .first();
      await apiRow.hover();
      await expect(apiRow.getByRole('button', { name: 'Replace' })).toBeVisible();
      await expect(apiRow.getByRole('button', { name: 'Export' })).toBeVisible();
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(fixtureRootPath, { recursive: true, force: true });
    }
  });

  test('User can keep mapped services when Select Root Folder is cancelled', async () => {
    const fixtureRootPath = createServiceRootMappingFixture();
    const session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'select,cancel',
        SAP_TOOLS_E2E_ROOT_FOLDER_PATH: fixtureRootPath,
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));

      const selectRootFolderButton = webviewFrame.getByRole('button', {
        name: 'Select Root Folder',
      });
      await clickWithFallback(selectRootFolderButton);

      const mappedStateCells = getMappedServiceIcons(webviewFrame);
      await expect(mappedStateCells).toHaveCount(3, { timeout: 10000 });
      await expect(webviewFrame.locator('.service-export-path')).toContainText(fixtureRootPath);

      // Second open attempt is forced to "cancel" in E2E mode.
      await clickWithFallback(selectRootFolderButton);

      await expect(webviewFrame.getByText(/Scanning local folders/i)).toHaveCount(0);
      await expect(webviewFrame.locator('.service-export-path')).toContainText(fixtureRootPath);
      await expect(mappedStateCells).toHaveCount(3);
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(fixtureRootPath, { recursive: true, force: true });
    }
  });

  test('User can keep current Apps export state when Select Root Folder is cancelled initially', async () => {
    const session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'cancel',
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));

      const selectRootFolderButton = webviewFrame.getByRole('button', {
        name: 'Select Root Folder',
      });
      await clickWithFallback(selectRootFolderButton);

      await expect(webviewFrame.getByText(/Scanning local folders/i)).toHaveCount(0);
      await expect(webviewFrame.locator('.service-export-path')).toContainText('Root: Not selected');
      await expect(webviewFrame.locator('.service-map-row.is-unmapped')).toHaveCount(3);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can remap services after selecting a new root folder', async () => {
    const firstFixtureRootPath = createServiceRootMappingFixture();
    const secondFixtureRootPath = createServiceRootMappingFixture();
    const session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'select,select',
        SAP_TOOLS_E2E_ROOT_FOLDER_PATHS: `${firstFixtureRootPath}::${secondFixtureRootPath}`,
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));

      const selectRootFolderButton = webviewFrame.getByRole('button', {
        name: 'Select Root Folder',
      });
      const mappedStateCells = getMappedServiceIcons(webviewFrame);
      const rootPathLabel = webviewFrame.locator('.service-export-path');

      await clickWithFallback(selectRootFolderButton);
      await expect(mappedStateCells).toHaveCount(3, { timeout: 10000 });
      await expect(rootPathLabel).toContainText(firstFixtureRootPath);

      await clickWithFallback(selectRootFolderButton);
      await expect(webviewFrame.getByText(/Scanning local folders/i)).toHaveCount(0);
      await expect(rootPathLabel).toContainText(secondFixtureRootPath);
      await expect(rootPathLabel).not.toContainText(firstFixtureRootPath);
      await expect(mappedStateCells).toHaveCount(3);
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(firstFixtureRootPath, { recursive: true, force: true });
      fs.rmSync(secondFixtureRootPath, { recursive: true, force: true });
    }
  });

  test('User can reopen extension host and keep mapped services without selecting root folder again', async () => {
    const fixtureRootPath = createServiceRootMappingFixture();
    let session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'select',
        SAP_TOOLS_E2E_ROOT_FOLDER_PATH: fixtureRootPath,
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Select Root Folder' }));
      const mappedStateCells = getMappedServiceIcons(webviewFrame);
      await expect(mappedStateCells).toHaveCount(3, { timeout: 10000 });
      await expect(webviewFrame.locator('.service-export-path')).toContainText(fixtureRootPath);

      session = await relaunchExtensionHost(session);
      const reopenedFrame = await openSapToolsSidebar(session.window);
      await expect(
        reopenedFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 20000 });
      await reopenedFrame
        .locator('.workspace-tabs .tab-button[data-tab-id="apps"]')
        .first()
        .evaluate((button) => {
          if (button instanceof HTMLElement) {
            button.click();
          }
        });

      const reopenedMappedStateCells = getMappedServiceIcons(reopenedFrame);
      await expect(reopenedFrame.locator('.service-export-path')).toContainText(fixtureRootPath, {
        timeout: 15000,
      });
      await expect(reopenedMappedStateCells).toHaveCount(3, { timeout: 10000 });
      await expect(reopenedFrame.locator('.service-map-row.is-unmapped')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(fixtureRootPath, { recursive: true, force: true });
    }
  });

  test('User can reopen extension and see mapped services in Apps export table', async () => {
    const fixtureRootPath = createHeavyServiceRootMappingFixture();
    let session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'select',
        SAP_TOOLS_E2E_ROOT_FOLDER_PATH: fixtureRootPath,
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Select Root Folder' }));

      const mappedStateCells = getMappedServiceIcons(webviewFrame);
      await expect(mappedStateCells).toHaveCount(3, { timeout: 15000 });
      await expect(webviewFrame.locator('.service-export-path')).toContainText(fixtureRootPath);

      session = await relaunchExtensionHost(session);
      const reopenedFrame = await openSapToolsSidebar(session.window, 60000);
      await expect(
        reopenedFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 20000 });
      await reopenedFrame
        .locator('.workspace-tabs .tab-button[data-tab-id="apps"]')
        .first()
        .evaluate((button) => {
          if (button instanceof HTMLElement) {
            button.click();
          }
        });

      const reopenedMappedStateCells = getMappedServiceIcons(reopenedFrame);
      await expect(reopenedMappedStateCells).toHaveCount(3, { timeout: 15000 });
      await expect(reopenedFrame.locator('.service-map-row.is-unmapped')).toHaveCount(0);
      await expect(reopenedFrame.locator('.service-export-path')).toContainText(fixtureRootPath);
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(fixtureRootPath, { recursive: true, force: true });
    }
  });

  test('User can confirm same scope after Change Region and keep mapped services', async () => {
    const fixtureRootPath = createHeavyServiceRootMappingFixture();
    const session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'select',
        SAP_TOOLS_E2E_ROOT_FOLDER_PATH: fixtureRootPath,
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Select Root Folder' }));

      const mappedStateCells = getMappedServiceIcons(webviewFrame);
      await expect(mappedStateCells).toHaveCount(3, { timeout: 15000 });
      await expect(webviewFrame.locator('.service-export-path')).toContainText(fixtureRootPath);

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Change Region' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Select SAP BTP Region' })
      ).toBeVisible({ timeout: 10000 });

      await selectDefaultScope(webviewFrame);
      const reConfirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(reConfirmButton).toBeEnabled();
      await clickWithFallback(reConfirmButton);

      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await expect(webviewFrame.locator('.service-map-row')).toHaveCount(3, { timeout: 15000 });
      await expect(getMappedServiceIcons(webviewFrame)).toHaveCount(3);
      await expect(webviewFrame.getByRole('img', { name: 'Unmapped service' })).toHaveCount(0);
      await expect(webviewFrame.locator('.service-export-path')).toContainText(fixtureRootPath);
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(fixtureRootPath, { recursive: true, force: true });
    }
  });

  test('User can search services in Apps Log Control', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);

      const appLogSearchInput = webviewFrame.getByRole('searchbox', {
        name: 'Search services in Apps Log Control',
      });
      await expect(appLogSearchInput).toBeVisible();
      await expect(webviewFrame.locator('.app-log-item')).toHaveCount(3);

      await appLogSearchInput.fill('worker');
      await expect(webviewFrame.locator('.app-log-item')).toHaveCount(1);
      await expect(webviewFrame.locator('.app-log-item .app-log-name')).toHaveText([
        'finance-uat-worker',
      ]);

      await appLogSearchInput.fill('service-not-found');
      await expect(webviewFrame.locator('.app-log-item')).toHaveCount(0);
      await expect(webviewFrame.getByText('No apps found in current space.')).toBeVisible();

      await appLogSearchInput.fill('');
      await expect(webviewFrame.locator('.app-log-item')).toHaveCount(3);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can search services in Services & Packages', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));

      const serviceSearchInput = webviewFrame.getByRole('searchbox', {
        name: 'Search services in Services & Packages',
      });
      await expect(serviceSearchInput).toBeVisible();
      await expect(webviewFrame.locator('.service-map-row')).toHaveCount(3);

      await serviceSearchInput.fill('worker');
      await expect(webviewFrame.locator('.service-map-row')).toHaveCount(1);
      await expect(webviewFrame.locator('.service-map-row .service-map-name')).toHaveText([
        'finance-uat-worker',
      ]);

      await serviceSearchInput.fill('service-not-found');
      await expect(webviewFrame.locator('.service-map-row')).toHaveCount(0);
      await expect(webviewFrame.getByText('No services match current search.')).toBeVisible();

      await serviceSearchInput.fill('');
      await expect(webviewFrame.locator('.service-map-row')).toHaveCount(3);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see consistent Apps and export typography with front-truncated service paths', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);

      const logsHeadingSnapshot = await webviewFrame.evaluate(() => {
        const activeAppsLogHeading = document.querySelector('.active-apps-log h3');
        const appsLogControlHeading = document.querySelector('.app-logs-panel h2');
        if (
          !(activeAppsLogHeading instanceof HTMLElement) ||
          !(appsLogControlHeading instanceof HTMLElement)
        ) {
          return null;
        }

        return {
          activeAppsLogFontSize: getComputedStyle(activeAppsLogHeading).fontSize,
          appsLogControlFontSize: getComputedStyle(appsLogControlHeading).fontSize,
        };
      });
      expect(logsHeadingSnapshot).not.toBeNull();
      if (logsHeadingSnapshot === null) {
        return;
      }
      expect(logsHeadingSnapshot.activeAppsLogFontSize).toBe(
        logsHeadingSnapshot.appsLogControlFontSize
      );

      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await expect(
        webviewFrame.getByRole('heading', { name: 'Services & Packages' })
      ).toBeVisible();
      await expect(
        webviewFrame.getByRole('button', { name: 'Export Artifacts' })
      ).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see the mapped folder path via the mapped icon tooltip when root path is long', async () => {
    const fixtureRootPath = createLongServiceRootMappingFixture();
    const session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_E2E_ROOT_DIALOG_STEPS: 'select',
        SAP_TOOLS_E2E_ROOT_FOLDER_PATH: fixtureRootPath,
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await selectDefaultScope(webviewFrame);

      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect(confirmButton).toBeEnabled();
      await clickWithFallback(confirmButton);
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Apps' }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Select Root Folder' }));

      await expect(getMappedServiceIcons(webviewFrame)).toHaveCount(3, { timeout: 10000 });

      // The long folder path is no longer rendered inline to save row space; it is
      // exposed through the mapped status icon tooltip instead.
      await expect(
        getMappedServiceIconForApp(webviewFrame, 'finance-uat-api')
      ).toHaveAttribute('title', /\/finance_uat_api$/);

      const mappingListSizeSnapshot = await webviewFrame.evaluate(() => {
        const mappingList = document.querySelector('.service-mapping-list');
        if (!(mappingList instanceof HTMLElement)) {
          return null;
        }
        return {
          clientWidth: mappingList.clientWidth,
          scrollWidth: mappingList.scrollWidth,
        };
      });
      expect(mappingListSizeSnapshot).not.toBeNull();
      if (mappingListSizeSnapshot !== null) {
        expect(mappingListSizeSnapshot.scrollWidth).toBeLessThanOrEqual(
          mappingListSizeSnapshot.clientWidth + 1
        );
      }
    } finally {
      await cleanupExtensionHost(session);
      fs.rmSync(fixtureRootPath, { recursive: true, force: true });
    }
  });

  test('User can open settings, update sync interval, and return to selection screen', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Open Settings' }));
      await expect(webviewFrame.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect(
        webviewFrame.locator('.settings-status-list li span', { hasText: 'Last start' })
      ).toHaveCount(0);

      const buttonHeights = await Promise.all([
        webviewFrame.getByRole('button', { name: 'Sync now' }).evaluate((button) => {
          return Math.round(button.getBoundingClientRect().height);
        }),
        webviewFrame.getByRole('button', { name: 'Logout' }).evaluate((button) => {
          return Math.round(button.getBoundingClientRect().height);
        }),
      ]);
      expect(Math.abs(buttonHeights[0] - buttonHeights[1])).toBeLessThanOrEqual(1);

      await webviewFrame.getByLabel('Cache sync interval').selectOption('12');
      await expect(webviewFrame.getByRole('status')).toContainText(
        /Sync interval updated to 12 hours/i
      );

      await clickWithFallback(
        webviewFrame.getByRole('button', { name: 'Close Settings' })
      );
      await expect(
        webviewFrame.getByRole('heading', { name: 'Select SAP BTP Region' })
      ).toBeVisible();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see interrupted sync status after stale cache sync recovery on launch', async () => {
    const session = await launchExtensionHost({
      extraEnv: {
        SAP_TOOLS_TEST_MODE: '0',
        SAP_TOOLS_E2E_SEED_STALE_SYNC: '1',
      },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Open Settings' }));
      await expect(webviewFrame.getByRole('heading', { name: 'Settings' })).toBeVisible();

      const syncStatusMessage = webviewFrame.locator('.settings-status-message');
      await expect(syncStatusMessage).toContainText(/interrupted/i);
      await expect(syncStatusMessage).not.toContainText(/sync in progress/i);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can logout from settings and return to login gate', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Open Settings' }));
      await expect(webviewFrame.getByRole('heading', { name: 'Settings' })).toBeVisible();

      await clickWithFallback(webviewFrame.getByRole('button', { name: 'Logout' }));
      const loginFrame = await resolveSapToolsLoginFrame(session.window);
      await expect(
        loginFrame.getByRole('heading', { name: 'SAP Tools Login' })
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can start from Quick Org Search when synced topology has orgs', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await expect(getSelectionTab(webviewFrame, 'Quick Org Search')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 15000 }
      );
      await expect(getSelectionTab(webviewFrame, 'Custom')).toHaveAttribute(
        'aria-selected',
        'false'
      );
      await expect(getQuickOrgSearchPanel(webviewFrame)).toBeVisible();
      await expect(getQuickOrgSearchInput(webviewFrame)).toBeVisible();
      await expect(getQuickOrgSearchPanel(webviewFrame)).not.toContainText(
        /orgs synced across regions/i
      );
      await expect(getTopologyOrgRow(webviewFrame, 'finance-services-prod', /^us10\b/i))
        .toBeVisible();
      await expect(webviewFrame.getByRole('heading', { name: 'Choose Area' })).toHaveCount(0);
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use Custom tab without topology rows changing manual selection', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await expect(getSelectionTab(webviewFrame, 'Quick Org Search')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 15000 }
      );
      await clickWithFallback(getSelectionTab(webviewFrame, 'Custom'));
      await expect(getCustomSelectionPanel(webviewFrame)).toBeVisible();
      await expect(getQuickOrgSearchPanel(webviewFrame)).toHaveCount(0);
      await expect(
        webviewFrame.getByRole('button', {
          name: /Quick org search pick finance-services-prod in us10/i,
        })
      ).toHaveCount(0);
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
      await expect(getOrgStageOption(webviewFrame, ORG_TO_SELECT)).toBeVisible({
        timeout: 10000,
      });
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see restored quick scope org name without manual org list', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await expect(getQuickOrgSearchInput(webviewFrame)).toBeVisible({ timeout: 15000 });

      await webviewFrame.evaluate(() => {
        window.postMessage(
          {
            type: 'sapTools.restoreConfirmedScope',
            scope: {
              regionId: 'us10',
              orgGuid: 'live-cf-org-guid',
              orgName: 'finance-services-prod',
              spaceName: 'uat',
            },
          },
          '*'
        );
      });

      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });
      await expect(webviewFrame.locator('.workspace-context')).toContainText(
        'Region: us-10. Org: finance-services-prod. Space: uat'
      );
      await expect(webviewFrame.locator('.workspace-context')).not.toContainText(
        'No org selected'
      );
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can start from Custom tab when synced topology has no orgs', async () => {
    const session = await launchExtensionHost({
      extraEnv: { SAP_TOOLS_E2E_EMPTY_TOPOLOGY: '1' },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await expect(getSelectionTab(webviewFrame, 'Custom')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 15000 }
      );
      await expect(getCustomSelectionPanel(webviewFrame)).toBeVisible();
      await clickWithFallback(getSelectionTab(webviewFrame, 'Quick Org Search'));
      await expect(getQuickOrgSearchPanel(webviewFrame)).toContainText(
        'No synced orgs found.'
      );
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can filter Quick Org Search results by typing a query', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      const searchInput = getQuickOrgSearchInput(webviewFrame);
      await expect(searchInput).toBeVisible({ timeout: 15000 });

      await searchInput.fill('finance');
      await expect(getTopologyOrgRow(webviewFrame, 'finance-services-prod', /^us10\b/i))
        .toBeVisible();
      const filteredNames = await webviewFrame
        .getByRole('button', { name: /Quick org search pick/i })
        .allInnerTexts();
      expect(filteredNames.length).toBeGreaterThan(0);
      expect(
        filteredNames.every((name) => name.toLowerCase().includes('finance'))
      ).toBe(true);

      await searchInput.fill('this-org-does-not-exist-anywhere');
      await expect(getQuickOrgSearchPanel(webviewFrame)).toContainText(
        'No org matches "this-org-does-not-exist-anywhere"'
      );
      await expect(
        webviewFrame.getByRole('button', { name: /Quick org search pick/i })
      ).toHaveCount(0);

      await searchInput.fill('');
      await expect(getTopologyOrgRow(webviewFrame, 'finance-services-prod', /^us10\b/i))
        .toBeVisible();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can keep Quick Org Search input focus while topology refreshes', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      const searchInput = getQuickOrgSearchInput(webviewFrame);
      await expect(searchInput).toBeVisible({ timeout: 15000 });
      await searchInput.fill('finance-services-prod');
      await searchInput.evaluate((element) => {
        if (!(element instanceof HTMLInputElement)) {
          return;
        }
        element.focus();
        element.setSelectionRange(7, 7);
      });

      await webviewFrame.evaluate(() => {
        window.postMessage(
          {
            type: 'sapTools.cfTopology',
            topology: {
              ready: true,
              accounts: [
                {
                  regionKey: 'us10',
                  regionLabel: 'US East (VA) - AWS (us10)',
                  apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
                  orgName: 'finance-services-prod',
                  spaces: ['prod', 'uat', 'sandbox'],
                },
                {
                  regionKey: 'br10',
                  regionLabel: 'Brazil (Sao Paulo) - AWS (br10)',
                  apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
                  orgName: 'finance-services-prod',
                  spaces: ['prod', 'uat', 'sandbox'],
                },
              ],
            },
          },
          '*'
        );
      });

      await expect(searchInput).toHaveValue('finance-services-prod');
      await expect
        .poll(async () => {
          return getQuickOrgSearchInput(webviewFrame).evaluate((element) => {
            if (!(element instanceof HTMLInputElement)) {
              return { focused: false, selectionStart: -1 };
            }
            return {
              focused: document.activeElement === element,
              selectionStart: element.selectionStart ?? -1,
            };
          });
        })
        .toEqual({ focused: true, selectionStart: 7 });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can choose org and space in Quick tab with focused organization and space sections', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      const searchInput = getQuickOrgSearchInput(webviewFrame);
      await expect(searchInput).toBeVisible({ timeout: 15000 });

      await searchInput.fill('finance-services-prod');
      const targetRow = getTopologyOrgRow(webviewFrame, 'finance-services-prod', /^us10\b/i);
      await expect(targetRow).toBeVisible();
      await clickWithFallback(targetRow);

      const quickPanel = getQuickOrgSearchPanel(webviewFrame);
      await expect(
        quickPanel.getByRole('region', { name: 'Quick organization' })
      ).toBeVisible();
      await expect(quickPanel.getByRole('heading', { name: 'Organization' }))
        .toBeVisible();
      await expect(
        quickPanel.getByRole('button', {
          name: /finance-services-prod in us-10 US East \(VA\)/i,
        })
      ).toBeVisible();
      await expect(
        quickPanel.getByRole('region', { name: 'Quick space list' })
      ).toBeVisible();
      await expect(quickPanel.getByRole('heading', { name: 'Choose Space' }))
        .toBeVisible();
      await expect(webviewFrame.getByRole('heading', { name: 'Choose Area' }))
        .toHaveCount(0);
      await expect(webviewFrame.getByRole('heading', { name: 'Choose Region' }))
        .toHaveCount(0);
      const quickBackLayout = await webviewFrame.evaluate(() => {
        const quickPanelElement = document.querySelector('.selection-quick-panel');
        const spaceStage = quickPanelElement?.querySelector(
          '[data-stage-id="quick-space"]'
        );
        const backButton = quickPanelElement?.querySelector(
          '[data-action="quick-back-to-orgs"]'
        );

        if (!(spaceStage instanceof HTMLElement) || !(backButton instanceof HTMLElement)) {
          return { backBelowSpace: false, backMinWidth: 0, backWidth: 0, confirmWidth: 0 };
        }

        const confirmButton = quickPanelElement?.querySelector(
          '[data-action="quick-confirm-scope"]'
        );

        if (!(confirmButton instanceof HTMLElement)) {
          return { backBelowSpace: false, backMinWidth: 0, backWidth: 0, confirmWidth: 0 };
        }

        return {
          backBelowSpace:
            backButton.getBoundingClientRect().top >=
            spaceStage.getBoundingClientRect().bottom - 1,
          backMinWidth: Number.parseFloat(getComputedStyle(backButton).minWidth),
          backWidth: backButton.getBoundingClientRect().width,
          confirmWidth: confirmButton.getBoundingClientRect().width,
        };
      });
      expect(quickBackLayout.backBelowSpace).toBe(true);
      expect(quickBackLayout.backMinWidth).toBeGreaterThanOrEqual(80);
      expect(Math.abs(quickBackLayout.backWidth - quickBackLayout.confirmWidth))
        .toBeLessThanOrEqual(1);
      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeDisabled();
      await expect
        .poll(() => confirmButton.evaluate((button) => button.closest('.group-card') === null))
        .toBe(true);
      await clickWithFallback(webviewFrame.getByRole('button', { name: SPACE_TO_SELECT }));
      await expect(confirmButton).toBeEnabled();
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can continue immediately when Quick Org Search finds one space', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      const searchInput = getQuickOrgSearchInput(webviewFrame);
      await expect(searchInput).toBeVisible({ timeout: 15000 });

      await searchInput.fill('apps-proof-prod');
      const targetRow = getTopologyOrgRow(webviewFrame, 'apps-proof-prod', /^us10\b/i);
      await expect(targetRow).toBeVisible();
      await clickWithFallback(targetRow);

      const quickPanel = getQuickOrgSearchPanel(webviewFrame);
      await expect(
        quickPanel.getByRole('region', { name: 'Quick space list' })
      ).toBeVisible();
      const proofspaceButton = quickPanel.getByRole('button', { name: /^proofspace$/i });
      await expect(proofspaceButton).toBeVisible();
      await expect(proofspaceButton).toHaveAttribute('aria-pressed', 'true');
      await expect(quickPanel.getByRole('button', { name: /^proofspace$/i }))
        .toHaveCount(1);

      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await expect(webviewFrame.locator('.stage-loading')).toHaveCount(0);
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can confirm scope from Quick tab and enter monitoring workspace', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      const searchInput = getQuickOrgSearchInput(webviewFrame);
      await expect(searchInput).toBeVisible({ timeout: 15000 });

      await searchInput.fill('finance-services-prod');
      const targetRow = getTopologyOrgRow(
        webviewFrame,
        'finance-services-prod',
        /^us10\b/i
      );
      await expect(targetRow).toBeVisible();
      await clickWithFallback(targetRow);

      await clickWithFallback(webviewFrame.getByRole('button', { name: SPACE_TO_SELECT }));
      const confirmButton = webviewFrame.getByRole('button', {
        name: 'Confirm Scope',
      });
      await expect(confirmButton).toBeEnabled();
      await expect
        .poll(() => confirmButton.evaluate((button) => button.closest('.group-card') === null))
        .toBe(true);
      await clickWithFallback(confirmButton);
      await expect(
        webviewFrame.getByRole('heading', { name: 'Monitoring Workspace' })
      ).toBeVisible({ timeout: 10000 });
      await expect(webviewFrame.locator('.workspace-context')).toContainText(
        'Region: us-10. Org: finance-services-prod. Space: uat'
      );
      await expect(webviewFrame.getByText('finance-uat-api')).toBeVisible({
        timeout: 10000,
      });
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can return from Quick space view and reset Quick state through tab switching', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      const searchInput = getQuickOrgSearchInput(webviewFrame);
      await expect(searchInput).toBeVisible({ timeout: 15000 });

      await searchInput.fill('finance-services-prod');
      await clickWithFallback(
        getTopologyOrgRow(webviewFrame, 'finance-services-prod', /^us10\b/i)
      );
      await expect(webviewFrame.getByRole('heading', { name: 'Choose Space' }))
        .toBeVisible();
      await clickWithFallback(webviewFrame.getByRole('button', { name: /Back/i }));
      await expect(getTopologyOrgRow(webviewFrame, 'finance-services-prod', /^us10\b/i))
        .toBeVisible();

      await clickWithFallback(
        getTopologyOrgRow(webviewFrame, 'finance-services-prod', /^br10\b/i)
      );
      await expect(webviewFrame.getByText('br-10 Brazil (Sao Paulo)')).toBeVisible();
      await clickWithFallback(getSelectionTab(webviewFrame, 'Custom'));
      await expect(getCustomSelectionPanel(webviewFrame)).toBeVisible();
      await clickWithFallback(getSelectionTab(webviewFrame, 'Quick Org Search'));
      await expect(getQuickOrgSearchInput(webviewFrame)).toHaveValue('finance-services-prod');
      await expect(webviewFrame.getByRole('heading', { name: 'Choose Space' }))
        .toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can see disabled Quick confirmation when a topology org has no spaces', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await expect(getQuickOrgSearchInput(webviewFrame)).toBeVisible({ timeout: 15000 });
      await webviewFrame.evaluate(() => {
        window.postMessage(
          {
            type: 'sapTools.cfTopology',
            topology: {
              ready: true,
              accounts: [
                {
                  regionKey: 'us10',
                  regionLabel: 'US East (VA) - AWS (us10)',
                  apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
                  orgName: 'empty-spaces-prod',
                  spaces: [],
                },
              ],
            },
          },
          '*'
        );
      });

      await clickWithFallback(
        webviewFrame.getByRole('button', {
          name: /Quick org search pick empty-spaces-prod in us10/i,
        })
      );
      await expect(getQuickOrgSearchPanel(webviewFrame)).toContainText(
        'No spaces found for this org.'
      );
      await expect(webviewFrame.getByRole('button', { name: 'Confirm Scope' }))
        .toBeDisabled();
      await expect(webviewFrame.locator('.stage-error')).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can scroll Custom selection on a short sidebar', async () => {
    const session = await launchExtensionHost();

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await session.window.setViewportSize({ width: 430, height: 460 });
      await clickWithFallback(getSelectionTab(webviewFrame, 'Custom'));
      await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
      await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
      await clickWithFallback(getOrgStageOption(webviewFrame, ORG_TO_SELECT));

      const scrollSnapshot = await webviewFrame.evaluate(() => {
        const groups = document.querySelector('.groups');
        const confirm = document.querySelector('[aria-label="Region confirmation"]');
        if (!(groups instanceof HTMLElement) || !(confirm instanceof HTMLElement)) {
          return null;
        }
        const beforeBottom = confirm.getBoundingClientRect().bottom;
        groups.scrollTop = groups.scrollHeight;
        const afterBottom = confirm.getBoundingClientRect().bottom;
        const afterTop = confirm.getBoundingClientRect().top;
        return {
          beforeBottom,
          afterBottom,
          afterTop,
          viewportHeight: window.innerHeight,
          canScroll: groups.scrollHeight > groups.clientHeight,
          overflowY: getComputedStyle(groups).overflowY,
        };
      });

      expect(scrollSnapshot).toEqual(
        expect.objectContaining({
          canScroll: true,
          overflowY: 'auto',
        })
      );
      expect(scrollSnapshot?.afterBottom).toBeLessThanOrEqual(
        scrollSnapshot?.viewportHeight ?? 0
      );
      expect(scrollSnapshot?.afterTop).toBeGreaterThanOrEqual(0);
      const confirmButton = webviewFrame.getByRole('button', { name: 'Confirm Scope' });
      await expect
        .poll(() => confirmButton.evaluate((button) => button.closest('.group-card') === null))
        .toBe(true);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can use area selector when cf-sync topology is unavailable', async () => {
    const session = await launchExtensionHost({
      extraEnv: { SAP_TOOLS_E2E_DISABLE_TOPOLOGY: '1' },
    });

    try {
      const webviewFrame = await openSapToolsSidebar(session.window);
      await expect(
        webviewFrame.getByRole('heading', { name: 'Choose Area' })
      ).toBeVisible({ timeout: 15000 });
      await expect(getSelectionTab(webviewFrame, 'Quick Org Search')).toHaveCount(0);
      await expect(getSelectionTab(webviewFrame, 'Custom')).toHaveCount(0);
      await expect(webviewFrame.getByRole('searchbox', {
        name: 'Search synced organizations',
      })).toHaveCount(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
