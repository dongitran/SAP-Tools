import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  writeFileMock,
  prepareCfCliSessionMock,
  fetchDefaultEnvJsonFromTargetMock,
  fetchPnpmLockFromTargetMock,
  findRemotePackageJsonPathsFromTargetMock,
} = vi.hoisted(() => ({
  writeFileMock: vi.fn(),
  prepareCfCliSessionMock: vi.fn(),
  fetchDefaultEnvJsonFromTargetMock: vi.fn(),
  fetchPnpmLockFromTargetMock: vi.fn(),
  findRemotePackageJsonPathsFromTargetMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: writeFileMock,
}));

vi.mock('./cfClient', () => ({
  prepareCfCliSession: prepareCfCliSessionMock,
  fetchDefaultEnvJsonFromTarget: fetchDefaultEnvJsonFromTargetMock,
  fetchPnpmLockFromTarget: fetchPnpmLockFromTargetMock,
  findRemotePackageJsonPathsFromTarget: findRemotePackageJsonPathsFromTargetMock,
}));

import { exportServiceArtifacts } from './serviceArtifactExporter';

const baseOptions = {
  appName: 'finance-uat-api',
  targetFolderPath: '/tmp/workspace/finance-uat-api',
  session: {
    apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
    email: 'test@example.com',
    password: 'test-password',
    orgName: 'finance-services-prod',
    spaceName: 'uat',
    cfHomeDir: '/tmp/sap-tools-cf-home',
  },
};

beforeEach(() => {
  writeFileMock.mockReset();
  prepareCfCliSessionMock.mockReset();
  fetchDefaultEnvJsonFromTargetMock.mockReset();
  fetchPnpmLockFromTargetMock.mockReset();
  findRemotePackageJsonPathsFromTargetMock.mockReset();
});

