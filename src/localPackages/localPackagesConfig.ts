import * as vscode from 'vscode';

/**
 * Typed reader for the `sapTools.localPackages.*` / `sapTools.localRegistry.*`
 * settings that drive the local package build + Verdaccio publish pipeline. These
 * keys are SAP-Tools-only (not shared with cds-debug), so they use a plain
 * `getConfiguration('sapTools')` lookup, mirroring the style of `sharedDebugConfig.ts`.
 */

const CONFIG_SECTION = 'sapTools';
const DEFAULT_PORT = 4873;
const DEFAULT_TAG = 'staging';

export type VersionBumpStrategy = 'prerelease-timestamp' | 'none';

export interface LocalRegistryConfig {
  readonly port: number;
  /** npm scopes (e.g. `@example`) routed to the local registry for publish/install. */
  readonly scopes: readonly string[];
  readonly defaultTag: string;
  readonly autoStart: boolean;
}

export interface LocalPackagesConfig {
  readonly namePatterns: string;
  readonly prePublishScript: string;
  readonly versionBumpStrategy: VersionBumpStrategy;
  readonly installInServiceAfterPublish: boolean;
  readonly registry: LocalRegistryConfig;
}

export function readLocalPackagesConfig(): LocalPackagesConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  const namePatterns = readString(config, 'localPackages.namePatterns', '');
  const prePublishScript = readString(config, 'localPackages.prePublishScript', '');
  const versionBumpStrategy = readVersionBumpStrategy(config);
  const installInServiceAfterPublish = config.get<boolean>(
    'localPackages.installInServiceAfterPublish',
    true
  );

  const explicitScopes = parseScopes(readString(config, 'localRegistry.scopes', ''));
  const scopes = explicitScopes.length > 0 ? explicitScopes : deriveScopes(namePatterns);

  const configuredTag = readString(config, 'localRegistry.defaultTag', DEFAULT_TAG);

  return {
    namePatterns,
    prePublishScript,
    versionBumpStrategy,
    installInServiceAfterPublish,
    registry: {
      port: readPort(config),
      scopes,
      defaultTag: configuredTag.length > 0 ? configuredTag : DEFAULT_TAG,
      autoStart: config.get<boolean>('localRegistry.autoStart', true),
    },
  };
}

function readString(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallback: string
): string {
  const value = config.get<unknown>(key);
  return typeof value === 'string' ? value.trim() : fallback;
}

function readPort(config: vscode.WorkspaceConfiguration): number {
  const value = config.get<unknown>('localRegistry.port');
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536) {
    return value;
  }
  return DEFAULT_PORT;
}

function readVersionBumpStrategy(config: vscode.WorkspaceConfiguration): VersionBumpStrategy {
  const value = config.get<unknown>('localPackages.versionBumpStrategy');
  return value === 'none' ? 'none' : 'prerelease-timestamp';
}

/** Splits a comma/space separated scope list, normalizing each to a leading `@`. */
export function parseScopes(raw: string): string[] {
  const scopes = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    scopes.add(trimmed.startsWith('@') ? trimmed : `@${trimmed}`);
  }
  return [...scopes];
}

/**
 * Best-effort derivation of npm scopes from the detection patterns when the user has
 * not set `localRegistry.scopes` explicitly — e.g. `@example/` → `@example`.
 */
export function deriveScopes(namePatterns: string): string[] {
  const scopes = new Set<string>();
  for (const match of namePatterns.matchAll(/@[a-z0-9][a-z0-9._-]*/gi)) {
    scopes.add(match[0]);
  }
  return [...scopes];
}
