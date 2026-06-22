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
  prepareCfCliSession: vi.fn(),
  runCfSshCommandFromTarget: vi.fn(),
  spawnCfSshPortForward: vi.fn(),
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

function createManagerWithCacheStore(cacheStore: object): ApisExplorerPanelManager {
  return new ApisExplorerPanelManager(
    {} as never,
    { appendLine: vi.fn() } as never,
    cacheStore as never
  );
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise?.(value);
    },
  };
}

function createManagerWithGlobalState(globalState: {
  readonly get: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
}): ApisExplorerPanelManager {
  return new ApisExplorerPanelManager(
    {} as never,
    { appendLine: vi.fn() } as never,
    {
      getApiCatalog: vi.fn(async () => null),
      setApiCatalog: vi.fn(async () => undefined),
    } as never,
    globalState as never
  );
}

describe('ApisExplorerPanelManager', () => {
  beforeEach(() => {
    createWebviewPanelMock.mockReset();
    cfClientMocks.fetchAppRouteUrlFromTarget.mockReset();
    cfClientMocks.fetchAppRouteUrlFromTarget.mockResolvedValue('default.example.com');
    cfClientMocks.fetchRemoteCdsServicesFromTarget.mockReset();
    cfClientMocks.fetchRemoteCdsServicesFromTarget.mockResolvedValue(null);
    cfClientMocks.fetchXsuaaTokenFromTarget.mockReset();
    cfClientMocks.fetchXsuaaTokenFromTarget.mockResolvedValue('Bearer fresh-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn(async () => ({ value: [] })),
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

  it('stops active Live Trace when the APIs panel is disposed', async () => {
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManager();

    const session = manager.openApisExplorer('finance-uat-api', makeTarget('space-a'));
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

    expect(session.traceSession?.isRunning()).toBe(true);
    panel.dispose();

    await vi.waitFor(() => {
      expect(session.traceSession?.isRunning()).toBe(false);
    });
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

  it('isolates API catalog cache entries by CF target when app names are shared', async () => {
    const panel = createMockPanel();
    const cacheStore = {
      getApiCatalog: vi.fn(async () => null),
      setApiCatalog: vi.fn(async () => undefined),
    };
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManagerWithCacheStore(cacheStore);

    manager.openApisExplorer('demo-app', makeTarget('space-a'));
    await panel.messageHandler?.({ type: 'sapTools.apis.webviewReady' });
    await vi.waitFor(() => {
      expect(cacheStore.getApiCatalog).toHaveBeenCalledTimes(1);
    });

    manager.openApisExplorer('demo-app', makeTarget('space-b'));
    await vi.waitFor(() => {
      expect(cacheStore.getApiCatalog).toHaveBeenCalledTimes(2);
    });

    const firstKey = cacheStore.getApiCatalog.mock.calls[0]?.[0];
    const secondKey = cacheStore.getApiCatalog.mock.calls[1]?.[0];
    expect(firstKey).toBe('["https://api.example.com","demo-org","space-a","demo-app"]');
    expect(secondKey).toBe('["https://api.example.com","demo-org","space-b","demo-app"]');
  });

  it('clears the reused panel catalog immediately when its CF target changes', () => {
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManager();

    manager.openApisExplorer('demo-app', makeTarget('space-a'));
    panel.webview.postMessage.mockClear();
    manager.openApisExplorer('demo-app', makeTarget('space-b'));

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'sapTools.apis.catalogLoading',
    });
  });

  it('ignores a catalog load that completes after the panel moved to a newer target', async () => {
    const oldRoute = createDeferred<string | null>();
    const newRoute = createDeferred<string | null>();
    cfClientMocks.fetchAppRouteUrlFromTarget
      .mockReset()
      .mockReturnValueOnce(oldRoute.promise)
      .mockReturnValueOnce(newRoute.promise);
    const panel = createMockPanel();
    const cacheStore = {
      getApiCatalog: vi.fn(async () => null),
      setApiCatalog: vi.fn(async () => undefined),
    };
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManagerWithCacheStore(cacheStore);

    manager.openApisExplorer('demo-app', makeTarget('space-a'));
    await panel.messageHandler?.({ type: 'sapTools.apis.webviewReady' });
    await vi.waitFor(() => {
      expect(cfClientMocks.fetchAppRouteUrlFromTarget).toHaveBeenCalledTimes(1);
    });
    manager.openApisExplorer('demo-app', makeTarget('space-b'));
    await vi.waitFor(() => {
      expect(cfClientMocks.fetchAppRouteUrlFromTarget).toHaveBeenCalledTimes(2);
    });

    newRoute.resolve('new-space.example.com');
    await vi.waitFor(() => {
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sapTools.apis.catalogLoaded',
          payload: expect.objectContaining({ baseUrl: 'https://new-space.example.com' }),
        })
      );
    });
    oldRoute.resolve('old-space.example.com');
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const loadedBaseUrls = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === 'sapTools.apis.catalogLoaded')
      .map((message) => message.payload?.baseUrl);
    expect(loadedBaseUrls).toEqual(['https://new-space.example.com']);
    expect(cacheStore.setApiCatalog).toHaveBeenCalledTimes(1);
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
    await manager.stopAllTraces('scope-changed');

    expect(panel.dispose).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sapTools.apis.trace.state',
        payload: expect.objectContaining({ state: 'stopped' }),
      })
    );
  });

  it('persists Live Trace capture preferences and injects them into new panels', async () => {
    const values = new Map<string, unknown>();
    values.set('sapTools.apis.trace.preferences', {
      captureHeaders: false,
      captureRequestBody: false,
      captureResponseBody: true,
    });
    const globalState = {
      get: vi.fn((key: string) => values.get(key)),
      update: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    };
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = createManagerWithGlobalState(globalState);

    manager.openApisExplorer('orders-api', makeTarget('space-a'));
    expect(panel.webview.html).toContain('window.sapToolsApiTracePreferences');
    expect(panel.webview.html).toContain('"captureHeaders":false');
    expect(panel.webview.html).toContain('"captureRequestBody":false');
    expect(panel.webview.html).toContain('"captureResponseBody":true');

    await panel.messageHandler?.({
      type: 'sapTools.apis.trace.preferencesChanged',
      payload: {
        captureHeaders: false,
        captureRequestBody: true,
        captureResponseBody: false,
      },
    });

    expect(globalState.update).toHaveBeenCalledWith('sapTools.apis.trace.preferences', {
      captureHeaders: false,
      captureRequestBody: true,
      captureResponseBody: false,
    });
  });
});
