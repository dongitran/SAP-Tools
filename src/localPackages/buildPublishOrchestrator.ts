import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildOrderForService, type PackageNode } from './dependencyGraph';
import type { LocalPackagesConfig } from './localPackagesConfig';
import { scanLocalPackages, type LocalPackage } from './localPackageScanner';
import { buildPackage } from './packageBuilder';
import {
  npmRegistryAuthKey,
  publishPackage,
  resolvePublishTag,
} from './packagePublisher';
import { runCommand } from './processRunner';

/**
 * Drives the per-service pipeline: scan the root for local packages, work out which
 * ones the service needs and in what order, then build → publish each to the local
 * registry, and finally reinstall them in the service. The registry must already be
 * running; the caller passes its URL + auth token (so this module stays decoupled from
 * the Verdaccio lifecycle manager).
 */

export type BuildPublishPhase = 'build' | 'publish' | 'install';
export type BuildPublishStatus = 'running' | 'done' | 'skipped' | 'failed';

export interface BuildPublishProgress {
  readonly packageName: string;
  readonly phase: BuildPublishPhase;
  readonly status: BuildPublishStatus;
  readonly index: number;
  readonly total: number;
  readonly message?: string;
}

export interface BuildPublishRequest {
  readonly rootFolderPath: string;
  readonly serviceFolderPath: string;
  readonly config: LocalPackagesConfig;
  readonly registryUrl: string;
  readonly authToken: string;
  /** Called once with the resolved build order, before any package is built. */
  readonly onOrder?: (order: readonly string[]) => void;
  readonly onProgress: (progress: BuildPublishProgress) => void;
  readonly onOutput: (chunk: string) => void;
}

export interface BuildPublishOutcome {
  readonly order: readonly string[];
  readonly builtCount: number;
  readonly skippedCount: number;
  readonly installedInService: boolean;
}

export async function runBuildPublishForService(
  request: BuildPublishRequest
): Promise<BuildPublishOutcome> {
  const { config } = request;

  const packages = await scanLocalPackages(
    request.rootFolderPath,
    config.namePatterns
  );
  if (packages.length === 0) {
    throw new Error(
      'No local packages found under the root folder. Configure "sapTools.localPackages.namePatterns" to match your package names (e.g. "@example/").'
    );
  }

  const byName = new Map<string, LocalPackage>(packages.map((pkg) => [pkg.name, pkg]));
  const nodes: PackageNode[] = packages.map((pkg) => ({
    name: pkg.name,
    deps: pkg.dependencyNames,
  }));

  const serviceDepSpecs = await readServiceDependencySpecs(request.serviceFolderPath);
  const serviceDepNames = Object.keys(serviceDepSpecs).filter((name) => byName.has(name));

  const order = buildOrderForService(serviceDepNames, nodes).ordered;
  if (order.length === 0) {
    throw new Error(
      'This service does not depend on any detected local package, so there is nothing to build.'
    );
  }
  request.onOrder?.(order);

  const total = order.length;
  let builtCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < order.length; index += 1) {
    const name = order[index] ?? '';
    const pkg = byName.get(name);
    if (pkg === undefined) {
      continue;
    }

    try {
      request.onProgress({ packageName: name, phase: 'build', status: 'running', index, total });
      const buildOutcome = await buildPackage(pkg, request.onOutput);
      if (buildOutcome === 'skipped') {
        skippedCount += 1;
      } else {
        builtCount += 1;
      }
      request.onProgress({
        packageName: name,
        phase: 'build',
        status: buildOutcome === 'skipped' ? 'skipped' : 'done',
        index,
        total,
        ...(buildOutcome === 'skipped' ? { message: 'no build script' } : {}),
      });

      request.onProgress({ packageName: name, phase: 'publish', status: 'running', index, total });
      const tag = resolvePublishTag(serviceDepSpecs[name], config.registry.defaultTag);
      const publishResult = await publishPackage(pkg, {
        registryUrl: request.registryUrl,
        tag,
        authToken: request.authToken,
        versionBumpStrategy: config.versionBumpStrategy,
        onOutput: request.onOutput,
      });
      request.onProgress({
        packageName: name,
        phase: 'publish',
        status: 'done',
        index,
        total,
        message: `${publishResult.publishedVersion} (${publishResult.tag})`,
      });
    } catch (error) {
      request.onProgress({
        packageName: name,
        phase: 'publish',
        status: 'failed',
        index,
        total,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  let installedInService = false;
  if (config.installInServiceAfterPublish) {
    request.onProgress({
      packageName: '(service)',
      phase: 'install',
      status: 'running',
      index: total,
      total,
    });
    await installInService(request);
    installedInService = true;
    request.onProgress({
      packageName: '(service)',
      phase: 'install',
      status: 'done',
      index: total,
      total,
    });
  }

  return { order, builtCount, skippedCount, installedInService };
}

async function installInService(request: BuildPublishRequest): Promise<void> {
  const authKey = npmRegistryAuthKey(request.registryUrl);
  const scopeArgs = request.config.registry.scopes.map(
    (scope) => `--${scope}:registry=${request.registryUrl}`
  );
  await runCommand(
    'npm',
    ['install', ...scopeArgs, `--${authKey}:_authToken=${request.authToken}`],
    { cwd: request.serviceFolderPath, onOutput: request.onOutput }
  );
}

async function readServiceDependencySpecs(
  serviceFolderPath: string
): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(join(serviceFolderPath, 'package.json'), 'utf8');
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !isRecord(parsed['dependencies'])) {
    return {};
  }
  const specs: Record<string, string> = {};
  for (const [name, spec] of Object.entries(parsed['dependencies'])) {
    if (typeof spec === 'string') {
      specs[name] = spec;
    }
  }
  return specs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
