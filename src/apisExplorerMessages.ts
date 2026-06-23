import type { ApiTraceStartOptions } from './apiTraceTypes.js';

const ALLOWED_EXECUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_AUTH_METHODS = new Set(['none', 'local', 'custom', 'CF Token', 'xsuaa-auto']);

export interface ExecuteRequestPayload {
  readonly url: string;
  readonly method: string;
  readonly auth: string;
  readonly body?: string;
  readonly source?: 'traceReplay';
  readonly requestId?: string;
  readonly headers?: Record<string, string>;
}

export interface ApiTracePreferencesPayload {
  readonly captureHeaders: boolean;
  readonly captureRequestBody: boolean;
  readonly captureResponseBody: boolean;
}

export const DEFAULT_API_TRACE_PREFERENCES: ApiTracePreferencesPayload = {
  captureHeaders: true,
  captureRequestBody: true,
  captureResponseBody: true,
};

export function readExecuteRequestPayload(payload: unknown): ExecuteRequestPayload | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  if (typeof raw['url'] !== 'string' || !isHttpUrl(raw['url'])) {
    return null;
  }
  if (typeof raw['method'] !== 'string' || !ALLOWED_EXECUTE_METHODS.has(raw['method'])) {
    return null;
  }
  if (typeof raw['auth'] !== 'string' || !ALLOWED_AUTH_METHODS.has(raw['auth'])) {
    return null;
  }
  const replayMetadata = readExecuteReplayMetadata(raw);
  if (replayMetadata === null) {
    return null;
  }
  if (replayMetadata !== undefined && raw['auth'] !== 'none') {
    return null;
  }
  const headers = readExecuteHeaders(raw, replayMetadata);
  if (headers === null) {
    return null;
  }
  const body = typeof raw['body'] === 'string' ? raw['body'] : undefined;
  const base = body === undefined
    ? { url: raw['url'], method: raw['method'], auth: raw['auth'] }
    : { url: raw['url'], method: raw['method'], auth: raw['auth'], body };
  const withReplay = replayMetadata === undefined ? base : { ...base, ...replayMetadata };
  return headers === undefined ? withReplay : { ...withReplay, headers };
}

export function readTraceStartOptions(payload: unknown): ApiTraceStartOptions | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  if (raw['mode'] !== 'runtime-http') {
    return null;
  }
  const filters = readTraceFilters(raw['filters']);
  return {
    mode: 'runtime-http',
    instanceIndex: readInstanceIndex(raw['instanceIndex']),
    processName: typeof raw['processName'] === 'string' && raw['processName'] !== ''
      ? raw['processName']
      : 'web',
    captureHeaders: raw['captureHeaders'] === true,
    captureRequestBody: raw['captureRequestBody'] === true,
    captureResponseBody: raw['captureResponseBody'] === true,
    maxBodyBytes: readTraceBodyLimit(raw['maxBodyBytes'], 4096, 20000),
    filters,
  };
}

export function readTracePreferencesPayload(payload: unknown): ApiTracePreferencesPayload | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  return {
    captureHeaders: raw['captureHeaders'] !== false,
    captureRequestBody: raw['captureRequestBody'] !== false,
    captureResponseBody: raw['captureResponseBody'] !== false,
  };
}

export function readUninstallRuntimeHook(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return true;
  }
  return (payload as Record<string, unknown>)['uninstallRuntimeHook'] !== false;
}

function readTraceFilters(rawFilters: unknown): ApiTraceStartOptions['filters'] {
  if (typeof rawFilters !== 'object' || rawFilters === null) {
    return { method: [], pathContains: '', statusClass: 'all' };
  }
  const raw = rawFilters as Record<string, unknown>;
  const method = Array.isArray(raw['method'])
    ? raw['method'].filter((value): value is string => typeof value === 'string')
    : [];
  const statusClass = readStatusClass(raw['statusClass']);
  return {
    method,
    pathContains: typeof raw['pathContains'] === 'string' ? raw['pathContains'] : '',
    statusClass,
  };
}

function readInstanceIndex(value: unknown): number | 'all' {
  if (value === 'all') {
    return 'all';
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readStatusClass(value: unknown): ApiTraceStartOptions['filters']['statusClass'] {
  return value === '2xx' || value === '3xx' || value === '4xx' || value === '5xx'
    ? value
    : 'all';
}

function readExecuteReplayMetadata(
  raw: Record<string, unknown>
): { readonly source: 'traceReplay'; readonly requestId: string } | undefined | null {
  if (raw['source'] === undefined && raw['requestId'] === undefined) {
    return undefined;
  }
  if (raw['source'] !== 'traceReplay') {
    return null;
  }
  if (typeof raw['requestId'] !== 'string' || !isSafeRequestId(raw['requestId'])) {
    return null;
  }
  return { source: 'traceReplay', requestId: raw['requestId'] };
}

const OMITTED_REPLAY_HEADERS = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function readExecuteHeaders(
  raw: Record<string, unknown>,
  replayMetadata: { readonly source: 'traceReplay'; readonly requestId: string } | undefined
): Record<string, string> | undefined | null {
  if (raw['headers'] === undefined) {
    return undefined;
  }
  if (replayMetadata === undefined || !isRecord(raw['headers'])) {
    return null;
  }

  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(raw['headers'])) {
    const name = rawName.trim().toLowerCase();
    if (!isSafeHeaderName(name) || typeof rawValue !== 'string' || !isSafeHeaderValue(rawValue)) {
      return null;
    }
    if (OMITTED_REPLAY_HEADERS.has(name)) {
      continue;
    }
    headers[name] = rawValue;
  }
  return headers;
}

function isSafeRequestId(value: string): boolean {
  return value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function readPositiveNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function readTraceBodyLimit(value: unknown, fallback: number, max: number): number {
  if (value === 0) {
    return 0;
  }
  return readPositiveNumber(value, fallback, max);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeHeaderName(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(value);
}

function isSafeHeaderValue(value: string): boolean {
  return value.length <= 8192 && !/[\r\n]/.test(value);
}
