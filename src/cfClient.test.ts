// cspell:words guids clientid clientsecret dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileAsyncMock, fetchMock, spawnedProcessMock, spawnMock } = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn(),
  fetchMock: vi.fn(),
  spawnedProcessMock: {
    killed: false,
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { end: vi.fn() },
    on: vi.fn(),
  },
  spawnMock: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: () => execFileAsyncMock,
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: spawnMock,
}));

import {
  configureCfCommandLogger,
  ensureCfAppSshEnabled,
  fetchDefaultEnvJsonFromTarget,
  fetchOrgs,
  fetchPnpmLockFromTarget,
  fetchRemoteTextFileFromTarget,
  findRemotePackageJsonPathsFromTarget,
  fetchRecentAppLogs,
  fetchSpaces,
  fetchStartedAppsViaCfCli,
  fetchXsuaaTokenFromTarget,
  getCfApiEndpoint,
  isCfSessionExpired,
  parseCfAppsOutput,
  prepareCfCliSession,
  resetCfCliSessionReuse,
  spawnAppLogStreamFromTarget,
} from './cfClient';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  spawnMock.mockReset();
  spawnedProcessMock.kill.mockReset();
  spawnedProcessMock.killed = false;
  spawnMock.mockReturnValue(spawnedProcessMock);
  configureCfCommandLogger(null);
  resetCfCliSessionReuse();
});

describe('getCfApiEndpoint', () => {
  it('resolves default Cloud Foundry endpoint for non-China regions', () => {
    expect(getCfApiEndpoint('us-10')).toBe('https://api.cf.us10.hana.ondemand.com');
    expect(getCfApiEndpoint('eu22')).toBe('https://api.cf.eu22.hana.ondemand.com');
  });

  it('resolves extension landscape endpoint without removing landscape hyphen', () => {
    expect(getCfApiEndpoint('us10-001')).toBe(
      'https://api.cf.us10-001.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('us10001')).toBe(
      'https://api.cf.us10-001.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('us10-002')).toBe(
      'https://api.cf.us10-002.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('us10002')).toBe(
      'https://api.cf.us10-002.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu10-002')).toBe(
      'https://api.cf.eu10-002.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu10002')).toBe(
      'https://api.cf.eu10-002.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu10-003')).toBe(
      'https://api.cf.eu10-003.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu10-004')).toBe(
      'https://api.cf.eu10-004.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu10004')).toBe(
      'https://api.cf.eu10-004.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu10-005')).toBe(
      'https://api.cf.eu10-005.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu20-001')).toBe(
      'https://api.cf.eu20-001.hana.ondemand.com'
    );
    expect(getCfApiEndpoint('eu20002')).toBe(
      'https://api.cf.eu20-002.hana.ondemand.com'
    );
  });

  it('resolves China Cloud Foundry endpoint on sapcloud domain', () => {
    expect(getCfApiEndpoint('cn-20')).toBe('https://api.cf.cn20.platform.sapcloud.cn');
    expect(getCfApiEndpoint('cn40')).toBe('https://api.cf.cn40.platform.sapcloud.cn');
  });
});

describe('isCfSessionExpired', () => {
  it('treats tokens inside the safety window as expired', () => {
    const nowMs = 1_000_000;

    expect(
      isCfSessionExpired(
        {
          apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
          token: {
            accessToken: 'token',
            refreshToken: '',
            expiresAt: nowMs + 60_000,
          },
        },
        nowMs
      )
    ).toBe(true);
  });

  it('keeps sessions usable when the token expiry is outside the safety window', () => {
    const nowMs = 1_000_000;

    expect(
      isCfSessionExpired(
        {
          apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
          token: {
            accessToken: 'token',
            refreshToken: '',
            expiresAt: nowMs + 60_001,
          },
        },
        nowMs
      )
    ).toBe(false);
  });
});

