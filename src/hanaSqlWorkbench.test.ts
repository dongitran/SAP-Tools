import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { HanaSqlScopeSession } from './hanaSqlConnectionResolver';
import type { HanaConnection, HanaQueryResult } from './hanaSqlService';
import type {
  HanaTableDisplayEntry,
  RenderSqlResultOptions,
} from './hanaSqlWorkbenchSupport';

const {
  executeCommandMock,
  onDidChangeActiveTextEditorMock,
  onDidCloseTextDocumentMock,
  registerCommandMock,
  registerCompletionItemProviderMock,
} = vi.hoisted(() => ({
  executeCommandMock: vi.fn(),
  onDidChangeActiveTextEditorMock: vi.fn(() => ({ dispose: vi.fn() })),
  onDidCloseTextDocumentMock: vi.fn(() => ({ dispose: vi.fn() })),
  registerCommandMock: vi.fn(() => ({ dispose: vi.fn() })),
  registerCompletionItemProviderMock: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: executeCommandMock,
    registerCommand: registerCommandMock,
  },
  CompletionItem: class MockCompletionItem {
    detail = '';
    insertText = '';

    constructor(
      readonly label: string,
      readonly kind: number
    ) {}
  },
  CompletionItemKind: {
    Keyword: 1,
    Struct: 2,
  },
  languages: {
    registerCompletionItemProvider: registerCompletionItemProviderMock,
  },
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: onDidChangeActiveTextEditorMock,
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    visibleTextEditors: [],
  },
  workspace: {
    onDidCloseTextDocument: onDidCloseTextDocumentMock,
  },
}));

import { HanaSqlWorkbench } from './hanaSqlWorkbench';

interface HanaSqlAppContextForTest {
  readonly appId: string;
  readonly appName: string;
  session: HanaSqlScopeSession | null;
  connection: HanaConnection | null;
  schema: string;
  sqlDocumentUri: string;
  sqlDocumentFileUri: string;
  tableNames: readonly string[];
  tableEntries: readonly HanaTableDisplayEntry[];
  tableNamesPromise: Promise<void> | null;
  cacheVersion: number;
}

interface HanaSqlWorkbenchTestAccess {
  readonly appContextsByAppId: Map<string, HanaSqlAppContextForTest>;
  readonly appIdByDocumentUri: Map<string, string>;
  invalidateAllAppContexts(): void;
  applyActiveScopeSessionToContext(context: HanaSqlAppContextForTest): void;
  prepareStatement(
    context: HanaSqlAppContextForTest,
    rawSql: string,
    tableEntries: readonly HanaTableDisplayEntry[]
  ): {
    readonly executionSql: string;
    readonly statementKind: string;
    readonly tableName: string;
  };
}

interface HanaSqlWorkbenchQuickSelectTestAccess extends HanaSqlWorkbenchTestAccess {
  openLoadingResultPanel(
    appName: string,
    tableName: string,
    sql: string,
    sourceViewColumn: number | undefined
  ): { update(options: RenderSqlResultOptions): void };
  updateLoadingResultPanel(
    resultPanel: { update(options: RenderSqlResultOptions): void },
    appName: string,
    tableName: string,
    sql: string
  ): void;
  executeSqlForContext(
    context: HanaSqlAppContextForTest,
    sql: string,
    statementKind: string
  ): Promise<HanaQueryResult>;
}

function createWorkbench(): HanaSqlWorkbench {
  const outputChannel = {
    appendLine: vi.fn(),
  };
  return new HanaSqlWorkbench(outputChannel);
}

function createScopeSession(overrides: Partial<HanaSqlScopeSession> = {}): HanaSqlScopeSession {
  return {
    apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
    email: 'developer@example.com',
    password: 'top-secret',
    orgName: 'finance-services-prod',
    spaceName: 'uat',
    cfHomeDir: '/tmp/sap-tools-cf-home',
    ...overrides,
  };
}

