import type * as vscode from 'vscode';

import {
  DEFAULT_SYNC_INTERVAL_HOURS,
  isSyncIntervalHours,
} from './cacheModels';
import type {
  CachedAppEntry,
  CachedLocalPackage,
  CachedOrgEntry,
  CachedRegionEntry,
  CachedSpaceEntry,
  CacheSettings,
  CacheState,
  ExportRootFolderCacheEntry,
  CachedUserEntry,
  HanaTableDisplayCacheEntry,
  HanaTableListCacheEntry,
  LocalPackagesCacheEntry,
  RegionAccessState,
  SyncIntervalHours,
  ApiCatalogCacheEntry,
  ApiCatalogEntity,
} from './cacheModels';

const CACHE_STATE_KEY = 'sapTools.cache.state.v1';

const EMPTY_USERS: Record<string, CachedUserEntry> = Object.freeze({});
const EMPTY_EXPORT_ROOT_FOLDERS: Record<string, ExportRootFolderCacheEntry> =
  Object.freeze({});
const EMPTY_HANA_TABLE_LISTS: Record<string, HanaTableListCacheEntry> =
  Object.freeze({});
const EMPTY_API_CATALOGS: Record<string, ApiCatalogCacheEntry> = Object.freeze({});

export class CacheStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {}

  readState(): Promise<CacheState> {
    const rawState = this.context.globalState.get<unknown>(CACHE_STATE_KEY);
    return Promise.resolve(normalizeCacheState(rawState));
  }

  async writeState(state: CacheState): Promise<void> {
    await this.context.globalState.update(CACHE_STATE_KEY, state);
  }

  async getSettings(): Promise<CacheSettings> {
    const state = await this.readState();
    return state.settings;
  }

  async setSyncIntervalHours(hours: SyncIntervalHours): Promise<CacheSettings> {
    const nextState = await this.updateState((state) => {
      return {
        ...state,
        settings: {
          syncIntervalHours: hours,
        },
      };
    });
    return nextState.settings;
  }

  async getUser(email: string): Promise<CachedUserEntry | null> {
    const normalizedKey = normalizeUserEmail(email);
    if (normalizedKey.length === 0) {
      return null;
    }

    const state = await this.readState();
    const cachedUser = state.users[normalizedKey];
    return cachedUser ?? null;
  }

  async getExportRootFolder(
    email: string,
    regionCode: string,
    orgGuid: string
  ): Promise<ExportRootFolderCacheEntry | null> {
    const scopeKey = buildExportRootFolderScopeKey(email, regionCode, orgGuid);
    if (scopeKey.length === 0) {
      return null;
    }

    const state = await this.readState();
    const cachedEntry = state.exportRootFolders[scopeKey];
    return cachedEntry ?? null;
  }

  async setExportRootFolder(
    email: string,
    regionCode: string,
    orgGuid: string,
    rootFolderPath: string
  ): Promise<ExportRootFolderCacheEntry> {
    const scopeKey = buildExportRootFolderScopeKey(email, regionCode, orgGuid);
    if (scopeKey.length === 0) {
      throw new Error('Cannot cache export root folder for an empty scope key.');
    }

    const normalizedRootFolderPath = rootFolderPath.trim();
    if (normalizedRootFolderPath.length === 0) {
      throw new Error('Cannot cache an empty export root folder path.');
    }

    const nextEntry: ExportRootFolderCacheEntry = {
      rootFolderPath: normalizedRootFolderPath,
      updatedAt: new Date().toISOString(),
    };

    await this.updateState((state) => {
      return {
        ...state,
        exportRootFolders: {
          ...state.exportRootFolders,
          [scopeKey]: nextEntry,
        },
      };
    });

    return nextEntry;
  }

  async deleteExportRootFolder(
    email: string,
    regionCode: string,
    orgGuid: string
  ): Promise<void> {
    const scopeKey = buildExportRootFolderScopeKey(email, regionCode, orgGuid);
    if (scopeKey.length === 0) {
      return;
    }

    await this.updateState((state) => {
      if (state.exportRootFolders[scopeKey] === undefined) {
        return state;
      }

      const remainingEntries = Object.fromEntries(
        Object.entries(state.exportRootFolders).filter(([key]) => key !== scopeKey)
      );
      return {
        ...state,
        exportRootFolders: remainingEntries,
      };
    });
  }

  async getHanaTableList(
    scopeKey: string
  ): Promise<HanaTableListCacheEntry | null> {
    if (scopeKey.length === 0) {
      return null;
    }
    const state = await this.readState();
    const cachedEntry = state.hanaTableLists[scopeKey];
    return cachedEntry ?? null;
  }

  /** The app that last opened a working HANA tunnel for `host`, if remembered. */
  async getHanaTunnelJumpApp(host: string): Promise<string | undefined> {
    if (host.length === 0) {
      return undefined;
    }
    const state = await this.readState();
    return state.hanaTunnelJumpApps?.[host];
  }

  /** Remember the SSH-capable jump-host app that opened a tunnel for `host`. */
  async setHanaTunnelJumpApp(host: string, app: string): Promise<void> {
    if (host.length === 0 || app.length === 0) {
      return;
    }
    await this.updateState((state) => ({
      ...state,
      hanaTunnelJumpApps: {
        ...(state.hanaTunnelJumpApps ?? {}),
        [host]: app,
      },
    }));
  }

  /** Forget all remembered HANA tunnel jump-hosts (e.g. on logout). */
  async clearHanaTunnelJumpApps(): Promise<void> {
    await this.updateState((state) => {
      if (
        state.hanaTunnelJumpApps === undefined ||
        Object.keys(state.hanaTunnelJumpApps).length === 0
      ) {
        return state;
      }
      return { ...state, hanaTunnelJumpApps: {} };
    });
  }

  async setHanaTableList(
    scopeKey: string,
    entry: HanaTableListCacheEntry
  ): Promise<HanaTableListCacheEntry> {
    if (scopeKey.length === 0) {
      throw new Error('Cannot cache HANA table list for an empty scope key.');
    }

    const normalizedEntry = normalizeHanaTableListEntry(entry);
    if (normalizedEntry === null) {
      throw new Error('Cannot cache an invalid HANA table list entry.');
    }

    await this.updateState((state) => {
      return {
        ...state,
        hanaTableLists: {
          ...state.hanaTableLists,
          [scopeKey]: normalizedEntry,
        },
      };
    });

    return normalizedEntry;
  }

  async deleteHanaTableList(scopeKey: string): Promise<void> {
    if (scopeKey.length === 0) {
      return;
    }

    await this.updateState((state) => {
      if (state.hanaTableLists[scopeKey] === undefined) {
        return state;
      }
      const remaining = Object.fromEntries(
        Object.entries(state.hanaTableLists).filter(([key]) => key !== scopeKey)
      );
      return {
        ...state,
        hanaTableLists: remaining,
      };
    });
  }

  async clearHanaTableListsForUser(email: string): Promise<number> {
    const normalizedEmail = normalizeUserEmail(email);
    if (normalizedEmail.length === 0) {
      return 0;
    }

    const prefix = `${normalizedEmail}::`;
    let removed = 0;
    await this.updateState((state) => {
      const filtered: Record<string, HanaTableListCacheEntry> = {};
      for (const [key, value] of Object.entries(state.hanaTableLists)) {
        if (key.startsWith(prefix)) {
          removed += 1;
          continue;
        }
        filtered[key] = value;
      }
      if (removed === 0) {
        return state;
      }
      return {
        ...state,
        hanaTableLists: filtered,
      };
    });
    return removed;
  }

  async getApiCatalog(cacheKey: string): Promise<ApiCatalogCacheEntry | null> {
    const trimmedId = cacheKey.trim();
    if (trimmedId.length === 0) {
      return null;
    }
    const state = await this.readState();
    return state.apiCatalogs[trimmedId] ?? null;
  }

  async setApiCatalog(cacheKey: string, entry: ApiCatalogCacheEntry): Promise<void> {
    const trimmedId = cacheKey.trim();
    if (trimmedId.length === 0) {
      throw new Error('Cannot cache ApiCatalog with an empty cache key.');
    }
    await this.updateState((state) => {
      return {
        ...state,
        apiCatalogs: {
          ...state.apiCatalogs,
          [trimmedId]: entry,
        },
      };
    });
  }

  async upsertUser(
    email: string,
    updater: (current: CachedUserEntry | null) => CachedUserEntry
  ): Promise<CachedUserEntry> {
    const normalizedKey = normalizeUserEmail(email);
    if (normalizedKey.length === 0) {
      throw new Error('Cannot upsert cache user with an empty email key.');
    }

    const nextState = await this.updateState((state) => {
      const currentUser = state.users[normalizedKey] ?? null;
      const updatedUser = updater(currentUser);

      return {
        ...state,
        users: {
          ...state.users,
          [normalizedKey]: updatedUser,
        },
      };
    });

    const storedUser = nextState.users[normalizedKey];
    if (storedUser === undefined) {
      throw new Error('Failed to update cache user state.');
    }

    return storedUser;
  }

  async getLocalPackages(
    cacheKey: string
  ): Promise<LocalPackagesCacheEntry | null> {
    if (cacheKey.trim().length === 0) {
      return null;
    }
    const state = await this.readState();
    const entry = state.localPackages;
    if (entry?.cacheKey !== cacheKey) {
      return null;
    }
    return entry;
  }

  async setLocalPackages(
    cacheKey: string,
    packages: readonly CachedLocalPackage[]
  ): Promise<void> {
    if (cacheKey.trim().length === 0) {
      return;
    }
    const entry: LocalPackagesCacheEntry = {
      cacheKey,
      packages: [...packages],
      updatedAt: new Date().toISOString(),
    };
    await this.updateState((state) => ({
      ...state,
      localPackages: entry,
    }));
  }

  async updateState(
    updater: (current: CacheState) => CacheState
  ): Promise<CacheState> {
    return this.enqueueWrite(async () => {
      const currentState = await this.readState();
      const nextState = updater(currentState);
      await this.writeState(nextState);
      return nextState;
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = this.writeQueue.then(operation, operation);
    this.writeQueue = nextOperation.then(
      () => undefined,
      () => undefined
    );
    return nextOperation;
  }
}

export function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeRegionCode(regionCode: string): string {
  return regionCode.trim().toLowerCase();
}

export function normalizeOrgGuid(orgGuid: string): string {
  return orgGuid.trim().toLowerCase();
}

export function buildExportRootFolderScopeKey(
  email: string,
  regionCode: string,
  orgGuid: string
): string {
  const normalizedEmail = normalizeUserEmail(email);
  const normalizedRegionCode = normalizeRegionCode(regionCode);
  const normalizedOrgGuid = normalizeOrgGuid(orgGuid);
  if (
    normalizedEmail.length === 0 ||
    normalizedRegionCode.length === 0 ||
    normalizedOrgGuid.length === 0
  ) {
    return '';
  }

  return `${normalizedEmail}::${normalizedRegionCode}::${normalizedOrgGuid}`;
}

export function normalizeApiEndpoint(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/u, '');
}