describe('parseCfAppsOutput', () => {
  it('parses CF v8 processes output and extracts running instances', () => {
    const output = [
      'Getting apps in org sample / space prod as user@example.com...',
      '',
      'name  requested state  processes  routes',
      'web-api  started  web:1/1, worker:0/1  web-api.cfapps.example.com',
      'job-runner  started  web:0/1  ',
      'alerts  stopped  web:0/1  alerts.cfapps.example.com',
      '',
    ].join('\n');

    expect(parseCfAppsOutput(output)).toEqual([
      { name: 'web-api', requestedState: 'started', runningInstances: 1 },
      { name: 'job-runner', requestedState: 'started', runningInstances: 0 },
      { name: 'alerts', requestedState: 'stopped', runningInstances: 0 },
    ]);
  });

  it('parses CF v7 instances output and handles no header', () => {
    const output = [
      'name  requested state  instances  urls',
      'billing-api  started  2/2  billing-api.cfapps.example.com',
      'worker-api  started  0/1  worker-api.cfapps.example.com',
    ].join('\n');

    expect(parseCfAppsOutput(output)).toEqual([
      { name: 'billing-api', requestedState: 'started', runningInstances: 2 },
      { name: 'worker-api', requestedState: 'started', runningInstances: 0 },
    ]);

    expect(parseCfAppsOutput('unexpected output')).toEqual([]);
  });
});

describe('prepareCfCliSession', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('serializes concurrent preparations and reuses auth for the second', async () => {
    const order: string[] = [];
    execFileAsyncMock.mockImplementation((_cmd: string, args: string[]) => {
      order.push(args[0] ?? '');
      return new Promise((resolve) => {
        setTimeout(() => resolve({ stdout: '' }), 5);
      });
    });

    const params = {
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
      cfHomeDir: '/tmp/sap-tools-cf-home-serialized',
    };

    await Promise.all([prepareCfCliSession(params), prepareCfCliSession(params)]);

    // Serialized (without it the triplets would interleave as
    // api, api, auth, auth, target, target) AND the second preparation reuses
    // the freshly-established api/auth, re-running only `cf target`.
    expect(order).toEqual(['api', 'auth', 'target', 'target']);
  });

  it('reuses an established session and only re-targets within the reuse window', async () => {
    const order: string[] = [];
    execFileAsyncMock.mockImplementation((_cmd: string, args: string[]) => {
      order.push(args[0] ?? '');
      return Promise.resolve({ stdout: '' });
    });
    const base = {
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      cfHomeDir: '/tmp/sap-tools-cf-home-reuse',
    };

    await prepareCfCliSession({ ...base, orgName: 'org-a', spaceName: 'dev' });
    await prepareCfCliSession({ ...base, orgName: 'org-b', spaceName: 'prod' });

    // Second prep skips api/auth and only re-asserts the new org/space.
    expect(order).toEqual(['api', 'auth', 'target', 'target']);

    // A different API endpoint is treated as a new session → full re-auth.
    order.length = 0;
    await prepareCfCliSession({
      ...base,
      apiEndpoint: 'https://api.cf.eu10.hana.ondemand.com',
      orgName: 'org-a',
      spaceName: 'dev',
    });
    expect(order).toEqual(['api', 'auth', 'target']);
  });

  it('re-authenticates fully when a reused target reveals a stale session', async () => {
    const order: string[] = [];
    execFileAsyncMock.mockImplementation((_cmd: string, args: string[]) => {
      order.push(args[0] ?? '');
      // 4th call is the reduced re-target on the second prep; simulate the
      // stored token having expired so it must fall back to a full re-auth.
      if (order.length === 4) {
        return Promise.reject({ stderr: 'No org and space targeted', message: 'Command failed' });
      }
      return Promise.resolve({ stdout: '' });
    });
    const params = {
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
      cfHomeDir: '/tmp/sap-tools-cf-home-stale',
    };

    await prepareCfCliSession(params);
    await prepareCfCliSession(params);

    expect(order).toEqual(['api', 'auth', 'target', 'target', 'api', 'auth', 'target']);
  });

  it('does a full preparation again after the session cache is reset', async () => {
    const order: string[] = [];
    execFileAsyncMock.mockImplementation((_cmd: string, args: string[]) => {
      order.push(args[0] ?? '');
      return Promise.resolve({ stdout: '' });
    });
    const params = {
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
      cfHomeDir: '/tmp/sap-tools-cf-home-reset',
    };

    await prepareCfCliSession(params);
    resetCfCliSessionReuse();
    await prepareCfCliSession(params);

    expect(order).toEqual(['api', 'auth', 'target', 'api', 'auth', 'target']);
  });

  it('does a full preparation again when forced even inside the reuse window', async () => {
    const order: string[] = [];
    execFileAsyncMock.mockImplementation((_cmd: string, args: string[]) => {
      order.push(args[0] ?? '');
      return Promise.resolve({ stdout: '' });
    });
    const params = {
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
      cfHomeDir: '/tmp/sap-tools-cf-home-force',
    };

    await prepareCfCliSession(params);
    await prepareCfCliSession({ ...params, forceReauth: true });

    expect(order).toEqual(['api', 'auth', 'target', 'api', 'auth', 'target']);
  });
});

