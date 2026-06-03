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

  it('keeps Marketplace stable metadata aligned with the release workflow', () => {
    const manifest = readExtensionManifest();
    const topHeading = readChangelogTopHeading();
    const publishScript = String(manifest.scripts['publish'] ?? '');
    const minorVersion = Number(manifest.version.split('.')[1] ?? Number.NaN);

    expect(topHeading).toContain(`${manifest.version} (stable)`);
    expect(Number.isInteger(minorVersion)).toBe(true);
    expect(minorVersion % 2).toBe(0);
    expect(publishScript).not.toContain('--pre-release');
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
});
