import { describe, expect, it } from 'vitest';

import { extractAdvancedEventMeshDiscovery } from './advancedEventMeshBindings';

// cspell:ignore clientid clientsecret demoapp smdg tokenendpoint

function advancedService(name = 'advanced-event-mesh'): Record<string, unknown> {
  return {
    name,
    instance_name: name,
    credentials: {
      'authentication-service': {
        tokenendpoint: 'https://ias.example.com/oauth2/token',
        clientid: 'aem-client',
        clientsecret: 'aem-secret',
      },
      endpoints: {
        'advanced-event-mesh': {
          uri: 'https://broker.example.com:943/',
          smf_uri: 'wss://broker.example.com:443/',
        },
      },
      vpn: 'demo-aem',
    },
  };
}

function validationService(): Record<string, unknown> {
  return {
    name: 'smdg-aem-validation-service',
    instance_name: 'smdg-aem-validation-service',
    plan: 'aem-validation-service-plan',
    credentials: {
      handshake: {
        uri: 'https://em-pubsub-broker.mesh.cf.us10.hana.ondemand.com/handshake/',
        oa2: {
          tokenendpoint: 'https://uaa.example.com/oauth/token',
          clientid: 'validation-client',
          clientsecret: 'validation-secret',
          granttype: 'client_credentials',
        },
      },
    },
  };
}

function envWith(vcap: Record<string, unknown>): Record<string, unknown> {
  return { VCAP_SERVICES: vcap };
}

describe('extractAdvancedEventMeshDiscovery', () => {
  it('parses CAP Advanced Event Mesh user-provided and validation bindings', () => {
    const discovery = extractAdvancedEventMeshDiscovery(
      envWith({
        'user-provided': [advancedService()],
        'aem-validation-service': [validationService()],
      })
    );

    expect(discovery.brokerBindings).toHaveLength(1);
    expect(discovery.brokerBindings[0]).toEqual({
      index: 0,
      name: 'advanced-event-mesh',
      instanceName: 'advanced-event-mesh',
      vpn: 'demo-aem',
      managementUri: 'https://broker.example.com:943',
      smfUri: 'wss://broker.example.com:443',
      authentication: {
        tokenendpoint: 'https://ias.example.com/oauth2/token',
        clientid: 'aem-client',
        clientsecret: 'aem-secret',
      },
    });

    expect(discovery.validationBindings).toHaveLength(1);
    expect(discovery.validationBindings[0]).toEqual({
      index: 0,
      name: 'smdg-aem-validation-service',
      instanceName: 'smdg-aem-validation-service',
      handshakeUri: 'https://em-pubsub-broker.mesh.cf.us10.hana.ondemand.com/handshake',
      authentication: {
        tokenendpoint: 'https://uaa.example.com/oauth/token',
        clientid: 'validation-client',
        clientsecret: 'validation-secret',
        granttype: 'client_credentials',
      },
    });
  });

  it('accepts an Advanced Event Mesh service with the expected endpoint key even when renamed', () => {
    const discovery = extractAdvancedEventMeshDiscovery(
      envWith({ 'user-provided': [advancedService('renamed-binding')] })
    );

    expect(discovery.brokerBindings).toHaveLength(1);
    expect(discovery.brokerBindings[0]?.name).toBe('renamed-binding');
  });

  it('skips incomplete broker and validation bindings while preserving original indexes', () => {
    const incompleteBroker = advancedService('broken-aem');
    const brokerCredentials = incompleteBroker['credentials'] as Record<string, unknown>;
    delete brokerCredentials['vpn'];

    const incompleteValidation = validationService();
    const validationCredentials = incompleteValidation['credentials'] as Record<string, unknown>;
    validationCredentials['handshake'] = { uri: 'https://handshake.example.com' };

    const discovery = extractAdvancedEventMeshDiscovery(
      envWith({
        'user-provided': [incompleteBroker, advancedService('valid-aem')],
        'aem-validation-service': [incompleteValidation, validationService()],
      })
    );

    expect(discovery.brokerBindings).toHaveLength(1);
    expect(discovery.brokerBindings[0]?.index).toBe(1);
    expect(discovery.brokerBindings[0]?.name).toBe('valid-aem');
    expect(discovery.validationBindings).toHaveLength(1);
    expect(discovery.validationBindings[0]?.index).toBe(1);
  });

  it('returns empty arrays when VCAP_SERVICES is absent or malformed', () => {
    expect(extractAdvancedEventMeshDiscovery({})).toEqual({
      brokerBindings: [],
      validationBindings: [],
    });
    expect(extractAdvancedEventMeshDiscovery({ VCAP_SERVICES: { 'user-provided': 'nope' } }))
      .toEqual({
        brokerBindings: [],
        validationBindings: [],
      });
  });
});
