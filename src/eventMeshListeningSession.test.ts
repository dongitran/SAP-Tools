import { describe, expect, it, vi } from 'vitest';

import type { EventMeshBinding } from './eventMeshBindings';
import {
  EventMeshListeningSession,
  type EventMeshListenerLike,
  type EventMeshManagementClientLike,
} from './eventMeshListeningSession';

function makeBinding(index: number, namespace: string): EventMeshBinding {
  const oa2 = {
    clientid: `client-${index}`,
    clientsecret: `secret-${index}`,
    tokenendpoint: `https://uaa.example.com/${index}/oauth/token`,
  };
  return {
    index,
    name: `binding-${index}`,
    instanceName: `binding-${index}`,
    namespace,
    management: { uri: `https://mgmt-${index}.example.com`, oa2 },
    messaging: { uri: `https://rest-${index}.example.com`, oa2 },
    amqp: { uri: `wss://amqp-${index}.example.com`, oa2 },
  };
}

function createClient(): EventMeshManagementClientLike {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    addSubscription: vi.fn().mockResolvedValue(undefined),
    deleteQueue: vi.fn().mockResolvedValue(undefined),
  };
}

function createListener(): EventMeshListenerLike {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
}

function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSession(
  clients: Map<number, EventMeshManagementClientLike>,
  listeners: EventMeshListenerLike[]
): EventMeshListeningSession {
  return new EventMeshListeningSession({
    debugQueueSegment: 'saptools-debug',
    buildRunId: (binding) => `run-${String(binding.index)}`,
    getClient: (binding) => {
      const client = clients.get(binding.index);
      if (client === undefined) {
        throw new Error(`missing client ${String(binding.index)}`);
      }
      return client;
    },
    createListener: () => {
      const listener = createListener();
      listeners.push(listener);
      return listener;
    },
  });
}

