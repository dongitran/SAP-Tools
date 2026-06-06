// cspell:words unstub
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as vscode from 'vscode';

import type { CacheStore } from './cacheStore';
import type { CacheSyncService } from './cacheSyncService';
import type { CfSession } from './cfClient';
import type { CfLogsPanelProvider } from './cfLogsPanel';
import type { HanaSqlWorkbench } from './hanaSqlWorkbench';
import type { SharedCfScope } from './scopeSync';

const { getConfigurationMock, getEffectiveCredentialsMock, updateMock, state } =
  vi.hoisted(() => ({
    getConfigurationMock: vi.fn(),
    getEffectiveCredentialsMock: vi.fn(),
    updateMock: vi.fn(),
    state: {
      currentScope: undefined as unknown,
    },
  }));

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 'global-target',
  },
  workspace: {
    getConfiguration: getConfigurationMock,
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      name: 'mock',
      append: vi.fn(),
      appendLine: vi.fn(),
      replace: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}));

vi.mock('./credentialStore', () => ({
  clearCredentials: vi.fn(),
  getEffectiveCredentials: getEffectiveCredentialsMock,
  storeCredentials: vi.fn(),
}));

import { RegionSidebarProvider } from './sidebarProvider';

interface ConfirmScopePayloadForTest {
  readonly regionId: string;
  readonly regionCode: string;
  readonly regionName: string;
  readonly regionArea: string;
  readonly orgGuid: string;
  readonly orgName: string;
  readonly spaceName: string;
}

interface QuickScopeConfirmPayloadForTest {
  readonly regionKey: string;
  readonly orgName: string;
  readonly spaceName: string;
}

interface SpaceSelectionPayloadForTest {
  readonly spaceName: string;
  readonly orgGuid: string;
  readonly orgName: string;
}

interface ConfirmScopeOptionsForTest {
  readonly invalidateHanaAppContexts?: boolean;
  readonly writeSharedScope?: boolean;
}

interface SidebarProviderTestAccess {
  cfSession: CfSession | null;
  cfSessionRegionCode: string;
  currentConfirmedScope: SharedCfScope | undefined;
  selectedOrgGuid: string;
  selectedRegionCode: string;
  selectedRegionId: string;
  ensureRegionSession(credentials: {
    readonly email: string;
    readonly password: string;
  }): Promise<CfSession>;
  handleSpaceSelected(payload: SpaceSelectionPayloadForTest): Promise<void>;
  handleQuickScopeConfirm(payload: QuickScopeConfirmPayloadForTest): Promise<void>;
  handleConfirmScope(
    payload: ConfirmScopePayloadForTest,
    options?: ConfirmScopeOptionsForTest
  ): Promise<void>;
  handleExternalScopeChange(scope: SharedCfScope): Promise<void>;
  hydrateQuickConfirmedScope(payload: ConfirmScopePayloadForTest): Promise<void>;
  hydrateRestoredScope(scope: unknown): Promise<void>;
  lastWrittenScope: SharedCfScope | undefined;
  postMessage(message: Record<string, unknown>): void;
  postSpacesError(message: string): void;
  resolveOrgGuidByName(regionId: string, orgName: string): Promise<string>;
  restoreExternalScope(scope: SharedCfScope): Promise<void>;
}

interface ProviderFixture {
  readonly access: SidebarProviderTestAccess;
  readonly cfLogsPanelUpdateAppsMock: ReturnType<typeof vi.fn>;
  readonly globalStateUpdateMock: ReturnType<typeof vi.fn>;
  readonly hanaInvalidateAllAppContextsMock: ReturnType<typeof vi.fn>;
  readonly provider: RegionSidebarProvider;
}

function configureWorkspaceScope(scope: SharedCfScope | undefined): void {
  state.currentScope = scope;
  getConfigurationMock.mockReturnValue({
    get: vi.fn(() => state.currentScope),
    update: updateMock,
  });
}