describe('fetchStartedAppsViaCfCli', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('runs cf commands in sequence and returns only started apps with running instances', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '' }) // cf api
      .mockResolvedValueOnce({ stdout: '' }) // cf auth
      .mockResolvedValueOnce({ stdout: '' }) // cf target
      .mockResolvedValueOnce({
        stdout: [
          'name  requested state  processes  routes',
          'orders-api  started  web:2/2  orders-api.cfapps.example.com',
          'batch-worker  started  web:0/1  ',
          'legacy-api  stopped  web:0/1  legacy-api.cfapps.example.com',
        ].join('\n'),
      }); // cf apps

    const apps = await fetchStartedAppsViaCfCli({
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    expect(apps).toEqual([
      { name: 'orders-api', runningInstances: 2 },
    ]);

    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      ['api', 'https://api.cf.us10.hana.ondemand.com'],
      expect.objectContaining({
        maxBuffer: 8 * 1024 * 1024,
        timeout: 600_000,
        env: expect.objectContaining({
          CF_HOME: '/tmp/sap-tools-cf-home',
        }),
      })
    );

    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'cf',
      ['auth'],
      expect.objectContaining({
        env: expect.objectContaining({
          CF_USERNAME: 'test@example.com',
          CF_PASSWORD: 'super-secret-password',
        }),
      })
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      'cf',
      ['target', '-o', 'finance-services-prod', '-s', 'uat'],
      expect.any(Object)
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(4, 'cf', ['apps'], expect.any(Object));
  });

  it('logs sanitized CF CLI command shape without credentials', async () => {
    const commandLogs: string[] = [];
    configureCfCommandLogger((message) => {
      commandLogs.push(message);
    });
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({
        stdout: [
          'name  requested state  processes  routes',
          'orders-api  started  web:1/1  orders-api.cfapps.example.com',
        ].join('\n'),
      });

    await fetchStartedAppsViaCfCli({
      apiEndpoint: 'https://api.cf.eu10-004.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    expect(commandLogs).toEqual([
      '[cf-cli] cf api https://api.cf.eu10-004.hana.ondemand.com',
      '[cf-cli] cf auth',
      '[cf-cli] cf target -o finance-services-prod -s uat',
      '[cf-cli] cf apps',
    ]);
    expect(commandLogs.join('\n')).not.toContain('super-secret-password');
    expect(commandLogs.join('\n')).not.toContain('test@example.com');
  });

  it('returns safe auth error message without leaking password from command args', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '' })
      .mockRejectedValueOnce({
        stderr: 'Credentials were rejected by UAA',
        message: 'Command failed: cf auth test@example.com super-secret-password',
      });

    let errorMessage = '';
    try {
      await fetchStartedAppsViaCfCli({
        apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
        email: 'test@example.com',
        password: 'super-secret-password',
        orgName: 'finance-services-prod',
        spaceName: 'uat',
      });
      expect.fail('Expected fetchStartedAppsViaCfCli to throw.');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('Failed to authenticate Cloud Foundry CLI.');
    expect(errorMessage).toContain('Credentials were rejected by UAA');
    expect(errorMessage).not.toContain('super-secret-password');
  });

  it('retries cf apps command once when CLI fails with transient connection error', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '' }) // cf api
      .mockResolvedValueOnce({ stdout: '' }) // cf auth
      .mockResolvedValueOnce({ stdout: '' }) // cf target
      .mockRejectedValueOnce({
        stderr: 'connection reset by peer',
        message: 'Command failed',
      }) // cf apps attempt 1
      .mockResolvedValueOnce({
        stdout: [
          'name  requested state  processes  routes',
          'orders-api  started  web:2/2  orders-api.cfapps.example.com',
        ].join('\n'),
      }); // cf apps attempt 2

    const apps = await fetchStartedAppsViaCfCli({
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
    });

    expect(apps).toEqual([{ name: 'orders-api', runningInstances: 2 }]);
    expect(execFileAsyncMock).toHaveBeenCalledTimes(5);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(4, 'cf', ['apps'], expect.any(Object));
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(5, 'cf', ['apps'], expect.any(Object));
  });
});