export function normalizeOrgName(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSpaceName(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeAppId(value: string): string {
  return value.trim().toLowerCase();
}

export interface HanaTableListScopeInput {
  readonly email: string;
  readonly apiEndpoint: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly appId: string;
}

export function buildHanaTableListScopeKey(
  scope: HanaTableListScopeInput
): string {
  const normalizedEmail = normalizeUserEmail(scope.email);
  const normalizedApiEndpoint = normalizeApiEndpoint(scope.apiEndpoint);
  const normalizedOrgName = normalizeOrgName(scope.orgName);
  const normalizedSpaceName = normalizeSpaceName(scope.spaceName);
  const normalizedAppId = normalizeAppId(scope.appId);
  if (
    normalizedEmail.length === 0 ||
    normalizedApiEndpoint.length === 0 ||
    normalizedOrgName.length === 0 ||
    normalizedSpaceName.length === 0 ||
    normalizedAppId.length === 0
  ) {
    return '';
  }
  return `${normalizedEmail}::${normalizedApiEndpoint}::${normalizedOrgName}::${normalizedSpaceName}::${normalizedAppId}`;
}

function normalizeCacheState(rawState: unknown): CacheState {
  if (!isRecord(rawState)) {
    return createDefaultCacheState();
  }

  const rawVersion = rawState['version'];
  if (rawVersion !== 1) {
    return createDefaultCacheState();
  }

  const rawSettings = normalizeSettings(rawState['settings']);
  const rawUsers = normalizeUsers(rawState['users']);
  const rawExportRootFolders = normalizeExportRootFolders(rawState['exportRootFolders']);
  const rawHanaTableLists = normalizeHanaTableLists(rawState['hanaTableLists']);
  const rawLocalPackages = normalizeLocalPackagesCacheEntry(rawState['localPackages']);
  const rawApiCatalogs = normalizeApiCatalogs(rawState['apiCatalogs']);
  const rawHanaTunnelJumpApps = normalizeHanaTunnelJumpApps(rawState['hanaTunnelJumpApps']);

  const state: CacheState = {
    version: 1,
    settings: rawSettings,
    users: rawUsers,
    exportRootFolders: rawExportRootFolders,
    hanaTableLists: rawHanaTableLists,
    apiCatalogs: rawApiCatalogs,
  };

  if (rawLocalPackages !== null) {
    // Cannot assign undefined directly due to exactOptionalPropertyTypes
    Object.assign(state, { localPackages: rawLocalPackages });
  }

  if (Object.keys(rawHanaTunnelJumpApps).length > 0) {
    Object.assign(state, { hanaTunnelJumpApps: rawHanaTunnelJumpApps });
  }

  return state;
}

function normalizeHanaTunnelJumpApps(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [host, app] of Object.entries(raw)) {
    if (host.length > 0 && typeof app === 'string' && app.length > 0) {
      result[host] = app;
    }
  }
  return result;
}

function normalizeHanaTableLists(
  rawHanaTableLists: unknown
): Record<string, HanaTableListCacheEntry> {
  if (!isRecord(rawHanaTableLists)) {
    return EMPTY_HANA_TABLE_LISTS;
  }

  const entries: Record<string, HanaTableListCacheEntry> = {};
  for (const [scopeKey, rawEntry] of Object.entries(rawHanaTableLists)) {
    const trimmedScopeKey = scopeKey.trim();
    if (trimmedScopeKey.length === 0) {
      continue;
    }
    const normalized = normalizeHanaTableListEntry(rawEntry);
    if (normalized === null) {
      continue;
    }
    entries[trimmedScopeKey] = normalized;
  }
  return entries;
}

function normalizeHanaTableListEntry(
  rawEntry: unknown
): HanaTableListCacheEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const schema = readString(rawEntry['schema']);
  const updatedAt = readString(rawEntry['updatedAt']);
  if (updatedAt.length === 0) {
    return null;
  }

  const tableNames = normalizeHanaTableNames(rawEntry['tableNames']);
  const displayEntries = normalizeHanaDisplayEntries(rawEntry['displayEntries']);

  return {
    schema,
    tableNames,
    displayEntries,
    updatedAt,
    ...(rawEntry['tunnelActive'] === true ? { tunnelActive: true } : {}),
  };
}