describe('HanaSqlWorkbench scope cache invalidation', () => {
  beforeEach(() => {
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    process.env['SAP_TOOLS_E2E'] = '1';
    delete process.env['SAP_TOOLS_E2E_TESTMODE_TABLES_DELAY_MS'];
    executeCommandMock.mockClear();
    onDidChangeActiveTextEditorMock.mockClear();
    onDidCloseTextDocumentMock.mockClear();
    registerCommandMock.mockClear();
    registerCompletionItemProviderMock.mockClear();
  });

  test('clears cached HANA credentials and tables while preserving document mappings', async () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;

    await workbench.loadTableEntriesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: null,
    });
    const context = access.appContextsByAppId.get('finance-uat-api');
    expect(context).toBeDefined();
    if (context === undefined) {
      throw new Error('Expected test app context.');
    }

    context.connection = {
      host: 'old-host',
      port: 30015,
      user: 'old-user',
      password: 'old-password',
    };
    context.sqlDocumentUri = 'untitled:saptools-finance-uat-api.sql';
    access.appIdByDocumentUri.set(context.sqlDocumentUri, context.appId);
    expect(context.tableNames.length).toBeGreaterThan(0);
    expect(context.tableEntries.length).toBeGreaterThan(0);

    access.invalidateAllAppContexts();

    expect(context.connection).toBeNull();
    expect(context.schema).toBe('');
    expect(context.tableNames).toEqual([]);
    expect(context.tableEntries).toEqual([]);
    expect(context.tableNamesPromise).toBeNull();
    expect(access.appIdByDocumentUri.get(context.sqlDocumentUri)).toBe('finance-uat-api');
  });

  test('discards table metadata loaded by a stale in-flight preload', async () => {
    process.env['SAP_TOOLS_E2E_TESTMODE_TABLES_DELAY_MS'] = '25';
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;

    const staleLoad = workbench.loadTableEntriesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: null,
    });
    const context = access.appContextsByAppId.get('finance-uat-api');
    expect(context).toBeDefined();
    if (context === undefined) {
      throw new Error('Expected test app context.');
    }

    access.invalidateAllAppContexts();
    const staleEntries = await staleLoad;

    expect(staleEntries).toEqual([]);
    expect(context.tableNames).toEqual([]);
    expect(context.tableEntries).toEqual([]);

    const freshEntries = await workbench.loadTableEntriesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: null,
    });

    expect(freshEntries.length).toBeGreaterThan(0);
    expect(context.tableNames.length).toBeGreaterThan(0);
    expect(context.tableEntries.length).toBeGreaterThan(0);
  });

  test('loads fresh table metadata for a caller waiting through invalidation', async () => {
    process.env['SAP_TOOLS_E2E_TESTMODE_TABLES_DELAY_MS'] = '25';
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;

    const staleLoad = workbench.loadTableNamesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: null,
    });
    const context = access.appContextsByAppId.get('finance-uat-api');
    expect(context).toBeDefined();
    if (context === undefined) {
      throw new Error('Expected test app context.');
    }
    expect(context.tableNamesPromise).not.toBeNull();

    const waitingLoad = workbench.loadTableNamesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: null,
    });
    access.invalidateAllAppContexts();

    await staleLoad;
    const tableNames = await waitingLoad;

    expect(tableNames.length).toBeGreaterThan(0);
    expect(context.tableNames.length).toBeGreaterThan(0);
    expect(context.cacheVersion).toBeGreaterThan(0);
  });

  test('clears cached HANA connection when the same app is opened in a different scope', async () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;
    const firstSession = createScopeSession();
    const nextSession = createScopeSession({ spaceName: 'prod' });

    await workbench.loadTableEntriesForApp({
      appId: 'finance-api',
      appName: 'finance-api',
      session: firstSession,
    });
    const context = access.appContextsByAppId.get('finance-api');
    expect(context).toBeDefined();
    if (context === undefined) {
      throw new Error('Expected test app context.');
    }

    context.connection = {
      host: 'old-host',
      port: 30015,
      user: 'old-user',
      password: 'old-password',
    };
    context.schema = 'OLD_SCHEMA';

    await workbench.loadTableEntriesForApp({
      appId: 'finance-api',
      appName: 'finance-api',
      session: nextSession,
    });

    expect(context.session).toEqual(nextSession);
    expect(context.connection).toBeNull();
    expect(context.cacheVersion).toBeGreaterThan(0);
  });

  test('starts a fresh table load when app scope changes during an in-flight preload', async () => {
    process.env['SAP_TOOLS_E2E_TESTMODE_TABLES_DELAY_MS'] = '25';
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;
    const firstSession = createScopeSession();
    const nextSession = createScopeSession({ orgName: 'finance-services-prod-copy' });

    const staleLoad = workbench.loadTableNamesForApp({
      appId: 'finance-api',
      appName: 'finance-api',
      session: firstSession,
    });
    const context = access.appContextsByAppId.get('finance-api');
    expect(context).toBeDefined();
    if (context === undefined) {
      throw new Error('Expected test app context.');
    }
    expect(context.tableNamesPromise).not.toBeNull();

    const freshLoad = workbench.loadTableNamesForApp({
      appId: 'finance-api',
      appName: 'finance-api',
      session: nextSession,
    });

    await staleLoad;
    const tableNames = await freshLoad;

    expect(context.session).toEqual(nextSession);
    expect(context.cacheVersion).toBeGreaterThan(0);
    expect(tableNames.length).toBeGreaterThan(0);
    expect(context.tableNames.length).toBeGreaterThan(0);
  });
});

