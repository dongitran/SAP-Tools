import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  existsSyncMock,
  readFileMock,
  writeFileMock,
  mkdirMock,
  prepareCfCliSessionMock,
  fetchDefaultEnvJsonFromTargetMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  prepareCfCliSessionMock: vi.fn(),
  fetchDefaultEnvJsonFromTargetMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  mkdir: mkdirMock,
}));

vi.mock('./cfClient', () => ({
  prepareCfCliSession: prepareCfCliSessionMock,
  fetchDefaultEnvJsonFromTarget: fetchDefaultEnvJsonFromTargetMock,
}));

import {
  extractHanaCredentialsFromDefaultEnv,
  toSqlToolsConnection,
  upsertSqlToolsConnection,
  exportSqlToolsConfig,
} from './sqlToolsConfigExporter';

// ── Test fixtures ────────────────────────────────────────────────────────────

const HANA_CREDENTIALS = {
  host: 'feb62cb7-1234.hanacloud.ondemand.com',
  port: '443',
  user: 'demoapp_PRD_RT',
  password: 'secret-password',
  schema: 'demoapp_PRD',
};

const VALID_DEFAULT_ENV = {
  VCAP_SERVICES: {
    hana: [
      {
        credentials: {
          host: HANA_CREDENTIALS.host,
          port: HANA_CREDENTIALS.port,
          user: HANA_CREDENTIALS.user,
          password: HANA_CREDENTIALS.password,
          schema: HANA_CREDENTIALS.schema,
          hdi_user: 'hdi_user',
          hdi_password: 'hdi_password',
          url: 'https://example.com',
          database_id: 'db-id-123',
          certificate: '-----BEGIN CERTIFICATE-----',
        },
      },
    ],
  },
  NODE_ENV: 'production',
};

const BASE_EXPORT_OPTIONS = {
  appName: 'finance-uat-api',
  regionCode: 'us10',
  rootFolderPath: '/workspace/sap-services',
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
  existsSyncMock.mockReset();
  readFileMock.mockReset();
  writeFileMock.mockReset();
  mkdirMock.mockReset();
  prepareCfCliSessionMock.mockReset();
  fetchDefaultEnvJsonFromTargetMock.mockReset();
});

// ── extractHanaCredentialsFromDefaultEnv ───────────────────────────────────────────

describe('extractHanaCredentialsFromDefaultEnv', () => {
  it('returns credentials from a valid default-env.json payload', () => {
    const result = extractHanaCredentialsFromDefaultEnv(VALID_DEFAULT_ENV as Record<string, unknown>);
    expect(result).toEqual(HANA_CREDENTIALS);
  });

  it('returns null when VCAP_SERVICES is missing', () => {
    const result = extractHanaCredentialsFromDefaultEnv({ NODE_ENV: 'production' });
    expect(result).toBeNull();
  });

  it('returns null when VCAP_SERVICES is not an object', () => {
    const result = extractHanaCredentialsFromDefaultEnv({ VCAP_SERVICES: 'invalid' });
    expect(result).toBeNull();
  });

  it('returns null when hana array is missing in VCAP_SERVICES', () => {
    const result = extractHanaCredentialsFromDefaultEnv({ VCAP_SERVICES: { other: [] } });
    expect(result).toBeNull();
  });

  it('returns null when hana array is empty', () => {
    const result = extractHanaCredentialsFromDefaultEnv({ VCAP_SERVICES: { hana: [] } });
    expect(result).toBeNull();
  });

  it('returns null when credentials object is missing', () => {
    const result = extractHanaCredentialsFromDefaultEnv({
      VCAP_SERVICES: { hana: [{ no_credentials: true }] },
    });
    expect(result).toBeNull();
  });

  it('returns null when a required credential field is missing', () => {
    const partialCredentials = {
      VCAP_SERVICES: {
        hana: [
          {
            credentials: {
              host: 'host.example.com',
              // port is missing
              user: 'user',
              password: 'pass',
              schema: 'schema',
            },
          },
        ],
      },
    };
    const result = extractHanaCredentialsFromDefaultEnv(partialCredentials);
    expect(result).toBeNull();
  });

  it('returns null when host is an empty string', () => {
    const result = extractHanaCredentialsFromDefaultEnv({
      VCAP_SERVICES: {
        hana: [
          {
            credentials: { host: '', port: '443', user: 'u', password: 'p', schema: 's' },
          },
        ],
      },
    });
    expect(result).toBeNull();
  });
});

// ── toSqlToolsConnection ─────────────────────────────────────────────────────

