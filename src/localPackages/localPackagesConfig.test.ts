import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configValues, getConfigurationMock } = vi.hoisted(() => ({
  configValues: new Map<string, unknown>(),
  getConfigurationMock: vi.fn(),
}));

interface MockWorkspaceConfiguration {
  get<T>(key: string, fallback?: T): T | undefined;
}

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: getConfigurationMock,
  },
}));

import {
  deriveLocalRegistryTagFromScope,
  deriveLocalRegistryVersionSuffixFromScope,
  readLocalPackagesConfig,
} from './localPackagesConfig';

function createMockConfiguration(): MockWorkspaceConfiguration {
  return {
    get<T>(key: string, fallback?: T): T | undefined {
      if (!configValues.has(key)) {
        return fallback;
      }
      return configValues.get(key) as T;
    },
  };
}

beforeEach(() => {
  configValues.clear();
  getConfigurationMock.mockReturnValue(createMockConfiguration());
});

describe('deriveLocalRegistryTagFromScope', () => {
  it('builds a deterministic npm dist-tag from space and org', () => {
    expect(
      deriveLocalRegistryTagFromScope({
        orgName: 'finance-services-prod',
        spaceName: 'uat',
      })
    ).toBe('cf-uat-finance-services-prod');
  });

  it('normalizes uppercase, whitespace, and invalid tag separators', () => {
    expect(
      deriveLocalRegistryTagFromScope({
        orgName: 'Finance Services PROD',
        spaceName: 'UAT / Blue',
      })
    ).toBe('cf-uat-blue-finance-services-prod');
  });

  it('falls back to local when scope is missing or incomplete', () => {
    expect(deriveLocalRegistryTagFromScope(undefined)).toBe('local');
    expect(
      deriveLocalRegistryTagFromScope({ orgName: '', spaceName: 'uat' })
    ).toBe('local');
  });
});

describe('deriveLocalRegistryVersionSuffixFromScope', () => {
  it('builds a semver prerelease suffix from space and org', () => {
    expect(
      deriveLocalRegistryVersionSuffixFromScope({
        orgName: 'origin',
        spaceName: 'uat',
      })
    ).toBe('uat-origin');
  });

  it('falls back to local when scope is missing or incomplete', () => {
    expect(deriveLocalRegistryVersionSuffixFromScope(undefined)).toBe('local');
    expect(
      deriveLocalRegistryVersionSuffixFromScope({ orgName: 'origin', spaceName: '' })
    ).toBe('local');
  });
});

describe('readLocalPackagesConfig', () => {
  it('derives defaultTag and version suffix from the active scope when the setting is empty', () => {
    configValues.set('localRegistry.defaultTag', '');

    const config = readLocalPackagesConfig({
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(config.registry.defaultTag).toBe('cf-uat-finance-services-prod');
    expect(config.registry.versionSuffix).toBe('uat-finance-services-prod');
  });

  it('respects an explicitly configured defaultTag', () => {
    configValues.set('localRegistry.defaultTag', 'local');

    const config = readLocalPackagesConfig({
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(config.registry.defaultTag).toBe('local');
  });

  it('falls back to local when no scope is available', () => {
    configValues.set('localRegistry.defaultTag', '');

    const config = readLocalPackagesConfig(undefined);

    expect(config.registry.defaultTag).toBe('local');
  });

  it('deletes package .npmrc files before build by default', () => {
    const config = readLocalPackagesConfig(undefined);

    expect(config.deleteNpmrcBeforeBuild).toBe(true);
  });

  it('allows package .npmrc deletion to be disabled', () => {
    configValues.set('localPackages.deleteNpmrcBeforeBuild', false);

    const config = readLocalPackagesConfig(undefined);

    expect(config.deleteNpmrcBeforeBuild).toBe(false);
  });
});