describe('fetchRecentAppLogs', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('runs cf commands in sequence and returns the raw log output', async () => {
    const sampleLog = 'Retrieving logs for app finance-uat-api...\n2026-01-01T10:00:00Z [APP/0] OUT hello world';

    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '' }) // cf api
      .mockResolvedValueOnce({ stdout: '' }) // cf auth
      .mockResolvedValueOnce({ stdout: '' }) // cf target
      .mockResolvedValueOnce({ stdout: sampleLog }); // cf logs --recent

    const result = await fetchRecentAppLogs({
      apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
      email: 'test@example.com',
      password: 'super-secret-password',
      orgName: 'finance-services-prod',
      spaceName: 'uat',
      appName: 'finance-uat-api',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    expect(result).toBe(sampleLog);
    expect(execFileAsyncMock).toHaveBeenCalledTimes(4);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      4,
      'cf',
      ['logs', 'finance-uat-api', '--recent'],
      expect.objectContaining({ env: expect.objectContaining({ CF_HOME: '/tmp/sap-tools-cf-home' }) })
    );
  });

  it('returns safe error message when log fetch fails', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockRejectedValueOnce({ stderr: 'App not found', message: 'Command failed' });

    await expect(
      fetchRecentAppLogs({
        apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
        email: 'test@example.com',
        password: 'secret',
        orgName: 'org',
        spaceName: 'space',
        appName: 'unknown-app',
      })
    ).rejects.toThrow('Failed to fetch recent logs for app "unknown-app".');
  });
});

describe('spawnAppLogStreamFromTarget', () => {
  it('logs live CF log stream command without credentials', () => {
    const commandLogs: string[] = [];
    configureCfCommandLogger((message) => {
      commandLogs.push(message);
    });

    const streamHandle = spawnAppLogStreamFromTarget({
      appName: 'finance-uat-api',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    expect(commandLogs).toEqual(['[cf-cli] cf logs finance-uat-api']);
    expect(spawnMock).toHaveBeenCalledWith(
      'cf',
      ['logs', 'finance-uat-api'],
      expect.objectContaining({
        env: expect.objectContaining({
          CF_HOME: '/tmp/sap-tools-cf-home',
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );

    streamHandle.stop();
    expect(spawnedProcessMock.kill).toHaveBeenCalledTimes(1);
  });
});

describe('ensureCfAppSshEnabled', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('does not restart the app when CF SSH is already enabled', async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: "ssh support is enabled for app 'finance-uat-api'\n",
    });

    await ensureCfAppSshEnabled({
      appName: 'finance-uat-api',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      ['ssh-enabled', 'finance-uat-api'],
      expect.objectContaining({
        env: expect.objectContaining({
          CF_HOME: '/tmp/sap-tools-cf-home',
        }),
      })
    );
  });

  it('enables CF SSH and restarts the app when SSH is disabled', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: "ssh support is disabled for app 'finance-uat-api'\n",
      })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' });

    await ensureCfAppSshEnabled({ appName: 'finance-uat-api' });

    expect(execFileAsyncMock).toHaveBeenCalledTimes(4);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      ['ssh-enabled', 'finance-uat-api'],
      expect.any(Object)
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'cf',
      ['enable-ssh', 'finance-uat-api'],
      expect.any(Object)
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      'cf',
      ['restart', 'finance-uat-api'],
      expect.any(Object)
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      4,
      'cf',
      ['ssh', 'finance-uat-api', '-c', 'true'],
      expect.any(Object)
    );
  });
});