describe('toSqlToolsConnection', () => {
  it('maps HANA credentials to the SQLTools connection format', () => {
    const conn = toSqlToolsConnection('finance-uat-api', 'us10', HANA_CREDENTIALS);
    expect(conn).toEqual({
      connectionTimeout: 30,
      hanaOptions: {
        encrypt: true,
        sslValidateCertificate: true,
        sslCryptoProvider: 'openssl',
      },
      previewLimit: 50,
      driver: 'SAPHana',
      name: 'finance-uat-api (us10)',
      server: HANA_CREDENTIALS.host,
      port: 443,
      username: HANA_CREDENTIALS.user,
      password: HANA_CREDENTIALS.password,
      database: HANA_CREDENTIALS.schema,
    });
  });

  it('parses port string to integer', () => {
    const conn = toSqlToolsConnection('app', 'ap11', { ...HANA_CREDENTIALS, port: '30015' });
    expect(conn.port).toBe(30015);
    expect(typeof conn.port).toBe('number');
  });

  it('formats name as "appName (regionCode)"', () => {
    const conn = toSqlToolsConnection('my-service', 'eu10', HANA_CREDENTIALS);
    expect(conn.name).toBe('my-service (eu10)');
  });

  it('normalizes hyphenated region code in connection name', () => {
    const conn = toSqlToolsConnection('my-service', 'us-10', HANA_CREDENTIALS);
    expect(conn.name).toBe('my-service (us10)');
  });
});

// ── upsertSqlToolsConnection ─────────────────────────────────────────────────

describe('upsertSqlToolsConnection', () => {
  const newConn = toSqlToolsConnection('finance-uat-api', 'us10', HANA_CREDENTIALS);

  it('appends connection when sqltools.connections does not exist', () => {
    const existing = { 'workbench.iconTheme': 'material-icon-theme' };
    const updated = upsertSqlToolsConnection(existing, newConn);
    expect(updated['sqltools.connections']).toEqual([newConn]);
    expect(updated['sqltools.useNodeRuntime']).toBe(true);
    expect(updated['workbench.iconTheme']).toBe('material-icon-theme');
  });

  it('appends connection when no matching name exists', () => {
    const other = toSqlToolsConnection('other-app', 'us10', HANA_CREDENTIALS);
    const existing = { 'sqltools.connections': [other] };
    const updated = upsertSqlToolsConnection(existing, newConn);
    const connections = updated['sqltools.connections'] as unknown[];
    expect(connections).toHaveLength(2);
    expect(connections).toContainEqual(newConn);
    expect(connections).toContainEqual(other);
  });

  it('replaces existing connection with the same name', () => {
    const oldConn = { ...newConn, password: 'old-password' };
    const existing = { 'sqltools.connections': [oldConn] };
    const updated = upsertSqlToolsConnection(existing, newConn);
    const connections = updated['sqltools.connections'] as unknown[];
    expect(connections).toHaveLength(1);
    expect(connections[0]).toEqual(newConn);
  });

  it('preserves order of other connections when replacing', () => {
    const connA = toSqlToolsConnection('app-a', 'us10', HANA_CREDENTIALS);
    const connB = toSqlToolsConnection('finance-uat-api', 'us10', { ...HANA_CREDENTIALS, password: 'old' });
    const connC = toSqlToolsConnection('app-c', 'us10', HANA_CREDENTIALS);
    const existing = { 'sqltools.connections': [connA, connB, connC] };
    const updated = upsertSqlToolsConnection(existing, newConn);
    const connections = updated['sqltools.connections'] as typeof connA[];
    expect(connections).toHaveLength(3);
    expect(connections[0]).toEqual(connA);
    expect(connections[1]).toEqual(newConn);
    expect(connections[2]).toEqual(connC);
  });

  it('sets sqltools.useNodeRuntime to true unconditionally', () => {
    const existing = { 'sqltools.useNodeRuntime': false };
    const updated = upsertSqlToolsConnection(existing, newConn);
    expect(updated['sqltools.useNodeRuntime']).toBe(true);
  });

  it('handles non-array sqltools.connections gracefully', () => {
    const existing = { 'sqltools.connections': 'corrupted' };
    const updated = upsertSqlToolsConnection(existing, newConn);
    expect(updated['sqltools.connections']).toEqual([newConn]);
  });

  it('ignores invalid array entries in sqltools.connections', () => {
    const existing = {
      'sqltools.connections': [
        null,
        'bad-entry',
        { notName: 'missing-name' },
        { name: 'other-app', server: 'other.example.com' },
      ],
    };
    const updated = upsertSqlToolsConnection(existing, newConn);
    const connections = updated['sqltools.connections'] as { name?: string }[];
    expect(connections).toHaveLength(2);
    expect(connections[0]?.name).toBe('other-app');
    expect(connections[1]?.name).toBe(newConn.name);
  });
});

