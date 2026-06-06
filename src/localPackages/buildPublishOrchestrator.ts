import { buildDependencyOrder, type PackageNode } from './dependencyGraph';
import type { LocalPackagesConfig } from './localPackagesConfig';
import { scanLocalPackages, type LocalPackage } from './localPackageScanner';
import { buildPackage } from './packageBuilder';
import { publishPackage } from './packagePublisher';

/**
 * Drives the package pipeline: scan the root folder for locally-developed npm packages
 * (by the configured name regex), order them topologically, then build → publish each
 * to the local registry in that order. This operates on the *packages* found under the
 * root — not on the Cloud Foundry app/service list, which is a separate concept. The
 * registry must already be running; the caller passes its URL + auth token.
 */

export type BuildPublishPhase = 'build' | 'publish';
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
}

/**
 * Builds and publishes every detected local package, in dependency order (a package is
 * built only after everything it depends on). Throws if no packages are found or the
 * dependency graph has a cycle.
 */
export async function runBuildPublishAll(
  request: BuildPublishRequest
): Promise<BuildPublishOutcome> {
  const packages = await scanLocalPackages(
    request.rootFolderPath,
    request.config.namePatterns
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
  const order = buildDependencyOrder(nodes).ordered;
  request.onOrder?.(order);

  const total = order.length;
  const tag = request.config.registry.defaultTag;
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
      const result = await publishPackage(pkg, {
        registryUrl: request.registryUrl,
        tag,
        authToken: request.authToken,
        versionBumpStrategy: request.config.versionBumpStrategy,
        onOutput: request.onOutput,
      });
      request.onProgress({
        packageName: name,
        phase: 'publish',
        status: 'done',
        index,
        total,
        message: `${result.publishedVersion} (${result.tag})`,
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

  return { order, builtCount, skippedCount };
}
