export type MicrosoftGraphToolId = 'outlook' | 'sharepoint';
export type MicrosoftGraphStepStatus = 'running' | 'done' | 'failed';

export interface MicrosoftGraphToolStepProgress {
  readonly toolId: MicrosoftGraphToolId;
  readonly stepId: string;
  readonly status: MicrosoftGraphStepStatus;
  readonly message: string;
}

export interface OutlookToolInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantId: string;
  readonly senderEmail: string;
  readonly recipientEmail: string;
}

export interface SharePointToolInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantId: string;
  readonly url: string;
  readonly site: string;
  readonly rootDir: string;
}

export type MicrosoftGraphToolRunRequest =
  | { readonly toolId: 'outlook'; readonly input: OutlookToolInput }
  | { readonly toolId: 'sharepoint'; readonly input: SharePointToolInput };

export interface MicrosoftGraphToolRunResult {
  readonly success: boolean;
  readonly toolId: MicrosoftGraphToolId;
  readonly message: string;
}

export type MicrosoftGraphFetch = (
  url: string,
  init: RequestInit
) => Promise<Response>;

export interface RunMicrosoftGraphToolOptions {
  readonly fetch?: MicrosoftGraphFetch;
  readonly onProgress?: (progress: MicrosoftGraphToolStepProgress) => void | Promise<void>;
  readonly now?: () => number;
}

export function readMicrosoftGraphToolRunRequest(
  value: unknown
): MicrosoftGraphToolRunRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const toolId = value['toolId'];
  const input = value['input'];
  if (toolId === 'outlook' && isRecord(input)) {
    return { toolId, input: readOutlookMessageInput(input) };
  }
  if (toolId === 'sharepoint' && isRecord(input)) {
    return { toolId, input: readSharePointMessageInput(input) };
  }
  return null;
}

interface GraphRunContext {
  readonly toolId: MicrosoftGraphToolId;
  readonly fetch: MicrosoftGraphFetch;
  readonly onProgress: (progress: MicrosoftGraphToolStepProgress) => void | Promise<void>;
  readonly now: () => number;
}

interface GraphStep<T> {
  readonly id: string;
  readonly label: string;
  readonly run: () => Promise<T>;
  readonly doneMessage: string;
}

class MicrosoftGraphStepError extends Error {
  constructor(
    readonly stepId: string,
    readonly stepLabel: string,
    message: string
  ) {
    super(message);
    this.name = 'MicrosoftGraphStepError';
  }
}

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

export async function runMicrosoftGraphTool(
  request: MicrosoftGraphToolRunRequest,
  options: RunMicrosoftGraphToolOptions = {}
): Promise<MicrosoftGraphToolRunResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failureResult(request.toolId, 'Microsoft Graph fetch runtime is unavailable.');
  }

  const context: GraphRunContext = {
    toolId: request.toolId,
    fetch: fetchImpl,
    onProgress: options.onProgress ?? ((): void => undefined),
    now: options.now ?? Date.now,
  };

  try {
    if (request.toolId === 'outlook') {
      return await runOutlookTool(context, request.input);
    }
    return await runSharePointTool(context, request.input);
  } catch (error: unknown) {
    return failureResult(request.toolId, buildToolFailureMessage(request.toolId, error));
  }
}

async function runOutlookTool(
  context: GraphRunContext,
  rawInput: OutlookToolInput
): Promise<MicrosoftGraphToolRunResult> {
  const input = normalizeOutlookInput(rawInput);
  const token = await runGraphStep(context, tokenStep(() => acquireToken(context, input)));
  await runGraphStep(context, mailStep(() => sendOutlookTestMail(context, token, input)));

  return {
    success: true,
    toolId: 'outlook',
    message: 'Outlook test completed. Test email was sent.',
  };
}

