import { describe, expect, it } from 'vitest';

import {
  computePublishVersion,
  npmRegistryAuthKey,
  resolvePublishTag,
} from './packagePublisher';

describe('computePublishVersion', () => {
  it('appends a unique local prerelease suffix by default', () => {
    expect(computePublishVersion('1.0.0-origin-staging-5', 'prerelease-timestamp', 1700)).toBe(
      '1.0.0-origin-staging-5-local.1700'
    );
  });

  it('replaces an older org-space publish suffix with the active space-org suffix', () => {
    expect(
      computePublishVersion('1.0.0-origin-uat-10', 'prerelease-timestamp', 1700, 'uat-origin')
    ).toBe('1.0.0-uat-origin-1700');
  });

  it('does not stack local suffixes across republishes', () => {
    expect(computePublishVersion('1.0.0-local.1699', 'prerelease-timestamp', 1700)).toBe(
      '1.0.0-local.1700'
    );
  });

  it('leaves the version untouched for the "none" strategy', () => {
    expect(computePublishVersion('1.0.0', 'none', 1700)).toBe('1.0.0');
  });
});

describe('npmRegistryAuthKey', () => {
  it('derives the npm auth config key from the registry url', () => {
    expect(npmRegistryAuthKey('http://localhost:4873')).toBe('//localhost:4873/');
    expect(npmRegistryAuthKey('http://localhost:4873/')).toBe('//localhost:4873/');
  });
});

describe('resolvePublishTag', () => {
  it('reuses a plain dist-tag the service requests', () => {
    expect(resolvePublishTag('staging', 'latest')).toBe('staging');
  });

  it('falls back to the default tag for semver ranges', () => {
    expect(resolvePublishTag('^1.0.0', 'staging')).toBe('staging');
    expect(resolvePublishTag('1.2.3', 'staging')).toBe('staging');
    expect(resolvePublishTag(undefined, 'staging')).toBe('staging');
  });
});