describe('EventMeshListeningSession', () => {
  it('starts one queue and listener per selected binding', async () => {
    const bindings = [makeBinding(0, 'demo/service/app'), makeBinding(1, 'demo/audit/app')];
    const clients = new Map(bindings.map((binding) => [binding.index, createClient()]));
    const listeners: EventMeshListenerLike[] = [];
    const session = createSession(clients, listeners);

    const summaries = await session.startMany(
      bindings.map((binding) => ({ binding, topics: [`${binding.namespace}/*`] })),
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );

    expect(summaries).toEqual([
      {
        bindingIndex: 0,
        bindingName: 'binding-0',
        bindingNamespace: 'demo/service/app',
        queueName: 'demo/service/app/saptools-debug/run-0',
        topics: ['demo/service/app/*'],
      },
      {
        bindingIndex: 1,
        bindingName: 'binding-1',
        bindingNamespace: 'demo/audit/app',
        queueName: 'demo/audit/app/saptools-debug/run-1',
        topics: ['demo/audit/app/*'],
      },
    ]);
    expect(clients.get(0)?.createQueue).toHaveBeenCalledWith('demo/service/app/saptools-debug/run-0');
    expect(clients.get(1)?.createQueue).toHaveBeenCalledWith('demo/audit/app/saptools-debug/run-1');
    expect(listeners).toHaveLength(2);
    expect(listeners[0]?.start).toHaveBeenCalledTimes(1);
    expect(listeners[1]?.start).toHaveBeenCalledTimes(1);
  });

  it('starts many bindings with bounded concurrency and reports progress', async () => {
    const bindings = Array.from({ length: 8 }, (_, index) =>
      makeBinding(index, `demo/service/app/${String(index)}`)
    );
    const clients = new Map(bindings.map((binding) => [binding.index, createClient()]));
    const gates = new Map(bindings.map((binding) => [binding.index, createDeferred()]));
    const startedIndexes: number[] = [];
    const progress: { completed: number; total: number; percent: number }[] = [];
    let activeStarts = 0;
    let maxActiveStarts = 0;
    const session = new EventMeshListeningSession({
      debugQueueSegment: 'saptools-debug',
      buildRunId: (binding) => `run-${String(binding.index)}`,
      getClient: (binding) => clients.get(binding.index) ?? createClient(),
      createListener: (binding) => {
        const listener = createListener();
        listener.start = vi.fn(async () => {
          activeStarts += 1;
          maxActiveStarts = Math.max(maxActiveStarts, activeStarts);
          startedIndexes.push(binding.index);
          const gate = gates.get(binding.index);
          if (gate === undefined) {
            throw new Error(`missing gate ${String(binding.index)}`);
          }
          await gate.promise;
          activeStarts -= 1;
        });
        return listener;
      },
    });

    const startPromise = session.startMany(
      bindings.map((binding) => ({ binding, topics: [`${binding.namespace}/*`] })),
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() },
      { onProgress: (entry) => progress.push(entry) }
    );

    await expect.poll(() => startedIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxActiveStarts).toBe(6);

    gates.get(0)?.resolve();
    await expect.poll(() => startedIndexes).toEqual([0, 1, 2, 3, 4, 5, 6]);
    gates.get(1)?.resolve();
    await expect.poll(() => startedIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    for (const index of [2, 3, 4, 5, 6, 7]) {
      gates.get(index)?.resolve();
    }

    const summaries = await startPromise;

    expect(summaries.map((summary) => summary.bindingIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(progress.at(0)).toMatchObject({ completed: 1, total: 8, percent: 13 });
    expect(progress.at(-1)).toMatchObject({ completed: 8, total: 8, percent: 100 });
    expect(maxActiveStarts).toBeLessThanOrEqual(6);
  });

  it('rolls back already-started bindings if a later binding fails', async () => {
    const bindings = [makeBinding(0, 'demo/service/app'), makeBinding(1, 'demo/audit/app')];
    const clients = new Map(bindings.map((binding) => [binding.index, createClient()]));
    const listeners: EventMeshListenerLike[] = [];
    const session = new EventMeshListeningSession({
      debugQueueSegment: 'saptools-debug',
      buildRunId: (binding) => `run-${String(binding.index)}`,
      getClient: (binding) => clients.get(binding.index) ?? createClient(),
      createListener: () => {
        const listener = createListener();
        if (listeners.length === 1) {
          listener.start = vi.fn().mockRejectedValue(new Error('second listener failed'));
        }
        listeners.push(listener);
        return listener;
      },
    });

    await expect(
      session.startMany(
        bindings.map((binding) => ({ binding, topics: [`${binding.namespace}/*`] })),
        { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
      )
    ).rejects.toThrow('second listener failed');

    expect(listeners[0]?.stop).toHaveBeenCalledTimes(1);
    expect(listeners[1]?.stop).toHaveBeenCalledTimes(1);
    expect(clients.get(0)?.deleteQueue).toHaveBeenCalledWith('demo/service/app/saptools-debug/run-0');
    expect(clients.get(1)?.deleteQueue).toHaveBeenCalledWith('demo/audit/app/saptools-debug/run-1');
    expect(session.activeSummaries()).toEqual([]);
  });

  it('adds only new topics to an active binding queue', async () => {
    const binding = makeBinding(0, 'demo/service/app');
    const client = createClient();
    const clients = new Map([[binding.index, client]]);
    const session = createSession(clients, []);
    await session.startBinding(
      { binding, topics: ['demo/service/app/*'] },
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );

    const added = await session.addTopics(0, [
      'demo/service/app/*',
      'demo/service/app/items/created',
      'demo/service/app/items/updated',
    ]);

    expect(added).toEqual(['demo/service/app/items/created', 'demo/service/app/items/updated']);
    expect(client.addSubscription).toHaveBeenCalledTimes(3);
    expect(client.addSubscription).toHaveBeenNthCalledWith(
      2,
      'demo/service/app/saptools-debug/run-0',
      'demo/service/app/items/created'
    );
    expect(session.activeSummaries()[0]?.topics).toEqual([
      'demo/service/app/*',
      'demo/service/app/items/created',
      'demo/service/app/items/updated',
    ]);
  });

  it('rejects adding topics to an inactive binding', async () => {
    const session = createSession(new Map(), []);

    await expect(session.addTopics(42, ['demo/topic'])).rejects.toThrow(
      'Selected messaging binding is not listening.'
    );
  });

  it('deletes a queue when stop happens before startup becomes active', async () => {
    const binding = makeBinding(0, 'demo/service/app');
    const client = createClient();
    const subscriptionGate = createDeferred();
    client.addSubscription = vi.fn(() => subscriptionGate.promise);
    const clients = new Map([[binding.index, client]]);
    const listeners: EventMeshListenerLike[] = [];
    const session = createSession(clients, listeners);

    const startPromise = session.startBinding(
      { binding, topics: ['demo/service/app/*'] },
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );
    await expect.poll(() => vi.mocked(client.createQueue).mock.calls.length).toBe(1);

    const stopPromise = session.stopAll();
    subscriptionGate.resolve();

    await expect(startPromise).rejects.toThrow(/stopped/i);
    await stopPromise;
    expect(client.deleteQueue).toHaveBeenCalledWith('demo/service/app/saptools-debug/run-0');
    expect(session.activeSummaries()).toEqual([]);
  });

  it('rejects a duplicate start while the binding is still starting', async () => {
    const binding = makeBinding(0, 'demo/service/app');
    const client = createClient();
    const listenerGate = createDeferred();
    const listeners: EventMeshListenerLike[] = [];
    const session = new EventMeshListeningSession({
      debugQueueSegment: 'saptools-debug',
      buildRunId: (entry) => `run-${String(entry.index)}`,
      getClient: () => client,
      createListener: () => {
        const listener = createListener();
        listener.start = vi.fn(() => listenerGate.promise);
        listeners.push(listener);
        return listener;
      },
    });

    const firstStart = session.startBinding(
      { binding, topics: ['demo/service/app/*'] },
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );
    await expect.poll(() => listeners.length).toBe(1);

    await expect(
      session.startBinding(
        { binding, topics: ['demo/service/app/items/created'] },
        { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
      )
    ).rejects.toThrow(/already listening/i);

    listenerGate.resolve();
    await firstStart;
    await session.stopAll();
  });

  it('stops every listener and deletes every debug queue', async () => {
    const bindings = [makeBinding(0, 'demo/service/app'), makeBinding(1, 'demo/audit/app')];
    const clients = new Map(bindings.map((binding) => [binding.index, createClient()]));
    const listeners: EventMeshListenerLike[] = [];
    const session = createSession(clients, listeners);
    await session.startMany(
      bindings.map((binding) => ({ binding, topics: [`${binding.namespace}/*`] })),
      { onMessage: vi.fn(), onStatus: vi.fn(), onConnected: vi.fn() }
    );

    await session.stopAll();

    expect(listeners[0]?.stop).toHaveBeenCalledTimes(1);
    expect(listeners[1]?.stop).toHaveBeenCalledTimes(1);
    expect(clients.get(0)?.deleteQueue).toHaveBeenCalledWith('demo/service/app/saptools-debug/run-0');
    expect(clients.get(1)?.deleteQueue).toHaveBeenCalledWith('demo/audit/app/saptools-debug/run-1');
    expect(session.activeSummaries()).toEqual([]);
  });
});