async function runSharePointTool(
  context: GraphRunContext,
  rawInput: SharePointToolInput
): Promise<MicrosoftGraphToolRunResult> {
  const input = normalizeSharePointInput(rawInput);
  const token = await runGraphStep(context, tokenStep(() => acquireToken(context, input)));
  const siteId = await runGraphStep(context, siteStep(() => resolveSharePointSite(context, token, input)));
  await runGraphStep(context, driveStep(() => resolveSharePointDrive(context, token, siteId)));
  const rootId = await runGraphStep(context, rootStep(() => resolveSharePointRoot(context, token, siteId, input)));
  const folderName = `sap-tools-graph-check-${String(context.now())}`;
  const folderId = await runGraphStep(context, folderStep(() => createSharePointFolder(context, token, siteId, rootId, folderName)));
  const fileId = await runGraphStep(context, fileStep(() => uploadSharePointFile(context, token, siteId, folderId)));
  await runGraphStep(context, deleteFileStep(() => deleteSharePointItem(context, token, siteId, fileId)));
  await runGraphStep(context, deleteFolderStep(() => deleteSharePointItem(context, token, siteId, folderId)));

  return {
    success: true,
    toolId: 'sharepoint',
    message: 'SharePoint test completed. Test folder and file were cleaned up.',
  };
}

async function runGraphStep<T>(
  context: GraphRunContext,
  step: GraphStep<T>
): Promise<T> {
  await emitProgress(context, step.id, 'running', 'Running');
  try {
    const result = await step.run();
    await emitProgress(context, step.id, 'done', step.doneMessage);
    return result;
  } catch (error: unknown) {
    const message = toSafeGraphErrorMessage(step.label, error);
    await emitProgress(context, step.id, 'failed', message);
    throw new MicrosoftGraphStepError(step.id, step.label, message);
  }
}