describe('fetchDefaultEnvJsonFromTarget', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('builds default-env json from app env payload', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'app-guid-123\n' })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          system_env_json: {
            VCAP_SERVICES: {
              hana: [{ name: 'hana-service' }],
            },
            VCAP_APPLICATION: {
              application_name: 'finance-uat-api',
            },
          },
          environment_variables: {
            NODE_ENV: 'production',
          },
          running_env_json: {
            MEMORY_LIMIT: '512M',
          },
        }),
      });

    const defaultEnvJson = await fetchDefaultEnvJsonFromTarget({
      appName: 'finance-uat-api',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    const parsed = JSON.parse(defaultEnvJson) as Record<string, unknown>;
    expect(parsed['VCAP_SERVICES']).toEqual({
      hana: [{ name: 'hana-service' }],
    });
    expect(parsed['VCAP_APPLICATION']).toEqual({
      application_name: 'finance-uat-api',
    });
    expect(parsed['NODE_ENV']).toBe('production');
    expect(parsed['MEMORY_LIMIT']).toBe('512M');
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      ['app', 'finance-uat-api', '--guid'],
      expect.any(Object)
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'cf',
      ['curl', '/v3/apps/app-guid-123/env'],
      expect.any(Object)
    );
  });

  it('fails when app env payload is not json', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'app-guid-123\n' })
      .mockResolvedValueOnce({ stdout: 'not-json' });

    await expect(
      fetchDefaultEnvJsonFromTarget({
        appName: 'finance-uat-api',
      })
    ).rejects.toThrow('Unexpected JSON format for CF app environment payload.');
  });
});

  describe('fetchXsuaaTokenFromTarget', () => {
    it('returns null if env stdout does not contain VCAP_SERVICES', async () => {
      execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('env')) {
          return { stdout: 'System-Provided:\n{}\n\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const token = await fetchXsuaaTokenFromTarget({
        appName: 'test-app', apiEndpoint: '', email: '', password: '', orgName: '', spaceName: ''
      });
      expect(token).toBeNull();
    });

    it('parses XSUAA credentials and fetches token', async () => {
      const mockEnv = `System-Provided:
VCAP_SERVICES: {
  "xsuaa": [
    {
      "credentials": {
        "clientid": "test-client",
        "clientsecret": "test-secret",
        "url": "https://test.authentication.com"
      }
    }
  ]
}

`;
      execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('env')) {
          return { stdout: mockEnv, stderr: '' };
        } else if (args.includes('oauth-token')) {
          return { stdout: 'bearer valid-cli-token', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'valid-xsuaa-token' })
      } as unknown as Response);

      const token = await fetchXsuaaTokenFromTarget({
        appName: 'test-app', apiEndpoint: '', email: '', password: '', orgName: '', spaceName: ''
      });
      
      expect(token).toBe('Bearer valid-xsuaa-token');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.authentication.com/oauth/token?grant_type=client_credentials',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Basic dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          }
        })
      );
    });
  });

  describe('fetchAppRouteUrlFromTarget', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('returns lock file content from app via cf ssh', async () => {
    const lockfile = 'lockfileVersion: 9.0\nimporters:\n  .:\n    dependencies:\n';
    execFileAsyncMock.mockResolvedValueOnce({ stdout: lockfile });

    const content = await fetchPnpmLockFromTarget({
      appName: 'finance-uat-api',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    expect(content).toBe(lockfile);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      ['ssh', 'finance-uat-api', '-c', 'cat /home/vcap/app/pnpm-lock.yaml'],
      expect.any(Object)
    );
  });

  it('throws recoverable auth errors without trying pnpm-lock fallback paths', async () => {
    execFileAsyncMock.mockRejectedValueOnce({ stderr: '401 Unauthorized' });

    await expect(
      fetchPnpmLockFromTarget({
        appName: 'finance-uat-api',
      })
    ).rejects.toThrow('401 Unauthorized');

    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
  });

  it('tries the configured remote root before the standard locations', async () => {
    execFileAsyncMock.mockResolvedValueOnce({ stdout: 'lockfileVersion: 9.0\n' });

    const content = await fetchPnpmLockFromTarget({
      appName: 'finance-uat-api',
      remoteRoot: '/home/vcap/app/gen/srv/',
    });

    expect(content).toContain('lockfileVersion: 9.0');
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      ['ssh', 'finance-uat-api', '-c', 'cat /home/vcap/app/gen/srv/pnpm-lock.yaml'],
      expect.any(Object)
    );
  });

  it('does not duplicate a remote root that equals the default location', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce({ stderr: 'No such file' })
      .mockResolvedValueOnce({ stdout: 'lockfileVersion: 9.0\n' });

    await fetchPnpmLockFromTarget({
      appName: 'finance-uat-api',
      remoteRoot: '/home/vcap/app',
    });

    // /home/vcap/app collapses into the first default command, leaving 2 total.
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      ['ssh', 'finance-uat-api', '-c', 'cat /home/vcap/app/pnpm-lock.yaml'],
      expect.any(Object)
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'cf',
      ['ssh', 'finance-uat-api', '-c', 'cat pnpm-lock.yaml'],
      expect.any(Object)
    );
  });

  it('tries fallback command when primary ssh command fails', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce({ stderr: 'No such file' })
      .mockResolvedValueOnce({ stdout: 'lockfileVersion: 9.0\n' });

    const content = await fetchPnpmLockFromTarget({
      appName: 'finance-uat-api',
    });

    expect(content).toContain('lockfileVersion: 9.0');
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'cf',
      ['ssh', 'finance-uat-api', '-c', 'cat pnpm-lock.yaml'],
      expect.any(Object)
    );
  });

  it('returns actionable error when lock file cannot be fetched', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce({ stderr: 'No such file' })
      .mockRejectedValueOnce({ stderr: 'ssh is disabled for this app' });

    await expect(
      fetchPnpmLockFromTarget({
        appName: 'finance-uat-api',
      })
    ).rejects.toThrow(
      'Unable to read pnpm-lock.yaml from app "finance-uat-api". Ensure SSH is enabled and the file exists in the app container.'
    );
  });
});

