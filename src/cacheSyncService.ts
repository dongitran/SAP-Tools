import type * as vscode from 'vscode';

import { ensureCfHomeDir } from './cfHome';
import {
  resolveDelayUntilNextSync,
  syncAllRegions,
  SyncCancelledError,
} from './cacheSyncRunner';
import { normalizeUserEmail } from './cacheStore';
import type { CacheStore } from './cacheStore';
import {
  buildRegionAccessMap,
  buildRegionByIdMap,
  maskEmail,
  toSafeErrorMessage,
} from './cacheSyncServiceSupport';
import type { CfCredentials } from './credentialStore';
import { SAP_BTP_REGIONS, toHyphenatedRegionCode } from './regions';
import type {
  CachedRegionEntry,
  CachedUserEntry,
  SyncIntervalHours,
} from './cacheModels';
import type { RegionAccessState } from './cacheModels';
const STALE_SYNC_ERROR =
  'Previous cache synchronization was interrupted before completion.';
const SYNC_CANCELLED_AFTER_LOGOUT =
  'Cache synchronization cancelled because credentials were cleared.';
const SYNC_CANCELLED_BY_DISPOSE =
  'Cache synchronization cancelled because the extension is shutting down.';
const SYNC_CANCELLED_BY_CREDENTIAL_CHANGE =
  'Cache synchronization cancelled because credentials changed.';

export interface CacheRuntimeSnapshot {
  readonly activeUserEmail: string | null;
  readonly syncInProgress: boolean;
  readonly lastSyncStartedAt: string | null;
  readonly lastSyncCompletedAt: string | null;
  readonly lastSyncError: string;
  readonly syncIntervalHours: SyncIntervalHours;
  readonly nextSyncAt: string | null;
  readonly regionAccessById: Record<string, RegionAccessState>;
}

export interface CachedOrgSummary {
  readonly guid: string;
  readonly name: string;
}

export interface CachedSpaceSummary {
  readonly guid: string;
  readonly name: string;
}

export interface CachedAppSummary {
  readonly id: string;
  readonly name: string;
  readonly runningInstances: number;
}

type SnapshotListener = (snapshot: CacheRuntimeSnapshot) => void;

export class CacheSyncService implements vscode.Disposable {
  private credentials: CfCredentials | null = null;
  private activeUserKey: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextSyncAt: string | null = null;
  private syncPromise: Promise<void> | null = null;
  private syncRunSequence = 0;
  private activeSyncRunId: number | null = null;
  private readonly cancelledSyncRuns = new Map<number, string>();
  private readonly latestSyncRunByUser = new Map<string, number>();
  private readonly listeners = new Set<SnapshotListener>();
  private disposed = false;
  private hasSeededE2eStaleSync = false;
  private readonly testMode = process.env['SAP_TOOLS_TEST_MODE'] === '1';

