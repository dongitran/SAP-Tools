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
  it('builds a deterministic npm dist-tag from org and space', () => {
    expect(
      deriveLocalRegistryTagFromScope({
        orgName: 'finance-services-prod',
        spaceName: 'uat',
      })
    ).toBe('cf-finance-services-prod-uat');
  });

  it('normalizes uppercase, whitespace, and invalid tag separators', () => {
    expect(
      deriveLocalRegistryTagFromScope({
        orgName: 'Finance Services PROD',
        spaceName: 'UAT / Blue',
      })
    ).toBe('cf-finance-services-prod-uat-blue');
  });

  it('falls back to local when scope is missing or incomplete', () => {
    expect(deriveLocalRegistryTagFromScope(undefined)).toBe('local');
    expect(
      deriveLocalRegistryTagFromScope({ orgName: '', spaceName: 'uat' })
    ).toBe('local');
  });
});

describe('readLocalPackagesConfig', () => {
  it('derives defaultTag from the active scope when the setting is empty', () => {
    configValues.set('localRegistry.defaultTag', '');

    const config = readLocalPackagesConfig({
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(config.registry.defaultTag).toBe('cf-finance-services-prod-uat');
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
});
