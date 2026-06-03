// cspell:words guids hana ondemand sapcloud
import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

import { parseCfAppsOutput } from './cfAppsParser';
import { logCfCommand } from './cfCommandLogger';
export { parseCfAppsOutput } from './cfAppsParser';
export { configureCfCommandLogger } from './cfCommandLogger';
export { getCfApiEndpoint } from './cfEndpoint';

const execFileAsync = promisify(execFile);

const CF_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const CF_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Lists every package.json inside the running app container (excluding noisy mount
 * points and node_modules). Shared in shape with the cds-debug extension so a regex
 * `remoteRoot` resolves to the same folder in both tools.
 */
const REMOTE_PACKAGE_JSON_FIND_COMMAND = [
  'find / -maxdepth 7',
  "\\( -path '*/node_modules' -o -path /proc -o -path /sys -o -path /dev \\) -prune -o",
  '-type f',
  '-name package.json',
  '-print 2>/dev/null',
].join(' ');

const DEFAULT_PNPM_LOCK_COMMANDS = [
  'cat /home/vcap/app/pnpm-lock.yaml',
  'cat pnpm-lock.yaml',
] as const;
const CF_API_REQUEST_TIMEOUT_MS = 20_000;
const CF_V3_PAGE_SIZE = 200;
const CF_RETRY_MAX_ATTEMPTS = 3;
const CF_RETRY_BASE_DELAY_MS = 120;

interface CfCliExecutionOptions {
  readonly cfHomeDir?: string;
  readonly envOverrides?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly failureMessage: string;
}

interface CfCliTargetParams {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
}

export interface CfLoginInfo {
  readonly authorizationEndpoint: string;
}

export interface CfToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

export interface CfOrg {
  readonly guid: string;
  readonly name: string;
}

export interface CfSpace {
  readonly guid: string;
  readonly name: string;
}

export interface CfSession {
  readonly token: CfToken;
  readonly apiEndpoint: string;
}

const CF_TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * A cached CF session is unusable once its access token is at (or near) its
 * expiry. CF API calls do not refresh tokens, so a stale token surfaces as a
 * 401 and must trigger a fresh login instead of being reused.
 */
export function isCfSessionExpired(
  session: CfSession,
  nowMs: number = Date.now()
): boolean {
  return session.token.expiresAt <= nowMs + CF_TOKEN_EXPIRY_SAFETY_MARGIN_MS;
}

export interface CfRunningApp {
  readonly name: string;
  readonly runningInstances: number;
}

export interface CfLogStreamHandle {
  readonly process: ChildProcessWithoutNullStreams;
  stop(): void;
}

/**
 * Fetch CF API /v2/info to discover the UAA authorization endpoint.
 */
