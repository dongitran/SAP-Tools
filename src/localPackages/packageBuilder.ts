import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { LocalPackage } from './localPackageScanner';
import { runCommand } from './processRunner';

import { npmRegistryAuthKey } from './packagePublisher';

/**
 * Runs a single local package's `npm run build`. Packages without a `build` script
 * (e.g. dependency-only packages like `@example/demo`) are reported as `skipped`
 * — they still need to be published, just not compiled.
 */

export type BuildOutcome = 'built' | 'skipped';

export interface BuildOptions {
  readonly registryUrl: string;
  readonly authToken: string;
  /**
   * Delete package-level .npmrc before install/build so stale registry overrides
   * cannot hijack local publishes.
   */
  readonly deleteNpmrcBeforeBuild?: boolean;
  readonly onOutput: (chunk: string) => void;
}

export async function buildPackage(
  pkg: LocalPackage,
  options: BuildOptions
): Promise<BuildOutcome> {
  if (options.deleteNpmrcBeforeBuild !== false) {
    await deletePackageNpmrc(pkg.dir);
  }

  const authKey = npmRegistryAuthKey(options.registryUrl);

  await runCommand(
    'pnpm',
    [
      'i',
      '--shamefully-hoist',
      '--config.node-linker=hoisted',
      '--registry',
      options.registryUrl,
      `--${authKey}:_authToken=${options.authToken}`,
    ],
    { cwd: pkg.dir, onOutput: options.onOutput, timeoutMs: 600000 }
  );

  if (pkg.buildScript === undefined) {
    return 'skipped';
  }

  await runCommand('npm', ['run', 'build'], {
    cwd: pkg.dir,
    onOutput: options.onOutput,
    timeoutMs: 600000,
  });
  return 'built';
}

async function deletePackageNpmrc(packageDir: string): Promise<void> {
  try {
    await unlink(join(packageDir, '.npmrc'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