// ── exportSqlToolsConfig ─────────────────────────────────────────────────────

describe('exportSqlToolsConfig', () => {
  const settingsPath = '/workspace/sap-services/.vscode/settings.json';
  const vscodeDirPath = '/workspace/sap-services/.vscode';

  it('creates .vscode directory and writes new settings.json when neither exists', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce(
      `${JSON.stringify(VALID_DEFAULT_ENV, null, 2)}\n`
    );

    const result = await exportSqlToolsConfig(BASE_EXPORT_OPTIONS);

    expect(prepareCfCliSessionMock).toHaveBeenCalledWith({
      apiEndpoint: BASE_EXPORT_OPTIONS.session.apiEndpoint,
      email: BASE_EXPORT_OPTIONS.session.email,
      password: BASE_EXPORT_OPTIONS.session.password,
      orgName: BASE_EXPORT_OPTIONS.session.orgName,
      spaceName: BASE_EXPORT_OPTIONS.session.spaceName,
      cfHomeDir: BASE_EXPORT_OPTIONS.session.cfHomeDir,
    });
    expect(fetchDefaultEnvJsonFromTargetMock).toHaveBeenCalledWith({
      appName: BASE_EXPORT_OPTIONS.appName,
      cfHomeDir: BASE_EXPORT_OPTIONS.session.cfHomeDir,
    });
    expect(mkdirMock).toHaveBeenCalledWith(vscodeDirPath, { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(1);

    const [writtenPath, writtenContent] = writeFileMock.mock.calls[0] as [string, string, string];
    expect(writtenPath).toBe(settingsPath);
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    expect(parsed['sqltools.useNodeRuntime']).toBe(true);
    const connections = parsed['sqltools.connections'] as { name: string }[];
    expect(connections).toHaveLength(1);
    expect(connections[0]?.name).toBe('finance-uat-api (us10)');
    expect(result.settingsPath).toBe(settingsPath);
    expect(result.connection.name).toBe('finance-uat-api (us10)');
  });

  it('re-authenticates and retries twice when fetching default-env fails with an auth error', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchDefaultEnvJsonFromTargetMock
      .mockRejectedValueOnce(new Error('Failed to fetch CF environment. (cli: not authorized)'))
      .mockRejectedValueOnce(new Error('Failed to fetch CF environment. (cli: 401 unauthorized)'))
      .mockResolvedValueOnce(`${JSON.stringify(VALID_DEFAULT_ENV, null, 2)}\n`);

    const result = await exportSqlToolsConfig(BASE_EXPORT_OPTIONS);

    expect(prepareCfCliSessionMock).toHaveBeenNthCalledWith(1, {
      apiEndpoint: BASE_EXPORT_OPTIONS.session.apiEndpoint,
      email: BASE_EXPORT_OPTIONS.session.email,
      password: BASE_EXPORT_OPTIONS.session.password,
      orgName: BASE_EXPORT_OPTIONS.session.orgName,
      spaceName: BASE_EXPORT_OPTIONS.session.spaceName,
      cfHomeDir: BASE_EXPORT_OPTIONS.session.cfHomeDir,
    });
    expect(prepareCfCliSessionMock).toHaveBeenNthCalledWith(2, {
      apiEndpoint: BASE_EXPORT_OPTIONS.session.apiEndpoint,
      email: BASE_EXPORT_OPTIONS.session.email,
      password: BASE_EXPORT_OPTIONS.session.password,
      orgName: BASE_EXPORT_OPTIONS.session.orgName,
      spaceName: BASE_EXPORT_OPTIONS.session.spaceName,
      cfHomeDir: BASE_EXPORT_OPTIONS.session.cfHomeDir,
      forceReauth: true,
    });
    expect(prepareCfCliSessionMock).toHaveBeenNthCalledWith(3, {
      apiEndpoint: BASE_EXPORT_OPTIONS.session.apiEndpoint,
      email: BASE_EXPORT_OPTIONS.session.email,
      password: BASE_EXPORT_OPTIONS.session.password,
      orgName: BASE_EXPORT_OPTIONS.session.orgName,
      spaceName: BASE_EXPORT_OPTIONS.session.spaceName,
      cfHomeDir: BASE_EXPORT_OPTIONS.session.cfHomeDir,
      forceReauth: true,
    });
    expect(fetchDefaultEnvJsonFromTargetMock).toHaveBeenCalledTimes(3);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(result.connection.name).toBe('finance-uat-api (us10)');
  });

  it('does not retry SQLTools export when default-env parsing fails', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce('not-json');

    await expect(exportSqlToolsConfig(BASE_EXPORT_OPTIONS)).rejects.toThrow(
      /Failed to parse default-env\.json/
    );

    expect(prepareCfCliSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchDefaultEnvJsonFromTargetMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('merges into existing settings.json preserving other keys', async () => {
    existsSyncMock.mockReturnValue(true);
    const existingSettings = JSON.stringify({
      'editor.tabSize': 2,
      'workbench.iconTheme': 'vscode-icons',
    });
    readFileMock.mockResolvedValueOnce(existingSettings);
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce(
      `${JSON.stringify(VALID_DEFAULT_ENV, null, 2)}\n`
    );

    await exportSqlToolsConfig(BASE_EXPORT_OPTIONS);

    const [, writtenContent] = writeFileMock.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    expect(parsed['editor.tabSize']).toBe(2);
    expect(parsed['workbench.iconTheme']).toBe('vscode-icons');
    expect(parsed['sqltools.useNodeRuntime']).toBe(true);
  });

  it('upserts (replaces) existing connection with same name in settings.json', async () => {
    existsSyncMock.mockReturnValue(true);
    const existingConn = {
      name: 'finance-uat-api (us10)',
      server: 'old-server.example.com',
      port: 443,
      driver: 'SAPHana',
    };
    const existingSettings = JSON.stringify({
      'sqltools.connections': [existingConn],
    });
    readFileMock.mockResolvedValueOnce(existingSettings);
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce(
      `${JSON.stringify(VALID_DEFAULT_ENV, null, 2)}\n`
    );

    await exportSqlToolsConfig(BASE_EXPORT_OPTIONS);

    const [, writtenContent] = writeFileMock.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    const connections = parsed['sqltools.connections'] as { server: string }[];
    expect(connections).toHaveLength(1);
    expect(connections[0]?.server).toBe(HANA_CREDENTIALS.host);
  });

  it('throws when default-env.json has no HANA binding', async () => {
    existsSyncMock.mockReturnValue(false);
    const noHanaPayload = { NODE_ENV: 'production', VCAP_SERVICES: {} };
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce(
      `${JSON.stringify(noHanaPayload, null, 2)}\n`
    );

    await expect(exportSqlToolsConfig(BASE_EXPORT_OPTIONS)).rejects.toThrow(
      /No HANA service binding found/
    );
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('throws when default-env.json is not valid JSON', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce('not-json');

    await expect(exportSqlToolsConfig(BASE_EXPORT_OPTIONS)).rejects.toThrow(
      /Failed to parse default-env\.json/
    );
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('writes settings.json with 4-space indentation', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce(
      `${JSON.stringify(VALID_DEFAULT_ENV, null, 2)}\n`
    );

    await exportSqlToolsConfig(BASE_EXPORT_OPTIONS);

    const [, writtenContent] = writeFileMock.mock.calls[0] as [string, string, string];
    // 4-space indented JSON has its first key indented with 4 spaces
    expect(writtenContent).toMatch(/^    "/m);
  });

  it('does not create .vscode dir when it already exists', async () => {
    existsSyncMock.mockImplementation((path: string) => {
      return path === settingsPath || path === vscodeDirPath;
    });
    readFileMock.mockResolvedValueOnce('{}');
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce(
      `${JSON.stringify(VALID_DEFAULT_ENV, null, 2)}\n`
    );

    await exportSqlToolsConfig(BASE_EXPORT_OPTIONS);

    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it('returns the settings path and connection in the result', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchDefaultEnvJsonFromTargetMock.mockResolvedValueOnce(
      `${JSON.stringify(VALID_DEFAULT_ENV, null, 2)}\n`
    );

    const result = await exportSqlToolsConfig(BASE_EXPORT_OPTIONS);

    expect(result.settingsPath).toBe(settingsPath);
    expect(result.connection).toMatchObject({
      name: 'finance-uat-api (us10)',
      server: HANA_CREDENTIALS.host,
      port: 443,
      username: HANA_CREDENTIALS.user,
      database: HANA_CREDENTIALS.schema,
      driver: 'SAPHana',
    });
  });
});
