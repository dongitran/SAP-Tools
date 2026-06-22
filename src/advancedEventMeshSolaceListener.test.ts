import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { AdvancedEventMeshBinding } from './advancedEventMeshBindings';
import type { AdvancedEventMeshFetchFn } from './advancedEventMeshClient';
import {
  AdvancedEventMeshSolaceListener,
  type SolclientjsModuleLoader,
} from './advancedEventMeshSolaceListener';

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

class FakeSession extends EventEmitter {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn(() => {
    this.emit('DISCONNECTED');
  });
  readonly dispose = vi.fn();
  consumer: FakeConsumer | null = null;
  consumerOptions: unknown = null;

  createMessageConsumer(options: unknown): FakeConsumer {
    this.consumerOptions = options;
    this.consumer = new FakeConsumer();
    return this.consumer;
  }
}

class FakeConsumer extends EventEmitter {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn(() => {
    this.emit('DOWN');
  });
  readonly dispose = vi.fn();
}

class FakeMessage {
  constructor(private readonly body: Buffer) {}

  getBinaryAttachment(): Buffer {
    return this.body;
  }

  getDestination(): { getName: () => string } {
    return { getName: () => 'topic/one' };
  }

  getHttpContentType(): string {
    return 'application/json';
  }

  getApplicationMessageId(): string {
    return 'msg-1';
  }
}

function createFakeSolace(): {
  readonly session: FakeSession;
  readonly createdSessionProperties: unknown[];
  readonly loader: SolclientjsModuleLoader;
} {
  const session = new FakeSession();
  const createdSessionProperties: unknown[] = [];
  const solace = {
    AuthenticationScheme: { OAUTH2: 'OAUTH2' },
    LogLevel: { ERROR: 'ERROR' },
    MessageConsumerAcknowledgeMode: { AUTO: 'AUTO' },
    MessageConsumerEventName: {
      CONNECT_FAILED_ERROR: 'CONNECT_FAILED_ERROR',
      DOWN: 'DOWN',
      DOWN_ERROR: 'DOWN_ERROR',
      MESSAGE: 'MESSAGE',
      UP: 'UP',
    },
    QueueType: { QUEUE: 'QUEUE' },
    SessionEventCode: {
      CONNECT_FAILED_ERROR: 'CONNECT_FAILED_ERROR',
      DISCONNECTED: 'DISCONNECTED',
      DOWN_ERROR: 'DOWN_ERROR',
      UP_NOTICE: 'UP_NOTICE',
    },
    SolclientFactory: {
      createSession: vi.fn((properties: unknown) => {
        createdSessionProperties.push(properties);
        return session;
      }),
      init: vi.fn(),
    },
    SolclientFactoryProfiles: { version10: 'version10' },
    QueueDescriptor: class QueueDescriptor {
      constructor(readonly value: unknown) {}
    },
    SessionProperties: class SessionProperties {
      constructor(readonly value: unknown) {}
    },
    SolclientFactoryProperties: class SolclientFactoryProperties {
      constructor(readonly value: unknown) {}
    },
  };
  return {
    session,
    createdSessionProperties,
    loader: () => solace,
  };
}

describe('AdvancedEventMeshSolaceListener', () => {
  it('uses OAuth2 and binds a consumer to the debug queue', async () => {
    const fake = createFakeSolace();
    const fetchFn = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { access_token: 'token-1', expires_in: 600 }))
    );
    const listener = new AdvancedEventMeshSolaceListener(
      makeBinding(),
      'saptools/aem/demo-aem/saptools-debug/run-1',
      { onMessage: vi.fn(), onError: vi.fn(), onConnected: vi.fn() },
      fake.loader,
      fetchFn as unknown as AdvancedEventMeshFetchFn
    );

    const start = listener.start();
    await vi.waitFor(() => expect(fake.session.connect).toHaveBeenCalledTimes(1));
    fake.session.emit('UP_NOTICE');
    await vi.waitFor(() => expect(fake.session.consumer?.connect).toHaveBeenCalledTimes(1));
    fake.session.consumer?.emit('UP');
    await start;

    const tokenInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(String(tokenInit?.body)).toContain('grant_type=client_credentials');
    expect(String(tokenInit?.body)).toContain('client_id=client-id');
    expect(String(tokenInit?.body)).toContain('client_secret=client-secret');
    expect(fake.createdSessionProperties[0]).toEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          accessToken: 'token-1',
          authenticationScheme: 'OAUTH2',
          url: 'wss://broker.example.com:443',
          userName: 'client-id',
          vpnName: 'demo-aem',
        }),
      })
    );
    expect(fake.session.consumerOptions).toEqual(
      expect.objectContaining({
        acknowledgeMode: 'AUTO',
        createIfMissing: false,
        queueDescriptor: expect.objectContaining({
          value: expect.objectContaining({
            name: 'saptools/aem/demo-aem/saptools-debug/run-1',
            type: 'QUEUE',
          }),
        }),
      })
    );
  });

  it('normalizes Solace consumer messages for the Advanced Event Mesh panel', async () => {
    const fake = createFakeSolace();
    const onMessage = vi.fn();
    const listener = new AdvancedEventMeshSolaceListener(
      makeBinding(),
      'saptools/aem/demo-aem/saptools-debug/run-1',
      { onMessage, onError: vi.fn(), onConnected: vi.fn() },
      fake.loader,
      vi.fn(() => Promise.resolve(jsonResponse(200, { access_token: 'token-1' }))) as unknown as AdvancedEventMeshFetchFn
    );

    const start = listener.start();
    await vi.waitFor(() => expect(fake.session.connect).toHaveBeenCalledTimes(1));
    fake.session.emit('UP_NOTICE');
    await vi.waitFor(() => expect(fake.session.consumer?.connect).toHaveBeenCalledTimes(1));
    fake.session.consumer?.emit('UP');
    await start;
    fake.session.consumer?.emit('MESSAGE', new FakeMessage(Buffer.from('{"ok":true}')));

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: Buffer.from('{"ok":true}'),
        contentType: 'application/json',
        messageId: 'msg-1',
        topic: 'topic/one',
      })
    );
  });

  it('rejects startup when stopped before the consumer becomes active', async () => {
    const fake = createFakeSolace();
    const listener = new AdvancedEventMeshSolaceListener(
      makeBinding(),
      'saptools/aem/demo-aem/saptools-debug/run-1',
      { onMessage: vi.fn(), onError: vi.fn(), onConnected: vi.fn() },
      fake.loader,
      vi.fn(() => Promise.resolve(jsonResponse(200, { access_token: 'token-1' }))) as unknown as AdvancedEventMeshFetchFn
    );

    const start = listener.start();
    await vi.waitFor(() => expect(fake.session.connect).toHaveBeenCalledTimes(1));
    listener.stop();

    await expect(start).rejects.toThrow(/stopped before/i);
    expect(fake.session.disconnect).toHaveBeenCalledTimes(1);
  });
});
