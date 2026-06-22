import { fetchDefaultEnvJsonFromTarget, prepareCfCliSession } from './cfClient';
import { extractAdvancedEventMeshDiscovery } from './advancedEventMeshBindings';
import { extractEventMeshBindings } from './eventMeshBindings';
import type { EventMeshTargetParams } from './eventMeshPanel';

export type EventMeshStopReason = 'user' | 'panel-closed' | 'scope-changed' | 'shutdown';

export interface ClassicEventMeshViewer {
  openEventMeshViewer(appId: string, targetParams?: EventMeshTargetParams): void | Promise<void>;
  closeEventMeshViewer(appId: string): void;
  stopAllListeners(reason: EventMeshStopReason): void;
}

export interface AdvancedEventMeshViewer {
  openAdvancedEventMeshViewer(
    appId: string,
    targetParams: EventMeshTargetParams,
    options: AdvancedEventMeshOpenOptions
  ): void | Promise<void>;
  stopAllListeners(reason: EventMeshStopReason): void;
}

export interface AdvancedEventMeshOpenOptions {
  readonly classicAvailable: boolean;
  readonly defaultEnv?: Record<string, unknown>;
}

interface EventMeshProviderRouterDependencies {
  readonly prepareCfCliSession?: (params: EventMeshTargetParams) => Promise<void>;
  readonly fetchDefaultEnvJsonFromTarget?: (params: {
    readonly appName: string;
    readonly cfHomeDir: string;
  }) => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EventMeshProviderRouter {
  constructor(
    private readonly classicViewer: ClassicEventMeshViewer,
    private readonly advancedViewer: AdvancedEventMeshViewer,
    private readonly dependencies: EventMeshProviderRouterDependencies = {}
  ) {}

  async openEventMeshViewer(
    appId: string,
    targetParams?: EventMeshTargetParams
  ): Promise<void> {
    if (targetParams === undefined) {
      await this.classicViewer.openEventMeshViewer(appId, targetParams);
      return;
    }

    await this.classicViewer.openEventMeshViewer(appId, targetParams);
    const defaultEnv = await this.tryReadDefaultEnv(appId, targetParams);
    if (defaultEnv === null) {
      return;
    }
    const classicBindings = extractEventMeshBindings(defaultEnv);
    const advancedBindings = extractAdvancedEventMeshDiscovery(defaultEnv).brokerBindings;
    if (advancedBindings.length > 0) {
      this.classicViewer.closeEventMeshViewer(appId);
      await this.advancedViewer.openAdvancedEventMeshViewer(appId, targetParams, {
        classicAvailable: classicBindings.length > 0,
        defaultEnv,
      });
      return;
    }
  }

  stopAllListeners(reason: EventMeshStopReason): void {
    this.classicViewer.stopAllListeners(reason);
    this.advancedViewer.stopAllListeners(reason);
  }

  private async tryReadDefaultEnv(
    appId: string,
    targetParams: EventMeshTargetParams
  ): Promise<Record<string, unknown> | null> {
    const prepare = this.dependencies.prepareCfCliSession ?? prepareCfCliSession;
    const fetchEnv = this.dependencies.fetchDefaultEnvJsonFromTarget ?? fetchDefaultEnvJsonFromTarget;
    try {
      await prepare(targetParams);
      const envJson = await fetchEnv({ appName: appId, cfHomeDir: targetParams.cfHomeDir });
      const parsed: unknown = JSON.parse(envJson);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
