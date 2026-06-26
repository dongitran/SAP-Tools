import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  fetchDefaultEnvJsonFromTarget,
  fetchPnpmLockFromTarget,
  fetchRemoteTextFileFromTarget,
  findRemotePackageJsonPathsFromTarget,
} from './cfClient';
import { runWithCfCliAuthRecovery } from './cfCliAuthRecovery';
import { resolveRemoteRootForApp } from './remoteRootResolver';

export interface ServiceExportSession {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir: string;
}

export interface ServiceArtifactExportOptions {
  readonly appName: string;
  readonly targetFolderPath: string;
  readonly session: ServiceExportSession;
  readonly includeDefaultEnv: boolean;
  readonly includePnpmLock: boolean;
  /**
   * Optional shared `remoteRoot` hint (literal path or `regex:`/`/pattern/flags`).
   * Resolved per app to locate pnpm-lock.yaml when it does not live at the standard
   * `/home/vcap/app` location.
   */
  readonly remoteRootSetting?: string;
}

const OPTIONAL_REMOTE_SOURCE_ARTIFACTS = [
  'package.json',
  '.npmrc',
  '.cdsrc.json',
  '.csdrc.json',
] as const;

export interface ServiceArtifactExportResult {
  readonly writtenFiles: readonly string[];
}

export function formatServiceArtifactExportCompletionMessage(
  appName: string,
  writtenFiles: readonly string[]
): string {
  const artifactNames = writtenFiles.map((filePath) => resolveArtifactFileName(filePath));
  if (artifactNames.length === 0) {
    return `Export completed for "${appName}".`;
  }

  const filesLabel = artifactNames.join(', ');
  const fileCount = artifactNames.length;
  const countLabel = `${String(fileCount)} ${fileCount === 1 ? 'file' : 'files'}`;
  return `Export completed for "${appName}". ${countLabel}: ${filesLabel}.`;
}

function resolveArtifactFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter((segment) => segment.length > 0).at(-1) ?? filePath;
}

export async function exportServiceArtifacts(
  options: ServiceArtifactExportOptions
): Promise<ServiceArtifactExportResult> {
  if (!options.includeDefaultEnv && !options.includePnpmLock) {
    throw new Error('At least one artifact must be selected for export.');
  }

  return runWithCfCliAuthRecovery(options.session, () =>
    exportServiceArtifactsAttempt(options)
  );
}

async function exportServiceArtifactsAttempt(
  options: ServiceArtifactExportOptions
): Promise<ServiceArtifactExportResult> {
  const writtenFiles: string[] = [];

  if (options.includeDefaultEnv) {
    const defaultEnvJson = await fetchDefaultEnvJsonFromTarget({
      appName: options.appName,
      cfHomeDir: options.session.cfHomeDir,
    });
    const outputPath = join(options.targetFolderPath, 'default-env.json');
    await writeFile(outputPath, defaultEnvJson, 'utf8');
    writtenFiles.push(outputPath);
  }

  if (options.includePnpmLock) {
    const remoteRoot = await resolvePnpmLockRemoteRoot(options);
    const pnpmLockContent = await fetchPnpmLockFromTarget({
      appName: options.appName,
      cfHomeDir: options.session.cfHomeDir,
      ...(remoteRoot !== undefined ? { remoteRoot } : {}),
    });
    const outputPath = join(options.targetFolderPath, 'pnpm-lock.yaml');
    await writeFile(outputPath, pnpmLockContent, 'utf8');
    writtenFiles.push(outputPath);

    await exportOptionalRemoteSourceArtifacts(options, remoteRoot, writtenFiles);
  }

  return { writtenFiles };
}

async function exportOptionalRemoteSourceArtifacts(
  options: ServiceArtifactExportOptions,
  remoteRoot: string | undefined,
  writtenFiles: string[]
): Promise<void> {
  for (const fileName of OPTIONAL_REMOTE_SOURCE_ARTIFACTS) {
    const content = await fetchRemoteTextFileFromTarget({
      appName: options.appName,
      cfHomeDir: options.session.cfHomeDir,
      fileName,
      ...(remoteRoot !== undefined ? { remoteRoot } : {}),
    });
    if (content === null) {
      continue;
    }

    const outputPath = join(options.targetFolderPath, fileName);
    await writeFile(outputPath, content, 'utf8');
    writtenFiles.push(outputPath);
  }
}

/**
 * Resolves the configured shared remoteRoot for the app, or `undefined` when no
 * setting is present or the regex matches nothing (callers then fall back to the
 * standard container locations).
 */
async function resolvePnpmLockRemoteRoot(
  options: ServiceArtifactExportOptions
): Promise<string | undefined> {
  const setting = options.remoteRootSetting?.trim();
  if (setting === undefined || setting.length === 0) {
    return undefined;
  }

  const resolution = await resolveRemoteRootForApp(options.appName, setting, {
    findPackageJsonPaths: (appName) =>
      findRemotePackageJsonPathsFromTarget({
        appName,
        cfHomeDir: options.session.cfHomeDir,
      }),
  });

  if (resolution.status === 'invalid-regex') {
    throw new Error(
      `Invalid remoteRoot regex in shared CAP debug config: ${resolution.error}`
    );
  }

  return resolution.status === 'literal' || resolution.status === 'resolved'
    ? resolution.remoteRoot
    : undefined;
}