  constructor(
    private readonly cacheStore: CacheStore,
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  dispose(): void {
    this.cancelInFlightSync(SYNC_CANCELLED_BY_DISPOSE);
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }

  subscribe(listener: SnapshotListener): vscode.Disposable {
    this.listeners.add(listener);
    return new ListenerDisposable(() => {
      this.listeners.delete(listener);
    });
  }

  async initialize(credentials: CfCredentials | null): Promise<CacheRuntimeSnapshot> {
    return this.setCredentials(credentials);
  }

  async setCredentials(
    credentials: CfCredentials | null
  ): Promise<CacheRuntimeSnapshot> {
    if (credentials === null) {
      this.cancelInFlightSync(SYNC_CANCELLED_AFTER_LOGOUT);
    } else if (this.credentials !== null) {
      const previousEmail = normalizeUserEmail(this.credentials.email);
      const nextEmail = normalizeUserEmail(credentials.email);
      if (previousEmail !== nextEmail || this.credentials.password !== credentials.password) {
        this.cancelInFlightSync(SYNC_CANCELLED_BY_CREDENTIAL_CHANGE);
      }
    }

    this.credentials = credentials;
    this.activeUserKey =
      credentials === null ? null : normalizeUserEmail(credentials.email);
    this.clearTimer();
    this.nextSyncAt = null;
    await this.seedE2eStaleSyncIfEnabled(credentials);

    if (this.testMode) {
      await this.seedTestModeCache(credentials);
      const snapshot = await this.getRuntimeSnapshot();
      this.emitSnapshot(snapshot);
      return snapshot;
    }

    await this.reconcileInterruptedSyncForActiveUser();
    await this.rescheduleForActiveUser(true);
    const snapshot = await this.getRuntimeSnapshot();
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async updateSyncInterval(
    syncIntervalHours: SyncIntervalHours
  ): Promise<CacheRuntimeSnapshot> {
    await this.cacheStore.setSyncIntervalHours(syncIntervalHours);
    await this.rescheduleForActiveUser(true);
    const snapshot = await this.getRuntimeSnapshot();
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async triggerSyncNow(): Promise<CacheRuntimeSnapshot> {
    if (this.testMode) {
      const snapshot = await this.getRuntimeSnapshot();
      this.emitSnapshot(snapshot);
      return snapshot;
    }

    await this.startSyncIfNeeded(true);
    const snapshot = await this.getRuntimeSnapshot();
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async getRuntimeSnapshot(): Promise<CacheRuntimeSnapshot> {
    const settings = await this.cacheStore.getSettings();
    const activeUser = await this.getActiveUserEntry();
    return {
      activeUserEmail: activeUser?.email ?? null,
      syncInProgress: activeUser?.syncInProgress ?? false,
      lastSyncStartedAt: activeUser?.lastSyncStartedAt ?? null,
      lastSyncCompletedAt: activeUser?.lastSyncCompletedAt ?? null,
      lastSyncError: activeUser?.lastSyncError ?? '',
      syncIntervalHours: settings.syncIntervalHours,
      nextSyncAt: this.nextSyncAt,
      regionAccessById: buildRegionAccessMap(activeUser?.regions ?? []),
    };
  }

  async getRegionAccessById(): Promise<Record<string, RegionAccessState>> {
    const activeUser = await this.getActiveUserEntry();
    return buildRegionAccessMap(activeUser?.regions ?? []);
  }

  async getCachedOrgs(regionId: string): Promise<readonly CachedOrgSummary[] | null> {
    const cachedRegion = await this.getCachedRegion(regionId);
    if (cachedRegion === null) {
      return null;
    }
    if (cachedRegion.accessState !== 'accessible') {
      return null;
    }

    return cachedRegion.orgs.map((org) => ({ guid: org.guid, name: org.name }));
  }

  async getCachedSpaces(
    regionId: string,
    orgGuid: string
  ): Promise<readonly CachedSpaceSummary[] | null> {
    const cachedRegion = await this.getCachedRegion(regionId);
    if (cachedRegion === null) {
      return null;
    }
    if (cachedRegion.accessState !== 'accessible') {
      return null;
    }

    const org = cachedRegion.orgs.find((entry) => entry.guid === orgGuid);
    if (org === undefined) {
      return null;
    }

    return org.spaces.map((space) => ({ guid: space.guid, name: space.name }));
  }

  async getCachedApps(
    regionId: string,
    orgGuid: string,
    spaceName: string
  ): Promise<readonly CachedAppSummary[] | null> {
    const cachedRegion = await this.getCachedRegion(regionId);
    if (cachedRegion === null) {
      return null;
    }
    if (cachedRegion.accessState !== 'accessible') {
      return null;
    }

    const org = cachedRegion.orgs.find((entry) => entry.guid === orgGuid);
    if (org === undefined) {
      return null;
    }

    const space = org.spaces.find((entry) => entry.name === spaceName);
    if (space === undefined) {
      return null;
    }

    return space.apps.map((app) => ({
      id: app.id,
      name: app.name,
      runningInstances: app.runningInstances,
    }));
  }

  private async getCachedRegion(regionId: string): Promise<CachedRegionEntry | null> {
    const activeUser = await this.getActiveUserEntry();
    if (activeUser === null) {
      return null;
    }

    const normalizedRegionId = regionId.trim().toLowerCase();
    if (normalizedRegionId.length === 0) {
      return null;
    }

    const region = activeUser.regions.find(
      (entry) => entry.regionId === normalizedRegionId
    );
    return region ?? null;
  }

  private async getActiveUserEntry(): Promise<CachedUserEntry | null> {
    if (this.activeUserKey === null) {
      return null;
    }
    return this.cacheStore.getUser(this.activeUserKey);
  }

  private beginSyncRun(email: string): number {
    const runId = this.syncRunSequence + 1;
    this.syncRunSequence = runId;
    this.activeSyncRunId = runId;
    this.latestSyncRunByUser.set(normalizeUserEmail(email), runId);
    return runId;
  }

  private finishSyncRun(runId: number): void {
    this.cancelledSyncRuns.delete(runId);
    if (this.activeSyncRunId === runId) {
      this.activeSyncRunId = null;
    }
  }

  private cancelInFlightSync(reason: string): void {
    if (this.activeSyncRunId !== null) {
      this.cancelledSyncRuns.set(this.activeSyncRunId, reason);
    }
  }

  private resolveRunCancellationReason(runId: number): string | null {
    return this.cancelledSyncRuns.get(runId) ?? null;
  }

  private throwIfRunCancelled(runId: number): void {
    const reason = this.resolveRunCancellationReason(runId);
    if (reason !== null) {
      throw new SyncCancelledError(reason);
    }
  }

  private shouldPersistRunUpdate(email: string, runId: number): boolean {
    const userKey = normalizeUserEmail(email);
    const latestRunId = this.latestSyncRunByUser.get(userKey);
    return latestRunId === runId;
  }

  private async reconcileInterruptedSyncForActiveUser(): Promise<void> {
    const activeUser = await this.getActiveUserEntry();
    if (activeUser === null) {
      return;
    }
    if (!activeUser.syncInProgress) {
      return;
    }

    await this.cacheStore.upsertUser(activeUser.email, (currentUser) => {
      const current = currentUser ?? activeUser;
      const previousError = current.lastSyncError.trim();
      return {
        email: current.email,
        syncInProgress: false,
        lastSyncStartedAt: current.lastSyncStartedAt,
        lastSyncCompletedAt: current.lastSyncCompletedAt,
        lastSyncError: previousError.length > 0 ? previousError : STALE_SYNC_ERROR,
        regions: current.regions,
      };
    });
  }

  private async seedE2eStaleSyncIfEnabled(
    credentials: CfCredentials | null
  ): Promise<void> {
    if (
      credentials === null ||
      process.env['SAP_TOOLS_E2E'] !== '1' ||
      process.env['SAP_TOOLS_E2E_SEED_STALE_SYNC'] !== '1' ||
      this.hasSeededE2eStaleSync
    ) {
      return;
    }

    this.hasSeededE2eStaleSync = true;
    const now = Date.now();
    try {
      await this.cacheStore.upsertUser(credentials.email, (currentUser) => {
        return {
          email: credentials.email,
          syncInProgress: true,
          lastSyncStartedAt: new Date(now - 60_000).toISOString(),
          lastSyncCompletedAt: new Date(now).toISOString(),
          lastSyncError: '',
          regions: currentUser?.regions ?? [],
        };
      });
    } catch (error) {
      this.hasSeededE2eStaleSync = false;
      throw error;
    }
  }

  private async rescheduleForActiveUser(
    runDueSyncInBackground: boolean
  ): Promise<void> {
    if (
      this.disposed ||
      this.credentials === null ||
      this.activeUserKey === null ||
      this.testMode
    ) {
      this.nextSyncAt = null;
      return;
    }

    const settings = await this.cacheStore.getSettings();
    const activeUser = await this.getActiveUserEntry();
    const delayMs = resolveDelayUntilNextSync(settings.syncIntervalHours, activeUser);
    if (delayMs <= 0) {
      if (runDueSyncInBackground) {
        this.nextSyncAt = new Date().toISOString();
        void this.startSyncIfNeeded(false);
        return;
      }
      await this.startSyncIfNeeded(false);
      return;
    }

    this.scheduleTimer(delayMs);
  }

  private scheduleTimer(delayMs: number): void {
    if (this.disposed || this.credentials === null) {
      return;
    }

    this.clearTimer();
    const dueAt = new Date(Date.now() + delayMs).toISOString();
    this.nextSyncAt = dueAt;
    this.timer = setTimeout(() => {
      void this.startSyncIfNeeded(false);
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async startSyncIfNeeded(force: boolean): Promise<void> {
    if (
      this.disposed ||
      this.credentials === null ||
      this.activeUserKey === null ||
      this.testMode
    ) {
      return;
    }

    if (this.syncPromise !== null) {
      await this.syncPromise;
      return;
    }

    if (!force && !(await this.shouldSyncNow())) {
      await this.rescheduleForActiveUser(false);
      return;
    }

    this.syncPromise = this.runSyncForActiveUser().finally(() => {
      this.syncPromise = null;
    });
    await this.syncPromise;
  }

  private async shouldSyncNow(): Promise<boolean> {
    const settings = await this.cacheStore.getSettings();
    const activeUser = await this.getActiveUserEntry();
    return resolveDelayUntilNextSync(settings.syncIntervalHours, activeUser) <= 0;
  }

  private async runSyncForActiveUser(): Promise<void> {
    if (this.credentials === null || this.activeUserKey === null) {
      return;
    }

    const credentials = this.credentials;
    const runId = this.beginSyncRun(credentials.email);
    const previousUser = await this.cacheStore.getUser(credentials.email);
    const previousRegionsById = buildRegionByIdMap(previousUser?.regions ?? []);
    const syncStartedAt = new Date().toISOString();
    await this.markUserSyncStarted(credentials.email, syncStartedAt, runId);

    try {
      this.throwIfRunCancelled(runId);
      const cfHomeDir = await ensureCfHomeDir(this.context);
      this.throwIfRunCancelled(runId);
      const regions = await syncAllRegions(
        credentials,
        cfHomeDir,
        previousRegionsById,
        () => this.resolveRunCancellationReason(runId)
      );
      this.throwIfRunCancelled(runId);
      await this.markUserSyncCompleted(credentials.email, syncStartedAt, regions, runId);
    } catch (error) {
      const errorMessage = toSafeErrorMessage(error);
      await this.markUserSyncFailed(credentials.email, syncStartedAt, errorMessage, runId);
      if (error instanceof SyncCancelledError) {
        this.outputChannel.appendLine(`[cache] Sync cancelled: ${errorMessage}`);
      } else {
        this.outputChannel.appendLine(`[cache] Sync failed: ${errorMessage}`);
      }
    } finally {
      this.finishSyncRun(runId);
    }

    await this.rescheduleForActiveUser(false);
    const snapshot = await this.getRuntimeSnapshot();
    this.emitSnapshot(snapshot);
  }

  private async markUserSyncStarted(
    email: string,
    syncStartedAt: string,
    runId: number
  ): Promise<void> {
    if (!this.shouldPersistRunUpdate(email, runId)) {
      return;
    }

    await this.cacheStore.upsertUser(email, (currentUser) => {
      return {
        email,
        syncInProgress: true,
        lastSyncStartedAt: syncStartedAt,
        lastSyncCompletedAt: currentUser?.lastSyncCompletedAt ?? null,
        lastSyncError: '',
        regions: currentUser?.regions ?? [],
      };
    });
    const snapshot = await this.getRuntimeSnapshot();
    this.emitSnapshot(snapshot);
  }

  private async markUserSyncCompleted(
    email: string,
    syncStartedAt: string,
    regions: readonly CachedRegionEntry[],
    runId: number
  ): Promise<void> {
    if (!this.shouldPersistRunUpdate(email, runId)) {
      return;
    }

    const completedAt = new Date().toISOString();
    await this.cacheStore.upsertUser(email, () => {
      return {
        email,
        syncInProgress: false,
        lastSyncStartedAt: syncStartedAt,
        lastSyncCompletedAt: completedAt,
        lastSyncError: '',
        regions,
      };
    });

    this.outputChannel.appendLine(
      `[cache] Sync completed for ${maskEmail(email)} with ${String(regions.length)} regions.`
    );
  }

  private async markUserSyncFailed(
    email: string,
    syncStartedAt: string,
    errorMessage: string,
    runId: number
  ): Promise<void> {
    if (!this.shouldPersistRunUpdate(email, runId)) {
      return;
    }

    await this.cacheStore.upsertUser(email, (currentUser) => {
      return {
        email,
        syncInProgress: false,
        lastSyncStartedAt: syncStartedAt,
        lastSyncCompletedAt: currentUser?.lastSyncCompletedAt ?? null,
        lastSyncError: errorMessage,
        regions: currentUser?.regions ?? [],
      };
    });
  }

  private emitSnapshot(snapshot: CacheRuntimeSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async seedTestModeCache(credentials: CfCredentials | null): Promise<void> {
    if (credentials === null) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const regions = SAP_BTP_REGIONS.map((region) => {
      return {
        regionId: region.id,
        regionCode: toHyphenatedRegionCode(region.id),
        area: region.area,
        displayName: region.displayName,
        accessState: 'accessible',
        accessMessage: '',
        orgs: [],
        updatedAt,
      } satisfies CachedRegionEntry;
    });

    await this.cacheStore.upsertUser(credentials.email, () => {
      return {
        email: credentials.email,
        syncInProgress: false,
        lastSyncStartedAt: updatedAt,
        lastSyncCompletedAt: updatedAt,
        lastSyncError: '',
        regions,
      };
    });
  }
}

class ListenerDisposable implements vscode.Disposable {
  constructor(private readonly onDispose: () => void) {}

  dispose(): void {
    this.onDispose();
  }
}