export async function fetchCfLoginInfo(apiEndpoint: string): Promise<CfLoginInfo> {
  const response = await fetchCfApi(`${apiEndpoint}/v2/info`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CF API info request failed with status ${String(response.status)}.`);
  }

  const data = await response.json();
  if (!isRecord(data) || typeof data['authorization_endpoint'] !== 'string') {
    throw new Error('Unexpected CF API info response format.');
  }

  return { authorizationEndpoint: data['authorization_endpoint'] };
}

/**
 * Authenticate against the UAA endpoint using resource owner password grant.
 * Uses the public CF client (client_id=cf, client_secret=empty).
 */
export async function cfLogin(
  authorizationEndpoint: string,
  email: string,
  password: string
): Promise<CfToken> {
  const clientCredentials = btoa('cf:');
  const body = new URLSearchParams({
    grant_type: 'password',
    username: email,
    password,
    scope: '',
  });

  const response = await fetchCfApi(`${authorizationEndpoint}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${clientCredentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const isAuthError = response.status === 401 || response.status === 400;
    const message = isAuthError
      ? 'Invalid SAP credentials. Check your email and password.'
      : `CF authentication failed with status ${String(response.status)}.`;
    throw new Error(message + (errorText.length > 0 ? ` (${errorText.slice(0, 120)})` : ''));
  }

  const data = await response.json();
  if (
    !isRecord(data) ||
    typeof data['access_token'] !== 'string' ||
    typeof data['expires_in'] !== 'number'
  ) {
    throw new Error('Unexpected UAA token response format.');
  }

  return {
    accessToken: data['access_token'],
    refreshToken: typeof data['refresh_token'] === 'string' ? data['refresh_token'] : '',
    expiresAt: Date.now() + data['expires_in'] * 1000,
  };
}

/**
 * Fetch all CF organizations visible to the authenticated user.
 */
export async function fetchOrgs(session: CfSession): Promise<CfOrg[]> {
  const v3Resources = await fetchV3Resources(
    session,
    `/v3/organizations?order_by=name&per_page=${String(CF_V3_PAGE_SIZE)}`,
    'Failed to fetch CF organizations'
  );
  return mapV3NamedResources(v3Resources);
}

/**
 * Fetch all CF spaces within the given organization.
 */
export async function fetchSpaces(session: CfSession, orgGuid: string): Promise<CfSpace[]> {
  const encodedOrgGuid = encodeURIComponent(orgGuid);
  const v3Resources = await fetchV3Resources(
    session,
    `/v3/spaces?organization_guids=${encodedOrgGuid}&order_by=name&per_page=${String(CF_V3_PAGE_SIZE)}`,
    'Failed to fetch CF spaces'
  );
  return mapV3NamedResources(v3Resources);
}

/**
 * Fetch apps from Cloud Foundry CLI and return only effectively running apps:
 * requested state is `started` and running instances > 0.
 */
export async function fetchStartedAppsViaCfCli(params: {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
}): Promise<CfRunningApp[]> {
  await prepareCfCliSession(params);

  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const appsStdout = await runCfCommand(['apps'], {
    ...cfHomeOptions,
    failureMessage: 'Failed to fetch apps from CF CLI.',
  });

  return parseCfAppsOutput(appsStdout)
    .filter((row) => row.requestedState === 'started' && row.runningInstances > 0)
    .map((row) => ({ name: row.name, runningInstances: row.runningInstances }));
}

/**
 * Prepare CF CLI context for a specific API + org + space.
 * This is an expensive step and should be reused when possible.
 */
export async function prepareCfCliSession(params: CfCliTargetParams): Promise<void> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);

  await runCfCommand(['api', params.apiEndpoint], {
    ...cfHomeOptions,
    failureMessage: 'Failed to set CF API endpoint.',
  });

  await runCfCommand(['auth'], {
    ...cfHomeOptions,
    envOverrides: {
      CF_USERNAME: params.email,
      CF_PASSWORD: params.password,
    },
    failureMessage: 'Failed to authenticate Cloud Foundry CLI.',
  });

  await runCfCommand(['target', '-o', params.orgName, '-s', params.spaceName], {
    ...cfHomeOptions,
    failureMessage: 'Failed to target CF org/space.',
  });
}

/**
 * Fetch recent logs for a Cloud Foundry application using the CF CLI.
 * Returns the raw log text from `cf logs APP_NAME --recent`.
 */
export async function fetchRecentAppLogs(params: {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly appName: string;
  readonly cfHomeDir?: string;
}): Promise<string> {
  await prepareCfCliSession(params);
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  return fetchRecentAppLogsFromTarget({
    appName: params.appName,
    ...cfHomeOptions,
  });
}

/**
 * Fetch recent logs assuming CF CLI has already been targeted.
 */
export async function fetchRecentAppLogsFromTarget(params: {
  readonly appName: string;
  readonly cfHomeDir?: string;
}): Promise<string> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);

  return runCfCommand(['logs', params.appName, '--recent'], {
    ...cfHomeOptions,
    failureMessage: `Failed to fetch recent logs for app "${params.appName}".`,
  });
}

/**
 * Fetch a synthesized default-env.json payload for an app from CF runtime environment data.
 * Requires CF CLI to be already targeted to the intended org/space.
 */
export async function fetchDefaultEnvJsonFromTarget(params: {
  readonly appName: string;
  readonly cfHomeDir?: string;
}): Promise<string> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const appGuidStdout = await runCfCommand(['app', params.appName, '--guid'], {
    ...cfHomeOptions,
    failureMessage: `Failed to resolve app GUID for "${params.appName}".`,
  });
  const appGuid = appGuidStdout.trim();
  if (appGuid.length === 0) {
    throw new Error(`CF returned an empty app GUID for "${params.appName}".`);
  }

  const encodedGuid = encodeURIComponent(appGuid);
  const appEnvStdout = await runCfCommand(['curl', `/v3/apps/${encodedGuid}/env`], {
    ...cfHomeOptions,
    failureMessage: `Failed to fetch CF environment for app "${params.appName}".`,
  });

  const appEnvPayload = parseJsonRecord(appEnvStdout, 'CF app environment payload');
  const defaultEnvPayload = buildDefaultEnvPayload(appEnvPayload);

  return `${JSON.stringify(defaultEnvPayload, null, 2)}\n`;
}

/**
 * List the absolute paths of every package.json inside the running app container.
 * Requires CF CLI to be already targeted to the intended org/space. Used to resolve
 * a regex `remoteRoot` to a concrete container folder.
 */
