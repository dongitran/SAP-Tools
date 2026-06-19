import { test, expect, Frame } from '@playwright/test';
import {
  cleanupExtensionHost,
  clickWithFallback,
  ExtensionHostSession,
  launchExtensionHost,
  openSapToolsSidebar,
  selectDefaultScope,
} from './support/sapToolsHarness';

async function openConfirmedWorkspace(): Promise<{ session: ExtensionHostSession; webviewFrame: Frame }> {
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

async function findApisExplorerFrame(session: ExtensionHostSession): Promise<Frame | null> {
  const candidateFrames = session.window.frames().filter((f) => f.url().includes('vscode-webview://'));
  for (const f of [...candidateFrames].reverse()) {
    if (await f.getByRole('tab', { name: 'Request Runner' }).isVisible().catch(() => false)) {
      return f;
    }
    if (await f.getByText('Endpoints', { exact: false }).isVisible().catch(() => false)) {
      return f;
    }
  }
  return null;
}

async function openApisExplorerFromLogsTab(
  session: ExtensionHostSession,
  webviewFrame: Frame
): Promise<Frame> {
  await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Log-API-Event' }));
  await expect(webviewFrame.locator('.app-logs-panel')).toBeVisible();

  const appItem = webviewFrame.locator('.app-log-item').first();
  await expect(appItem).toBeVisible();
  await appItem.hover();

  const apisButton = appItem.getByRole('button', { name: 'APIs' });
  await expect(apisButton).toBeVisible();
  await clickWithFallback(apisButton);

  await expect.poll(async () => {
    return (await findApisExplorerFrame(session)) !== null;
  }, { timeout: 20000 }).toBe(true);

  const apisFrame = await findApisExplorerFrame(session);
  if (apisFrame === null) {
    throw new Error('Could not find APIs Explorer frame');
  }
  return apisFrame;
}

test.describe('APIs Explorer Workspace Flow', () => {
  test('User can open APIs webview from Log-API-Event tab', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      const frame = await openApisExplorerFromLogsTab(session, webviewFrame);
      await expect(frame.getByRole('tab', { name: 'Request Runner' })).toHaveAttribute(
        'aria-selected',
        'true'
      );

      // Verify the sidebar exists inside the new APIs webview panel
      const apiSidebar = frame.locator('.api-webview-sidebar');
      await expect(apiSidebar).toBeVisible();

      // Search for an endpoint
      const searchInput = frame.locator('input[data-action="api-search-entity"]');
      await searchInput.fill('pro');

      // Click on "Products" in the sidebar
      const productItem = frame.locator('button[data-entity-name="Products"]');
      await expect(productItem).toBeVisible();
      await clickWithFallback(productItem);

      // Verify URL bar updates
      const urlBar = frame.locator('input.api-url-input');
      await expect(urlBar).toBeVisible();
      await expect(urlBar).toHaveValue(/products/i);

      // Execute GET request
      const executeBtn = frame.getByRole('button', { name: 'Execute' });
      await expect(executeBtn).toBeVisible();
      await clickWithFallback(executeBtn);

      // Wait for the status badge
      const statusBadge = frame.locator('.api-status-badge');
      await expect(statusBadge).toBeVisible({ timeout: 15000 });

      // The status will likely be an Error since the test environment URL is a mock route
      // that cannot be fetched by the VS Code backend, or 404/500 if it hits a real dead end.
      // We just want to verify the round-trip execution completed and rendered a result.
      const statusText = await statusBadge.textContent();
      expect(statusText).toBeTruthy();

      // Verify JSON View is rendered with Event Mesh-style transparent token highlighting.
      const jsonView = frame.getByLabel('API JSON response');
      await expect(jsonView).toBeVisible();
      const styleSnapshot = await jsonView.evaluate((payload) => {
        const token = (className: string): HTMLElement | null =>
          payload.querySelector(`.${className}`);
        const styleFor = (element: HTMLElement | null): { color: string | null; background: string | null } => {
          if (element === null) return { color: null, background: null };
          const style = getComputedStyle(element);
          return { color: style.color, background: style.backgroundColor };
        };
        const payloadStyle = getComputedStyle(payload);
        const wrapper = payload.closest('.api-view-content');
        return {
          payloadBackground: payloadStyle.backgroundColor,
          wrapperBackground: wrapper instanceof HTMLElement ? getComputedStyle(wrapper).backgroundColor : null,
          codeCount: payload.querySelectorAll('code').length,
          tokenCount: payload.querySelectorAll('.api-json-token').length,
          key: styleFor(token('api-json-key')),
          string: styleFor(token('api-json-string')),
          punctuation: styleFor(token('api-json-punctuation')),
        };
      });

      expect(styleSnapshot.payloadBackground).toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.wrapperBackground).toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.codeCount).toBe(0);
      expect(styleSnapshot.tokenCount).toBeGreaterThan(0);
      expect(styleSnapshot.key.background).toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.string.background).toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.punctuation.background).toBe('rgba(0, 0, 0, 0)');
      expect(new Set([styleSnapshot.key.color, styleSnapshot.string.color, styleSnapshot.punctuation.color]).size).toBe(3);

      await frame.locator('body').screenshot({ path: 'test-results/debug-apis-panel.png' });
      await jsonView.screenshot({ path: 'test-results/api-json-highlight-vscode.png' });
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can wait for API discovery without demo endpoints and keep scroll after selecting an endpoint', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      const frame = await openApisExplorerFromLogsTab(session, webviewFrame);

      await frame.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'saptools.prototype.apis.appSelected', payload: { appId: 'fresh-api-app' } },
        }));
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'sapTools.apis.syncStarted' },
        }));
      });

      await expect(frame.getByText('Discovering Endpoints...')).toBeVisible();
      await expect(frame.getByText('Loading application endpoints...')).toBeVisible();
      await expect(frame.locator('button[data-entity-name="Users"]')).toHaveCount(0);
      await expect(frame.locator('button[data-entity-name="Products"]')).toHaveCount(0);
      await expect(frame.locator('button[data-entity-name="Orders"]')).toHaveCount(0);

      const endpointNames = Array.from({ length: 40 }, (_, index) =>
        `Endpoint ${String(index + 1).padStart(2, '0')}`
      );
      await frame.evaluate((names) => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'sapTools.apis.catalogLoaded',
            payload: {
              name: 'fresh-api-app',
              baseUrl: 'https://mock.example.com',
              entities: names.map((name, index) => ({
                name,
                count: index + 1,
                methods: ['GET'],
                path: `/odata/v4/endpoint-${String(index + 1).padStart(2, '0')}`,
              })),
            },
          },
        }));
      }, endpointNames);

      const list = frame.locator('.api-entities-list-container');
      await expect(list).toBeVisible();
      await expect(frame.locator('button[data-entity-name="Endpoint 01"]')).toBeVisible();
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });

      const lastEndpoint = frame.locator('button[data-entity-name="Endpoint 40"]');
      await expect(lastEndpoint).toBeVisible();
      const scrollBefore = await list.evaluate((element) => element.scrollTop);
      expect(scrollBefore).toBeGreaterThan(0);

      await clickWithFallback(lastEndpoint);
      await expect(lastEndpoint).toHaveClass(/is-active/);
      await expect(lastEndpoint).toHaveAttribute('aria-pressed', 'true');
      await expect(frame.locator('input.api-url-input')).toHaveValue(/endpoint-40/);

      const scrollAfter = await list.evaluate((element) => element.scrollTop);
      expect(scrollAfter).toBeGreaterThan(0);
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can start Live Trace and inspect raw request and response details', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      const frame = await openApisExplorerFromLogsTab(session, webviewFrame);

      await clickWithFallback(frame.getByRole('tab', { name: 'Live Trace' }));
      await expect(frame.getByRole('button', { name: 'Start Listening' })).toBeVisible();
      await clickWithFallback(frame.getByRole('button', { name: 'Start Listening' }));

      await expect(frame.getByLabel('Live Trace state')).toHaveText('Streaming', { timeout: 15000 });
      await expect(frame.getByLabel('Live Trace summary')).toContainText('Observed URLs');
      await expect(frame.getByRole('button', { name: /POST 201 \/odata\/v4\/orders/i })).toBeVisible();

      await frame.getByLabel('Observed URL').selectOption('/odata/v4/orders');
      await expect(frame.getByText('Visible')).toBeVisible();
      await expect(frame.getByRole('button', { name: /POST 201 \/odata\/v4\/orders/i })).toBeVisible();
      await expect(frame.getByRole('button', { name: /PATCH 400 \/odata\/v4\/orders\(1\)/i })).toHaveCount(0);

      const detailTabs = frame.getByRole('tablist', { name: 'Trace detail sections' });
      await expect(detailTabs.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(frame.getByLabel('Trace event overview')).toContainText('Status');
      await expect(frame.getByLabel('Trace event overview')).toContainText('Duration');
      await expect(frame.getByLabel('Trace event overview')).toContainText('Trace ID');

      await clickWithFallback(detailTabs.getByRole('tab', { name: 'Request', exact: true }));
      await expect(detailTabs.getByRole('tab', { name: 'Request', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(frame.getByRole('heading', { name: 'Request Body' })).toBeVisible();
      await expect(frame.getByRole('heading', { name: 'Request Headers' })).toBeVisible();
      await expect(frame.getByText('authorization')).toBeVisible();
      await expect(frame.getByText('Bearer demo-access-token').first()).toBeVisible();

      await clickWithFallback(detailTabs.getByRole('tab', { name: 'Response', exact: true }));
      await expect(detailTabs.getByRole('tab', { name: 'Response', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(frame.getByRole('heading', { name: 'Response Body' })).toBeVisible();
      await expect(frame.getByRole('heading', { name: 'Response Headers' })).toBeVisible();
      await expect(frame.getByText('created')).toBeVisible();

      await clickWithFallback(frame.getByRole('button', { name: 'Stop Listening' }));
      await expect(frame.getByLabel('Live Trace state')).toHaveText('Stopped', { timeout: 15000 });

      await clickWithFallback(frame.getByRole('tab', { name: 'Request Runner' }));
      await expect(frame.getByRole('button', { name: 'Execute' })).toBeVisible();
    } finally {
      await cleanupExtensionHost(session);
    }
  });

  test('User can open Event viewer from Log-API-Event tab', async () => {
    const { session, webviewFrame } = await openConfirmedWorkspace();

    try {
      await clickWithFallback(webviewFrame.getByRole('tab', { name: 'Log-API-Event' }));
      await expect(webviewFrame.locator('.app-logs-panel')).toBeVisible();

      const appItem = webviewFrame.locator('.app-log-item').first();
      await expect(appItem).toBeVisible();
      await appItem.hover();

      await expect(appItem.getByText('Ready', { exact: true })).toHaveCount(0);
      await expect(appItem.getByRole('button', { name: 'APIs' })).toBeVisible();
      const eventButton = appItem.getByRole('button', { name: 'Event' });
      await expect(eventButton).toBeVisible();
      await clickWithFallback(eventButton);

      let eventFrame: Frame | null = null;
      await expect.poll(async () => {
        const candidateFrames = session.window.frames().filter((f) => f.url().includes('vscode-webview://'));
        for (const f of [...candidateFrames].reverse()) {
          if (await f.getByText('Event Mesh', { exact: true }).isVisible().catch(() => false)) {
            eventFrame = f;
            return true;
          }
        }
        return false;
      }, { timeout: 20000 }).toBe(true);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (eventFrame === null) {
        throw new Error('Could not find Event viewer frame');
      }
      const frame = eventFrame as Frame;

      await expect(frame.getByRole('tab', { name: 'Subscribe Simple' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await expect(frame.getByText('Client Binding Groups')).toBeVisible();
      await clickWithFallback(frame.getByRole('button', { name: /Start Listening To/i }));
      await expect(frame.getByLabel('Event Mesh results').getByText('Listening', { exact: true })).toBeVisible();
      await expect(frame.getByText('demo/service/app/items/created')).toBeVisible();
      await clickWithFallback(frame.getByRole('button', { name: /#1/i }));

      const jsonPayload = frame.getByLabel('Received JSON payload').first();
      await expect(jsonPayload).toBeVisible();
      const styleSnapshot = await jsonPayload.evaluate((payload) => {
        const token = (className: string): HTMLElement | null =>
          payload.querySelector(`.${className}`);
        const styleFor = (element: HTMLElement | null): { color: string | null; background: string | null } => {
          if (element === null) return { color: null, background: null };
          const style = getComputedStyle(element);
          return { color: style.color, background: style.backgroundColor };
        };
        const payloadStyle = getComputedStyle(payload);
        return {
          payloadBackground: payloadStyle.backgroundColor,
          codeCount: payload.querySelectorAll('code').length,
          tokenCount: payload.querySelectorAll('.event-json-token').length,
          key: styleFor(token('event-json-key')),
          string: styleFor(token('event-json-string')),
          punctuation: styleFor(token('event-json-punctuation')),
        };
      });

      expect(styleSnapshot.payloadBackground).toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.codeCount).toBe(0);
      expect(styleSnapshot.tokenCount).toBeGreaterThan(0);
      expect(styleSnapshot.key.background).toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.string.background).toBe('rgba(0, 0, 0, 0)');
      expect(styleSnapshot.punctuation.background).toBe('rgba(0, 0, 0, 0)');
      expect(new Set([styleSnapshot.key.color, styleSnapshot.string.color, styleSnapshot.punctuation.color]).size).toBe(3);
      await frame.getByLabel('Event Mesh results').screenshot({
        path: 'test-results/event-json-highlight-vscode.png',
      });
    } finally {
      await cleanupExtensionHost(session);
    }
  });
});
