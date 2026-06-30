import fs from 'node:fs';
import path from 'node:path';

import {
  expect,
  _electron as electron,
  type ElectronApplication,
  type Frame,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  getExtensionRootDir,
  getTemporaryExtensionsDir,
  getTemporaryUserDataDir,
  getTemporaryWorkspaceDir,
  resolveVscodeExecutablePath,
} from '../../src/launchVscode';

export const ACTIVITY_BAR_TITLE = 'SAP Tools';
export const AREA_TO_SELECT = /Americas\s+br - ca - us/i;
export const EUROPE_AREA_TO_SELECT = /Europe\s+ch - eu - uk/i;
export const REGION_TO_SELECT = /us-10\s+US East \(VA\)/i;
export const US10001_REGION_TO_SELECT = /us10-001\s+US East \(VA\) Extension/i;
export const US10002_REGION_TO_SELECT = /us10-002\s+US East \(VA\) Extension/i;
export const EU10004_REGION_TO_SELECT = /eu10-004\s+Europe \(Frankfurt\) Extension/i;
export const EU20002_REGION_TO_SELECT = /eu20-002\s+Europe \(Netherlands\) Extension/i;
export const BR10_REGION_TO_SELECT = /br-10\s+Brazil \(Sao Paulo\)/i;
export const ORG_TO_SELECT = /finance-services-prod/i;
export const PROOF_ORG_TO_SELECT = /apps-proof-prod/i;
export const SPACE_TO_SELECT = /^uat$/i;
export const DEFAULT_THEME_NAME = 'Default Dark Modern';

export interface ThemeScenario {
  readonly id: string;
  readonly colorTheme: string;
  readonly expectedBodyThemeClass: string;
  readonly maxShellBrightness?: number;
  readonly minShellBrightness?: number;
}

export const THEME_SCENARIOS: readonly ThemeScenario[] = [
  {
    id: 'dark',
    colorTheme: 'Default Dark Modern',
    expectedBodyThemeClass: 'vscode-dark',
    maxShellBrightness: 0.2,
  },
  {
    id: 'light',
    colorTheme: 'Default Light Modern',
    expectedBodyThemeClass: 'vscode-light',
    minShellBrightness: 0.45,
  },
  {
    id: 'high-contrast',
    colorTheme: 'Default High Contrast',
    expectedBodyThemeClass: 'vscode-high-contrast',
    maxShellBrightness: 0.15,
  },
];

export interface ExtensionHostSession {
  readonly electronApp: ElectronApplication;
  readonly extensionsDir: string;
  readonly window: Page;
  readonly workspaceDir: string;
  readonly userDataDir: string;
}

export interface PaletteSnapshot {
  readonly bodyBackgroundColor: string;
  readonly shellBackgroundColor: string;
  readonly bodyBrightness: number;
  readonly shellBrightness: number;
}

export interface ShellNodeStabilitySnapshot {
  readonly sameShellNode: boolean;
  readonly sameHeaderNode: boolean;
  readonly sameGroupsNode: boolean;
  readonly sameAreaSlotNode: boolean;
  readonly sameRegionSlotNode: boolean;
  readonly sameOrgSlotNode: boolean;
}

export interface ViewportGutterSnapshot {
  readonly viewportWidth: number;
  readonly appLeft: number;
  readonly appRight: number;
  readonly appWidth: number;
  readonly bodyPaddingLeft: number;
  readonly bodyPaddingRight: number;
}

export interface ExtensionHostLaunchOptions {
  readonly colorTheme?: string;
  readonly extraEnv?: Readonly<Record<string, string>>;
  /**
   * When true, passes SAP_EMAIL and SAP_PASSWORD so the extension skips the
   * login gate and renders the main region selector immediately.
   * Also sets SAP_TOOLS_TEST_MODE=1 to use mock CF org/space data.
   * Default: true (most tests need to reach the region selector).
   */
  readonly withMockCredentials?: boolean;
}