describe('HanaSqlWorkbench table list persistent cache', () => {
  beforeEach(() => {
    delete process.env['SAP_TOOLS_TEST_MODE'];
    delete process.env['SAP_TOOLS_E2E'];
    delete process.env['SAP_TOOLS_E2E_TESTMODE_TABLES_DELAY_MS'];
    executeCommandMock.mockClear();
    onDidChangeActiveTextEditorMock.mockClear();
    onDidCloseTextDocumentMock.mockClear();
    registerCommandMock.mockClear();
    registerCompletionItemProviderMock.mockClear();
  });

  function createMockCacheStore(initialEntry: {
    schema: string;
    tableNames: readonly string[];
    displayEntries: readonly { name: string; displayName: string }[];
    updatedAt: string;
  } | null) {
    return {
      getHanaTableList: vi.fn(async () => initialEntry),
      setHanaTableList: vi.fn(async (_key: string, entry: unknown) => entry),
      deleteHanaTableList: vi.fn(async () => undefined),
    };
  }

  test('serves cached table entries without running HANA discovery when an entry is present for the scope', async () => {
    const cachedEntry = {
      schema: 'PERSISTED_SCHEMA',
      tableNames: ['ORDERS', 'CUSTOMERS'],
      displayEntries: [
        { name: 'ORDERS', displayName: 'Orders' },
        { name: 'CUSTOMERS', displayName: 'Customers' },
      ],
      updatedAt: '2026-05-21T10:00:00.000Z',
    };
    const cacheStore = createMockCacheStore(cachedEntry);
    const workbench = new HanaSqlWorkbench(
      { appendLine: vi.fn() } as unknown as Parameters<typeof HanaSqlWorkbench['prototype']['constructor']>[0],
      cacheStore
    );

    const entries = await workbench.loadTableEntriesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: createScopeSession(),
    });

    expect(entries).toEqual([
      { name: 'ORDERS', displayName: 'Orders' },
      { name: 'CUSTOMERS', displayName: 'Customers' },
    ]);
    expect(cacheStore.getHanaTableList).toHaveBeenCalledTimes(1);
    expect(cacheStore.setHanaTableList).not.toHaveBeenCalled();
    const expectedScopeKey =
      'developer@example.com::https://api.cf.us10.hana.ondemand.com::finance-services-prod::uat::finance-uat-api';
    expect(cacheStore.getHanaTableList).toHaveBeenCalledWith(expectedScopeKey);
  });

  test('skips the cache lookup when the session is missing (no scope key buildable)', async () => {
    const cacheStore = createMockCacheStore(null);
    const workbench = new HanaSqlWorkbench(
      { appendLine: vi.fn() } as unknown as Parameters<typeof HanaSqlWorkbench['prototype']['constructor']>[0],
      cacheStore
    );

    try {
      await workbench.loadTableEntriesForApp({
        appId: 'finance-uat-api',
        appName: 'finance-uat-api',
        session: null,
      });
    } catch {
      /* ensureConnection rejects without a session; we only care about cache behavior */
    }

    expect(cacheStore.getHanaTableList).not.toHaveBeenCalled();
  });

  test('refreshTableEntriesForApp resets the in-memory cache and forces a fresh load', async () => {
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    const cacheStore = createMockCacheStore(null);
    const workbench = new HanaSqlWorkbench(
      { appendLine: vi.fn() } as unknown as Parameters<typeof HanaSqlWorkbench['prototype']['constructor']>[0],
      cacheStore
    );
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;

    const firstEntries = await workbench.loadTableEntriesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: createScopeSession(),
    });
    expect(firstEntries.length).toBeGreaterThan(0);
    const context = access.appContextsByAppId.get('finance-uat-api');
    const cacheVersionBefore = context?.cacheVersion ?? 0;

    const refreshedEntries = await workbench.refreshTableEntriesForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: createScopeSession(),
    });
    expect(refreshedEntries.length).toBeGreaterThan(0);
    expect(context?.cacheVersion).toBeGreaterThan(cacheVersionBefore);
  });
});

