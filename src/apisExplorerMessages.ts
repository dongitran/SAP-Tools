import type { ApiTraceStartOptions } from './apiTraceTypes.js';

const ALLOWED_EXECUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_AUTH_METHODS = new Set(['none', 'local', 'custom', 'CF Token', 'xsuaa-auto']);

export interface ExecuteRequestPayload {
  readonly url: string;
  readonly method: string;
  readonly auth: string;
  readonly body?: string;
}

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
  const body = typeof raw['body'] === 'string' ? raw['body'] : undefined;
  return body === undefined
    ? { url: raw['url'], method: raw['method'], auth: raw['auth'] }
    : { url: raw['url'], method: raw['method'], auth: raw['auth'], body };
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
    maxBodyBytes: readPositiveNumber(raw['maxBodyBytes'], 4096, 20000),
    filters,
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

function readPositiveNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