async function acquireToken(
  context: GraphRunContext,
  input: { readonly clientId: string; readonly clientSecret: string; readonly tenantId: string }
): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    scope: GRAPH_SCOPE,
    grant_type: 'client_credentials',
  });
  const payload = await requestJson(
    context.fetch,
    `https://login.microsoftonline.com/${encodeURIComponent(input.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', headers: formHeaders(), body },
    'OAuth2 token request'
  );
  return readRequiredString(payload, 'access_token', 'OAuth2 token response');
}

async function sendOutlookTestMail(
  context: GraphRunContext,
  token: string,
  input: OutlookToolInput
): Promise<void> {
  await requestNoContent(
    context.fetch,
    graphUrl(`/users/${encodeURIComponent(input.senderEmail)}/sendMail`),
    {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify(buildSendMailPayload(input.recipientEmail)),
    },
    'Outlook sendMail request'
  );
}

async function resolveSharePointSite(
  context: GraphRunContext,
  token: string,
  input: NormalizedSharePointInput
): Promise<string> {
  const payload = await requestJson(
    context.fetch,
    graphUrl(`/sites/${input.hostname}:${input.sitePath}`),
    { method: 'GET', headers: authHeaders(token) },
    'SharePoint site lookup'
  );
  return readRequiredString(payload, 'id', 'SharePoint site response');
}

async function resolveSharePointDrive(
  context: GraphRunContext,
  token: string,
  siteId: string
): Promise<string> {
  const payload = await requestJson(
    context.fetch,
    graphUrl(`/sites/${encodeURIComponent(siteId)}/drive`),
    { method: 'GET', headers: authHeaders(token) },
    'SharePoint drive lookup'
  );
  return readRequiredString(payload, 'id', 'SharePoint drive response');
}

async function resolveSharePointRoot(
  context: GraphRunContext,
  token: string,
  siteId: string,
  input: NormalizedSharePointInput
): Promise<string> {
  const rootPath = input.rootPath.length === 0 ? '/root' : `/root:${input.rootPath}`;
  const payload = await requestJson(
    context.fetch,
    graphUrl(`/sites/${encodeURIComponent(siteId)}/drive${rootPath}`),
    { method: 'GET', headers: authHeaders(token) },
    'SharePoint root directory lookup'
  );
  return readRequiredString(payload, 'id', 'SharePoint root directory response');
}

async function createSharePointFolder(
  context: GraphRunContext,
  token: string,
  siteId: string,
  rootId: string,
  folderName: string
): Promise<string> {
  const payload = await requestJson(
    context.fetch,
    graphUrl(`/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(rootId)}/children`),
    { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify(buildFolderPayload(folderName)) },
    'SharePoint create folder request'
  );
  return readRequiredString(payload, 'id', 'SharePoint create folder response');
}

async function uploadSharePointFile(
  context: GraphRunContext,
  token: string,
  siteId: string,
  folderId: string
): Promise<string> {
  const payload = await requestJson(
    context.fetch,
    graphUrl(`/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(folderId)}:/sap-tools-graph-check.txt:/content`),
    { method: 'PUT', headers: textHeaders(token), body: 'SAP Tools Microsoft Graph test file.\n' },
    'SharePoint upload file request'
  );
  return readRequiredString(payload, 'id', 'SharePoint upload file response');
}

async function deleteSharePointItem(
  context: GraphRunContext,
  token: string,
  siteId: string,
  itemId: string
): Promise<void> {
  await requestNoContent(
    context.fetch,
    graphUrl(`/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}`),
    { method: 'DELETE', headers: authHeaders(token) },
    'SharePoint delete item request'
  );
}

async function requestJson(
  fetchImpl: MicrosoftGraphFetch,
  url: string,
  init: RequestInit,
  label: string
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, init);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(formatHttpFailure(label, response, payload));
  }
  if (!isRecord(payload)) {
    throw new Error(`${label} returned an unexpected response.`);
  }
  return payload;
}

async function requestNoContent(
  fetchImpl: MicrosoftGraphFetch,
  url: string,
  init: RequestInit,
  label: string
): Promise<void> {
  const response = await fetchImpl(url, init);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(formatHttpFailure(label, response, payload));
  }
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function normalizeOutlookInput(input: OutlookToolInput): OutlookToolInput {
  return {
    clientId: requireInput(input.clientId, 'Client ID'),
    clientSecret: requireInput(input.clientSecret, 'Client Secret'),
    tenantId: requireInput(input.tenantId, 'Tenant ID'),
    senderEmail: requireInput(input.senderEmail, 'Sender Email').toLowerCase(),
    recipientEmail: requireInput(input.recipientEmail, 'Recipient Email').toLowerCase(),
  };
}

interface NormalizedSharePointInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantId: string;
  readonly hostname: string;
  readonly sitePath: string;
  readonly rootPath: string;
}

function normalizeSharePointInput(input: SharePointToolInput): NormalizedSharePointInput {
  const url = new URL(requireInput(input.url, 'SharePoint URL'));
  if (url.protocol !== 'https:') {
    throw new Error('SharePoint URL must use https.');
  }
  return {
    clientId: requireInput(input.clientId, 'Client ID'),
    clientSecret: requireInput(input.clientSecret, 'Client Secret'),
    tenantId: requireInput(input.tenantId, 'Tenant ID'),
    hostname: url.hostname,
    sitePath: requireGraphPath(input.site, 'Site'),
    rootPath: normalizeOptionalGraphPath(input.rootDir),
  };
}

function requireInput(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function requireGraphPath(value: string, label: string): string {
  const normalized = normalizeOptionalGraphPath(value);
  if (normalized.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeOptionalGraphPath(value: string): string {
  const segments = value.trim().split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return '';
  }
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function buildSendMailPayload(recipientEmail: string): Record<string, unknown> {
  return {
    message: {
      subject: 'SAP Tools Microsoft Graph test',
      body: {
        contentType: 'Text',
        content: 'This is a Microsoft Graph connectivity test from SAP Tools.',
      },
      toRecipients: [{ emailAddress: { address: recipientEmail } }],
    },
    saveToSentItems: false,
  };
}

function buildFolderPayload(folderName: string): Record<string, unknown> {
  return {
    name: folderName,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'rename',
  };
}

function tokenStep(run: () => Promise<string>): GraphStep<string> {
  return {
    id: 'token',
    label: 'Validate OAuth2 app key',
    run,
    doneMessage: 'OAuth2 token acquired.',
  };
}

function mailStep(run: () => Promise<void>): GraphStep<void> {
  return { id: 'send-mail', label: 'Send test email', run, doneMessage: 'Test email sent.' };
}

function siteStep(run: () => Promise<string>): GraphStep<string> {
  return { id: 'site', label: 'Resolve SharePoint site', run, doneMessage: 'SharePoint site resolved.' };
}

function driveStep(run: () => Promise<string>): GraphStep<string> {
  return { id: 'drive', label: 'Resolve document drive', run, doneMessage: 'Document drive resolved.' };
}

function rootStep(run: () => Promise<string>): GraphStep<string> {
  return { id: 'root', label: 'Verify root directory', run, doneMessage: 'Root directory resolved.' };
}

function folderStep(run: () => Promise<string>): GraphStep<string> {
  return { id: 'create-folder', label: 'Create test folder', run, doneMessage: 'Test folder created.' };
}

function fileStep(run: () => Promise<string>): GraphStep<string> {
  return { id: 'create-file', label: 'Create test file', run, doneMessage: 'Test file uploaded.' };
}

function deleteFileStep(run: () => Promise<void>): GraphStep<void> {
  return { id: 'delete-file', label: 'Delete test file', run, doneMessage: 'Test file deleted.' };
}

function deleteFolderStep(run: () => Promise<void>): GraphStep<void> {
  return { id: 'delete-folder', label: 'Delete test folder', run, doneMessage: 'Test folder deleted.' };
}

async function emitProgress(
  context: GraphRunContext,
  stepId: string,
  status: MicrosoftGraphStepStatus,
  message: string
): Promise<void> {
  await context.onProgress({ toolId: context.toolId, stepId, status, message });
}

function graphUrl(path: string): string {
  return `${GRAPH_BASE_URL}${path}`;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string): Record<string, string> {
  return { ...authHeaders(token), 'content-type': 'application/json' };
}

function textHeaders(token: string): Record<string, string> {
  return { ...authHeaders(token), 'content-type': 'text/plain' };
}

function formHeaders(): Record<string, string> {
  return { 'content-type': 'application/x-www-form-urlencoded' };
}

function readRequiredString(
  payload: Record<string, unknown>,
  field: string,
  label: string
): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} did not include ${field}.`);
  }
  return value.trim();
}

