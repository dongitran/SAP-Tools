import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LocalPackage } from './localPackageScanner';
import type { VersionBumpStrategy } from './localPackagesConfig';
import { CommandFailedError, runCommand } from './processRunner';

/**
 * Publishes a locally-built package to the self-hosted registry. Because Verdaccio
 * rejects republishing an existing version, the version is temporarily bumped to a
 * unique prerelease for the publish and then the original `package.json` is restored
 * (keeping the package repo's git tree clean). Services depend via a dist-tag (e.g.
 * `staging`), so publishing under that tag is what makes a later `npm install` pick up
 * the fresh build without ever editing the service's `package.json`.
 */

export interface PublishOptions {
  readonly registryUrl: string;
  readonly tag: string;
  readonly authToken: string;
  readonly versionBumpStrategy: VersionBumpStrategy;
  readonly onOutput: (chunk: string) => void;
}

export interface PublishResult {
  readonly publishedVersion: string;
  readonly tag: string;
}

/** Computes the unique version used for a publish, stripping any prior local suffix. */
export function computePublishVersion(
  baseVersion: string,
  strategy: VersionBumpStrategy,
  now: number
): string {
  if (strategy === 'none') {
    return baseVersion;
  }
  const base = baseVersion.replace(/-local\.\d+$/, '');
  return `${base}-local.${String(now)}`;
}

/** Turns a registry URL into the npm auth config key, e.g. `//localhost:4873/`. */
export function npmRegistryAuthKey(registryUrl: string): string {
  const withoutProtocol = registryUrl.replace(/^https?:/i, '');
  return withoutProtocol.endsWith('/') ? withoutProtocol : `${withoutProtocol}/`;
}

/**
 * Decides the dist-tag to publish under from how a service consumes the package: a
 * plain tag value like `staging`/`latest` is reused; a semver range falls back to the
 * configured default tag.
 */
export function resolvePublishTag(
  consumerSpec: string | undefined,
  defaultTag: string
): string {
  if (consumerSpec !== undefined && /^[A-Za-z][A-Za-z0-9._-]*$/.test(consumerSpec.trim())) {
    return consumerSpec.trim();
  }
  return defaultTag;
}

export async function publishPackage(
  pkg: LocalPackage,
  options: PublishOptions
): Promise<PublishResult> {
  const packageJsonPath = join(pkg.dir, 'package.json');
  const originalContent = await readFile(packageJsonPath, 'utf8');
  const publishVersion = computePublishVersion(
    pkg.version,
    options.versionBumpStrategy,
    Date.now()
  );
  const mutatesVersion =
    options.versionBumpStrategy !== 'none' && publishVersion !== pkg.version;

  try {
    if (mutatesVersion) {
      await writeVersion(packageJsonPath, originalContent, publishVersion);
    }
    const authKey = npmRegistryAuthKey(options.registryUrl);
    await runCommand(
      'npm',
      [
        'publish',
        '--registry',
        options.registryUrl,
        '--tag',
        options.tag,
        `--${authKey}:_authToken=${options.authToken}`,
      ],
      { cwd: pkg.dir, onOutput: options.onOutput }
    );
    return { publishedVersion: publishVersion, tag: options.tag };
  } catch (error) {
    throw friendlyPublishError(pkg.name, error);
  } finally {
    if (mutatesVersion) {
      await writeFile(packageJsonPath, originalContent, 'utf8');
    }
  }
}

async function writeVersion(
  packageJsonPath: string,
  originalContent: string,
  version: string
): Promise<void> {
  const parsed: unknown = JSON.parse(originalContent);
  const next = { ...(parsed as Record<string, unknown>), version };
  await writeFile(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function friendlyPublishError(packageName: string, error: unknown): Error {
  if (error instanceof CommandFailedError) {
    const output = `${error.stdout}\n${error.stderr}`;
    if (/EPUBLISHCONFLICT|cannot publish over|previously published/i.test(output)) {
      return new Error(
        `Publishing ${packageName} failed: this version already exists in the local registry. ` +
          `Enable "sapTools.localPackages.versionBumpStrategy": "prerelease-timestamp" or bump the version.`
      );
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}
