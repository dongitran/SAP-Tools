import { describe, expect, it, vi } from 'vitest';

import {
  normalizeRemotePackageJsonPath,
  parseRemoteRootSetting,
  resolveRemoteRootForApp,
} from './remoteRootResolver';

describe('parseRemoteRootSetting', () => {
  it('treats empty/whitespace values as none', () => {
    expect(parseRemoteRootSetting(undefined)).toEqual({ kind: 'none' });
    expect(parseRemoteRootSetting('   ')).toEqual({ kind: 'none' });
  });

  it('treats a plain path as a literal', () => {
    expect(parseRemoteRootSetting('  /home/vcap/app  ')).toEqual({
      kind: 'literal',
      value: '/home/vcap/app',
    });
  });

  it('parses the regex: prefix form', () => {
    const setting = parseRemoteRootSetting('regex:/home/vcap/app/[a-z]+_srv$');
    expect(setting.kind).toBe('regex');
    if (setting.kind === 'regex') {
      expect(setting.pattern).toBe('/home/vcap/app/[a-z]+_srv$');
      expect(setting.flags).toBe('');
    }
  });

  it('parses the /pattern/flags form', () => {
    const setting = parseRemoteRootSetting('/srv$/i');
    expect(setting.kind).toBe('regex');
    if (setting.kind === 'regex') {
      expect(setting.pattern).toBe('srv$');
      expect(setting.flags).toBe('i');
    }
  });

  it('reports invalid regex patterns', () => {
    const setting = parseRemoteRootSetting('regex:(unterminated');
    expect(setting.kind).toBe('invalid-regex');
  });
});

describe('normalizeRemotePackageJsonPath', () => {
  it('reduces an absolute package.json path to its folder', () => {
    expect(normalizeRemotePackageJsonPath('/home/vcap/app/srv/package.json')).toBe(
      '/home/vcap/app/srv'
    );
  });

  it('returns root for a top-level package.json', () => {
    expect(normalizeRemotePackageJsonPath('/package.json')).toBe('/');
  });

  it('rejects non-absolute or non-package.json paths', () => {
    expect(normalizeRemotePackageJsonPath('relative/package.json')).toBeNull();
    expect(normalizeRemotePackageJsonPath('/home/vcap/app/pnpm-lock.yaml')).toBeNull();
  });
});

describe('resolveRemoteRootForApp', () => {
  it('returns none for an empty setting without calling the finder', async () => {
    const finder = vi.fn();
    const resolution = await resolveRemoteRootForApp('app', '', {
      findPackageJsonPaths: finder,
    });
    expect(resolution).toEqual({ status: 'none' });
    expect(finder).not.toHaveBeenCalled();
  });

  it('returns a literal path without calling the finder', async () => {
    const finder = vi.fn();
    const resolution = await resolveRemoteRootForApp('app', '/home/vcap/app/srv', {
      findPackageJsonPaths: finder,
    });
    expect(resolution).toEqual({ status: 'literal', remoteRoot: '/home/vcap/app/srv' });
    expect(finder).not.toHaveBeenCalled();
  });

  it('resolves a regex to the shallowest matching package.json folder', async () => {
    const finder = vi.fn().mockResolvedValue([
      '/home/vcap/app/node_modules/x/package.json',
      '/home/vcap/app/gen/srv/package.json',
      '/home/vcap/app/srv/package.json',
    ]);
    const resolution = await resolveRemoteRootForApp('finance-srv', 'regex:srv$', {
      findPackageJsonPaths: finder,
    });
    expect(finder).toHaveBeenCalledWith('finance-srv');
    expect(resolution).toEqual({
      status: 'resolved',
      remoteRoot: '/home/vcap/app/srv',
      pattern: 'srv$',
    });
  });

  it('reports unmatched when no candidate folder matches', async () => {
    const finder = vi.fn().mockResolvedValue(['/home/vcap/app/package.json']);
    const resolution = await resolveRemoteRootForApp('app', 'regex:does-not-exist', {
      findPackageJsonPaths: finder,
    });
    expect(resolution).toEqual({ status: 'unmatched', pattern: 'does-not-exist' });
  });

  it('reports invalid regex without calling the finder', async () => {
    const finder = vi.fn();
    const resolution = await resolveRemoteRootForApp('app', 'regex:(bad', {
      findPackageJsonPaths: finder,
    });
    expect(resolution.status).toBe('invalid-regex');
    expect(finder).not.toHaveBeenCalled();
  });

  it('throws when a regex setting is used without a finder', async () => {
    await expect(resolveRemoteRootForApp('app', 'regex:srv$')).rejects.toThrow(
      'findPackageJsonPaths is required'
    );
  });
});