function normalizeHanaTableNames(rawTableNames: unknown): readonly string[] {
  if (!Array.isArray(rawTableNames)) {
    return [];
  }
  const names: string[] = [];
  for (const rawName of rawTableNames) {
    const name = readString(rawName);
    if (name.length > 0) {
      names.push(name);
    }
  }
  return names;
}

function normalizeHanaDisplayEntries(
  rawEntries: unknown
): readonly HanaTableDisplayCacheEntry[] {
  if (!Array.isArray(rawEntries)) {
    return [];
  }
  const entries: HanaTableDisplayCacheEntry[] = [];
  for (const rawEntry of rawEntries) {
    if (!isRecord(rawEntry)) {
      continue;
    }
    const name = readString(rawEntry['name']);
    const displayName = readString(rawEntry['displayName']);
    if (name.length === 0 || displayName.length === 0) {
      continue;
    }
    entries.push({ name, displayName });
  }
  return entries;
}

function normalizeSettings(rawSettings: unknown): CacheSettings {
  if (!isRecord(rawSettings)) {
    return {
      syncIntervalHours: DEFAULT_SYNC_INTERVAL_HOURS,
    };
  }

  const rawInterval = rawSettings['syncIntervalHours'];
  if (typeof rawInterval !== 'number' || !isSyncIntervalHours(rawInterval)) {
    return {
      syncIntervalHours: DEFAULT_SYNC_INTERVAL_HOURS,
    };
  }

  return {
    syncIntervalHours: rawInterval,
  };
}