export async function findRemotePackageJsonPathsFromTarget(params: {
  readonly appName: string;
  readonly cfHomeDir?: string;
}): Promise<string[]> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const stdout = await runCfCommand(
    ['ssh', params.appName, '-c', REMOTE_PACKAGE_JSON_FIND_COMMAND],
    {
      ...cfHomeOptions,
      failureMessage: `Failed to list package.json paths for app "${params.appName}".`,
    }
  );

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Fetch pnpm-lock.yaml from the app container via CF SSH.
 * Requires CF CLI to be already targeted to the intended org/space.
 * When `remoteRoot` is provided it is tried first, then the standard locations.
 */
export async function fetchPnpmLockFromTarget(params: {
  readonly appName: string;
  readonly cfHomeDir?: string;
  readonly remoteRoot?: string;
}): Promise<string> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const lockFileCommands = buildPnpmLockCommands(params.remoteRoot);

  const errors: string[] = [];
  for (const command of lockFileCommands) {
    try {
      const content = await runCfCommand(['ssh', params.appName, '-c', command], {
        ...cfHomeOptions,
        failureMessage: `Failed to fetch pnpm-lock.yaml for app "${params.appName}".`,
      });
      if (content.trim().length > 0) {
        return content;
      }
      errors.push(`CF SSH command returned empty content: ${command}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown CF SSH command error.';
      errors.push(errorMessage);
    }
  }

  const errorDetail = errors.length > 0 ? ` (${errors.join(' | ')})` : '';
  throw new Error(
    `Unable to read pnpm-lock.yaml from app "${params.appName}". Ensure SSH is enabled and the file exists in the app container.${errorDetail}`
  );
}

/**
 * Spawn long-running `cf logs <app>` stream process.
 * Requires CF target to be prepared beforehand.
 */
export function spawnAppLogStreamFromTarget(params: {
  readonly appName: string;
  readonly cfHomeDir?: string;
}): CfLogStreamHandle {
  const env = buildCfCliEnv(params.cfHomeDir, undefined);
  logCfCommand(['logs', params.appName]);
  const process = spawn('cf', ['logs', params.appName], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    process,
    stop(): void {
      if (!process.killed) {
        process.kill();
      }
    },
  };
}

async function runCfCommand(
  args: string[],
  options: CfCliExecutionOptions
): Promise<string> {
  const env = buildCfCliEnv(options.cfHomeDir, options.envOverrides);
  const maxAttempts = CF_RETRY_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logCfCommand(args);
    try {
      const { stdout } = await execFileAsync('cf', args, {
        env,
        maxBuffer: CF_MAX_BUFFER_BYTES,
        timeout: options.timeoutMs ?? CF_COMMAND_TIMEOUT_MS,
      });
      return stdout;
    } catch (error) {
      const safeDetail = extractSafeCliDetail(error);
      const detailSuffix = safeDetail.length > 0 ? ` ${safeDetail}` : '';
      const retryable = shouldRetryCfCliError(error);
      if (retryable && attempt < maxAttempts) {
        await sleep(resolveRetryDelayMs(attempt));
        continue;
      }
      throw new Error(`${options.failureMessage}${detailSuffix}`);
    }
  }

  throw new Error(options.failureMessage);
}

function buildCfCliEnv(
  cfHomeDir: string | undefined,
  envOverrides: Record<string, string> | undefined
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (typeof cfHomeDir === 'string' && cfHomeDir.length > 0) {
    env['CF_HOME'] = cfHomeDir;
  }
  if (envOverrides !== undefined) {
    for (const [key, value] of Object.entries(envOverrides)) {
      env[key] = value;
    }
  }
  return env;
}

function extractSafeCliDetail(error: unknown): string {
  if (!isRecord(error)) {
    return '';
  }

  const stderr = typeof error['stderr'] === 'string' ? error['stderr'] : '';
  const normalized = stderr.replaceAll(/\s+/g, ' ').trim();

  if (normalized.length === 0) {
    return '';
  }

  return `(cli: ${normalized.slice(0, 180)})`;
}

function buildPnpmLockCommands(remoteRoot: string | undefined): string[] {
  const commands: string[] = [];
  const normalizedRoot = remoteRoot?.trim().replace(/\/+$/, '');
  if (normalizedRoot !== undefined && normalizedRoot.length > 0) {
    commands.push(`cat ${normalizedRoot}/pnpm-lock.yaml`);
  }
  for (const fallback of DEFAULT_PNPM_LOCK_COMMANDS) {
    if (!commands.includes(fallback)) {
      commands.push(fallback);
    }
  }
  return commands;
}

function buildCfHomeOptions(cfHomeDir: string | undefined): Pick<CfCliExecutionOptions, 'cfHomeDir'> {
  if (typeof cfHomeDir === 'string' && cfHomeDir.length > 0) {
    return { cfHomeDir };
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchV3Resources(
  session: CfSession,
  relativeUrl: string,
  failureMessage: string
): Promise<Record<string, unknown>[]> {
  const visitedUrls = new Set<string>();
  const resources: Record<string, unknown>[] = [];
  let nextPageUrl = `${session.apiEndpoint}${relativeUrl}`;

  while (nextPageUrl.length > 0) {
    if (visitedUrls.has(nextPageUrl)) {
      throw new Error(`${failureMessage} (v3 pagination loop detected).`);
    }
    visitedUrls.add(nextPageUrl);

    const response = await fetchCfApi(nextPageUrl, {
      headers: buildCfAuthHeaders(session.token.accessToken),
    });

    if (!response.ok) {
      throw new Error(`${failureMessage} (status ${String(response.status)}).`);
    }

    const payload = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload['resources'])) {
      throw new Error(`Unexpected v3 response format for ${failureMessage.toLowerCase()}.`);
    }

    for (const resource of payload['resources']) {
      if (isRecord(resource)) {
        resources.push(resource);
      }
    }

    nextPageUrl = resolveV3NextPageUrl(payload['pagination'], session.apiEndpoint);
  }

  return resources;
}

function mapV3NamedResources(resources: readonly Record<string, unknown>[]): CfOrg[] {
  const items: CfOrg[] = [];
  for (const resource of resources) {
    const guid = resource['guid'];
    const name = resource['name'];
    if (typeof guid === 'string' && typeof name === 'string') {
      items.push({ guid, name });
    }
  }
  return items;
}

function resolveV3NextPageUrl(pagination: unknown, apiEndpoint: string): string {
  if (!isRecord(pagination)) {
    return '';
  }
  const next = pagination['next'];
  if (!isRecord(next) || typeof next['href'] !== 'string') {
    return '';
  }
  const href = next['href'];
  if (href.length === 0) {
    return '';
  }
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  return `${apiEndpoint}${href}`;
}

function buildCfAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

function parseJsonRecord(jsonText: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Unexpected JSON format for ${label}.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Unexpected JSON object format for ${label}.`);
  }

  return parsed;
}