describe('HanaSqlWorkbench SQL result table display names', () => {
  beforeEach(() => {
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    process.env['SAP_TOOLS_E2E'] = '1';
    executeCommandMock.mockClear();
    onDidChangeActiveTextEditorMock.mockClear();
    onDidCloseTextDocumentMock.mockClear();
    registerCommandMock.mockClear();
    registerCompletionItemProviderMock.mockClear();
  });

  function createPreparedStatementContext(): HanaSqlAppContextForTest {
    return {
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: null,
      connection: null,
      schema: 'TEST_SCHEMA',
      sqlDocumentUri: '',
      sqlDocumentFileUri: '',
      tableNames: ['DEMO_PURCHASEORDERITEMMAPPING'],
      tableEntries: [
        {
          displayName: 'Demo_PurchaseOrderItemMapping',
          name: 'DEMO_PURCHASEORDERITEMMAPPING',
        },
      ],
      tableNamesPromise: null,
      cacheVersion: 0,
    };
  }

  test('uses the sidebar readable table name for rewritten display-name references', () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;
    const context = createPreparedStatementContext();

    const prepared = access.prepareStatement(
      context,
      'SELECT * FROM Demo_PurchaseOrderItemMapping LIMIT 100',
      context.tableEntries
    );

    expect(prepared.executionSql).toBe(
      'SELECT * FROM "TEST_SCHEMA"."DEMO_PURCHASEORDERITEMMAPPING" LIMIT 100'
    );
    expect(prepared.tableName).toBe('Demo_PurchaseOrderItemMapping');
  });

  test('uses the sidebar readable table name for already quoted raw references', () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;
    const context = createPreparedStatementContext();

    const prepared = access.prepareStatement(
      context,
      'SELECT * FROM "TEST_SCHEMA"."DEMO_PURCHASEORDERITEMMAPPING" LIMIT 100',
      context.tableEntries
    );

    expect(prepared.executionSql).toBe(
      'SELECT * FROM "TEST_SCHEMA"."DEMO_PURCHASEORDERITEMMAPPING" LIMIT 100'
    );
    expect(prepared.tableName).toBe('Demo_PurchaseOrderItemMapping');
  });

  test('uses the sidebar readable table name for quick table selects', async () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchQuickSelectTestAccess;
    const updates: RenderSqlResultOptions[] = [];
    const resultPanel = { update: (options: RenderSqlResultOptions): void => updates.push(options) };
    const recordLoadingUpdate = (
      appName: string,
      tableName: string,
      sql: string,
      executedAt: string
    ): void => {
      updates.push({ appName, tableName, sql, executedAt, isLoading: true });
    };

    access.openLoadingResultPanel = vi.fn(
      (appName: string, tableName: string, sql: string) => {
        recordLoadingUpdate(appName, tableName, sql, 'open');
        return resultPanel;
      }
    );
    access.updateLoadingResultPanel = vi.fn(
      (
        panel: { update(options: RenderSqlResultOptions): void },
        appName: string,
        tableName: string,
        sql: string
      ) => {
        void panel;
        recordLoadingUpdate(appName, tableName, sql, 'loading');
      }
    );
    access.executeSqlForContext = vi.fn(async () => ({
      kind: 'resultset',
      columns: ['ID'],
      rows: [['1']],
      rowCount: 1,
      elapsedMs: 4,
    }));

    await workbench.loadTableEntriesForApp({ appId: 'finance-uat-api', appName: 'finance-uat-api', session: null });
    await workbench.runQuickTableSelectForApp({
      appId: 'finance-uat-api',
      appName: 'finance-uat-api',
      session: null,
      tableName: 'DEMO_APP',
    });

    expect(updates.map((update) => update.tableName)).toEqual(['Demo_App', 'Demo_App', 'Demo_App']);
    expect(updates.at(-1)?.sql).toBe('SELECT * FROM "TEST_SCHEMA"."DEMO_APP" LIMIT 100');
  });
});

