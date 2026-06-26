// cspell:words sqltools hana ondemand openssl
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { fetchDefaultEnvJsonFromTarget } from './cfClient';
import { runWithCfCliAuthRecovery } from './cfCliAuthRecovery';
import type { ServiceExportSession } from './serviceArtifactExporter';

// ── Fixed SQLTools constants (mirrors 01-saptools/src/vscode.ts) ────────────

const HANA_OPTIONS = {
  encrypt: true,
  sslValidateCertificate: true,
  sslCryptoProvider: 'openssl',
} as const;

const CONNECTION_TIMEOUT = 30;
const PREVIEW_LIMIT = 50;
const DRIVER = 'SAPHana';

// ── Data structures ──────────────────────────────────────────────────────────

export interface SqlToolsConnection {
  readonly connectionTimeout: number;
  readonly hanaOptions: {
    readonly encrypt: boolean;
    readonly sslValidateCertificate: boolean;
    readonly sslCryptoProvider: string;
  };
  readonly previewLimit: number;
  readonly driver: string;
  readonly name: string;
  readonly server: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
}

interface HanaCredentials {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly password: string;
  readonly schema: string;
}

type SqlToolsConnectionEntry = Record<string, unknown> & {
  readonly name: string;
};

export interface SqlToolsConfigExportOptions {
  readonly appName: string;
  readonly regionCode: string;
  readonly rootFolderPath: string;
  readonly session: ServiceExportSession;
}

export interface SqlToolsConfigExportResult {
  readonly settingsPath: string;
  readonly connection: SqlToolsConnection;
}

// ── Conversion ───────────────────────────────────────────────────────────────

export function toSqlToolsConnection(
  appName: string,
  regionCode: string,
  credentials: HanaCredentials
): SqlToolsConnection {
  const normalizedRegionCode = toSqlToolsRegionKey(regionCode);

  return {
    connectionTimeout: CONNECTION_TIMEOUT,
    hanaOptions: HANA_OPTIONS,
    previewLimit: PREVIEW_LIMIT,
    driver: DRIVER,
    name: `${appName} (${normalizedRegionCode})`,
    server: credentials.host,
    port: parseInt(credentials.port, 10),
    username: credentials.user,
    password: credentials.password,
    database: credentials.schema,
  };
}

// ── HANA credential extraction from default-env.json ────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract HANA credentials from a parsed default-env.json payload.
 *
 * The payload has the shape: `{ "VCAP_SERVICES": { "hana": [{ "credentials": {...} }] } }`.
 * Returns the first HANA binding's credentials, or null if not present.
 */
export function extractHanaCredentialsFromDefaultEnv(
  payload: Record<string, unknown>
): HanaCredentials | null {
  const vcap = payload['VCAP_SERVICES'];
  if (!isRecord(vcap)) {
    return null;
  }

  const hanaBindings = vcap['hana'];
  if (!Array.isArray(hanaBindings) || hanaBindings.length === 0) {
    return null;
  }

  // Explicit unknown annotation avoids the any[] narrowing from Array.isArray
  const binding: unknown = hanaBindings[0];
  if (!isRecord(binding)) {
    return null;
  }

  const credentials = binding['credentials'];
  if (!isRecord(credentials)) {
    return null;
  }

  const host = credentials['host'];
  const port = credentials['port'];
  const user = credentials['user'];
  const password = credentials['password'];
  const schema = credentials['schema'];

  if (
    typeof host !== 'string' || host.length === 0 ||
    typeof port !== 'string' || port.length === 0 ||
    typeof user !== 'string' || user.length === 0 ||
    typeof password !== 'string' ||
    typeof schema !== 'string' || schema.length === 0
  ) {
    return null;
  }

  return { host, port, user, password, schema };
}

// ── .vscode/settings.json I/O ────────────────────────────────────────────────

