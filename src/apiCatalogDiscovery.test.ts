import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cfClientMocks = vi.hoisted(() => ({
  fetchRemoteCdsServicesFromTarget: vi.fn(),
  fetchXsuaaTokenFromTarget: vi.fn(),
}));

vi.mock('./cfClient.js', () => cfClientMocks);

import { discoverApiEntities } from './apiCatalogDiscovery';

const TARGET_PARAMS = {
  apiEndpoint: 'https://api.example.com',
  email: 'user@example.com',
  password: 'secret',
  orgName: 'demo-org',
  spaceName: 'demo-space',
  cfHomeDir: '/tmp/cf-home',
};

describe('API catalog discovery', () => {
  beforeEach(() => {
    cfClientMocks.fetchXsuaaTokenFromTarget.mockReset();
    cfClientMocks.fetchXsuaaTokenFromTarget.mockResolvedValue('Bearer token');
    cfClientMocks.fetchRemoteCdsServicesFromTarget.mockReset();
    cfClientMocks.fetchRemoteCdsServicesFromTarget.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('expands CAP root endpoints into their OData entities', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn(async (): Promise<unknown> => ({
          endpoints: [{ name: 'CatalogService', path: '/odata/v4/catalog' }],
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn(async (): Promise<unknown> => ({
          value: [{ name: 'Products', url: 'Products' }],
        })),
      });
    vi.stubGlobal('fetch', fetchMock);

    const entities = await discoverApiEntities({
      appId: 'demo-app',
      baseUrl: 'https://demo.example.com',
      targetParams: TARGET_PARAMS,
      log: vi.fn(),
      onDeepDiscoveryStart: vi.fn(),
    });

    expect(entities).toEqual([
      expect.objectContaining({
        name: 'CatalogService / Products',
        path: '/odata/v4/catalog/Products',
      }),
    ]);
  });

  it('falls back to CDS service declarations when root discovery fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<never> => {
      throw new Error('root unavailable');
    }));
    cfClientMocks.fetchRemoteCdsServicesFromTarget.mockResolvedValue(
      "service OrdersService @(path: '/odata/v4/orders') { }"
    );

    const entities = await discoverApiEntities({
      appId: 'demo-app',
      baseUrl: 'https://demo.example.com',
      targetParams: TARGET_PARAMS,
      log: vi.fn(),
      onDeepDiscoveryStart: vi.fn(),
    });

    expect(entities).toEqual([
      expect.objectContaining({
        name: 'OrdersService',
        path: '/odata/v4/orders',
      }),
    ]);
  });
});
