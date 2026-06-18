import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EventMeshBinding } from './eventMeshBindings';
import { publishEventToMesh, publishEventToMeshQueue } from './eventMeshPublishClient';

function makeBinding(index: number): EventMeshBinding {
  const oa2 = {
    clientid: `cid-${index}`,
    clientsecret: `sec-${index}`,
    tokenendpoint: `https://uaa.example.com/oauth/token-${index}`,
  };
  return {
    index,
    name: `app-service-${index}`,
    instanceName: `app-service-${index}`,
    namespace: `demo/service/app/${index}`,
    management: { uri: 'https://mgmt.example.com', oa2 },
    messaging: { uri: 'https://rest.example.com', oa2 },
    amqp: { uri: 'wss://amqp.example.com', oa2 },
  };
}

function textResponse(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function stubPublishFetch(): ReturnType<typeof vi.fn> {
  const fetchFn = vi.fn((url: string) => {
    if (url.includes('/oauth/token')) {
      return Promise.resolve(textResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 300 })));
    }
    return Promise.resolve(textResponse(204));
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

function publishCall(fetchFn: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const call = fetchFn.mock.calls.find((entry) => String(entry[0]).includes('/messagingrest/'));
  if (call === undefined) {
    throw new Error('Publish call was not made.');
  }
  return [String(call[0]), call[1] as RequestInit];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Event Mesh REST publish client', () => {
  it('publishes topic messages to the topic REST Messaging endpoint', async () => {
    const fetchFn = stubPublishFetch();
    const binding = makeBinding(1);

    const status = await publishEventToMesh(
      binding,
      'demo/service/app/items/created',
      '{"ok":true}',
      'application/json'
    );

    const [url, init] = publishCall(fetchFn);
    expect(status).toBe(204);
    expect(url).toBe(
      `https://rest.example.com/messagingrest/v1/topics/${encodeURIComponent('demo/service/app/items/created')}/messages`
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"ok":true}');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-qos': '0' });
  });

  it('publishes queue messages to the queue REST Messaging endpoint', async () => {
    const fetchFn = stubPublishFetch();
    const binding = makeBinding(2);

    const status = await publishEventToMeshQueue(
      binding,
      'demo/service/app/q-main',
      'plain text',
      'text/plain'
    );

    const [url, init] = publishCall(fetchFn);
    expect(status).toBe(204);
    expect(url).toBe(
      `https://rest.example.com/messagingrest/v1/queues/${encodeURIComponent('demo/service/app/q-main')}/messages`
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBe('plain text');
    expect(init.headers).toMatchObject({ 'content-type': 'text/plain', 'x-qos': '0' });
  });
});
