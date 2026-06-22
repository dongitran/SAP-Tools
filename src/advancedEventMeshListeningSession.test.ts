import { describe, expect, it, vi } from 'vitest';

import type { AdvancedEventMeshBinding } from './advancedEventMeshBindings';
import {
  AdvancedEventMeshListeningSession,
  type AdvancedEventMeshListenerLike,
  type AdvancedEventMeshManagementClientLike,
} from './advancedEventMeshListeningSession';

function makeBinding(index: number): AdvancedEventMeshBinding {
  return {
    index,
    name: `advanced-event-mesh-${String(index)}`,
    instanceName: `advanced-event-mesh-${String(index)}`,
    vpn: 'demo-aem',
    managementUri: 'https://broker.example.com:943',
    smfUri: 'wss://broker.example.com:443',
    authentication: {
      tokenendpoint: 'https://ias.example.com/oauth2/token',
      clientid: `client-${String(index)}`,
      clientsecret: `secret-${String(index)}`,
    },
  };
}

function createClient(): AdvancedEventMeshManagementClientLike {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    addSubscription: vi.fn().mockResolvedValue(undefined),
    deleteQueue: vi.fn().mockResolvedValue(undefined),
  };
}

function createListener(): AdvancedEventMeshListenerLike {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
}

function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createSession(
  client: AdvancedEventMeshManagementClientLike,
  listeners: AdvancedEventMeshListenerLike[]
): AdvancedEventMeshListeningSession {
  return new AdvancedEventMeshListeningSession({
    buildQueueName: (binding) => `saptools/aem/${binding.vpn}/saptools-debug/run-${String(binding.index)}`,
    getClient: () => client,
    createListener: () => {
      const listener = createListener();
      listeners.push(listener);
      return listener;
    },
  });
}

describe('AdvancedEventMeshListeningSession', () => {
  it('creates a debug queue, subscribes topics, and starts one Solace listener', async () => {
    const binding = makeBinding(0);
    const client = createClient();
    const listeners: AdvancedEventMeshListenerLike[] = [];
    const session = createSession(client, listeners);

    const summary = await session.startBinding(
      { binding, topics: ['topic/one/>', 'topic/two/>'] },
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );

    expect(summary).toEqual({
      bindingIndex: 0,
      bindingName: 'advanced-event-mesh-0',
      vpn: 'demo-aem',
      queueName: 'saptools/aem/demo-aem/saptools-debug/run-0',
      topics: ['topic/one/>', 'topic/two/>'],
    });
    expect(client.createQueue).toHaveBeenCalledWith('saptools/aem/demo-aem/saptools-debug/run-0');
    expect(client.addSubscription).toHaveBeenNthCalledWith(
      1,
      'saptools/aem/demo-aem/saptools-debug/run-0',
      'topic/one/>'
    );
    expect(listeners[0]?.start).toHaveBeenCalledTimes(1);
  });

  it('adds only new topics to the active debug queue', async () => {
    const binding = makeBinding(0);
    const client = createClient();
    const session = createSession(client, []);
    await session.startBinding(
      { binding, topics: ['topic/one/>'] },
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );

    const added = await session.addTopics(0, ['topic/one/>', 'topic/two/>']);

    expect(added).toEqual(['topic/two/>']);
    expect(client.addSubscription).toHaveBeenCalledTimes(2);
    expect(client.addSubscription).toHaveBeenNthCalledWith(
      2,
      'saptools/aem/demo-aem/saptools-debug/run-0',
      'topic/two/>'
    );
  });

  it('stops the Solace listener and deletes the debug queue', async () => {
    const binding = makeBinding(0);
    const client = createClient();
    const listeners: AdvancedEventMeshListenerLike[] = [];
    const session = createSession(client, listeners);
    await session.startBinding(
      { binding, topics: ['topic/one/>'] },
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );

    await session.stopAll();

    expect(listeners[0]?.stop).toHaveBeenCalledTimes(1);
    expect(client.deleteQueue).toHaveBeenCalledWith('saptools/aem/demo-aem/saptools-debug/run-0');
    expect(session.activeSummary()).toBeNull();
  });

  it('deletes the debug queue when stop happens during startup', async () => {
    const binding = makeBinding(0);
    const client = createClient();
    const subscriptionGate = createDeferred();
    client.addSubscription = vi.fn(() => subscriptionGate.promise);
    const session = createSession(client, []);

    const start = session.startBinding(
      { binding, topics: ['topic/one/>'] },
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );
    await expect.poll(() => vi.mocked(client.createQueue).mock.calls.length).toBe(1);

    const stop = session.stopAll();
    subscriptionGate.resolve();

    await expect(start).rejects.toThrow(/stopped/i);
    await stop;
    expect(client.deleteQueue).toHaveBeenCalledWith('saptools/aem/demo-aem/saptools-debug/run-0');
    expect(session.activeSummary()).toBeNull();
  });
});