function normalizeUsers(rawUsers: unknown): Record<string, CachedUserEntry> {
  if (!isRecord(rawUsers)) {
    return EMPTY_USERS;
  }

  const users: Record<string, CachedUserEntry> = {};
  for (const [emailKey, rawUser] of Object.entries(rawUsers)) {
    const normalizedEmailKey = normalizeUserEmail(emailKey);
    if (normalizedEmailKey.length === 0) {
      continue;
    }

    const normalizedUser = normalizeCachedUser(rawUser);
    if (normalizedUser === null) {
      continue;
    }

    users[normalizedEmailKey] = normalizedUser;
  }

  return users;
}

function normalizeExportRootFolders(
  rawExportRootFolders: unknown
): Record<string, ExportRootFolderCacheEntry> {
  if (!isRecord(rawExportRootFolders)) {
    return EMPTY_EXPORT_ROOT_FOLDERS;
  }

  const entries: Record<string, ExportRootFolderCacheEntry> = {};
  for (const [rawScopeKey, rawEntry] of Object.entries(rawExportRootFolders)) {
    const scopeKey = normalizeScopeKey(rawScopeKey);
    if (scopeKey.length === 0) {
      continue;
    }

    const normalizedEntry = normalizeExportRootFolderEntry(rawEntry);
    if (normalizedEntry === null) {
      continue;
    }

    entries[scopeKey] = normalizedEntry;
  }

  return entries;
}