describe('fetchRemoteTextFileFromTarget', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('returns package.json from the configured remote root before default locations', async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: '__SAP_TOOLS_REMOTE_FILE_CONTENT__\n{"name":"finance-uat-api"}\n',
    });

    const content = await fetchRemoteTextFileFromTarget({
      appName: 'finance-uat-api',
      fileName: 'package.json',
      remoteRoot: '/home/vcap/app/gen/srv/',
    });

    expect(content).toBe('{"name":"finance-uat-api"}\n');
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      [
        'ssh',
        'finance-uat-api',
        '-c',
        "if [ -f '/home/vcap/app/gen/srv/package.json' ]; then printf '%s\\n' '__SAP_TOOLS_REMOTE_FILE_CONTENT__'; cat '/home/vcap/app/gen/srv/package.json'; else exit 66; fi",
      ],
      expect.any(Object)
    );
  });

  it('exports an empty optional file when it exists in the container', async () => {
    execFileAsyncMock.mockResolvedValueOnce({ stdout: '__SAP_TOOLS_REMOTE_FILE_CONTENT__\n' });

    const content = await fetchRemoteTextFileFromTarget({
      appName: 'finance-uat-api',
      fileName: '.npmrc',
      remoteRoot: '/home/vcap/app',
    });

    expect(content).toBe('');
  });

  it('quotes remote paths before passing them to the shell command', async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: '__SAP_TOOLS_REMOTE_FILE_CONTENT__\nregistry=https://example.invalid/\n',
    });

    await fetchRemoteTextFileFromTarget({
      appName: 'finance-uat-api',
      fileName: '.npmrc',
      remoteRoot: "/home/vcap/app/service's root",
    });

    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'cf',
      [
        'ssh',
        'finance-uat-api',
        '-c',
        "if [ -f '/home/vcap/app/service'\\''s root/.npmrc' ]; then printf '%s\\n' '__SAP_TOOLS_REMOTE_FILE_CONTENT__'; cat '/home/vcap/app/service'\\''s root/.npmrc'; else exit 66; fi",
      ],
      expect.any(Object)
    );
  });

  it('returns null for optional dotfiles that are not present', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce({ stderr: 'No such file' })
      .mockRejectedValueOnce({ stderr: 'No such file' });

    const content = await fetchRemoteTextFileFromTarget({
      appName: 'finance-uat-api',
      fileName: '.cdsrc.json',
    });

    expect(content).toBeNull();
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'cf',
      [
        'ssh',
        'finance-uat-api',
        '-c',
        "if [ -f '.cdsrc.json' ]; then printf '%s\\n' '__SAP_TOOLS_REMOTE_FILE_CONTENT__'; cat '.cdsrc.json'; else exit 66; fi",
      ],
      expect.any(Object)
    );
  });

  it('throws recoverable auth errors instead of treating them as missing optional files', async () => {
    execFileAsyncMock.mockRejectedValueOnce({ stderr: 'Not logged in. Use cf login.' });

    await expect(
      fetchRemoteTextFileFromTarget({
        appName: 'finance-uat-api',
        fileName: '.npmrc',
      })
    ).rejects.toThrow('Not logged in');

    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
  });
});

describe('findRemotePackageJsonPathsFromTarget', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it('runs the find command via cf ssh and returns trimmed non-empty lines', async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: '/home/vcap/app/package.json\n  /home/vcap/app/srv/package.json  \n\n',
    });

    const paths = await findRemotePackageJsonPathsFromTarget({
      appName: 'finance-uat-api',
      cfHomeDir: '/tmp/sap-tools-cf-home',
    });

    expect(paths).toEqual([
      '/home/vcap/app/package.json',
      '/home/vcap/app/srv/package.json',
    ]);
    const [command, args] = execFileAsyncMock.mock.calls[0] ?? [];
    expect(command).toBe('cf');
    expect(args?.slice(0, 3)).toEqual(['ssh', 'finance-uat-api', '-c']);
    expect(String(args?.[3])).toContain('-name package.json');
  });
});

