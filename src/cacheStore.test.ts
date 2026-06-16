import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

import {
  buildExportRootFolderScopeKey,
  buildHanaTableListScopeKey,
  CacheStore,
  normalizeUserEmail,
} from './cacheStore';
import type {
  CacheState,
  CachedUserEntry,
  HanaTableListCacheEntry,
} from './cacheModels';

interface MockGlobalState {
  readonly get: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
}

function createMockContext(
  initialState: unknown = undefined
): vscode.ExtensionContext {
  const storage = new Map<string, unknown>();
  if (initialState !== undefined) {
    storage.set('sapTools.cache.state.v1', initialState);
  }

  const globalState: MockGlobalState = {
    get: vi.fn((key: string) => storage.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      storage.set(key, value);
    }),
  };

  return {
    globalState,
  } as unknown as vscode.ExtensionContext;
}

function createSampleUser(email: string): CachedUserEntry {
  return {
    email,
    syncInProgress: false,
    lastSyncStartedAt: '2026-04-13T01:00:00.000Z',
    lastSyncCompletedAt: '2026-04-13T01:15:00.000Z',
    lastSyncError: '',
    regions: [
      {
        regionId: 'us10',
        regionCode: 'us-10',
        area: 'Americas',
        displayName: 'US East (VA)',
        accessState: 'accessible',
        accessMessage: '',
        updatedAt: '2026-04-13T01:10:00.000Z',
        orgs: [
          {
            guid: 'org-1',
            name: 'finance-services-prod',
            spaces: [
              {
                guid: 'space-1',
                name: 'uat',
                apps: [{ id: 'app-1', name: 'finance-uat-api', runningInstances: 1 }],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('CacheStore', () => {
  it('returns default state when storage is empty', async () => {
    const context = createMockContext();
    const store = new CacheStore(context);

    const state = await store.readState();
    expect(state).toEqual({
      version: 1,
      settings: { syncIntervalHours: 24 },
      users: {},
      exportRootFolders: {},
      hanaTableLists: {},
      apiCatalogs: {},
    });
  });

  it('normalizes persisted state that lacks the hanaTableLists field for backward compatibility', async () => {
    const legacyState = {
      version: 1,
      settings: { syncIntervalHours: 24 },
      users: {},
      exportRootFolders: {},
    };
    const context = createMockContext(legacyState);
    const store = new CacheStore(context);

    const state = await store.readState();
    expect(state.hanaTableLists).toEqual({});
  });

  it('persists sync interval setting', async () => {
    const context = createMockContext();
    const store = new CacheStore(context);

    await store.setSyncIntervalHours(48);
    const settings = await store.getSettings();

    expect(settings.syncIntervalHours).toBe(48);
  });

  it('falls back to default interval when persisted value is invalid', async () => {
    const context = createMockContext({
      version: 1,
      settings: {
        syncIntervalHours: 13,
      },
      users: {},
    });
    const store = new CacheStore(context);

    const settings = await store.getSettings();
    expect(settings.syncIntervalHours).toBe(24);
  });

  it('stores user entries independently by normalized email key', async () => {
    const context = createMockContext();
    const store = new CacheStore(context);

    await store.upsertUser('User.A@Example.com', () => createSampleUser('User.A@Example.com'));
    await store.upsertUser('user.b@example.com', () => createSampleUser('user.b@example.com'));

    const userA = await store.getUser('user.a@example.com');
    const userB = await store.getUser('USER.B@EXAMPLE.COM');

    expect(userA?.email).toBe('User.A@Example.com');
    expect(userB?.email).toBe('user.b@example.com');
    expect(userA?.regions[0]?.regionCode).toBe('us-10');
    expect(userB?.regions[0]?.orgs[0]?.spaces[0]?.apps[0]?.name).toBe('finance-uat-api');
  });

  it('normalizes persisted user keys and strips invalid entries', async () => {
    const persisted: CacheState = {
      version: 1,
      settings: { syncIntervalHours: 24 },
      users: {
        'USER.C@EXAMPLE.COM': createSampleUser('user.c@example.com'),
        '': createSampleUser('invalid@example.com'),
      },
      exportRootFolders: {},
      hanaTableLists: {},
    };
    const context = createMockContext(persisted);
    const store = new CacheStore(context);

    const state = await store.readState();
    expect(Object.keys(state.users)).toEqual(['user.c@example.com']);
  });

  it('serializes concurrent writes to prevent lost updates', async () => {
    const storage = new Map<string, unknown>();
    let inFlightUpdates = 0;
    let maxInFlightUpdates = 0;

    const context = {
      globalState: {
        get: vi.fn((key: string) => storage.get(key)),
        update: vi.fn(async (key: string, value: unknown) => {
          inFlightUpdates += 1;
          maxInFlightUpdates = Math.max(maxInFlightUpdates, inFlightUpdates);
          await new Promise((resolve) => setTimeout(resolve, 10));
          storage.set(key, value);
          inFlightUpdates -= 1;
        }),
      },
    } as unknown as vscode.ExtensionContext;

    const store = new CacheStore(context);

    await Promise.all([
      store.setSyncIntervalHours(48),
      store.upsertUser('race.a@example.com', () => createSampleUser('race.a@example.com')),
      store.upsertUser('race.b@example.com', () => createSampleUser('race.b@example.com')),
    ]);

    const state = await store.readState();
    expect(state.settings.syncIntervalHours).toBe(48);
    expect(state.users['race.a@example.com']?.email).toBe('race.a@example.com');
    expect(state.users['race.b@example.com']?.email).toBe('race.b@example.com');
    expect(maxInFlightUpdates).toBe(1);
  });

  it('stores and resolves export root folder by normalized scope key', async () => {
    const context = createMockContext();
    const store = new CacheStore(context);

    await store.setExportRootFolder(
      '  Dev.User@Example.Com ',
      ' US-10 ',
      ' ORG-GUID-1 ',
      ' /tmp/workspace/services '
    );

    const cachedEntry = await store.getExportRootFolder(
      'dev.user@example.com',
      'us-10',
      'org-guid-1'
    );

    expect(cachedEntry?.rootFolderPath).toBe('/tmp/workspace/services');
    expect(typeof cachedEntry?.updatedAt).toBe('string');
    expect(cachedEntry?.updatedAt.length).toBeGreaterThan(0);
  });

  it('deletes export root folder cache for scope', async () => {
    const context = createMockContext();
    const store = new CacheStore(context);

    await store.setExportRootFolder(
      'dev@example.com',
      'us-10',
      'org-guid-1',
      '/tmp/workspace/services'
    );
    await store.deleteExportRootFolder('dev@example.com', 'us-10', 'org-guid-1');

    const cachedEntry = await store.getExportRootFolder(
      'dev@example.com',
      'us-10',
      'org-guid-1'
    );
    expect(cachedEntry).toBeNull();
  });
});

describe('normalizeUserEmail', () => {
  it('trims and lowercases email key', () => {
    expect(normalizeUserEmail('  Dev.User@Example.Com  ')).toBe(
      'dev.user@example.com'
    );
  });
});

describe('buildExportRootFolderScopeKey', () => {
  it('normalizes email, region code and org guid', () => {
    expect(
      buildExportRootFolderScopeKey(
        ' Dev.User@Example.Com ',
        ' US-10 ',
        ' ORG-GUID-1 '
      )
    ).toBe('dev.user@example.com::us-10::org-guid-1');
  });
});

describe('buildHanaTableListScopeKey', () => {
  it('joins email, api endpoint, org, space and app id with double colons', () => {
    expect(
      buildHanaTableListScopeKey({
        email: 'Dev.User@Example.Com',
        apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
        orgName: 'Finance-Services-Prod',
        spaceName: 'UAT',
        appId: 'finance-uat-api',
      })
    ).toBe(
      'dev.user@example.com::https://api.cf.us10.hana.ondemand.com::finance-services-prod::uat::finance-uat-api'
    );
  });

  it('strips a trailing slash on the api endpoint so equivalent URLs map to the same key', () => {
    expect(
      buildHanaTableListScopeKey({
        email: 'a@b.com',
        apiEndpoint: 'https://api.example.com/',
        orgName: 'org',
        spaceName: 'space',
        appId: 'app',
      })
    ).toBe('a@b.com::https://api.example.com::org::space::app');
  });

  it('returns an empty string when any scope component is blank', () => {
    expect(
      buildHanaTableListScopeKey({
        email: '',
        apiEndpoint: 'https://api.example.com',
        orgName: 'org',
        spaceName: 'space',
        appId: 'app',
      })
    ).toBe('');
    expect(
      buildHanaTableListScopeKey({
        email: 'a@b.com',
        apiEndpoint: 'https://api.example.com',
        orgName: 'org',
        spaceName: '',
        appId: 'app',
      })
    ).toBe('');
  });
});

describe('CacheStore HANA table list cache', () => {
  function createSampleHanaTableListEntry(
    overrides: Partial<HanaTableListCacheEntry> = {}
  ): HanaTableListCacheEntry {
    return {
      schema: 'SAP_HANA_SCHEMA_1',
      tableNames: ['ORDERS', 'CUSTOMERS'],
      displayEntries: [
        { name: 'ORDERS', displayName: 'Orders' },
        { name: 'CUSTOMERS', displayName: 'Customers' },
      ],
      updatedAt: '2026-05-21T10:00:00.000Z',
      ...overrides,
    };
  }

  it('returns null when no cached table list exists for the scope key', async () => {
    const store = new CacheStore(createMockContext());
    expect(await store.getHanaTableList('missing-key')).toBeNull();
  });

  it('returns null when the scope key is empty', async () => {
    const store = new CacheStore(createMockContext());
    expect(await store.getHanaTableList('')).toBeNull();
  });

  it('persists and retrieves a table list entry by scope key', async () => {
    const store = new CacheStore(createMockContext());
    const scopeKey = buildHanaTableListScopeKey({
      email: 'dev@example.com',
      apiEndpoint: 'https://api.example.com',
      orgName: 'org-1',
      spaceName: 'uat',
      appId: 'finance-uat-api',
    });
    const entry = createSampleHanaTableListEntry();

    await store.setHanaTableList(scopeKey, entry);
    const cached = await store.getHanaTableList(scopeKey);

    expect(cached?.schema).toBe('SAP_HANA_SCHEMA_1');
    expect(cached?.tableNames).toEqual(['ORDERS', 'CUSTOMERS']);
    expect(cached?.displayEntries).toEqual([
      { name: 'ORDERS', displayName: 'Orders' },
      { name: 'CUSTOMERS', displayName: 'Customers' },
    ]);
    expect(cached?.updatedAt).toBe('2026-05-21T10:00:00.000Z');
  });

  it('persists the tunnelActive flag so the tunnel badge survives a reload', async () => {
    const store = new CacheStore(createMockContext());
    const scopeKey = 'dev@example.com::https://api.example.com::org-1::uat::finance-uat-api';

    await store.setHanaTableList(scopeKey, createSampleHanaTableListEntry({ tunnelActive: true }));
    expect((await store.getHanaTableList(scopeKey))?.tunnelActive).toBe(true);

    await store.setHanaTableList(scopeKey, createSampleHanaTableListEntry({ tunnelActive: false }));
    expect((await store.getHanaTableList(scopeKey))?.tunnelActive).toBeUndefined();
  });

  it('rejects an empty scope key when setting a table list entry', async () => {
    const store = new CacheStore(createMockContext());
    await expect(
      store.setHanaTableList('', createSampleHanaTableListEntry())
    ).rejects.toThrow(/empty scope key/);
  });

  it('remembers the HANA tunnel jump-host per host and overwrites on change', async () => {
    const store = new CacheStore(createMockContext());
    expect(await store.getHanaTunnelJumpApp('hana-host-1')).toBeUndefined();

    await store.setHanaTunnelJumpApp('hana-host-1', 'ssh-app');
    expect(await store.getHanaTunnelJumpApp('hana-host-1')).toBe('ssh-app');
    expect(await store.getHanaTunnelJumpApp('hana-host-2')).toBeUndefined();

    await store.setHanaTunnelJumpApp('hana-host-1', 'other-app');
    expect(await store.getHanaTunnelJumpApp('hana-host-1')).toBe('other-app');
  });

  it('persists the tunnel jump-host so it survives a reload', async () => {
    const context = createMockContext();
    await new CacheStore(context).setHanaTunnelJumpApp('hana-host', 'ssh-app');

    const reloaded = new CacheStore(context);
    expect(await reloaded.getHanaTunnelJumpApp('hana-host')).toBe('ssh-app');
  });

  it('ignores an empty host or app for the tunnel jump-host', async () => {
    const store = new CacheStore(createMockContext());
    await store.setHanaTunnelJumpApp('', 'ssh-app');
    await store.setHanaTunnelJumpApp('hana-host', '');
    expect(await store.getHanaTunnelJumpApp('')).toBeUndefined();
    expect(await store.getHanaTunnelJumpApp('hana-host')).toBeUndefined();
  });

  it('drops malformed persisted tunnel jump-host entries when normalizing', async () => {
    const store = new CacheStore(
      createMockContext({
        version: 1,
        settings: { syncIntervalHours: 24 },
        users: {},
        exportRootFolders: {},
        hanaTableLists: {},
        hanaTunnelJumpApps: { good: 'ssh-app', emptyApp: '', badApp: 7 },
      })
    );

    expect(await store.getHanaTunnelJumpApp('good')).toBe('ssh-app');
    expect(await store.getHanaTunnelJumpApp('emptyApp')).toBeUndefined();
    expect(await store.getHanaTunnelJumpApp('badApp')).toBeUndefined();
  });

  it('clears all remembered tunnel jump-hosts (e.g. on logout)', async () => {
    const store = new CacheStore(createMockContext());
    await store.setHanaTunnelJumpApp('host-1', 'ssh-app');
    await store.setHanaTunnelJumpApp('host-2', 'other-app');

    await store.clearHanaTunnelJumpApps();

    expect(await store.getHanaTunnelJumpApp('host-1')).toBeUndefined();
    expect(await store.getHanaTunnelJumpApp('host-2')).toBeUndefined();
  });

  it('rejects an entry with an empty updatedAt as malformed', async () => {
    const store = new CacheStore(createMockContext());
    await expect(
      store.setHanaTableList('valid-key', createSampleHanaTableListEntry({ updatedAt: '' }))
    ).rejects.toThrow(/invalid/i);
  });

  it('deletes a single table list entry without touching siblings', async () => {
    const store = new CacheStore(createMockContext());
    const keyA = 'a@example.com::https://api.example.com::org::space::app-a';
    const keyB = 'a@example.com::https://api.example.com::org::space::app-b';
    await store.setHanaTableList(keyA, createSampleHanaTableListEntry());
    await store.setHanaTableList(keyB, createSampleHanaTableListEntry({ schema: 'SCHEMA_B' }));

    await store.deleteHanaTableList(keyA);

    expect(await store.getHanaTableList(keyA)).toBeNull();
    const remaining = await store.getHanaTableList(keyB);
    expect(remaining?.schema).toBe('SCHEMA_B');
  });

  it('clears every cached table list whose scope key belongs to the given user email', async () => {
    const store = new CacheStore(createMockContext());
    const userAKey = 'a@example.com::https://api.example.com::org::space::app-a';
    const userBKey = 'b@example.com::https://api.example.com::org::space::app-a';
    await store.setHanaTableList(userAKey, createSampleHanaTableListEntry());
    await store.setHanaTableList(userBKey, createSampleHanaTableListEntry());

    const removed = await store.clearHanaTableListsForUser('A@example.com');

    expect(removed).toBe(1);
    expect(await store.getHanaTableList(userAKey)).toBeNull();
    expect(await store.getHanaTableList(userBKey)).not.toBeNull();
  });

  it('drops persisted entries that are missing required metadata when normalizing', async () => {
    const state = {
      version: 1,
      settings: { syncIntervalHours: 24 },
      users: {},
      exportRootFolders: {},
      hanaTableLists: {
        'good-key': {
          schema: 'S',
          tableNames: ['ORDERS'],
          displayEntries: [{ name: 'ORDERS', displayName: 'Orders' }],
          updatedAt: '2026-05-21T10:00:00.000Z',
        },
        'no-timestamp-key': {
          schema: 'S',
          tableNames: ['X'],
          displayEntries: [],
          updatedAt: '',
        },
        '   ': {
          schema: 'S',
          tableNames: ['X'],
          displayEntries: [],
          updatedAt: '2026-05-21T10:00:00.000Z',
        },
      },
    };
    const store = new CacheStore(createMockContext(state));

    expect(await store.getHanaTableList('good-key')).not.toBeNull();
    expect(await store.getHanaTableList('no-timestamp-key')).toBeNull();
  });
});