function normalizeScopeKey(scopeKey: string): string {
  const [emailPartRaw, regionCodePartRaw, orgGuidPartRaw] = scopeKey
    .split('::')
    .map((part) => part.trim());
  if (
    emailPartRaw === undefined ||
    regionCodePartRaw === undefined ||
    orgGuidPartRaw === undefined
  ) {
    return '';
  }

  return buildExportRootFolderScopeKey(
    emailPartRaw,
    regionCodePartRaw,
    orgGuidPartRaw
  );
}

function normalizeExportRootFolderEntry(
  rawEntry: unknown
): ExportRootFolderCacheEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const rootFolderPath = readString(rawEntry['rootFolderPath']);
  if (rootFolderPath.length === 0) {
    return null;
  }

  const updatedAt = readString(rawEntry['updatedAt']);
  if (updatedAt.length === 0) {
    return null;
  }

  return {
    rootFolderPath,
    updatedAt,
  };
}

function normalizeCachedUser(rawUser: unknown): CachedUserEntry | null {
  if (!isRecord(rawUser)) {
    return null;
  }

  const email = readString(rawUser['email']);
  if (email.length === 0) {
    return null;
  }

  const syncInProgress = rawUser['syncInProgress'] === true;
  const lastSyncStartedAt = readNullableString(rawUser['lastSyncStartedAt']);
  const lastSyncCompletedAt = readNullableString(rawUser['lastSyncCompletedAt']);
  const lastSyncError = readString(rawUser['lastSyncError']);
  const regions = normalizeRegions(rawUser['regions']);

  return {
    email,
    syncInProgress,
    lastSyncStartedAt,
    lastSyncCompletedAt,
    lastSyncError,
    regions,
  };
}

function normalizeRegions(rawRegions: unknown): readonly CachedRegionEntry[] {
  if (!Array.isArray(rawRegions)) {
    return [];
  }

  const regions: CachedRegionEntry[] = [];
  for (const rawRegion of rawRegions) {
    const normalizedRegion = normalizeRegion(rawRegion);
    if (normalizedRegion !== null) {
      regions.push(normalizedRegion);
    }
  }
  return regions;
}

