import { describe, expect, it, vi } from 'vitest';

import { AdvancedEventMeshSempClient, type AdvancedEventMeshFetchFn } from './advancedEventMeshClient';
import type { AdvancedEventMeshBinding } from './advancedEventMeshBindings';

// cspell:ignore SEMP Semp msgVpns demoapp

function makeBinding(): AdvancedEventMeshBinding {
  return {
    index: 0,
    name: 'advanced-event-mesh',
    instanceName: 'advanced-event-mesh',
    vpn: 'demo-aem',
    managementUri: 'https://broker.example.com:943',
    smfUri: 'wss://broker.example.com:443',
    authentication: {
      tokenendpoint: 'https://ias.example.com/oauth2/token',
      clientid: 'client-id',
      clientsecret: 'client-secret',
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('AdvancedEventMeshSempClient', () => {
  it('discovers queues and queue subscription topics through read-only SEMP GET requests', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      if (url.endsWith('/queues?count=100')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              {
                queueName: 'q/two',
                permission: 'consume',
                ingressEnabled: true,
                egressEnabled: false,
              },
              {
                queueName: 'q-one',
                permission: 'consume',
                ingressEnabled: true,
                egressEnabled: true,
              },
            ],
          })
        );
      }
      if (url.includes('/queues/q-one/subscriptions')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [{ subscriptionTopic: 'topic/a' }, { subscriptionTopic: 'topic/shared' }],
          })
        );
      }
      if (url.includes(`/queues/${encodeURIComponent('q/two')}/subscriptions`)) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [{ subscriptionTopic: 'topic/shared' }],
          })
        );
      }
      return Promise.resolve(jsonResponse(404, 'not found'));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    const discovery = await client.discoverQueueSubscriptions();

    expect(discovery.queues).toEqual([
      {
        queueName: 'q-one',
        permission: 'consume',
        ingressEnabled: true,
        egressEnabled: true,
        subscriptionCount: 2,
      },
      {
        queueName: 'q/two',
        permission: 'consume',
        ingressEnabled: true,
        egressEnabled: false,
        subscriptionCount: 1,
      },
    ]);
    expect(discovery.topics).toEqual([
      { topic: 'topic/a', queues: ['q-one'] },
      { topic: 'topic/shared', queues: ['q-one', 'q/two'] },
    ]);
    expect(discovery.unreadableQueueCount).toBe(0);

    const methods = fetchFn.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? 'GET');
    expect(methods).toEqual(['POST', 'GET', 'GET', 'GET']);
    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      'https://broker.example.com:943/SEMP/v2/config/msgVpns/demo-aem/queues?count=100'
    );
    expect(String(fetchFn.mock.calls[3]?.[0])).toContain(
      `/queues/${encodeURIComponent('q/two')}/subscriptions`
    );
  });

  it('sends OAuth client credentials as a form body without putting secrets in the URL', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      return Promise.resolve(jsonResponse(200, { data: [] }));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await client.listQueues();

    const tokenCall = fetchFn.mock.calls[0];
    const init = tokenCall?.[1] as RequestInit | undefined;
    expect(tokenCall?.[0]).toBe('https://ias.example.com/oauth2/token');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual(
      expect.objectContaining({ 'content-type': 'application/x-www-form-urlencoded' })
    );
    expect(String(init?.body)).toContain('grant_type=client_credentials');
    expect(String(init?.body)).toContain('client_id=client-id');
    expect(String(init?.body)).toContain('client_secret=client-secret');
  });

  it('uses SEMP pagination links when the broker returns another page', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      if (url.endsWith('/queues?count=100')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [{ queueName: 'q1' }],
            meta: { pagination: { nextPageUri: '/SEMP/v2/config/msgVpns/demo-aem/queues?cursor=abc' } },
          })
        );
      }
      if (url.endsWith('/queues?cursor=abc')) {
        return Promise.resolve(jsonResponse(200, { data: [{ queueName: 'q2' }] }));
      }
      return Promise.resolve(jsonResponse(404, 'not found'));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    expect((await client.listQueues()).map((queue) => queue.queueName)).toEqual(['q1', 'q2']);
  });

  it('rejects cross-origin SEMP pagination links before requesting a token for that page', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      if (url.endsWith('/queues?count=100')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [{ queueName: 'q1' }],
            meta: { pagination: { nextPageUri: 'https://evil.example.com/SEMP/v2/config/x' } },
          })
        );
      }
      return Promise.resolve(jsonResponse(404, 'not found'));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await expect(client.listQueues()).rejects.toThrow(/outside/i);
    expect(fetchFn.mock.calls.map((call) => String(call[0]))).not.toContain(
      'https://evil.example.com/SEMP/v2/config/x'
    );
  });

  it('stops SEMP pagination loops instead of following the same page repeatedly', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      return Promise.resolve(
        jsonResponse(200, {
          data: [{ queueName: 'q1' }],
          meta: { pagination: { nextPageUri: '/SEMP/v2/config/msgVpns/demo-aem/queues?count=100' } },
        })
      );
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await expect(client.listQueues()).rejects.toThrow(/loop/i);
  });

  it('reports unreadable queues while preserving topics from readable queues', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      if (url.endsWith('/queues?count=100')) {
        return Promise.resolve(
          jsonResponse(200, { data: [{ queueName: 'q1' }, { queueName: 'q2' }] })
        );
      }
      if (url.includes('/queues/q1/subscriptions')) {
        return Promise.resolve(jsonResponse(500, 'temporary failure'));
      }
      return Promise.resolve(jsonResponse(200, { data: [{ subscriptionTopic: 'topic/ok' }] }));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await expect(client.discoverQueueSubscriptions()).resolves.toEqual({
      queues: [{ queueName: 'q1' }, { queueName: 'q2', subscriptionCount: 1 }],
      topics: [{ topic: 'topic/ok', queues: ['q2'] }],
      unreadableQueueCount: 1,
    });
  });

  it('aborts a pending SEMP request when the caller aborts the signal', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal instanceof AbortSignal) {
          signal.addEventListener('abort', () => {
            reject(new Error('fetch aborted'));
          }, { once: true });
        }
      });
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    const request = client.listQueues(controller.signal);
    controller.abort();

    await expect(request).rejects.toThrow(/aborted/i);
  });

  it('does not start a SEMP request when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: [] })));
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await expect(client.listQueues(controller.signal)).rejects.toThrow(/aborted/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not leak the client secret in HTTP error messages', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(401, 'client-secret rejected'));
      }
      return Promise.resolve(jsonResponse(200, { data: [] }));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await expect(client.listQueues()).rejects.toThrow(/HTTP 401/);
    await expect(client.listQueues()).rejects.not.toThrow(/client-secret/);
  });

  it('creates a bounded debug queue and subscription with SEMP write requests', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      return Promise.resolve(jsonResponse(200, { data: [] }));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await client.createQueue('saptools-debug/run-1');
    await client.addSubscription('saptools-debug/run-1', 'topic/one/>');

    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      'https://broker.example.com:943/SEMP/v2/config/msgVpns/demo-aem/queues'
    );
    expect(fetchFn.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          msgVpnName: 'demo-aem',
          queueName: 'saptools-debug/run-1',
          accessType: 'exclusive',
          permission: 'consume',
          ingressEnabled: true,
          egressEnabled: true,
          maxMsgSpoolUsage: 10,
          maxMsgSize: 10485760,
          respectTtlEnabled: true,
        }),
      })
    );
    expect(fetchFn.mock.calls[2]?.[0]).toBe(
      `https://broker.example.com:943/SEMP/v2/config/msgVpns/demo-aem/queues/${encodeURIComponent('saptools-debug/run-1')}/subscriptions`
    );
    expect(fetchFn.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          msgVpnName: 'demo-aem',
          queueName: 'saptools-debug/run-1',
          subscriptionTopic: 'topic/one/>',
        }),
      })
    );
  });

  it('deletes debug queues idempotently through SEMP', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/oauth2/token')) {
        return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 600 }));
      }
      return Promise.resolve(jsonResponse(404, 'missing'));
    });
    const client = new AdvancedEventMeshSempClient(
      makeBinding(),
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    await expect(client.deleteQueue('saptools-debug/run-1')).resolves.toBeUndefined();

    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      `https://broker.example.com:943/SEMP/v2/config/msgVpns/demo-aem/queues/${encodeURIComponent('saptools-debug/run-1')}`
    );
    expect(fetchFn.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
