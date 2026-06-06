import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  compileNamePatterns,
  matchesAnyPattern,
  scanLocalPackages,
} from './localPackageScanner';

const createdTempDirs: string[] = [];

afterEach(async (): Promise<void> => {
  for (const dirPath of createdTempDirs.splice(0, createdTempDirs.length)) {
    await rm(dirPath, { recursive: true, force: true });
  }
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'saptools-localpkg-'));
  createdTempDirs.push(root);
  return root;
}

async function writePackage(
  dir: string,
  pkg: Record<string, unknown>
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8');
}

describe('compileNamePatterns', () => {
  it('splits on commas and matches a scope prefix literally', () => {
    const patterns = compileNamePatterns('@example/, @acme/');
    expect(matchesAnyPattern('@example/core', patterns)).toBe(true);
    expect(matchesAnyPattern('@acme/widgets', patterns)).toBe(true);
    expect(matchesAnyPattern('@other/thing', patterns)).toBe(false);
  });

  it('supports real regex patterns', () => {
    const patterns = compileNamePatterns('^@example/(core|config)');
    expect(matchesAnyPattern('@example/config', patterns)).toBe(true);
    expect(matchesAnyPattern('@example/service-app', patterns)).toBe(false);
  });

  it('returns no patterns for blank input', () => {
    expect(compileNamePatterns('   ')).toEqual([]);
    expect(compileNamePatterns(',,')).toEqual([]);
  });
});

describe('scanLocalPackages', () => {
  it('detects packages by name, captures build script + deps, skips services', async () => {
    const root = await makeRoot();
    await writePackage(join(root, 'core'), {
      name: '@example/core',
      version: '1.0.0-staging-5',
      // no build script — must still be detected (key off name, not scripts)
    });
    await writePackage(join(root, 'config'), {
      name: '@example/config',
      version: '1.0.0-staging-19',
      dependencies: { '@example/core': 'staging', '@sap/cds': '9.1.0' },
      scripts: { build: 'cds build --production' },
    });
    await writePackage(join(root, 'service-app'), {
      name: '@example/service-app',
      version: '0.0.0',
      dependencies: { '@example/config': 'staging' },
    });

    const packages = await scanLocalPackages(root, '@example/(core|config)');

    expect(packages.map((p) => p.name)).toEqual([
      '@example/config',
      '@example/core',
    ]);

    const core = packages.find((p) => p.name === '@example/core');
    expect(core?.buildScript).toBeUndefined();

    const config = packages.find((p) => p.name === '@example/config');
    expect(config?.buildScript).toBe('cds build --production');
    expect(config?.dependencyNames).toContain('@example/core');
    expect(config?.dependencySpecs['@example/core']).toBe('staging');
  });

  it('does not descend into node_modules', async () => {
    const root = await makeRoot();
    await writePackage(join(root, 'node_modules', '@example', 'core'), {
      name: '@example/core',
      version: '1.0.0',
    });

    const packages = await scanLocalPackages(root, '@example/');
    expect(packages).toEqual([]);
  });

  it('returns nothing when no patterns are configured', async () => {
    const root = await makeRoot();
    await writePackage(join(root, 'core'), { name: '@example/core' });
    expect(await scanLocalPackages(root, '')).toEqual([]);
  });
});
