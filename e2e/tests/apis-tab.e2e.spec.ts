import { test, expect } from '@playwright/test';
import {
  cleanupExtensionHost,
  clickWithFallback,
  launchExtensionHost,
  openSapToolsSidebar,
  selectDefaultScope,
} from './support/sapToolsHarness';

async function openConfirmedWorkspace() {
  const session = await launchExtensionHost();
  const webviewFrame = await openSapToolsSidebar(session.window);
  await selectDefaultScope(webviewFrame);
  await clickWithFallback(
    webviewFrame.getByRole('button', { name: 'Confirm Scope' })
  );
  await expect(
    webviewFrame.getByRole('heading', { name: 'BTP Workspace' })
  ).toBeVisible();
  return { session, webviewFrame };
}

test.describe('APIs Explorer Workspace Flow', () => {
  test('User can open APIs webview from Logs/APIs tab', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      // Click the Logs/APIs tab button
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Logs/APIs' }));
      
      // Assert that the app logs panel is visible
      await expect(webviewFrame.locator('.app-logs-panel')).toBeVisible();

      // Find the first app that has an APIs button
      const appItem = webviewFrame.locator('.app-log-item').first();
      await expect(appItem).toBeVisible();

      // Hover over the app item to reveal the APIs button
      await appItem.hover();

      // Click APIs button
      const apisButton = appItem.getByRole('button', { name: 'APIs' });
      await expect(apisButton).toBeVisible();
      await clickWithFallback(apisButton);

      // Wait for the new Webview Panel to open by polling frames
      let centerWebviewFrame: any = null;
      await expect.poll(async () => {
        const candidateFrames = session.window.frames().filter((f) => f.url().includes('vscode-webview://'));
        for (const f of [...candidateFrames].reverse()) {
          if (await f.getByText('Endpoints', { exact: false }).isVisible().catch(() => false)) {
            centerWebviewFrame = f;
            return true;
          }
        }
        return false;
      }, { timeout: 20000 }).toBe(true);

      // Verify the sidebar exists inside the new APIs webview panel
      const apiSidebar = centerWebviewFrame.locator('.api-webview-sidebar');
      await expect(apiSidebar).toBeVisible();

      // Search for an endpoint
      const searchInput = centerWebviewFrame.locator('input[data-action="api-search-entity"]');
      await searchInput.fill('pro');

      // Click on "Products" in the sidebar
      const productItem = centerWebviewFrame.locator('button[data-entity-name="Products"]');
      await expect(productItem).toBeVisible();
      await clickWithFallback(productItem);

      // Verify URL bar updates
      const urlBar = centerWebviewFrame.locator('input.api-url-input');
      await expect(urlBar).toBeVisible();
      await expect(urlBar).toHaveValue(/Products/);

      // Execute GET request
      const executeBtn = centerWebviewFrame.getByRole('button', { name: 'Execute GET' });
      await expect(executeBtn).toBeVisible();
      await clickWithFallback(executeBtn);

      // Wait for the status badge
      const statusBadge = centerWebviewFrame.locator('.api-status-badge');
      await expect(statusBadge).toBeVisible({ timeout: 2000 });
      await expect(statusBadge).toHaveText(/200 OK/);

      // Verify JSON View contains mock data
      const jsonView = centerWebviewFrame.locator('.api-raw-json');
      await expect(jsonView).toBeVisible();
      await expect(jsonView).toContainText('Laptop');

      await centerWebviewFrame.locator('body').screenshot({ path: 'test-results/debug-apis-panel.png' });
    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
