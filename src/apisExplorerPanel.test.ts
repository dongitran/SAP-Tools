import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { createWebviewPanelMock } = vi.hoisted(() => ({
  createWebviewPanelMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  Uri: {
    joinPath: vi.fn((_base: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  },
  ViewColumn: {
    Active: 1,
  },
  window: {
    createWebviewPanel: createWebviewPanelMock,
  },
}));

const cfClientMocks = vi.hoisted(() => ({
  fetchAppRouteUrlFromTarget: vi.fn(),
  fetchCfOauthTokenFromTarget: vi.fn(),
  fetchRemoteCdsServicesFromTarget: vi.fn(),
  fetchXsuaaTokenFromTarget: vi.fn(),
}));

vi.mock('./cfClient.js', () => cfClientMocks);

import { ApisExplorerPanelManager, type ApisExplorerTargetParams } from './apisExplorerPanel';

interface MockPanel {
  readonly webview: {
    html: string;
    readonly asWebviewUri: (uri: { readonly path?: string }) => {
      readonly with: () => { readonly toString: () => string };
      readonly toString: () => string;
    };
    readonly onDidReceiveMessage: ReturnType<typeof vi.fn>;
    readonly postMessage: ReturnType<typeof vi.fn>;
    readonly cspSource: string;
  };
  readonly reveal: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly onDidDispose: ReturnType<typeof vi.fn>;
  messageHandler?: (message: unknown) => void | Promise<void>;
}

function createMockPanel(): MockPanel {
  const disposeHandlers: (() => void)[] = [];
  const panel: MockPanel = {
    webview: {
      html: '',
      asWebviewUri: (uri) => ({
        with: () => ({ toString: () => `vscode-resource:${uri.path ?? 'asset'}` }),
        toString: () => `vscode-resource:${uri.path ?? 'asset'}`,
      }),
      onDidReceiveMessage: vi.fn((handler: (message: unknown) => void | Promise<void>) => {
        panel.messageHandler = handler;
        return { dispose: vi.fn() };
      }),
      postMessage: vi.fn(async () => true),
      cspSource: 'vscode-resource:',
    },
    reveal: vi.fn(),
    dispose: vi.fn(() => {
      for (const handler of disposeHandlers) {
        handler();
      }
    }),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
  };
  return panel;
}

function makeTarget(spaceName: string): ApisExplorerTargetParams {
  return {
    apiEndpoint: 'https://api.example.com',
    email: 'user@example.com',
    password: 'secret',
    orgName: 'demo-org',
    spaceName,
    cfHomeDir: `/tmp/cf-${spaceName}`,
  };
}

function createManager(): ApisExplorerPanelManager {
  return new ApisExplorerPanelManager(
    {} as never,
    { appendLine: vi.fn() } as never,
    {
      getApiCatalog: vi.fn(async () => null),
      setApiCatalog: vi.fn(async () => undefined),
    } as never
  );
}

describe('ApisExplorerPanelManager', () => {
  beforeEach(() => {
    createWebviewPanelMock.mockReset();
    cfClientMocks.fetchXsuaaTokenFromTarget.mockResolvedValue('Bearer fresh-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn(async () => '{"value":[]}'),
    })));
    delete process.env['SAP_TOOLS_TEST_MODE'];
    delete process.env['SAP_TOOLS_E2E'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds a restrictive content security policy to the APIs webview HTML', () => {
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManager();

    manager.openApisExplorer('finance-uat-api', makeTarget('space-a'));

    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain("default-src 'none'");
    expect(panel.webview.html).toContain('script-src');
    expect(panel.webview.html).toContain('style-src');
    expect(panel.webview.html).toContain('nonce-');
  });

  it('routes Live Trace start/stop messages through a trace session in test mode', async () => {
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManager();

    manager.openApisExplorer('finance-uat-api', makeTarget('space-a'));
    await panel.messageHandler?.({
      type: 'sapTools.apis.trace.start',
      payload: {
        mode: 'runtime-http',
        instanceIndex: 0,
        processName: 'web',
        captureHeaders: false,
        captureRequestBody: false,
        captureResponseBody: false,
        maxBodyBytes: 4096,
        filters: {
          method: [],
          pathContains: '',
          statusClass: 'all',
        },
      },
    });
    await panel.messageHandler?.({
      type: 'sapTools.apis.trace.stop',
      payload: { uninstallRuntimeHook: true },
    });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sapTools.apis.trace.batch' })
    );
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sapTools.apis.trace.state',
        payload: expect.objectContaining({ state: 'stopped' }),
      })
    );
  });

  it('reuses an APIs panel with updated target params instead of executing with a stale scope', async () => {
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManager();

    manager.openApisExplorer('finance-uat-api', makeTarget('space-a'));
    manager.openApisExplorer('finance-uat-api', makeTarget('space-b'));
    cfClientMocks.fetchXsuaaTokenFromTarget.mockClear();
    await panel.messageHandler?.({
      type: 'sapTools.apis.executeRequest',
      payload: {
        url: 'https://app.example.com/odata/v4/products?token=secret',
        method: 'GET',
        auth: 'xsuaa-auto',
      },
    });

    expect(panel.reveal).toHaveBeenCalledTimes(1);
    expect(cfClientMocks.fetchXsuaaTokenFromTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceName: 'space-b',
        cfHomeDir: '/tmp/cf-space-b',
      })
    );
  });

  it('stops active traces without closing panels when scope changes', async () => {
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManager();

    manager.openApisExplorer('finance-uat-api', makeTarget('space-a'));
    await panel.messageHandler?.({
      type: 'sapTools.apis.trace.start',
      payload: {
        mode: 'runtime-http',
        instanceIndex: 0,
        processName: 'web',
        captureHeaders: false,
        captureRequestBody: false,
        captureResponseBody: false,
        maxBodyBytes: 4096,
        filters: {
          method: [],
          pathContains: '',
          statusClass: 'all',
        },
      },
    });
    manager.stopAllTraces('scope-changed');

    expect(panel.dispose).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sapTools.apis.trace.state',
        payload: expect.objectContaining({ state: 'stopped' }),
      })
    );
  });
});