export function buildExtensionHostEnv(
  withMockCredentials: boolean,
  extraEnv: Readonly<Record<string, string>>
): Record<string, string> {
  const env = toLaunchEnv(process.env);
  env['SAP_TOOLS_E2E'] = '1';

  if (withMockCredentials) {
    env['SAP_EMAIL'] = 'test@example.com';
    env['SAP_PASSWORD'] = 'test-password';
    env['SAP_TOOLS_TEST_MODE'] = '1';
    delete env['SAP_TOOLS_FORCE_LOGIN_GATE'];
    for (const [key, value] of Object.entries(extraEnv)) {
      env[key] = value;
    }
    return env;
  }

  delete env['SAP_EMAIL'];
  delete env['SAP_PASSWORD'];
  delete env['SAP_TOOLS_TEST_MODE'];
  env['SAP_TOOLS_FORCE_LOGIN_GATE'] = '1';
  for (const [key, value] of Object.entries(extraEnv)) {
    env[key] = value;
  }
  return env;
}

export function toLaunchEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  return env;
}

export function ensureThemeSettings(userDataDir: string, colorTheme: string): void {
  const userConfigDir = path.join(userDataDir, 'User');
  fs.mkdirSync(userConfigDir, { recursive: true });
  const settingsPath = path.join(userConfigDir, 'settings.json');
  const settings = {
    'workbench.colorTheme': colorTheme,
  };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

export function createServiceRootMappingFixture(): string {
  const fixtureRoot = fs.mkdtempSync(path.join('/tmp', 'sap-tools-e2e-root-'));
  const folderNames = ['finance_uat_api', 'finance_uat_worker', 'finance_uat_audit'];

  for (const folderName of folderNames) {
    const serviceFolder = path.join(fixtureRoot, folderName);
    fs.mkdirSync(serviceFolder, { recursive: true });
    fs.writeFileSync(path.join(serviceFolder, 'package.json'), '{ "name": "fixture" }\n', 'utf8');
  }

  return fixtureRoot;
}

export function createLongServiceRootMappingFixture(): string {
  const fixtureRoot = fs.mkdtempSync(path.join('/tmp', 'sap-tools-e2e-root-long-'));
  const nestedSegments = [
    'very-long-root-folder-name-for-leading-ellipsis-check',
    'team-integration-environment-with-lengthy-directory-name',
    'sap-cap-service-artifacts-generated-output-folder',
  ];

  const longRootPath = nestedSegments.reduce((currentPath, segment) => {
    return path.join(currentPath, segment);
  }, fixtureRoot);
  fs.mkdirSync(longRootPath, { recursive: true });

  const folderNames = ['finance_uat_api', 'finance_uat_worker', 'finance_uat_audit'];
  for (const folderName of folderNames) {
    const serviceFolder = path.join(longRootPath, folderName);
    fs.mkdirSync(serviceFolder, { recursive: true });
    fs.writeFileSync(path.join(serviceFolder, 'package.json'), '{ "name": "fixture" }\n', 'utf8');
  }

  return longRootPath;
}

export function createHeavyServiceRootMappingFixture(): string {
  const fixtureRoot = createServiceRootMappingFixture();
  const noiseRoot = path.join(fixtureRoot, 'noise-tree');

  for (let branchIndex = 0; branchIndex < 60; branchIndex += 1) {
    const branchRoot = path.join(noiseRoot, `branch-${String(branchIndex)}`);
    fs.mkdirSync(path.join(branchRoot, 'level-a', 'level-b', 'level-c'), {
      recursive: true,
    });

    for (let leafIndex = 0; leafIndex < 8; leafIndex += 1) {
      fs.mkdirSync(path.join(branchRoot, 'level-a', `leaf-a-${String(leafIndex)}`), {
        recursive: true,
      });
      fs.mkdirSync(path.join(branchRoot, 'level-a', 'level-b', `leaf-b-${String(leafIndex)}`), {
        recursive: true,
      });
      fs.mkdirSync(
        path.join(
          branchRoot,
          'level-a',
          'level-b',
          'level-c',
          `leaf-c-${String(leafIndex)}`
        ),
        {
          recursive: true,
        }
      );
    }
  }

  return fixtureRoot;
}

export async function dismissAiSignInModalIfNeeded(window: Page): Promise<void> {
  const signInPrompt = window.getByText('Sign in to use AI Features');
  const appeared = await signInPrompt
    .waitFor({ state: 'visible', timeout: 1500 })
    .then(() => true)
    .catch(() => false);

  if (!appeared) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await window.keyboard.press('Escape');
    const hidden = await signInPrompt.isHidden().catch(() => true);
    if (hidden) {
      return;
    }
  }

  const closeButton = window.getByRole('button', { name: /close/i });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }

  await expect(signInPrompt).toBeHidden({ timeout: 10000 });
}