async function readVscodeSettings(
  settingsPath: string
): Promise<Record<string, unknown>> {
  if (!existsSync(settingsPath)) {
    return {};
  }

  const raw = await readFile(settingsPath, 'utf-8');

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeVscodeSettings(
  settingsPath: string,
  settings: Record<string, unknown>
): Promise<void> {
  const vscodeDir = join(settingsPath, '..');

  if (!existsSync(vscodeDir)) {
    await mkdir(vscodeDir, { recursive: true });
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 4), 'utf-8');
}

/**
 * Upsert a single SQLTools connection into .vscode/settings.json.
 *
 * Match is by connection name. If an entry with the same name already exists
 * it is replaced; otherwise the new connection is appended to the array.
 * All other settings in the file are preserved.
 */
export function upsertSqlToolsConnection(
  existing: Record<string, unknown>,
  newConnection: SqlToolsConnection
): Record<string, unknown> {
  const rawConnections = existing['sqltools.connections'];
  const connections: SqlToolsConnectionEntry[] = Array.isArray(rawConnections)
    ? rawConnections.filter(isSqlToolsConnectionEntry)
    : [];
  const normalizedConnection: SqlToolsConnectionEntry = { ...newConnection };

  const idx = connections.findIndex((connection) => {
    return connection.name === normalizedConnection.name;
  });
  const updated =
    idx >= 0
      ? connections.map((connection, index) => {
          return index === idx ? normalizedConnection : connection;
        })
      : [...connections, normalizedConnection];

  return {
    ...existing,
    'sqltools.useNodeRuntime': true,
    'sqltools.connections': updated,
  };
}

function toSqlToolsRegionKey(regionCode: string): string {
  return regionCode.replaceAll('-', '').trim().toLowerCase();
}

function isSqlToolsConnectionEntry(value: unknown): value is SqlToolsConnectionEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const maybeConnection = value as { readonly name?: unknown };
  return typeof maybeConnection.name === 'string' && maybeConnection.name.length > 0;
}

// ── Main export function ──────────────────────────────────────────────────────

/**
 * Export a SQLTools connection for the given app into the workspace-root
 * `.vscode/settings.json`.
 *
 * Flow:
 *  1. Prepare CF CLI session (api + auth + target org/space).
 *  2. Fetch default-env.json for the app from CF.
 *  3. Parse HANA credentials from VCAP_SERVICES.
 *  4. Convert to SqlToolsConnection.
 *  5. Upsert into rootFolderPath/.vscode/settings.json.
 */
export async function exportSqlToolsConfig(
  options: SqlToolsConfigExportOptions
): Promise<SqlToolsConfigExportResult> {
  return runWithCfCliAuthRecovery(options.session, () =>
    exportSqlToolsConfigAttempt(options)
  );
}

async function exportSqlToolsConfigAttempt(
  options: SqlToolsConfigExportOptions
): Promise<SqlToolsConfigExportResult> {
  const defaultEnvJson = await fetchDefaultEnvJsonFromTarget({
    appName: options.appName,
    cfHomeDir: options.session.cfHomeDir,
  });

  let parsedPayload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(defaultEnvJson) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('default-env.json is not a JSON object.');
    }
    parsedPayload = parsed;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse default-env.json for "${options.appName}": ${msg}`);
  }

  const credentials = extractHanaCredentialsFromDefaultEnv(parsedPayload);
  if (credentials === null) {
    throw new Error(
      `No HANA service binding found in default-env.json for "${options.appName}". ` +
        'Ensure the app is bound to a HANA service instance.'
    );
  }

  const connection = toSqlToolsConnection(options.appName, options.regionCode, credentials);
  const settingsPath = join(options.rootFolderPath, '.vscode', 'settings.json');
  const existing = await readVscodeSettings(settingsPath);
  const updated = upsertSqlToolsConnection(existing, connection);
  await writeVscodeSettings(settingsPath, updated);

  return { settingsPath, connection };
}
