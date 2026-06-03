import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfigurationMock } = vi.hoisted(() => ({
  getConfigurationMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: getConfigurationMock,
  },
}));

import { extractRemoteRoot, pickRemoteRoot, readSharedRemoteRoot } from './sharedDebugConfig';

/**
 * Stubs `getConfiguration(section).get('sharedCapDebugConfig')` per section so we can
 * model "SAP Tools configured", "cds-debug configured", and "neither" independently.
 */
function configureSharedCapDebugConfig(values: {
  sapTools?: unknown;
  cdsDebug?: unknown;
}): void {
  getConfigurationMock.mockImplementation((section: string) => ({
    get: () => (section === 'sapTools' ? values.sapTools : values.cdsDebug),
  }));
}

beforeEach(() => {
  getConfigurationMock.mockReset();
});

describe('extractRemoteRoot', () => {
  it('returns a trimmed non-empty remoteRoot', () => {
    expect(extractRemoteRoot({ remoteRoot: '  /home/vcap/app  ' })).toBe('/home/vcap/app');
  });

  it('returns undefined for blank, missing, or non-string remoteRoot', () => {
    expect(extractRemoteRoot({ remoteRoot: '   ' })).toBeUndefined();
    expect(extractRemoteRoot({ remoteRoot: 42 })).toBeUndefined();
    expect(extractRemoteRoot({})).toBeUndefined();
    expect(extractRemoteRoot(null)).toBeUndefined();
    expect(extractRemoteRoot('string')).toBeUndefined();
  });
});

describe('pickRemoteRoot', () => {
  it("prefers SAP Tools' own setting over cds-debug", () => {
    expect(
      pickRemoteRoot({ remoteRoot: '/own' }, { remoteRoot: '/cds' })
    ).toBe('/own');
  });

  it('falls back to the cds-debug setting when own is unset', () => {
    expect(pickRemoteRoot({}, { remoteRoot: '/cds' })).toBe('/cds');
    expect(pickRemoteRoot(undefined, { remoteRoot: 'regex:srv$' })).toBe('regex:srv$');
  });

  it('returns undefined when neither is configured', () => {
    expect(pickRemoteRoot({}, {})).toBeUndefined();
  });
});

describe('readSharedRemoteRoot', () => {
  it('reads the SAP Tools setting first', () => {
    configureSharedCapDebugConfig({
      sapTools: { remoteRoot: '/own/root' },
      cdsDebug: { remoteRoot: '/cds/root' },
    });
    expect(readSharedRemoteRoot()).toBe('/own/root');
  });

  it('falls back to the cds-debug setting when only it is configured', () => {
    configureSharedCapDebugConfig({
      sapTools: {},
      cdsDebug: { remoteRoot: 'regex:/home/vcap/app/.*_srv$' },
    });
    expect(readSharedRemoteRoot()).toBe('regex:/home/vcap/app/.*_srv$');
  });

  it('returns undefined when neither extension is configured', () => {
    configureSharedCapDebugConfig({ sapTools: {}, cdsDebug: {} });
    expect(readSharedRemoteRoot()).toBeUndefined();
  });
});
