import * as vscode from 'vscode';

/**
 * Shared configuration bridge between SAP Tools and the cds-debug extension.
 *
 * Both extensions are published together and already share `sapCap.currentScope`.
 * Artifact export needs the same "where do remote sources live" hint that cds-debug
 * exposes through `cdsDebug.sharedCapDebugConfig.remoteRoot`, so we read SAP Tools'
 * own `sapTools.sharedCapDebugConfig` first and transparently fall back to the
 * cds-debug key. This way a user who already configured cds-debug gets the behavior
 * for free, while a SAP Tools-only install can still configure it standalone.
 */

const SHARED_CAP_DEBUG_CONFIG_KEY = 'sharedCapDebugConfig';
const OWN_CONFIG_SECTION = 'sapTools';
const CDS_DEBUG_CONFIG_SECTION = 'cdsDebug';

/**
 * Pulls a usable `remoteRoot` string out of a `sharedCapDebugConfig` object, or
 * `undefined` when it is missing/blank/not a string.
 */
export function extractRemoteRoot(config: unknown): string | undefined {
  if (!isRecord(config)) {
    return undefined;
  }
  const remoteRoot = config['remoteRoot'];
  if (typeof remoteRoot !== 'string') {
    return undefined;
  }
  const trimmed = remoteRoot.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * SAP Tools' own setting wins; the cds-debug setting is the fallback so a single
 * cds-debug configuration keeps working when SAP Tools is added later.
 */
export function pickRemoteRoot(ownConfig: unknown, cdsDebugConfig: unknown): string | undefined {
  return extractRemoteRoot(ownConfig) ?? extractRemoteRoot(cdsDebugConfig);
}

/**
 * Reads the effective remoteRoot setting from VS Code configuration.
 */
export function readSharedRemoteRoot(): string | undefined {
  const ownConfig = vscode.workspace
    .getConfiguration(OWN_CONFIG_SECTION)
    .get<unknown>(SHARED_CAP_DEBUG_CONFIG_KEY);
  const cdsDebugConfig = vscode.workspace
    .getConfiguration(CDS_DEBUG_CONFIG_SECTION)
    .get<unknown>(SHARED_CAP_DEBUG_CONFIG_KEY);
  return pickRemoteRoot(ownConfig, cdsDebugConfig);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