function normalizeRegion(rawRegion: unknown): CachedRegionEntry | null {
  if (!isRecord(rawRegion)) {
    return null;
  }

  const regionId = readString(rawRegion['regionId']);
  const regionCode = readString(rawRegion['regionCode']);
  const area = readString(rawRegion['area']);
  const displayName = readString(rawRegion['displayName']);
  const accessState = normalizeRegionAccessState(rawRegion['accessState']);
  const accessMessage = readString(rawRegion['accessMessage']);
  const updatedAt = readString(rawRegion['updatedAt']);
  const orgs = normalizeOrgs(rawRegion['orgs']);

  if (regionId.length === 0 || regionCode.length === 0 || area.length === 0) {
    return null;
  }

  return {
    regionId,
    regionCode,
    area,
    displayName,
    accessState,
    accessMessage,
    orgs,
    updatedAt,
  };
}



function normalizeOrgs(rawOrgs: unknown): readonly CachedOrgEntry[] {
  if (!Array.isArray(rawOrgs)) {
    return [];
  }

  const orgs: CachedOrgEntry[] = [];
  for (const rawOrg of rawOrgs) {
    const normalizedOrg = normalizeOrg(rawOrg);
    if (normalizedOrg !== null) {
      orgs.push(normalizedOrg);
    }
  }
  return orgs;
}

function normalizeOrg(rawOrg: unknown): CachedOrgEntry | null {
  if (!isRecord(rawOrg)) {
    return null;
  }

  const guid = readString(rawOrg['guid']);
  const name = readString(rawOrg['name']);
  if (guid.length === 0 || name.length === 0) {
    return null;
  }

  return {
    guid,
    name,
    spaces: normalizeSpaces(rawOrg['spaces']),
  };
}

function normalizeSpaces(rawSpaces: unknown): readonly CachedSpaceEntry[] {
  if (!Array.isArray(rawSpaces)) {
    return [];
  }

  const spaces: CachedSpaceEntry[] = [];
  for (const rawSpace of rawSpaces) {
    const normalizedSpace = normalizeSpace(rawSpace);
    if (normalizedSpace !== null) {
      spaces.push(normalizedSpace);
    }
  }
  return spaces;
}

function normalizeSpace(rawSpace: unknown): CachedSpaceEntry | null {
  if (!isRecord(rawSpace)) {
    return null;
  }

  const guid = readString(rawSpace['guid']);
  const name = readString(rawSpace['name']);
  if (guid.length === 0 || name.length === 0) {
    return null;
  }

  return {
    guid,
    name,
    apps: normalizeApps(rawSpace['apps']),
  };
}

function normalizeApps(rawApps: unknown): readonly CachedAppEntry[] {
  if (!Array.isArray(rawApps)) {
    return [];
  }

  const apps: CachedAppEntry[] = [];
  for (const rawApp of rawApps) {
    const normalizedApp = normalizeApp(rawApp);
    if (normalizedApp !== null) {
      apps.push(normalizedApp);
    }
  }
  return apps;
}

function normalizeApp(rawApp: unknown): CachedAppEntry | null {
  if (!isRecord(rawApp)) {
    return null;
  }

  const id = readString(rawApp['id']);
  const name = readString(rawApp['name']);
  const runningInstancesRaw = rawApp['runningInstances'];
  if (
    id.length === 0 ||
    name.length === 0 ||
    typeof runningInstancesRaw !== 'number' ||
    !Number.isFinite(runningInstancesRaw) ||
    runningInstancesRaw < 0
  ) {
    return null;
  }

  return {
    id,
    name,
    runningInstances: runningInstancesRaw,
  };
}

function normalizeRegionAccessState(rawState: unknown): RegionAccessState {
  if (rawState === 'accessible') {
    return 'accessible';
  }
  if (rawState === 'inaccessible') {
    return 'inaccessible';
  }
  if (rawState === 'error') {
    return 'error';
  }
  return 'unknown';
}