describe('CF API v3 resources', () => {
  it('fetches organizations from v3 endpoint when available', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [{ guid: 'org-alpha', name: 'alpha-org' }],
        pagination: { next: null },
      })
    );

    const orgs = await fetchOrgs({
      apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
      token: {
        accessToken: 'token-value',
        refreshToken: '',
        expiresAt: Date.now() + 60_000,
      },
    });

    expect(orgs).toEqual([{ guid: 'org-alpha', name: 'alpha-org' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v3/organizations?order_by=name&per_page=200'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-value',
        }),
      })
    );
  });

  it('fetches all organization pages from v3 pagination', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [{ guid: 'org-a', name: 'a-org' }],
          pagination: {
            next: { href: '/v3/organizations?page=2&per_page=200' },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [{ guid: 'org-b', name: 'b-org' }],
          pagination: { next: null },
        })
      );

    const orgs = await fetchOrgs({
      apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
      token: {
        accessToken: 'token-value',
        refreshToken: '',
        expiresAt: Date.now() + 60_000,
      },
    });

    expect(orgs).toEqual([
      { guid: 'org-a', name: 'a-org' },
      { guid: 'org-b', name: 'b-org' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v3/organizations?page=2&per_page=200');
  });

  it('fails fast when v3 organizations endpoint returns an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(
      fetchOrgs({
        apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
        token: {
          accessToken: 'token-value',
          refreshToken: '',
          expiresAt: Date.now() + 60_000,
        },
      })
    ).rejects.toThrow('Failed to fetch CF organizations (status 404).');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v3/organizations');
  });

  it('retries organizations request when first response is transient 503', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [{ guid: 'org-alpha', name: 'alpha-org' }],
          pagination: { next: null },
        })
      );

    const orgs = await fetchOrgs({
      apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
      token: {
        accessToken: 'token-value',
        refreshToken: '',
        expiresAt: Date.now() + 60_000,
      },
    });

    expect(orgs).toEqual([{ guid: 'org-alpha', name: 'alpha-org' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry organizations request on 401 authentication failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));

    await expect(
      fetchOrgs({
        apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
        token: {
          accessToken: 'token-value',
          refreshToken: '',
          expiresAt: Date.now() + 60_000,
        },
      })
    ).rejects.toThrow('Failed to fetch CF organizations (status 401).');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches spaces from v3 endpoint when available', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [{ guid: 'space-a', name: 'dev' }],
        pagination: { next: null },
      })
    );

    const spaces = await fetchSpaces(
      {
        apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
        token: {
          accessToken: 'token-value',
          refreshToken: '',
          expiresAt: Date.now() + 60_000,
        },
      },
      'org-guid-1'
    );

    expect(spaces).toEqual([{ guid: 'space-a', name: 'dev' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v3/spaces?organization_guids=org-guid-1'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-value',
        }),
      })
    );
  });

  it('fetches all space pages from v3 pagination', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [{ guid: 'space-1', name: 'dev' }],
          pagination: {
            next: {
              href: 'https://api.cf.br10.hana.ondemand.com/v3/spaces?page=2&per_page=200',
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [{ guid: 'space-2', name: 'prod' }],
          pagination: { next: null },
        })
      );

    const spaces = await fetchSpaces(
      {
        apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
        token: {
          accessToken: 'token-value',
          refreshToken: '',
          expiresAt: Date.now() + 60_000,
        },
      },
      'org-guid-2'
    );

    expect(spaces).toEqual([
      { guid: 'space-1', name: 'dev' },
      { guid: 'space-2', name: 'prod' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v3/spaces?page=2&per_page=200');
  });

  it('fails after retrying when v3 spaces endpoint keeps returning 500', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(
      fetchSpaces(
        {
          apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
          token: {
            accessToken: 'token-value',
            refreshToken: '',
            expiresAt: Date.now() + 60_000,
          },
        },
        'org-guid-2'
      )
    ).rejects.toThrow('Failed to fetch CF spaces (status 500).');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v3/spaces?organization_guids=org-guid-2');
  });
});