function buildDefaultEnvPayload(appEnvPayload: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  mergeRecordIntoPayload(payload, appEnvPayload['system_env_json']);
  mergeRecordIntoPayload(payload, appEnvPayload['environment_variables']);
  mergeRecordIntoPayload(payload, appEnvPayload['running_env_json']);
  mergeRecordIntoPayload(payload, appEnvPayload['staging_env_json']);

  if (Object.keys(payload).length === 0) {
    throw new Error('No environment variables found to build default-env.json.');
  }

  return payload;
}

function mergeRecordIntoPayload(
  payload: Record<string, unknown>,
  source: unknown
): void {
  if (!isRecord(source)) {
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    payload[key] = value;
  }
}

async function fetchCfApi(url: string, init: RequestInit): Promise<Response> {
  const maxAttempts = CF_RETRY_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, CF_API_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const retryableStatus = shouldRetryHttpStatus(response.status);
      if (retryableStatus && attempt < maxAttempts) {
        await sleep(resolveRetryDelayMs(attempt));
        continue;
      }
      return response;
    } catch (error) {
      const requestError = isAbortError(error)
        ? new Error(`CF API request timed out after ${String(CF_API_REQUEST_TIMEOUT_MS)}ms.`)
        : error;

      if (shouldRetryCfApiError(requestError) && attempt < maxAttempts) {
        await sleep(resolveRetryDelayMs(attempt));
        continue;
      }

      throw requestError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('CF API request failed after retry attempts.');
}

function isAbortError(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error['name'] === 'string' &&
    error['name'].toLowerCase() === 'aborterror'
  );
}

function shouldRetryHttpStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function shouldRetryCfApiError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('temporarily unavailable')
  );
}

function shouldRetryCfCliError(error: unknown): boolean {
  if (!(error instanceof Error) && !isRecord(error)) {
    return false;
  }

  const stderr =
    typeof (isRecord(error) ? error['stderr'] : undefined) === 'string'
      ? String((error as Record<string, unknown>)['stderr'])
      : '';
  const message =
    `${stderr} ${error instanceof Error ? error.message : ''}`.toLowerCase();

  if (
    message.includes('invalid') ||
    message.includes('credentials were rejected') ||
    message.includes('authentication failed') ||
    message.includes('not authorized') ||
    message.includes('forbidden')
  ) {
    return false;
  }

  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('connection reset') ||
    message.includes('temporarily unavailable') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('econnrefused')
  );
}

function resolveRetryDelayMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * CF_RETRY_BASE_DELAY_MS);
  return CF_RETRY_BASE_DELAY_MS * attempt + jitter;
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
