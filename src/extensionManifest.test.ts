import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface ExtensionManifest {
  readonly contributes: Record<string, unknown>;
  readonly dependencies: Record<string, unknown>;
  readonly scripts: Record<string, unknown>;
  readonly version: string;
}

function readExtensionManifest(): ExtensionManifest {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    return { contributes: {}, dependencies: {}, scripts: {}, version: '' };
  }
  return {
    contributes: readRecord(parsed['contributes']),
    dependencies: readRecord(parsed['dependencies']),
    scripts: readRecord(parsed['scripts']),
    version: typeof parsed['version'] === 'string' ? parsed['version'] : '',
  };
}

function readChangelogTopHeading(): string {
  const raw = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  return raw
    .split('\n')
    .find((line) => line.startsWith('## '))
    ?.trim() ?? '';
}

function readExtensionSource(): string {
  return readFileSync(new URL('./extension.ts', import.meta.url), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

describe('Extension manifest feature surface', () => {
  it('does not package the removed workspace debug runtime', () => {
    const manifest = readExtensionManifest();

    expect(Object.keys(manifest.dependencies)).not.toContain(
      '@saptools/cf-debugger'
    );
    expect(String(manifest.scripts['postbuild'] ?? '')).not.toContain(
      'vendor-cf-debugger'
    );
  });

  it('pins cf-sync to the verified package line instead of a floating tag', () => {
    const manifest = readExtensionManifest();
    const cfSyncVersion = String(manifest.dependencies['@saptools/cf-sync'] ?? '');

    expect(cfSyncVersion).not.toBe('latest');
    expect(cfSyncVersion).toBe('^0.4.10');
  });

  it('keeps Marketplace metadata aligned with the release workflow', () => {
    const manifest = readExtensionManifest();
    const topHeading = readChangelogTopHeading();
    const publishScript = String(manifest.scripts['publish'] ?? '');
    const preReleasePublishScript = String(manifest.scripts['publish:pre'] ?? '');
    const minorVersion = Number(manifest.version.split('.')[1] ?? Number.NaN);

    expect(Number.isInteger(minorVersion)).toBe(true);
    // The release workflow ("Resolve publish flavor") publishes odd-minor versions as
    // pre-release and even-minor versions as stable; the CHANGELOG heading flavor must
    // match the version parity.
    const expectedFlavor = minorVersion % 2 === 1 ? 'pre-release' : 'stable';
    expect(topHeading).toContain(`${manifest.version} (${expectedFlavor})`);
    expect(publishScript).not.toContain('--pre-release');
    expect(preReleasePublishScript).toContain('--pre-release');
  });

  it('contributes the shared SAP CAP current scope setting', () => {
    const manifest = readExtensionManifest();
    const configuration = manifest.contributes['configuration'];
    expect(Array.isArray(configuration)).toBe(true);

    const properties = configuration
      .filter(isRecord)
      .map((entry) => readRecord(entry['properties']))
      .find((entry) => entry['sapCap.currentScope'] !== undefined);

    expect(properties?.['sapCap.currentScope']).toEqual(
      expect.objectContaining({
        scope: 'application',
        type: 'object',
      })
    );
  });

  it('contributes the shared CAP debug remoteRoot setting for artifact export', () => {
    const manifest = readExtensionManifest();
    const configuration = manifest.contributes['configuration'];
    expect(Array.isArray(configuration)).toBe(true);

    const properties = configuration
      .filter(isRecord)
      .map((entry) => readRecord(entry['properties']))
      .find((entry) => entry['sapTools.sharedCapDebugConfig'] !== undefined);

    const sharedConfig = readRecord(properties?.['sapTools.sharedCapDebugConfig']);
    expect(sharedConfig).toEqual(
      expect.objectContaining({ scope: 'application', type: 'object' })
    );
    expect(Object.keys(readRecord(sharedConfig['properties']))).toContain('remoteRoot');
  });

  it('contributes the shared explicit app-folder mappings setting', () => {
    const manifest = readExtensionManifest();
    const configuration = manifest.contributes['configuration'];
    expect(Array.isArray(configuration)).toBe(true);

    const properties = configuration
      .filter(isRecord)
      .map((entry) => readRecord(entry['properties']))
      .find((entry) => entry['sapTools.appFolderMappings'] !== undefined);

    expect(properties?.['sapTools.appFolderMappings']).toEqual(
      expect.objectContaining({ scope: 'application', type: 'array' })
    );
  });

  it('contributes the package .npmrc cleanup checkbox enabled by default', () => {
    const manifest = readExtensionManifest();
    const configuration = manifest.contributes['configuration'];
    expect(Array.isArray(configuration)).toBe(true);

    const properties = configuration
      .filter(isRecord)
      .map((entry) => readRecord(entry['properties']))
      .find((entry) => entry['sapTools.localPackages.deleteNpmrcBeforeBuild'] !== undefined);

    expect(properties?.['sapTools.localPackages.deleteNpmrcBeforeBuild']).toEqual(
      expect.objectContaining({
        default: true,
        type: 'boolean',
      })
    );
  });

  it('contributes the CF logs file-log directory setting', () => {
    const manifest = readExtensionManifest();
    const configuration = manifest.contributes['configuration'];
    expect(Array.isArray(configuration)).toBe(true);

    const properties = configuration
      .filter(isRecord)
      .map((entry) => readRecord(entry['properties']))
      .find((entry) => entry['sapTools.cfLogs.fileLogDirectory'] !== undefined);

    expect(properties?.['sapTools.cfLogs.fileLogDirectory']).toEqual(
      expect.objectContaining({
        default: '',
        scope: 'application',
        type: 'string',
      })
    );
  });

  it('leaves the local registry default tag empty so runtime can derive it from scope', () => {
    const manifest = readExtensionManifest();
    const configuration = manifest.contributes['configuration'];
    expect(Array.isArray(configuration)).toBe(true);

    const properties = configuration
      .filter(isRecord)
      .map((entry) => readRecord(entry['properties']))
      .find((entry) => entry['sapTools.localRegistry.defaultTag'] !== undefined);

    expect(properties?.['sapTools.localRegistry.defaultTag']).toEqual(
      expect.objectContaining({
        default: '',
        type: 'string',
      })
    );
  });

  it('registers the APIs Explorer manager for extension shutdown disposal', () => {
    const source = readExtensionSource();
    const subscriptionsBlock = /context\.subscriptions\.push\(([\s\S]*?)\n  \);/.exec(source)?.[1] ?? '';

    expect(subscriptionsBlock).toContain('apisExplorerPanelManager');
    expect(subscriptionsBlock).toContain('eventMeshPanelManager');
  });
});