function buildToolFailureMessage(toolId: MicrosoftGraphToolId, error: unknown): string {
  const toolLabel = toolId === 'outlook' ? 'Outlook test' : 'SharePoint test';
  if (error instanceof MicrosoftGraphStepError) {
    return `${toolLabel} failed at "${error.stepLabel}".`;
  }
  return `${toolLabel} failed: ${toSafeGraphErrorMessage(toolLabel, error)}`;
}

function failureResult(
  toolId: MicrosoftGraphToolId,
  message: string
): MicrosoftGraphToolRunResult {
  return { success: false, toolId, message };
}

function toSafeGraphErrorMessage(label: string, error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return sanitizeGraphMessage(error.message);
  }
  return `${label} failed.`;
}

function formatHttpFailure(
  label: string,
  response: Response,
  payload: unknown
): string {
  const code = readSafeGraphErrorCode(payload);
  const hint = buildGraphFailureHint(label, response.status);
  return `${label} failed (${String(response.status)}${code}).${hint}`;
}

function readSafeGraphErrorCode(payload: unknown): string {
  if (!isRecord(payload)) {
    return '';
  }
  const rawError = payload['error'];
  const code =
    typeof rawError === 'string'
      ? rawError.trim()
      : isRecord(rawError) && typeof rawError['code'] === 'string'
        ? rawError['code'].trim()
        : '';
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? `, ${code}` : '';
}

function buildGraphFailureHint(label: string, status: number): string {
  if (label === 'Outlook sendMail request' && status === 403) {
    return (
      ' Check Microsoft Graph Mail.Send application permission, admin consent, ' +
      'and Exchange application access policy for the sender mailbox.'
    );
  }
  return '';
}

export function sanitizeGraphMessage(message: string): string {
  return message
    .replaceAll(/client_secret=[^&\s]+/gi, 'client_secret=[redacted]')
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOutlookMessageInput(input: Record<string, unknown>): OutlookToolInput {
  return {
    clientId: readStringField(input, 'clientId', 256),
    clientSecret: readStringField(input, 'clientSecret', 4096),
    tenantId: readStringField(input, 'tenantId', 256),
    senderEmail: readStringField(input, 'senderEmail', 320),
    recipientEmail: readStringField(input, 'recipientEmail', 320),
  };
}

function readSharePointMessageInput(input: Record<string, unknown>): SharePointToolInput {
  return {
    clientId: readStringField(input, 'clientId', 256),
    clientSecret: readStringField(input, 'clientSecret', 4096),
    tenantId: readStringField(input, 'tenantId', 256),
    url: readStringField(input, 'url', 2048),
    site: readStringField(input, 'site', 1024),
    rootDir: readStringField(input, 'rootDir', 1024),
  };
}

function readStringField(
  input: Record<string, unknown>,
  field: string,
  maxLength: number
): string {
  const value = input[field];
  if (typeof value !== 'string' || value.length > maxLength) {
    return '';
  }
  return value;
}