export async function launchExtensionHost(
  options: ExtensionHostLaunchOptions = {}
): Promise<ExtensionHostSession> {
  const extensionPath = getExtensionRootDir();
  const workspaceDir = getTemporaryWorkspaceDir();
  const userDataDir = getTemporaryUserDataDir();
  const extensionsDir = getTemporaryExtensionsDir();
  ensureThemeSettings(userDataDir, options.colorTheme ?? DEFAULT_THEME_NAME);

  const withMockCredentials = options.withMockCredentials !== false;

  const electronApp = await electron.launch({
    executablePath: resolveVscodeExecutablePath(),
    args: [
      workspaceDir,
      `--extensionDevelopmentPath=${extensionPath}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--new-window',
    ],
    env: buildExtensionHostEnv(withMockCredentials, options.extraEnv ?? {}),
    timeout: 180000,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await dismissAiSignInModalIfNeeded(window);

  return {
    electronApp,
    extensionsDir,
    window,
    workspaceDir,
    userDataDir,
  };
}

export async function relaunchExtensionHost(
  previousSession: ExtensionHostSession,
  options: ExtensionHostLaunchOptions = {}
): Promise<ExtensionHostSession> {
  await previousSession.electronApp.close();

  const extensionPath = getExtensionRootDir();
  const workspaceDir = previousSession.workspaceDir;
  const userDataDir = previousSession.userDataDir;
  const extensionsDir = previousSession.extensionsDir;
  ensureThemeSettings(userDataDir, options.colorTheme ?? DEFAULT_THEME_NAME);

  const withMockCredentials = options.withMockCredentials !== false;
  const electronApp = await electron.launch({
    executablePath: resolveVscodeExecutablePath(),
    args: [
      workspaceDir,
      `--extensionDevelopmentPath=${extensionPath}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--new-window',
    ],
    env: buildExtensionHostEnv(withMockCredentials, options.extraEnv ?? {}),
    timeout: 180000,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await dismissAiSignInModalIfNeeded(window);

  return {
    electronApp,
    extensionsDir,
    window,
    workspaceDir,
    userDataDir,
  };
}

export async function cleanupExtensionHost(session: ExtensionHostSession): Promise<void> {
  await session.electronApp.close();
  fs.rmSync(session.extensionsDir, { recursive: true, force: true });
  fs.rmSync(session.workspaceDir, { recursive: true, force: true });
  fs.rmSync(session.userDataDir, { recursive: true, force: true });
}

export async function findSapToolsWebviewFrame(window: Page): Promise<Frame | undefined> {
  const candidateFrames = window
    .frames()
    .filter((frame) => frame.url().includes('vscode-webview://'));

  for (const frame of [...candidateFrames].reverse()) {
    // Match the main selector, login gate, or confirmed workspace heading.
    const regionTitle = frame.getByRole('heading', { name: 'Select SAP BTP Region' });
    const loginTitle = frame.getByRole('heading', { name: 'SAP Tools Login' });
    const workspaceTitle = frame.getByRole('heading', { name: 'BTP Workspace' });
    const isRegionVisible = await regionTitle.isVisible().catch(() => false);
    const isLoginVisible = await loginTitle.isVisible().catch(() => false);
    const isWorkspaceVisible = await workspaceTitle.isVisible().catch(() => false);
    if (isRegionVisible || isLoginVisible || isWorkspaceVisible) {
      return frame;
    }
  }

  return undefined;
}

export async function findSapToolsRegionFrame(window: Page): Promise<Frame | undefined> {
  const candidateFrames = window
    .frames()
    .filter((frame) => frame.url().includes('vscode-webview://'));

  for (const frame of [...candidateFrames].reverse()) {
    const regionTitle = frame.getByRole('heading', { name: 'Select SAP BTP Region' });
    const isRegionVisible = await regionTitle.isVisible().catch(() => false);
    if (isRegionVisible) {
      return frame;
    }
  }

  return undefined;
}

export async function findSapToolsLoginFrame(window: Page): Promise<Frame | undefined> {
  const candidateFrames = window
    .frames()
    .filter((frame) => frame.url().includes('vscode-webview://'));

  for (const frame of [...candidateFrames].reverse()) {
    const loginTitle = frame.getByRole('heading', { name: 'SAP Tools Login' });
    const isLoginVisible = await loginTitle.isVisible().catch(() => false);
    if (isLoginVisible) {
      return frame;
    }
  }

  return undefined;
}

export async function findSapToolsWorkspaceFrame(window: Page): Promise<Frame | undefined> {
  const candidateFrames = window
    .frames()
    .filter((frame) => frame.url().includes('vscode-webview://'));

  for (const frame of [...candidateFrames].reverse()) {
    const workspaceTitle = frame.getByRole('heading', { name: 'BTP Workspace' });
    const isWorkspaceVisible = await workspaceTitle.isVisible().catch(() => false);
    if (isWorkspaceVisible) {
      return frame;
    }
  }

  return undefined;
}

export async function findCfLogsPanelFrame(window: Page): Promise<Frame | undefined> {
  const candidateFrames = window
    .frames()
    .filter((frame) => frame.url().includes('vscode-webview://'));

  for (const frame of [...candidateFrames].reverse()) {
    const hasLogTable = (await frame.locator('.cf-log-table').count()) > 0;
    const hasSearchFilter = (await frame.getByLabel('Search logs').count()) > 0;
    if (hasLogTable && hasSearchFilter) {
      return frame;
    }
  }

  return undefined;
}

export async function resolveSapToolsWebviewFrame(
  window: Page,
  timeoutMs = 20000
): Promise<Frame> {
  await expect
    .poll(
      async () => {
        const frame = await findSapToolsWebviewFrame(window);
        return frame?.url() ?? '';
      },
      { timeout: timeoutMs }
    )
    .toContain('vscode-webview://');

  const frame = await findSapToolsWebviewFrame(window);
  if (frame === undefined) {
    throw new Error('SAP Tools webview frame was not found.');
  }

  return frame;
}

export async function resolveSapToolsRegionFrame(window: Page): Promise<Frame> {
  await expect
    .poll(
      async () => {
        const frame = await findSapToolsRegionFrame(window);
        return frame?.url() ?? '';
      },
      { timeout: 20000 }
    )
    .toContain('vscode-webview://');

  const frame = await findSapToolsRegionFrame(window);
  if (frame === undefined) {
    throw new Error('SAP Tools region frame was not found.');
  }

  return frame;
}

export async function resolveSapToolsLoginFrame(window: Page): Promise<Frame> {
  await expect
    .poll(
      async () => {
        const frame = await findSapToolsLoginFrame(window);
        return frame?.url() ?? '';
      },
      { timeout: 20000 }
    )
    .toContain('vscode-webview://');

  const frame = await findSapToolsLoginFrame(window);
  if (frame === undefined) {
    throw new Error('SAP Tools login frame was not found.');
  }

  return frame;
}

export async function resolveSapToolsWorkspaceFrame(
  window: Page,
  timeoutMs = 20000
): Promise<Frame> {
  await expect
    .poll(
      async () => {
        const frame = await findSapToolsWorkspaceFrame(window);
        return frame?.url() ?? '';
      },
      { timeout: timeoutMs }
    )
    .toContain('vscode-webview://');

  const frame = await findSapToolsWorkspaceFrame(window);
  if (frame === undefined) {
    throw new Error('SAP Tools workspace frame was not found.');
  }

  return frame;
}

export async function openSapToolsSidebar(
  window: Page,
  timeoutMs = 20000
): Promise<Frame> {
  const visibleFrame = await findSapToolsWebviewFrame(window);
  if (visibleFrame !== undefined) {
    return visibleFrame;
  }

  const sapToolsTab = window.getByRole('tab', {
    name: new RegExp(ACTIVITY_BAR_TITLE),
  });
  await expect(sapToolsTab).toBeVisible({ timeout: timeoutMs });
  await clickWithFallback(sapToolsTab);

  try {
    return await resolveSapToolsWebviewFrame(window, timeoutMs);
  } catch {
    await clickWithFallback(sapToolsTab);
    return await resolveSapToolsWebviewFrame(window, timeoutMs + 10000);
  }
}

export async function selectDefaultScope(webviewFrame: Frame): Promise<void> {
  await openCustomSelectionMode(webviewFrame);
  await clickWithFallback(webviewFrame.getByRole('button', { name: AREA_TO_SELECT }));
  await clickWithFallback(webviewFrame.getByRole('button', { name: REGION_TO_SELECT }));
  const orgOption = getOrgStageOption(webviewFrame, ORG_TO_SELECT);
  await expect(orgOption).toBeVisible({ timeout: 10000 });
  await clickWithFallback(orgOption);
  await expect(
    webviewFrame.getByRole('button', { name: SPACE_TO_SELECT })
  ).toBeVisible({ timeout: 10000 });
  await clickWithFallback(webviewFrame.getByRole('button', { name: SPACE_TO_SELECT }));
}

export function getSelectionTab(
  webviewFrame: Frame,
  name: 'Quick Org Search' | 'Custom'
): Locator {
  return webviewFrame.getByRole('tab', { name });
}

export function getCustomSelectionPanel(webviewFrame: Frame): Locator {
  return webviewFrame.getByRole('list', { name: 'Custom' });
}

export async function openCustomSelectionMode(webviewFrame: Frame): Promise<void> {
  const customTab = getSelectionTab(webviewFrame, 'Custom');
  const areaOption = webviewFrame.getByRole('button', { name: AREA_TO_SELECT });
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (await areaOption.isVisible().catch((): false => false)) {
        return;
      }
      await expect(customTab).toBeVisible({ timeout: 10000 });
      if ((await customTab.getAttribute('aria-selected')) !== 'true') {
        await clickWithFallback(customTab);
      }
      await expect(customTab).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
      await expect(getCustomSelectionPanel(webviewFrame)).toBeVisible({ timeout: 10000 });
      await expect(areaOption).toBeVisible({ timeout: 10000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('Custom selection mode did not become ready.');
}

export function getOrgStageOption(webviewFrame: Frame, name: string | RegExp): Locator {
  return webviewFrame
    .getByRole('region', { name: 'Organization list' })
    .getByRole('button', { name });
}

export function getOrgSearchInput(webviewFrame: Frame): Locator {
  return webviewFrame
    .getByRole('region', { name: 'Organization list' })
    .getByRole('searchbox', { name: 'Search organizations' });
}

export async function clickWithFallback(locator: Locator): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await locator.click({ timeout: 10000 });
      return;
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const pointerIntercepted = errorMessage.includes('intercepts pointer events');
      if (pointerIntercepted) {
        await locator.click({ force: true, timeout: 10000 });
        return;
      }

      const detachedFromDom =
        errorMessage.includes('Element is not attached to the DOM') ||
        errorMessage.includes('element is not attached') ||
        errorMessage.includes('element was detached from the DOM');
      const transientDomState =
        detachedFromDom || errorMessage.includes('element is not stable');
      if (transientDomState) {
        continue;
      }

      throw error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('Failed to click locator after retries.');
}

export async function resolveCfLogsPanelFrame(
  window: Page,
  timeoutMs: number
): Promise<Frame | undefined> {
  try {
    await expect
      .poll(
        async () => {
          const frame = await findCfLogsPanelFrame(window);
          return frame?.url() ?? '';
        },
        { timeout: timeoutMs }
      )
      .toContain('vscode-webview://');
  } catch {
    return undefined;
  }

  return findCfLogsPanelFrame(window);
}

export async function openCfLogsPanel(window: Page): Promise<Frame> {
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+L' : 'Control+Alt+L');
  const frameFromShortcut = await resolveCfLogsPanelFrame(window, 10000);
  if (frameFromShortcut !== undefined) {
    return frameFromShortcut;
  }

  await runWorkbenchCommand(window, 'Open CFLogs Panel');

  const frameFromCommand = await resolveCfLogsPanelFrame(window, 15000);
  if (frameFromCommand !== undefined) {
    return frameFromCommand;
  }

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
  const panelPart = window.locator('[id="workbench.parts.panel"]');
  const panelTab = panelPart.getByRole('tab', { name: /SAP TOOLS|CFLogs/i });
  const panelTabVisible = await panelTab
    .isVisible()
    .catch((): false => false);
  if (panelTabVisible) {
    await clickWithFallback(panelTab);
  }

  const frame = await resolveCfLogsPanelFrame(window, 15000);
  if (frame !== undefined) {
    return frame;
  }

  throw new Error('CF logs panel frame was not found.');
}

export async function runWorkbenchCommand(window: Page, commandTitle: string): Promise<void> {
  const openCommandPalette = async (): Promise<void> => {
    await window.keyboard.press('F1');
  };

  await openCommandPalette();

  const quickInputWidget = window.locator('.quick-input-widget:visible').first();
  const widgetVisible = await quickInputWidget.isVisible().catch(() => false);
  if (!widgetVisible) {
    await window.keyboard.press('F1');
    await expect(quickInputWidget).toBeVisible({ timeout: 10000 });
  }

  const quickInputField = quickInputWidget.locator('input[type="text"]').first();
  await expect(quickInputField).toBeVisible({ timeout: 10000 });
  await quickInputField.click();
  await quickInputField.fill('');
  await window.keyboard.type(`>${commandTitle}`);
  await window.keyboard.press('Enter');
}

export async function openSapToolsOutputChannel(window: Page): Promise<void> {
  await runWorkbenchCommand(window, 'Output: Show Output Channels');

  const quickInputWidget = window.locator('.quick-input-widget:visible').first();
  const quickPickVisible = await quickInputWidget
    .isVisible({ timeout: 5000 })
    .catch((): false => false);
  if (quickPickVisible) {
    const quickInputField = quickInputWidget.locator('input[type="text"]').first();
    await expect(quickInputField).toBeVisible({ timeout: 10000 });
    await quickInputField.fill('SAP Tools');
    await clickWithFallback(quickInputWidget.getByText('SAP Tools', { exact: true }).first());
  }

  await expect
    .poll(
      async () => readVisibleOutputChannelText(window),
      { timeout: 15000 }
    )
    .not.toBe('');
}

export async function readVisibleOutputChannelText(window: Page): Promise<string> {
  return window.evaluate(() => {
    const panelElement = document.querySelector('[id="workbench.parts.panel"]');
    const rootElement = panelElement ?? document.body;
    return Array.from(rootElement.querySelectorAll('.monaco-editor .view-lines .view-line'))
      .map((line) => line.textContent)
      .join('\n')
      .replaceAll('\u00a0', ' ');
  });
}

export async function readWebviewBodyClasses(webviewFrame: Frame): Promise<string[]> {
  return webviewFrame.evaluate(() => {
    return Array.from(document.body.classList);
  });
}

export async function readPaletteSnapshot(webviewFrame: Frame): Promise<PaletteSnapshot> {
  return webviewFrame.evaluate(() => {
    const shellElement = document.querySelector('.prototype-shell');
    if (!(shellElement instanceof HTMLElement)) {
      throw new Error('Prototype shell not found.');
    }

    const convertColorToBrightness = (color: string): number => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;

      const context = canvas.getContext('2d');
      if (context === null) {
        throw new Error('Canvas context not available for color conversion.');
      }

      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);

      const pixel = context.getImageData(0, 0, 1, 1).data;
      const red = pixel[0] ?? 0;
      const green = pixel[1] ?? 0;
      const blue = pixel[2] ?? 0;

      return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    };

    const bodyBackgroundColor = getComputedStyle(document.body).backgroundColor;
    const shellBackgroundColor = getComputedStyle(shellElement).backgroundColor;

    return {
      bodyBackgroundColor,
      shellBackgroundColor,
      bodyBrightness: convertColorToBrightness(bodyBackgroundColor),
      shellBrightness: convertColorToBrightness(shellBackgroundColor),
    };
  });
}

export async function readViewportGutterSnapshot(
  webviewFrame: Frame
): Promise<ViewportGutterSnapshot> {
  return webviewFrame.evaluate(() => {
    const appElement = document.querySelector('#app');
    if (!(appElement instanceof HTMLElement)) {
      throw new Error('App element (#app) was not found.');
    }

    const appRect = appElement.getBoundingClientRect();
    const bodyStyles = getComputedStyle(document.body);

    return {
      viewportWidth: document.documentElement.clientWidth,
      appLeft: appRect.left,
      appRight: appRect.right,
      appWidth: appRect.width,
      bodyPaddingLeft: Number.parseFloat(bodyStyles.paddingLeft),
      bodyPaddingRight: Number.parseFloat(bodyStyles.paddingRight),
    };
  });
}

export function expectNoOuterGutter(
  snapshot: ViewportGutterSnapshot
): void {
  expect(snapshot.bodyPaddingLeft).toBe(0);
  expect(snapshot.bodyPaddingRight).toBe(0);
  expect(snapshot.appLeft).toBeLessThanOrEqual(0.5);
  expect(snapshot.viewportWidth - snapshot.appRight).toBeLessThanOrEqual(0.5);
  expect(snapshot.appWidth).toBeGreaterThan(0);
}