describe('HanaSqlWorkbench active scope rebinding', () => {
  beforeEach(() => {
    delete process.env['SAP_TOOLS_TEST_MODE'];
    delete process.env['SAP_TOOLS_E2E'];
    executeCommandMock.mockClear();
    onDidChangeActiveTextEditorMock.mockClear();
    onDidCloseTextDocumentMock.mockClear();
    registerCommandMock.mockClear();
    registerCompletionItemProviderMock.mockClear();
  });

  function seedContext(
    access: HanaSqlWorkbenchTestAccess,
    session: HanaSqlScopeSession | null
  ): HanaSqlAppContextForTest {
    const context: HanaSqlAppContextForTest = {
      appId: 'finance-api',
      appName: 'finance-api',
      session,
      connection: {
        host: 'old-host',
        port: 30015,
        user: 'old-user',
        password: 'old-password',
      },
      schema: 'OLD_SCHEMA',
      sqlDocumentUri: 'untitled:saptools-finance-api.sql',
      sqlDocumentFileUri: 'file:///workspace/saptools-finance-api.sql',
      tableNames: ['T1'],
      tableEntries: [{ name: 'T1', displayName: 'T1' }],
      tableNamesPromise: null,
      cacheVersion: 0,
    };
    access.appContextsByAppId.set(context.appId, context);
    return context;
  }

  test('rebinds a reused SQL file to the active scope before running', () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;
    const activeSession = createScopeSession({
      orgName: 'finance-services-prod-2',
      spaceName: 'prod',
    });
    const context = seedContext(access, createScopeSession());
    workbench.setActiveScopeSessionProvider(() => activeSession);

    access.applyActiveScopeSessionToContext(context);

    expect(context.session).toEqual(activeSession);
    expect(context.connection).toBeNull();
    expect(context.schema).toBe('');
    expect(context.tableNames).toEqual([]);
    expect(context.cacheVersion).toBeGreaterThan(0);
  });

  test('drops a stale session when no scope is active so the run fails loudly', () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;
    const context = seedContext(access, createScopeSession());
    workbench.setActiveScopeSessionProvider(() => null);

    access.applyActiveScopeSessionToContext(context);

    expect(context.session).toBeNull();
    expect(context.connection).toBeNull();
    expect(context.cacheVersion).toBeGreaterThan(0);
  });

  test('keeps the cached connection when the active scope is unchanged', () => {
    const workbench = createWorkbench();
    const access = workbench as unknown as HanaSqlWorkbenchTestAccess;
    const context = seedContext(access, createScopeSession());
    workbench.setActiveScopeSessionProvider(() => createScopeSession());

    access.applyActiveScopeSessionToContext(context);

    expect(context.session).toEqual(createScopeSession());
    expect(context.connection).not.toBeNull();
    expect(context.cacheVersion).toBe(0);
  });
});