describe('exportServiceArtifacts', () => {
  it('throws when no artifact type is selected', async () => {
    await expect(
      exportServiceArtifacts({
        ...baseOptions,
        includeDefaultEnv: false,
        includePnpmLock: false,
      })
    ).rejects.toThrow('At least one artifact must be selected for export.');

    expect(prepareCfCliSessionMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('exports both default-env.json and pnpm-lock.yaml', async () => {
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce('{\n  "NODE_ENV": "production"\n}\n');
    fetchPnpmLockFromTargetMock.mockResolvedValueOnce('lockfileVersion: 9.0\n');

    const result = await exportServiceArtifacts({
      ...baseOptions,
      includeDefaultEnv: true,
      includePnpmLock: true,
    });

    expect(prepareCfCliSessionMock).toHaveBeenCalledTimes(1);
    expect(prepareCfCliSessionMock).toHaveBeenCalledWith({
      apiEndpoint: baseOptions.session.apiEndpoint,
      email: baseOptions.session.email,
      password: baseOptions.session.password,
      orgName: baseOptions.session.orgName,
      spaceName: baseOptions.session.spaceName,
      cfHomeDir: baseOptions.session.cfHomeDir,
    });
    expect(fetchDefaultEnvJsonFromTargetMock).toHaveBeenCalledWith({
      appName: baseOptions.appName,
      cfHomeDir: baseOptions.session.cfHomeDir,
    });
    expect(fetchPnpmLockFromTargetMock).toHaveBeenCalledWith({
      appName: baseOptions.appName,
      cfHomeDir: baseOptions.session.cfHomeDir,
    });
    expect(writeFileMock).toHaveBeenNthCalledWith(
      1,
      '/tmp/workspace/finance-uat-api/default-env.json',
      '{\n  "NODE_ENV": "production"\n}\n',
      'utf8'
    );
    expect(writeFileMock).toHaveBeenNthCalledWith(
      2,
      '/tmp/workspace/finance-uat-api/pnpm-lock.yaml',
      'lockfileVersion: 9.0\n',
      'utf8'
    );
    expect(result).toEqual({
      writtenFiles: [
        '/tmp/workspace/finance-uat-api/default-env.json',
        '/tmp/workspace/finance-uat-api/pnpm-lock.yaml',
      ],
    });
  });

  it('exports only default-env.json when requested', async () => {
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce('{\n  "VCAP_SERVICES": {}\n}\n');

    const result = await exportServiceArtifacts({
      ...baseOptions,
      includeDefaultEnv: true,
      includePnpmLock: false,
    });

    expect(fetchDefaultEnvJsonFromTargetMock).toHaveBeenCalledTimes(1);
    expect(fetchPnpmLockFromTargetMock).not.toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/workspace/finance-uat-api/default-env.json',
      '{\n  "VCAP_SERVICES": {}\n}\n',
      'utf8'
    );
    expect(result).toEqual({
      writtenFiles: ['/tmp/workspace/finance-uat-api/default-env.json'],
    });
  });

  it('exports only pnpm-lock.yaml when requested', async () => {
    fetchPnpmLockFromTargetMock.mockResolvedValueOnce('lockfileVersion: 9.0\n');

    const result = await exportServiceArtifacts({
      ...baseOptions,
      includeDefaultEnv: false,
      includePnpmLock: true,
    });

    expect(fetchDefaultEnvJsonFromTargetMock).not.toHaveBeenCalled();
    expect(fetchPnpmLockFromTargetMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/workspace/finance-uat-api/pnpm-lock.yaml',
      'lockfileVersion: 9.0\n',
      'utf8'
    );
    expect(result).toEqual({
      writtenFiles: ['/tmp/workspace/finance-uat-api/pnpm-lock.yaml'],
    });
  });

  it('passes a literal remoteRoot setting straight through to the lock fetch', async () => {
    fetchPnpmLockFromTargetMock.mockResolvedValueOnce('lockfileVersion: 9.0\n');

    await exportServiceArtifacts({
      ...baseOptions,
      includeDefaultEnv: false,
      includePnpmLock: true,
      remoteRootSetting: '/home/vcap/app/gen/srv',
    });

    expect(findRemotePackageJsonPathsFromTargetMock).not.toHaveBeenCalled();
    expect(fetchPnpmLockFromTargetMock).toHaveBeenCalledWith({
      appName: baseOptions.appName,
      cfHomeDir: baseOptions.session.cfHomeDir,
      remoteRoot: '/home/vcap/app/gen/srv',
    });
  });

  it('resolves a regex remoteRoot via the container package.json listing', async () => {
    findRemotePackageJsonPathsFromTargetMock.mockResolvedValueOnce([
      '/home/vcap/app/package.json',
      '/home/vcap/app/gen/srv/package.json',
    ]);
    fetchPnpmLockFromTargetMock.mockResolvedValueOnce('lockfileVersion: 9.0\n');

    await exportServiceArtifacts({
      ...baseOptions,
      includeDefaultEnv: false,
      includePnpmLock: true,
      remoteRootSetting: 'regex:gen/srv$',
    });

    expect(findRemotePackageJsonPathsFromTargetMock).toHaveBeenCalledWith({
      appName: baseOptions.appName,
      cfHomeDir: baseOptions.session.cfHomeDir,
    });
    expect(fetchPnpmLockFromTargetMock).toHaveBeenCalledWith({
      appName: baseOptions.appName,
      cfHomeDir: baseOptions.session.cfHomeDir,
      remoteRoot: '/home/vcap/app/gen/srv',
    });
  });

  it('falls back to default locations when the regex matches nothing', async () => {
    findRemotePackageJsonPathsFromTargetMock.mockResolvedValueOnce([
      '/home/vcap/app/package.json',
    ]);
    fetchPnpmLockFromTargetMock.mockResolvedValueOnce('lockfileVersion: 9.0\n');

    await exportServiceArtifacts({
      ...baseOptions,
      includeDefaultEnv: false,
      includePnpmLock: true,
      remoteRootSetting: 'regex:no-match$',
    });

    expect(fetchPnpmLockFromTargetMock).toHaveBeenCalledWith({
      appName: baseOptions.appName,
      cfHomeDir: baseOptions.session.cfHomeDir,
    });
  });

  it('throws on an invalid remoteRoot regex before fetching', async () => {
    await expect(
      exportServiceArtifacts({
        ...baseOptions,
        includeDefaultEnv: false,
        includePnpmLock: true,
        remoteRootSetting: 'regex:(unterminated',
      })
    ).rejects.toThrow('Invalid remoteRoot regex in shared CAP debug config');

    expect(fetchPnpmLockFromTargetMock).not.toHaveBeenCalled();
  });
});
