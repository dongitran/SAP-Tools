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
  readonly onOutput: (chunk: string) => void;
}

export async function buildPackage(
  pkg: LocalPackage,
  options: BuildOptions
): Promise<BuildOutcome> {
  if (pkg.buildScript === undefined) {
    return 'skipped';
  }
  
  const authKey = npmRegistryAuthKey(options.registryUrl);
  
  await runCommand(
    'pnpm', 
    [
      'i', 
      '--shamefully-hoist',
      '--config.node-linker=hoisted',
      '--registry', options.registryUrl,
      `--${authKey}:_authToken=${options.authToken}`
    ], 
    { cwd: pkg.dir, onOutput: options.onOutput, timeoutMs: 600000 }
  );
  await runCommand('npm', ['run', 'build'], { cwd: pkg.dir, onOutput: options.onOutput, timeoutMs: 600000 });
  return 'built';
}