function readString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createDefaultCacheState(): CacheState {
  return {
    version: 1,
    settings: {
      syncIntervalHours: DEFAULT_SYNC_INTERVAL_HOURS,
    },
    users: EMPTY_USERS,
    exportRootFolders: EMPTY_EXPORT_ROOT_FOLDERS,
    hanaTableLists: EMPTY_HANA_TABLE_LISTS,
    apiCatalogs: EMPTY_API_CATALOGS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeLocalPackagesCacheEntry(
  rawEntry: unknown
): LocalPackagesCacheEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const cacheKey = readString(rawEntry['cacheKey']);
  if (cacheKey.length === 0) {
    return null;
  }

  const updatedAt = readString(rawEntry['updatedAt']);
  if (updatedAt.length === 0) {
    return null;
  }

  let packages: readonly CachedLocalPackage[] = [];
  const rawPackages = rawEntry['packages'];
  if (Array.isArray(rawPackages)) {
    packages = rawPackages
      .map(normalizeCachedLocalPackage)
      .filter((pkg): pkg is CachedLocalPackage => pkg !== null);
  }

  return { cacheKey, packages, updatedAt };
}

function normalizeCachedLocalPackage(rawPkg: unknown): CachedLocalPackage | null {
  if (!isRecord(rawPkg)) {
    return null;
  }
  const name = readString(rawPkg['name']);
  if (name.length === 0) {
    return null;
  }
  const version = readString(rawPkg['version']);
  const hasBuildScript = rawPkg['hasBuildScript'] === true;
  const roundRaw = rawPkg['round'];
  const round = typeof roundRaw === 'number' ? roundRaw : null;
  return { name, version, hasBuildScript, round };
}

function normalizeApiCatalogs(rawApiCatalogs: unknown): Record<string, ApiCatalogCacheEntry> {
  if (!isRecord(rawApiCatalogs)) {
    return EMPTY_API_CATALOGS;
  }

  const entries: Record<string, ApiCatalogCacheEntry> = {};
  for (const [appId, rawEntry] of Object.entries(rawApiCatalogs)) {
    const trimmedAppId = appId.trim();
    if (trimmedAppId.length === 0) {
      continue;
    }
    const normalized = normalizeApiCatalogCacheEntry(rawEntry);
    if (normalized === null) {
      continue;
    }
    entries[trimmedAppId] = normalized;
  }
  return entries;
}

function normalizeApiCatalogCacheEntry(rawEntry: unknown): ApiCatalogCacheEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const name = readString(rawEntry['name']);
  if (name.length === 0) {
    return null;
  }

  const baseUrl = readString(rawEntry['baseUrl']);
  if (baseUrl.length === 0) {
    return null;
  }

  const servicePathRaw = rawEntry['servicePath'];
  const servicePath = typeof servicePathRaw === 'string' ? servicePathRaw : undefined;

  const updatedAt = readString(rawEntry['updatedAt']);
  if (updatedAt.length === 0) {
    return null;
  }

  let entities: readonly ApiCatalogEntity[] = [];
  const rawEntities = rawEntry['entities'];
  if (Array.isArray(rawEntities)) {
    entities = rawEntities
      .map(normalizeApiCatalogEntity)
      .filter((ent): ent is ApiCatalogEntity => ent !== null);
  }

  const entry: ApiCatalogCacheEntry = servicePath !== undefined 
    ? { name, baseUrl, entities, updatedAt, servicePath }
    : { name, baseUrl, entities, updatedAt };

  return entry;
}

function normalizeApiCatalogEntity(rawEnt: unknown): ApiCatalogEntity | null {
  if (!isRecord(rawEnt)) {
    return null;
  }

  const name = readString(rawEnt['name']);
  if (name.length === 0) {
    return null;
  }

  const countRaw = rawEnt['count'];
  const count = typeof countRaw === 'number' ? countRaw : undefined;

  const pathRaw = rawEnt['path'];
  const pathValue = typeof pathRaw === 'string' ? pathRaw : undefined;

  let entity: ApiCatalogEntity = { name };
  if (count !== undefined) {
    entity = { ...entity, count };
  }
  if (pathValue !== undefined) {
    entity = { ...entity, path: pathValue };
  }

  return entity;
}
