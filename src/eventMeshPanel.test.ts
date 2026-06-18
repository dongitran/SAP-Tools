import { describe, expect, it, vi } from 'vitest';

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

import {
  DEFAULT_EVENT_MESSAGE_BUFFER_LIMIT,
  EventMeshPanelManager,
  isStaleDebugQueueNameForTest,
  trimOutgoingEventBuffer,
  type EventMeshTargetParams,
} from './eventMeshPanel';
import type { EventMeshBinding } from './eventMeshBindings';
import { parsePublishEventRequest } from './eventMeshPublishRequest';

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

function makeBinding(index: number): EventMeshBinding {
  const oa2 = {
    clientid: 'cid',
    clientsecret: 'sec',
    tokenendpoint: 'https://uaa.example.com/oauth/token',
  };
  return {
    index,
    name: `binding-${index}`,
    instanceName: `binding-${index}`,
    namespace: `demo/service/app/${index}`,
    management: { uri: 'https://mgmt.example.com', oa2 },
    messaging: { uri: 'https://rest.example.com', oa2 },
    amqp: { uri: 'wss://amqp.example.com', oa2 },
  };
}

describe('EventMeshPanelManager debug queue cleanup', () => {
  it('keeps a recently created debug queue so another active viewer is not interrupted', () => {
    const namespace = 'demo/service/app';
    const createdAt = Date.UTC(2026, 5, 16, 10, 0, 0);
    const queueName = `${namespace}/saptools-debug/${createdAt.toString(36)}-abcd1234`;

    expect(
      isStaleDebugQueueNameForTest(queueName, namespace, createdAt + 60_000)
    ).toBe(false);
  });

  it('reaps only timestamped debug queues older than the stale threshold', () => {
    const namespace = 'demo/service/app';
    const createdAt = Date.UTC(2026, 5, 16, 10, 0, 0);
    const queueName = `${namespace}/saptools-debug/${createdAt.toString(36)}-abcd1234`;

    expect(
      isStaleDebugQueueNameForTest(queueName, namespace, createdAt + 7 * 60 * 60 * 1000)
    ).toBe(true);
  });

  it('does not reap unrelated or invalid queues', () => {
    const namespace = 'demo/service/app';

    expect(
      isStaleDebugQueueNameForTest(`${namespace}/other-tool/abc`, namespace, Date.now())
    ).toBe(false);
    expect(
      isStaleDebugQueueNameForTest(`${namespace}/saptools-debug/not-a-timestamp`, namespace, Date.now())
    ).toBe(false);
  });
});

describe('EventMeshPanelManager panel reuse', () => {
  it('recreates an existing app panel when the target scope changes', () => {
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
    const manager = new EventMeshPanelManager({} as never, { appendLine: vi.fn() } as never);

    manager.openEventMeshViewer('demo-app', makeTargetParams('space-a'));
    manager.openEventMeshViewer('demo-app', makeTargetParams('space-b'));

    expect(createWebviewPanelMock).toHaveBeenCalledTimes(2);
    expect(firstPanel.dispose).toHaveBeenCalledTimes(1);
    expect(firstPanel.reveal).not.toHaveBeenCalled();
  });
});

describe('EventMeshPanelManager webview security', () => {
  it('adds a restrictive content security policy to the Event viewer HTML', () => {
    const panel = createMockPanel();
    createWebviewPanelMock.mockReturnValue(panel);
    const manager = new EventMeshPanelManager({} as never, { appendLine: vi.fn() } as never);

    manager.openEventMeshViewer('demo-app', makeTargetParams('space-a'));

    expect(panel.webview.html).toContain('Content-Security-Policy');
    expect(panel.webview.html).toContain("default-src 'none'");
    expect(panel.webview.html).toContain('script-src');
    expect(panel.webview.html).toContain('style-src');
    expect(panel.webview.html).toContain('font-src');
    expect(panel.webview.html).toContain('nonce-');
  });
});

describe('EventMeshPanelManager outgoing message buffer safety', () => {
  it('keeps only the newest pending outgoing events by default', () => {
    const buffer = Array.from({ length: DEFAULT_EVENT_MESSAGE_BUFFER_LIMIT + 25 }, (_, index) => ({
      seq: index + 1,
    }));

    const trimmed = trimOutgoingEventBuffer(buffer);

    expect(trimmed).toHaveLength(DEFAULT_EVENT_MESSAGE_BUFFER_LIMIT);
    expect(trimmed[0]?.seq).toBe(26);
    expect(trimmed.at(-1)?.seq).toBe(DEFAULT_EVENT_MESSAGE_BUFFER_LIMIT + 25);
  });

  it('leaves short pending outgoing buffers unchanged', () => {
    const buffer = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];

    expect(trimOutgoingEventBuffer(buffer, 1000)).toEqual(buffer);
  });
});

describe('EventMeshPanelManager publish request parsing', () => {
  it('parses queue publish requests with an explicit queue destination', () => {
    const binding = makeBinding(7);

    expect(
      parsePublishEventRequest([binding], {
        bindingIndex: 7,
        destinationKind: 'queue',
        destination: 'demo/service/app/q-main',
        payload: 'plain',
        contentType: 'text/plain',
      })
    ).toEqual({
      binding,
      destinationKind: 'queue',
      destination: 'demo/service/app/q-main',
      payload: 'plain',
      contentType: 'text/plain',
    });
  });

  it('keeps legacy topic publish messages working', () => {
    const binding = makeBinding(8);

    expect(
      parsePublishEventRequest([binding], {
        bindingIndex: 8,
        topic: 'demo/service/app/items/created',
        payload: '{"ok":true}',
      })
    ).toEqual({
      binding,
      destinationKind: 'topic',
      destination: 'demo/service/app/items/created',
      payload: '{"ok":true}',
      contentType: 'application/json',
    });
  });

  it('rejects missing bindings and blank destinations', () => {
    const binding = makeBinding(9);

    expect(
      parsePublishEventRequest([binding], {
        bindingIndex: 404,
        destinationKind: 'queue',
        destination: 'demo/service/app/q-main',
      })
    ).toBeNull();
    expect(
      parsePublishEventRequest([binding], {
        bindingIndex: 9,
        destinationKind: 'queue',
        destination: '   ',
      })
    ).toBeNull();
  });
});