function createMockSession(): CfSession {
  return {
    apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
    token: {
      accessToken: 'token',
      expiresAt: Date.now() + 60_000,
      refreshToken: '',
    },
  };
}

function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolveDeferred: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveDeferred = resolve;
  });
  return {
    promise,
    resolve: resolveDeferred,
  };
}

function createProviderFixture(): ProviderFixture {
  const globalStateValues = new Map<string, unknown>();
  const globalStateUpdateMock = vi.fn(
    async (key: string, value: unknown): Promise<void> => {
      globalStateValues.set(key, value);
    }
  );
  const context = {
    globalState: {
      get: <T>(key: string): T | undefined => {
        return globalStateValues.get(key) as T | undefined;
      },
      update: globalStateUpdateMock,
    },
    secrets: {
      delete: vi.fn(),
      get: vi.fn(),
      store: vi.fn(),
    },
  } as unknown as vscode.ExtensionContext;

  const cacheSyncService = {
    getCachedApps: vi.fn(),
    getCachedOrgs: vi.fn(),
    getCachedSpaces: vi.fn(),
    subscribe: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as CacheSyncService;
  const cacheStore = {
    deleteExportRootFolder: vi.fn(),
    getExportRootFolder: vi.fn(async () => null),
  } as unknown as CacheStore;
  const cfLogsPanel = {
    focus: vi.fn(),
    updateApps: vi.fn(),
    updateScope: vi.fn(),
  } as unknown as CfLogsPanelProvider;
  const hanaSqlWorkbench = {
    invalidateAllAppContexts: vi.fn(),
  } as unknown as HanaSqlWorkbench;
  const outputChannel = {
    appendLine: vi.fn(),
  } as unknown as vscode.OutputChannel;

  const provider = new RegionSidebarProvider(
    {} as vscode.Uri,
    outputChannel,
    context,
    cfLogsPanel,
    cacheSyncService,
    cacheStore,
    hanaSqlWorkbench
  );

  return {
    access: provider as unknown as SidebarProviderTestAccess,
    cfLogsPanelUpdateAppsMock: cfLogsPanel.updateApps as ReturnType<typeof vi.fn>,
    globalStateUpdateMock,
    hanaInvalidateAllAppContextsMock:
      hanaSqlWorkbench.invalidateAllAppContexts as ReturnType<typeof vi.fn>,
    provider,
  };
}

describe('RegionSidebarProvider shared CF scope sync', () => {
  beforeEach(() => {
    getConfigurationMock.mockReset();
    getEffectiveCredentialsMock.mockReset();
    updateMock.mockReset();
    vi.unstubAllGlobals();
    configureWorkspaceScope(undefined);
    getEffectiveCredentialsMock.mockResolvedValue({
      email: 'test@example.com',
      password: 'test-password',
    });
    delete process.env['SAP_TOOLS_TEST_MODE'];
  });

  it('ignores an external scope change that matches the last written scope', async () => {
    const { access, cfLogsPanelUpdateAppsMock, hanaInvalidateAllAppContextsMock } =
      createProviderFixture();
    const scope: SharedCfScope = {
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    };
    access.cfSession = createMockSession();
    access.lastWrittenScope = scope;
    const restoreSpy = vi.spyOn(access, 'restoreExternalScope');

    await access.handleExternalScopeChange(scope);

    expect(restoreSpy).not.toHaveBeenCalled();
    expect(cfLogsPanelUpdateAppsMock).not.toHaveBeenCalled();
    expect(hanaInvalidateAllAppContextsMock).not.toHaveBeenCalled();
  });

  it('restores an external scope change when no CF session is active', async () => {
    const { access } = createProviderFixture();
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    vi.spyOn(access, 'hydrateRestoredScope').mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();

    await access.handleExternalScopeChange({
      regionCode: 'br10',
      orgName: 'billing-reconciliation-prod',
      spaceName: 'etl',
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      {
        regionId: 'br10',
        regionCode: 'br-10',
        regionName: 'Brazil (Sao Paulo)',
        regionArea: 'Americas',
        orgGuid: 'org-br10-billing-reconciliation',
        orgName: 'billing-reconciliation-prod',
        spaceName: 'etl',
      },
      { invalidateHanaAppContexts: false, writeSharedScope: false }
    );
  });

  it('ignores an external scope change for an unknown region', async () => {
    const { access } = createProviderFixture();
    access.cfSession = createMockSession();
    const restoreSpy = vi.spyOn(access, 'restoreExternalScope');

    await access.handleExternalScopeChange({
      regionCode: 'zz99',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('ignores an external scope change that matches the active confirmed scope', async () => {
    const { access } = createProviderFixture();
    const scope: SharedCfScope = {
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    };
    access.cfSession = createMockSession();
    access.currentConfirmedScope = scope;
    const restoreSpy = vi.spyOn(access, 'restoreExternalScope');

    await access.handleExternalScopeChange(scope);

    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('does not confirm an external scope when the org GUID cannot be resolved', async () => {
    const { access, cfLogsPanelUpdateAppsMock, hanaInvalidateAllAppContextsMock } =
      createProviderFixture();
    access.cfSession = createMockSession();
    vi.spyOn(access, 'resolveOrgGuidByName').mockResolvedValue('');
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope');

    await access.restoreExternalScope({
      regionCode: 'us10',
      orgName: 'missing-org',
      spaceName: 'uat',
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(cfLogsPanelUpdateAppsMock).toHaveBeenCalledWith([], null);
    expect(hanaInvalidateAllAppContextsMock).toHaveBeenCalledTimes(1);
  });

  it('clears scope-bound runtime state before resolving an external scope', async () => {
    const { access, cfLogsPanelUpdateAppsMock, hanaInvalidateAllAppContextsMock } =
      createProviderFixture();
    access.cfSession = createMockSession();
    vi.spyOn(access, 'resolveOrgGuidByName').mockImplementation(async () => {
      expect(cfLogsPanelUpdateAppsMock).toHaveBeenCalledWith([], null);
      expect(hanaInvalidateAllAppContextsMock).toHaveBeenCalledTimes(1);
      return 'org-finance-prod';
    });
    vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();
    vi.spyOn(access, 'hydrateRestoredScope').mockResolvedValue(undefined);

    await access.restoreExternalScope({
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(cfLogsPanelUpdateAppsMock).toHaveBeenCalledWith([], null);
    expect(hanaInvalidateAllAppContextsMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates HANA app contexts once while restoring an external scope', async () => {
    const { access, hanaInvalidateAllAppContextsMock } = createProviderFixture();
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    access.cfSession = createMockSession();
    vi.spyOn(access, 'resolveOrgGuidByName').mockResolvedValue('org-finance-prod');
    vi.spyOn(access, 'hydrateRestoredScope').mockResolvedValue(undefined);

    await access.restoreExternalScope({
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(hanaInvalidateAllAppContextsMock).toHaveBeenCalledTimes(1);
  });

  it('confirms an external scope with compact region id and hyphenated region code', async () => {
    const { access } = createProviderFixture();
    access.cfSession = createMockSession();
    vi.spyOn(access, 'resolveOrgGuidByName').mockResolvedValue('org-finance-prod');
    vi.spyOn(access, 'hydrateRestoredScope').mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();

    await access.restoreExternalScope({
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      {
        regionId: 'us10',
        regionCode: 'us-10',
        regionName: 'US East (VA)',
        regionArea: 'Americas',
        orgGuid: 'org-finance-prod',
        orgName: 'finance-services-prod',
        spaceName: 'uat',
      },
      { invalidateHanaAppContexts: false, writeSharedScope: false }
    );
  });

  it('keeps the latest external scope when changes arrive in quick succession', async () => {
    const { access } = createProviderFixture();
    access.cfSession = createMockSession();
    const firstResolveGate = createDeferred();
    vi.spyOn(access, 'resolveOrgGuidByName').mockImplementation(
      async (_regionId: string, orgName: string): Promise<string> => {
        if (orgName === 'finance-services-prod') {
          await firstResolveGate.promise;
          return 'org-finance-prod';
        }
        return 'org-br10-billing-reconciliation';
      }
    );
    vi.spyOn(access, 'hydrateRestoredScope').mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();

    const firstRestore = access.handleExternalScopeChange({
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });
    const secondRestore = access.handleExternalScopeChange({
      regionCode: 'br10',
      orgName: 'billing-reconciliation-prod',
      spaceName: 'etl',
    });

    await secondRestore;
    firstResolveGate.resolve();
    await firstRestore;

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      {
        regionId: 'br10',
        regionCode: 'br-10',
        regionName: 'Brazil (Sao Paulo)',
        regionArea: 'Americas',
        orgGuid: 'org-br10-billing-reconciliation',
        orgName: 'billing-reconciliation-prod',
        spaceName: 'etl',
      },
      { invalidateHanaAppContexts: false, writeSharedScope: false }
    );
  });

  it('writes confirmed scope with compact regionCode from payload.regionId', async () => {
    const { access, globalStateUpdateMock } = createProviderFixture();
    process.env['SAP_TOOLS_TEST_MODE'] = '1';

    await access.handleConfirmScope({
      regionId: 'us10',
      regionCode: 'us-10',
      regionName: 'US East (VA)',
      regionArea: 'Americas',
      orgGuid: 'org-finance-prod',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(globalStateUpdateMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      'currentScope',
      {
        regionCode: 'us10',
        orgName: 'finance-services-prod',
        spaceName: 'uat',
      },
      'global-target'
    );
  });

  it('invalidates HANA app contexts when the confirmed scope changes', async () => {
    const { access, hanaInvalidateAllAppContextsMock } = createProviderFixture();
    access.currentConfirmedScope = {
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    };

    await access.handleConfirmScope({
      regionId: 'br10',
      regionCode: 'br-10',
      regionName: 'Brazil (Sao Paulo)',
      regionArea: 'Americas',
      orgGuid: 'org-br10-billing-reconciliation',
      orgName: 'billing-reconciliation-prod',
      spaceName: 'etl',
    });

    expect(hanaInvalidateAllAppContextsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps HANA app contexts when the confirmed scope is unchanged', async () => {
    const { access, hanaInvalidateAllAppContextsMock } = createProviderFixture();
    access.currentConfirmedScope = {
      regionCode: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    };

    await access.handleConfirmScope({
      regionId: 'us10',
      regionCode: 'us-10',
      regionName: 'US East (VA)',
      regionArea: 'Americas',
      orgGuid: 'org-finance-prod',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(hanaInvalidateAllAppContextsMock).not.toHaveBeenCalled();
  });

  it('confirms quick scope selection with org GUID resolved from test mode topology', async () => {
    const { access } = createProviderFixture();
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();
    const hydrateSpy = vi
      .spyOn(access, 'hydrateQuickConfirmedScope')
      .mockResolvedValue();

    await access.handleQuickScopeConfirm({
      regionKey: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    const expectedPayload = {
      regionId: 'us10',
      regionCode: 'us-10',
      regionName: 'US East (VA)',
      regionArea: 'Americas',
      orgGuid: 'org-finance-prod',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    };
    expect(confirmSpy).toHaveBeenCalledWith(expectedPayload);
    expect(hydrateSpy).toHaveBeenCalledWith(expectedPayload);
  });

  it('posts org name when hydrating a quick confirmed scope', async () => {
    const { access } = createProviderFixture();
    const postMessageSpy = vi.spyOn(access, 'postMessage').mockImplementation(() => {
      return undefined;
    });
    vi.spyOn(access, 'handleSpaceSelected').mockResolvedValue();

    await access.hydrateQuickConfirmedScope({
      regionId: 'us10',
      regionCode: 'us-10',
      regionName: 'US East (VA)',
      regionArea: 'Americas',
      orgGuid: 'org-finance-prod',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'sapTools.restoreConfirmedScope',
      scope: {
        regionId: 'us10',
        orgGuid: 'org-finance-prod',
        orgName: 'finance-services-prod',
        spaceName: 'uat',
      },
    });
  });

  it('rejects quick scope selection for unknown regions', async () => {
    const { access } = createProviderFixture();
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();
    const spacesErrorSpy = vi.spyOn(access, 'postSpacesError');

    await access.handleQuickScopeConfirm({
      regionKey: 'zz99',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(spacesErrorSpy).toHaveBeenCalledWith(
      'Region "zz99" is not known to SAP Tools.'
    );
  });

  it('rejects quick scope selection when the org cannot be resolved', async () => {
    const { access } = createProviderFixture();
    process.env['SAP_TOOLS_TEST_MODE'] = '1';
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();
    const spacesErrorSpy = vi.spyOn(access, 'postSpacesError');

    await access.handleQuickScopeConfirm({
      regionKey: 'us10',
      orgName: 'missing-org',
      spaceName: 'uat',
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(spacesErrorSpy).toHaveBeenCalledWith(
      'Org "missing-org" was not found in region us10. It may have been removed.'
    );
  });

  it('shows a generic quick scope confirmation failure when live resolution cannot start', async () => {
    const { access } = createProviderFixture();
    getEffectiveCredentialsMock.mockResolvedValue(null);
    const confirmSpy = vi.spyOn(access, 'handleConfirmScope').mockResolvedValue();
    const spacesErrorSpy = vi.spyOn(access, 'postSpacesError');

    await access.handleQuickScopeConfirm({
      regionKey: 'us10',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(spacesErrorSpy).toHaveBeenCalledWith(
      'Could not confirm scope. Please try again or use Custom tab.'
    );
  });

  it('refreshes an expired cached CF session before reusing a region session', async () => {
    const { access } = createProviderFixture();
    access.selectedRegionCode = 'us-10';
    access.cfSessionRegionCode = 'us-10';
    access.cfSession = {
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      token: {
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1_000,
        refreshToken: '',
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/v2/info')) {
        return new Response(
          JSON.stringify({ authorization_endpoint: 'https://login.cf.example.com' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'fresh-token',
            expires_in: 3600,
            refresh_token: 'fresh-refresh',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const session = await access.ensureRegionSession({
      email: 'test@example.com',
      password: 'test-password',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.token.accessToken).toBe('fresh-token');
    expect(access.cfSession).toEqual(session);
  });

  it('keeps previous quick-scope state when live org resolution cannot log in', async () => {
    const { access } = createProviderFixture();
    const existingSession = createMockSession();
    access.cfSession = existingSession;
    access.cfSessionRegionCode = 'us-10';
    access.selectedRegionId = 'us10';
    access.selectedRegionCode = 'us-10';
    access.selectedOrgGuid = 'org-finance-prod';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => {
        return new Response('{}', { status: 401 });
      })
    );
    const spacesErrorSpy = vi.spyOn(access, 'postSpacesError');

    await access.handleQuickScopeConfirm({
      regionKey: 'br10',
      orgName: 'billing-reconciliation-prod',
      spaceName: 'etl',
    });

    expect(spacesErrorSpy).toHaveBeenCalledWith(
      'Could not confirm scope. Please try again or use Custom tab.'
    );
    expect(access.cfSession).toBe(existingSession);
    expect(access.cfSessionRegionCode).toBe('us-10');
    expect(access.selectedRegionId).toBe('us10');
    expect(access.selectedRegionCode).toBe('us-10');
    expect(access.selectedOrgGuid).toBe('org-finance-prod');
  });
});
