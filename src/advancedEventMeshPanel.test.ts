import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { AdvancedEventMeshPanelManager } from './advancedEventMeshPanel';
import type { EventMeshTargetParams } from './eventMeshPanel';

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
}

function createMockPanel(): MockPanel {
  const disposeHandlers: (() => void)[] = [];
  return {
    webview: {
      html: '',
      asWebviewUri: (uri) => ({
        with: () => ({ toString: () => `vscode-resource:${uri.path ?? 'asset'}` }),
        toString: () => `vscode-resource:${uri.path ?? 'asset'}`,
      }),
      onDidReceiveMessage: vi.fn(),
      postMessage: vi.fn(),
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
}

function makeTargetParams(spaceName: string): EventMeshTargetParams {
  return {
    apiEndpoint: 'https://api.example.com',
    email: 'user@example.com',
    password: 'secret',
    orgName: 'demo-org',
    spaceName,
    cfHomeDir: '/tmp/cf-home',
  };
}

describe('AdvancedEventMeshPanelManager webview security', () => {
  beforeEach(() => {
    createWebviewPanelMock.mockReset();
  });

  it('adds a restrictive content security policy to the Advanced Event Mesh HTML', () => {
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = new AdvancedEventMeshPanelManager({} as never, { appendLine: vi.fn() } as never);

    manager.openAdvancedEventMeshViewer('demo-app', makeTargetParams('space-a'), {
      classicAvailable: true,
    });

    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain("default-src 'none'");
    expect(panel.webview.html).toContain('advanced-events-webview.js');
    expect(panel.webview.html).toContain('window.advancedEventMeshAppId');
    expect(panel.webview.html).toContain('window.advancedEventMeshProviderTabs');
  });

  it('recreates the Advanced Event Mesh panel when the target scope changes', () => {
    const panels = [createMockPanel(), createMockPanel()];
    createWebviewPanelMock.mockImplementation(() => {
      const panel = panels.shift();
      if (panel === undefined) {
        throw new Error('No mock panel available.');
      }
      return panel;
    });
    const firstPanel = panels[0];
    if (firstPanel === undefined) {
      throw new Error('First mock panel missing.');
    }
    const manager = new AdvancedEventMeshPanelManager({} as never, { appendLine: vi.fn() } as never);

    manager.openAdvancedEventMeshViewer('demo-app', makeTargetParams('space-a'), {
      classicAvailable: false,
    });
    manager.openAdvancedEventMeshViewer('demo-app', makeTargetParams('space-b'), {
      classicAvailable: false,
    });

    expect(createWebviewPanelMock).toHaveBeenCalledTimes(2);
    expect(firstPanel.dispose).toHaveBeenCalledTimes(1);
    expect(firstPanel.reveal).not.toHaveBeenCalled();
  });
});
