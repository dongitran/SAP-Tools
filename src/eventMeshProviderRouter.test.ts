import { describe, expect, it, vi } from 'vitest';

import { EventMeshProviderRouter } from './eventMeshProviderRouter';
import type { EventMeshTargetParams } from './eventMeshPanel';

// cspell:ignore simplemdg

function makeTargetParams(): EventMeshTargetParams {
  return {
    apiEndpoint: 'https://api.example.com',
    email: 'user@example.com',
    password: 'secret',
    orgName: 'demo-org',
    spaceName: 'dev',
    cfHomeDir: '/tmp/cf-home',
  };
}

function regularEventEnv(): Record<string, unknown> {
  return {
    VCAP_SERVICES: {
      'enterprise-messaging': [
        {
          name: 'regular-em',
          instance_name: 'regular-em',
          credentials: {
            namespace: 'demo/app',
            management: [
              {
                uri: 'https://event-mesh.example.com',
                oa2: {
                  clientid: 'id',
                  clientsecret: 'secret',
                  tokenendpoint: 'https://uaa.example.com/oauth/token',
                },
              },
            ],
            messaging: [
              {
                protocol: ['httprest'],
                uri: 'https://event-mesh.example.com/rest',
                oa2: {
                  clientid: 'id',
                  clientsecret: 'secret',
                  tokenendpoint: 'https://uaa.example.com/oauth/token',
                },
              },
              {
                protocol: ['amqp10ws'],
                uri: 'wss://event-mesh.example.com/amqp',
                oa2: {
                  clientid: 'id',
                  clientsecret: 'secret',
                  tokenendpoint: 'https://uaa.example.com/oauth/token',
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function advancedEventEnv(): Record<string, unknown> {
  return {
    VCAP_SERVICES: {
      'user-provided': [
        {
          name: 'advanced-event-mesh',
          instance_name: 'advanced-event-mesh',
          credentials: {
            'authentication-service': {
              tokenendpoint: 'https://ias.example.com/oauth2/token',
              clientid: 'client-id',
              clientsecret: 'client-secret',
            },
            endpoints: {
              'advanced-event-mesh': {
                uri: 'https://broker.example.com:943',
                smf_uri: 'wss://broker.example.com:443',
              },
            },
            vpn: 'simplemdg-aem',
          },
        },
      ],
    },
  };
}

function mergedEnv(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  return {
    VCAP_SERVICES: {
      ...(left['VCAP_SERVICES'] as Record<string, unknown>),
      ...(right['VCAP_SERVICES'] as Record<string, unknown>),
    },
  };
}

describe('EventMeshProviderRouter', () => {
  it('preserves the legacy Event Mesh panel when no target params are available', () => {
    const classic = { openEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const advanced = { openAdvancedEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const router = new EventMeshProviderRouter(classic, advanced);

    router.openEventMeshViewer('demo-app');

    expect(classic.openEventMeshViewer).toHaveBeenCalledWith('demo-app', undefined);
    expect(advanced.openAdvancedEventMeshViewer).not.toHaveBeenCalled();
  });

  it('opens the regular Event Mesh panel when only enterprise-messaging is bound', async () => {
    const classic = { openEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const advanced = { openAdvancedEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const params = makeTargetParams();
    const router = new EventMeshProviderRouter(classic, advanced, {
      prepareCfCliSession: vi.fn(async () => undefined),
      fetchDefaultEnvJsonFromTarget: vi.fn(async () => JSON.stringify(regularEventEnv())),
    });

    await router.openEventMeshViewer('demo-app', params);

    expect(classic.openEventMeshViewer).toHaveBeenCalledWith('demo-app', params);
    expect(advanced.openAdvancedEventMeshViewer).not.toHaveBeenCalled();
  });

  it('opens the Advanced Event Mesh panel when only advanced-event-mesh is bound', async () => {
    const classic = { openEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const advanced = { openAdvancedEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const params = makeTargetParams();
    const router = new EventMeshProviderRouter(classic, advanced, {
      prepareCfCliSession: vi.fn(async () => undefined),
      fetchDefaultEnvJsonFromTarget: vi.fn(async () => JSON.stringify(advancedEventEnv())),
    });

    await router.openEventMeshViewer('demo-app', params);

    expect(classic.openEventMeshViewer).not.toHaveBeenCalled();
    expect(advanced.openAdvancedEventMeshViewer).toHaveBeenCalledWith('demo-app', params, {
      classicAvailable: false,
    });
  });

  it('opens the Advanced Event Mesh panel with a classic provider tab when both bindings exist', async () => {
    const classic = { openEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const advanced = { openAdvancedEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const params = makeTargetParams();
    const router = new EventMeshProviderRouter(classic, advanced, {
      prepareCfCliSession: vi.fn(async () => undefined),
      fetchDefaultEnvJsonFromTarget: vi.fn(async () =>
        JSON.stringify(mergedEnv(regularEventEnv(), advancedEventEnv()))
      ),
    });

    await router.openEventMeshViewer('demo-app', params);

    expect(classic.openEventMeshViewer).not.toHaveBeenCalled();
    expect(advanced.openAdvancedEventMeshViewer).toHaveBeenCalledWith('demo-app', params, {
      classicAvailable: true,
    });
  });

  it('falls back to the legacy panel so existing no-binding errors stay unchanged', async () => {
    const classic = { openEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const advanced = { openAdvancedEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const params = makeTargetParams();
    const router = new EventMeshProviderRouter(classic, advanced, {
      prepareCfCliSession: vi.fn(async () => undefined),
      fetchDefaultEnvJsonFromTarget: vi.fn(async () => JSON.stringify({ VCAP_SERVICES: {} })),
    });

    await router.openEventMeshViewer('demo-app', params);

    expect(classic.openEventMeshViewer).toHaveBeenCalledWith('demo-app', params);
    expect(advanced.openAdvancedEventMeshViewer).not.toHaveBeenCalled();
  });

  it('falls back to the legacy panel when provider detection cannot read the app env', async () => {
    const classic = { openEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const advanced = { openAdvancedEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const params = makeTargetParams();
    const router = new EventMeshProviderRouter(classic, advanced, {
      prepareCfCliSession: vi.fn(async () => undefined),
      fetchDefaultEnvJsonFromTarget: vi.fn(async () => {
        throw new Error('cf env unavailable');
      }),
    });

    await router.openEventMeshViewer('demo-app', params);

    expect(classic.openEventMeshViewer).toHaveBeenCalledWith('demo-app', params);
    expect(advanced.openAdvancedEventMeshViewer).not.toHaveBeenCalled();
  });

  it('stops listeners on every underlying provider', () => {
    const classic = { openEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const advanced = { openAdvancedEventMeshViewer: vi.fn(), stopAllListeners: vi.fn() };
    const router = new EventMeshProviderRouter(classic, advanced);

    router.stopAllListeners('scope-changed');

    expect(classic.stopAllListeners).toHaveBeenCalledWith('scope-changed');
    expect(advanced.stopAllListeners).toHaveBeenCalledWith('scope-changed');
  });
});
