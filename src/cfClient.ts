// cspell:words guids hana ondemand sapcloud
// cspell:ignore clientid clientsecret
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
const REMOTE_FILE_CONTENT_SENTINEL = '__SAP_TOOLS_REMOTE_FILE_CONTENT__';

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
 * Serializes CF CLI session preparation per CF_HOME. All SAP Tools features
 * share a single CF_HOME (one `cf` config.json), so concurrent preparations
 * would race on the same file.
 */
const cfCliSessionQueues = new Map<string, Promise<void>>();

/**
 * Prepare CF CLI context for a specific API + org + space.
 * This is an expensive step and should be reused when possible.
 *
 * `cf api` transiently clears the auth token and the targeted org/space, so if
 * two preparations interleave on the shared CF_HOME, one `cf api` wipes the
 * other's freshly-set target. Downstream `cf logs`/`cf curl` calls then briefly
 * fail with "Not logged in" / "No org targeted" until a later attempt happens
 * to find a fully-prepared config. Chaining preparations per CF_HOME keeps the
 * api → auth → target triplet atomic and removes that race.
 */
export async function prepareCfCliSession(params: CfCliTargetParams): Promise<void> {
  const queueKey = params.cfHomeDir ?? '';
  const previous = cfCliSessionQueues.get(queueKey) ?? Promise.resolve();
  const run = previous.then(
    () => runCfCliSessionPreparation(params),
    () => runCfCliSessionPreparation(params)
  );
  // Store a non-rejecting tail so the next caller always chains, even on failure.
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  cfCliSessionQueues.set(queueKey, tail);
  void tail.then(() => {
    if (cfCliSessionQueues.get(queueKey) === tail) {
      cfCliSessionQueues.delete(queueKey);
    }
  });
  return run;
}

async function runCfCliSessionPreparation(params: CfCliTargetParams): Promise<void> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);

  await runCfCommand(['api', params.apiEndpoint], {
    ...cfHomeOptions,
    failureMessage: 'Failed to set CF API endpoint.',
  });

  if (params.email !== '' && params.password !== '') {
    await runCfCommand(['auth'], {
      ...cfHomeOptions,
      envOverrides: {
        CF_USERNAME: params.email,
        CF_PASSWORD: params.password,
      },
      failureMessage: 'Failed to authenticate Cloud Foundry CLI.',
    });
  }

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
 * Fetch a text file from the app container via CF SSH.
 * Requires CF CLI to be already targeted to the intended org/space.
 * Returns `null` when all candidate locations are missing or empty so callers can
 * opportunistically export optional CAP project metadata without failing the main
 * artifact export.
 */
export async function fetchRemoteTextFileFromTarget(params: {
  readonly appName: string;
  readonly fileName: string;
  readonly cfHomeDir?: string;
  readonly remoteRoot?: string;
}): Promise<string | null> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const fileCommands = buildRemoteTextFileCommands(params.fileName, params.remoteRoot);

  for (const command of fileCommands) {
    try {
      const stdout = await runCfCommand(['ssh', params.appName, '-c', command], {
        ...cfHomeOptions,
        failureMessage: `Failed to fetch ${params.fileName} for app "${params.appName}".`,
      });
      const content = parseRemoteTextFileContent(stdout);
      if (content !== null) {
        return content;
      }
    } catch {
      // Missing optional files are expected for some CAP apps; try the next location.
    }
  }

  return null;
}

/**
 * Fetch all remote .cds file contents from the app container via CF SSH.
 * Requires CF CLI to be already targeted to the intended org/space.
 */
