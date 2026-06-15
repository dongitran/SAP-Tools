export const DEFAULT_SYNC_INTERVAL_HOURS = 24;

export const SYNC_INTERVAL_OPTIONS_HOURS = [12, 24, 48, 96] as const;

export type SyncIntervalHours = (typeof SYNC_INTERVAL_OPTIONS_HOURS)[number];

export type RegionAccessState =
  | 'unknown'
  | 'accessible'
  | 'inaccessible'
  | 'error';

export interface CachedAppEntry {
  readonly id: string;
  readonly name: string;
  readonly runningInstances: number;
}

export interface CachedSpaceEntry {
  readonly guid: string;
  readonly name: string;
  readonly apps: readonly CachedAppEntry[];
}

export interface CachedOrgEntry {
  readonly guid: string;
  readonly name: string;
  readonly spaces: readonly CachedSpaceEntry[];
}

export interface CachedRegionEntry {
  readonly regionId: string;
  readonly regionCode: string;
  readonly area: string;
  readonly displayName: string;
  readonly accessState: RegionAccessState;
  readonly accessMessage: string;
  readonly orgs: readonly CachedOrgEntry[];
  readonly updatedAt: string;
}

export interface CachedUserEntry {
  readonly email: string;
  readonly syncInProgress: boolean;
  readonly lastSyncStartedAt: string | null;
  readonly lastSyncCompletedAt: string | null;
  readonly lastSyncError: string;
  readonly regions: readonly CachedRegionEntry[];
}

export interface CacheSettings {
  readonly syncIntervalHours: SyncIntervalHours;
}

export interface ExportRootFolderCacheEntry {
  readonly rootFolderPath: string;
  readonly updatedAt: string;
}

export interface HanaTableDisplayCacheEntry {
  readonly name: string;
  readonly displayName: string;
}

export interface HanaTableListCacheEntry {
  readonly schema: string;
  readonly tableNames: readonly string[];
  readonly displayEntries: readonly HanaTableDisplayCacheEntry[];
  readonly updatedAt: string;
  /**
   * Whether this app's HANA connection used a cf-ssh tunnel when the table list
   * was last discovered. Persisted so the tunnel badge can be restored — and the
   * tunnel re-established — when the scope is revisited or VS Code is reopened,
   * even though the table list itself is then served from cache.
   */
  readonly tunnelActive?: boolean;
}

export interface CachedLocalPackage {
  readonly name: string;
  readonly version: string;
  readonly hasBuildScript: boolean;
  readonly round: number | null;
}

export interface LocalPackagesCacheEntry {
  /** Deterministic key: `${rootFolderPath}::${namePatterns}` — invalidated when either changes. */
  readonly cacheKey: string;
  readonly packages: readonly CachedLocalPackage[];
  readonly updatedAt: string;
}

export interface ApiCatalogEntity {
  readonly name: string;
  readonly count?: number;
  readonly path?: string;
}

export interface ApiCatalogCacheEntry {
  readonly name: string;
  readonly baseUrl: string;
  readonly servicePath?: string;
  readonly entities: readonly ApiCatalogEntity[];
  readonly updatedAt: string;
}

export interface CacheState {
  readonly version: 1;
  readonly settings: CacheSettings;
  readonly users: Record<string, CachedUserEntry>;
  readonly exportRootFolders: Record<string, ExportRootFolderCacheEntry>;
  readonly hanaTableLists: Record<string, HanaTableListCacheEntry>;
  readonly localPackages?: LocalPackagesCacheEntry;
  readonly apiCatalogs: Record<string, ApiCatalogCacheEntry>;
}

export function isSyncIntervalHours(
  value: number
): value is SyncIntervalHours {
  return SYNC_INTERVAL_OPTIONS_HOURS.includes(value as SyncIntervalHours);
}