export async function fetchRemoteCdsServicesFromTarget(params: {
  readonly appName: string;
  readonly cfHomeDir?: string;
}): Promise<string | null> {
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const command = `find / -maxdepth 7 \\( -path '*/node_modules' -o -path /proc -o -path /sys -o -path /dev \\) -prune -o -type f -name '*.cds' -print 2>/dev/null | xargs cat`;

  try {
    const stdout = await runCfCommand(['ssh', params.appName, '-c', command], {
      ...cfHomeOptions,
      failureMessage: `Failed to fetch remote .cds files for app "${params.appName}".`,
    });
    if (stdout.trim().length > 0) {
      return stdout;
    }
  } catch {
    // Ignore if not found or SSH fails
  }

  return null;
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

function buildRemoteTextFileCommands(fileName: string, remoteRoot: string | undefined): string[] {
  return buildRemoteFilePaths(fileName, remoteRoot).map(buildRemoteTextFileCommand);
}

function buildRemoteTextFileCommand(remoteFilePath: string): string {
  const quotedPath = quoteShellArg(remoteFilePath);
  return [
    `if [ -f ${quotedPath} ]; then`,
    `printf '%s\\n' ${quoteShellArg(REMOTE_FILE_CONTENT_SENTINEL)};`,
    `cat ${quotedPath};`,
    'else exit 66; fi',
  ].join(' ');
}

function parseRemoteTextFileContent(stdout: string): string | null {
  const sentinelPrefix = `${REMOTE_FILE_CONTENT_SENTINEL}\n`;
  return stdout.startsWith(sentinelPrefix) ? stdout.slice(sentinelPrefix.length) : null;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildPnpmLockCommands(remoteRoot: string | undefined): string[] {
  return buildRemoteFilePaths('pnpm-lock.yaml', remoteRoot).map((filePath) => `cat ${filePath}`);
}

function buildRemoteFilePaths(fileName: string, remoteRoot: string | undefined): string[] {
  const paths: string[] = [];
  const normalizedRoot = remoteRoot?.trim().replace(/\/+$/, '');
  if (normalizedRoot !== undefined && normalizedRoot.length > 0) {
    paths.push(`${normalizedRoot}/${fileName}`);
  }
  for (const fallback of [`/home/vcap/app/${fileName}`, fileName]) {
    if (!paths.includes(fallback)) {
      paths.push(fallback);
    }
  }
  return paths;
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

/**
 * Fetch the route URL for a specific app from Cloud Foundry.
 */
export async function fetchAppRouteUrlFromTarget(params: {
  readonly appName: string;
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
}): Promise<string | null> {
  await prepareCfCliSession(params);

  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const guidStdout = await runCfCommand(['app', params.appName, '--guid'], {
    ...cfHomeOptions,
    failureMessage: `Failed to fetch GUID for app ${params.appName}`,
  });
  const encodedGuid = encodeURIComponent(guidStdout.trim());

  const routesStdout = await runCfCommand(['curl', `/v3/apps/${encodedGuid}/routes`], {
    ...cfHomeOptions,
    failureMessage: `Failed to fetch routes for app ${params.appName}`,
  });

  try {
    const routesData = JSON.parse(routesStdout) as unknown;
    if (
      typeof routesData === 'object' &&
      routesData !== null &&
      'resources' in routesData &&
      Array.isArray((routesData as { resources: unknown[] }).resources) &&
      (routesData as { resources: unknown[] }).resources.length > 0
    ) {
      const firstResource = (routesData as { resources: { url?: string }[] }).resources[0];
      if (firstResource !== undefined && typeof firstResource.url === 'string') {
        return firstResource.url;
      }
    }
  } catch {
    // Ignore JSON parse errors
  }

  return null;
}

export async function fetchCfOauthTokenFromTarget(params: {
  apiEndpoint: string;
  email: string;
  password: string;
  orgName: string;
  spaceName: string;
  cfHomeDir?: string;
}): Promise<string | null> {
  await prepareCfCliSession(params);
  const homeDir = params.cfHomeDir ?? process.env['CF_HOME'] ?? process.cwd();

  try {
    const { stdout } = await execFileAsync('cf', ['oauth-token'], {
      env: { ...process.env, CF_HOME: homeDir },
      timeout: 5000
    });
    const token = stdout.trim();
    if (token.startsWith('bearer ') || token.startsWith('Bearer ')) {
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchXsuaaTokenFromTarget(params: {
  appName: string;
  apiEndpoint: string;
  email: string;
  password: string;
  orgName: string;
  spaceName: string;
  cfHomeDir?: string;
}): Promise<string | null> {
  await prepareCfCliSession(params);
  
  const cfHomeOptions = buildCfHomeOptions(params.cfHomeDir);
  const envStdout = await runCfCommand(['env', params.appName], {
    ...cfHomeOptions,
    failureMessage: `Failed to fetch env for app ${params.appName}`,
  });

  try {
    const vcapMatch = /System-Provided:\n([\s\S]*?)\n\n/.exec(envStdout);
    if (vcapMatch?.[1] === undefined || vcapMatch[1] === '') return null;
    
    const vcapStr = vcapMatch[1];
    const startIdx = vcapStr.indexOf('VCAP_SERVICES:');
    if (startIdx === -1) return null;
    
    const objStart = vcapStr.indexOf('{', startIdx);
    if (objStart === -1) return null;

    const nextKeyMatch = /\n[A-Z_]+:\s*\{/.exec(vcapStr.substring(objStart));
    const objEnd = nextKeyMatch !== null ? objStart + nextKeyMatch.index : vcapStr.length;
    
    const vcapServicesStr = vcapStr.substring(objStart, objEnd).trim();
    const vcapServices = JSON.parse(vcapServicesStr) as Record<string, unknown[]>;


    const xsuaaList = vcapServices['xsuaa'];
    if (!Array.isArray(xsuaaList) || xsuaaList.length === 0) return null;

    const credentials = (xsuaaList[0] as { credentials?: Record<string, string> }).credentials;
    if (credentials === undefined) return null;

    const clientid = credentials['clientid'];
    const clientsecret = credentials['clientsecret'];
    const url = credentials['url'];

    if (clientid === undefined || clientid === '' || clientsecret === undefined || clientsecret === '' || url === undefined || url === '') {
      return null;
    }

    const basicAuth = Buffer.from(`${clientid}:${clientsecret}`).toString('base64');
    
    const res = await fetch(`${url}/oauth/token?grant_type=client_credentials`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      }
    });

    if (res.ok) {
      const data = await res.json() as { access_token?: string };
      if (typeof data.access_token === 'string') {
        return `Bearer ${data.access_token}`;
      }
    }
  } catch {
    // Ignore parse or network errors
  }
  
  return null;
}
