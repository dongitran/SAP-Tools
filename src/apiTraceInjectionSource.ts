export const API_TRACE_GLOBAL_NAME = '__SAP_TOOLS_HTTP_TRACE__';
export const API_TRACE_RUNTIME_VERSION = 3;

export interface ApiTraceRuntimeInstallOptions {
  readonly appId: string;
  readonly instance: string;
  readonly captureHeaders: boolean;
  readonly captureRequestBody: boolean;
  readonly captureResponseBody: boolean;
  readonly maxBodyBytes: number;
  readonly maxEvents: number;
}

export const API_TRACE_RUNTIME_SOURCE = `
(() => {
  const name = '${API_TRACE_GLOBAL_NAME}';
  const runtimeVersion = ${String(API_TRACE_RUNTIME_VERSION)};
  const existing = globalThis[name];
  if (existing && typeof existing.version === 'number' && existing.version >= runtimeVersion) return existing;
  if (existing && typeof existing.uninstall === 'function') {
    try {
      existing.uninstall();
    } catch {}
  }
  const state = {
    version: runtimeVersion,
    installed: false,
    enabled: false,
    options: { appId: '', instance: '0', captureHeaders: false, captureRequestBody: false, captureResponseBody: false, maxBodyBytes: 4096, maxEvents: 1000 },
    queue: [],
    droppedCount: 0,
    originals: {},
    seen: new WeakSet(),
    nextId: 1
  };
  const load = () => {
    if (typeof require === 'function') return require;
    if (globalThis.process && globalThis.process.mainModule && typeof globalThis.process.mainModule.require === 'function') {
      return globalThis.process.mainModule.require.bind(globalThis.process.mainModule);
    }
    return null;
  };
  const toHeaderRecord = (headers) => {
    const output = {};
    if (!headers || !state.options.captureHeaders) return output;
    for (const key of Object.keys(headers)) {
      const value = headers[key];
      output[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return output;
  };
  const chunkText = (chunk) => {
    if (chunk === undefined || chunk === null) return '';
    if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
    if (typeof chunk === 'string') return chunk;
    if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8');
    return '';
  };
  const appendPreview = (current, chunk, enabled) => {
    if (!enabled) return current;
    const text = chunkText(chunk);
    if (state.options.maxBodyBytes <= 0) return current + text;
    if (current.length >= state.options.maxBodyBytes) return current;
    return (current + text).slice(0, state.options.maxBodyBytes);
  };
  const enqueue = (event) => {
    if (state.queue.length >= state.options.maxEvents) {
      state.queue.shift();
      state.droppedCount += 1;
    }
    state.queue.push(event);
  };
  const observe = (req, res) => {
    if (!state.enabled || !req || !res || state.seen.has(req)) return;
    state.seen.add(req);
    const started = Date.now();
    const initialUrl = String(req.url || '');
    const traceId = String(state.nextId++);
    let requestBytes = 0;
    let responseBytes = 0;
    let requestPreview = '';
    let responsePreview = '';
    let finished = false;
    const originalReqEmit = req.emit;
    const originalWrite = res.write;
    const originalEnd = res.end;
    req.emit = function patchedReqEmit(eventName, ...args) {
      if (eventName === 'data' && args[0] !== undefined) {
        const text = chunkText(args[0]);
        requestBytes += Buffer.byteLength(text);
        requestPreview = appendPreview(requestPreview, args[0], state.options.captureRequestBody);
      }
      return originalReqEmit.apply(this, [eventName, ...args]);
    };
    res.write = function patchedWrite(chunk, ...args) {
      const text = chunkText(chunk);
      responseBytes += Buffer.byteLength(text);
      responsePreview = appendPreview(responsePreview, chunk, state.options.captureResponseBody);
      return originalWrite.apply(this, [chunk, ...args]);
    };
    res.end = function patchedEnd(chunk, ...args) {
      if (chunk !== undefined) {
        const text = chunkText(chunk);
        responseBytes += Buffer.byteLength(text);
        responsePreview = appendPreview(responsePreview, chunk, state.options.captureResponseBody);
      }
      return originalEnd.apply(this, [chunk, ...args]);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      req.emit = originalReqEmit;
      res.write = originalWrite;
      res.end = originalEnd;
      const rawUrl = initialUrl || String(req.url || '');
      const event = {
        id: traceId,
        timestamp: new Date().toISOString(),
        instance: state.options.instance,
        method: String(req.method || 'GET').toUpperCase(),
        path: rawUrl.split('?')[0] || rawUrl,
        url: rawUrl,
        normalizedUrl: rawUrl,
        status: typeof res.statusCode === 'number' ? res.statusCode : null,
        durationMs: Date.now() - started,
        requestBytes,
        responseBytes,
        requestHeaders: toHeaderRecord(req.headers),
        responseHeaders: toHeaderRecord(typeof res.getHeaders === 'function' ? res.getHeaders() : {}),
        requestBodyPreview: requestPreview,
        responseBodyPreview: responsePreview,
        requestBodyTruncated: state.options.maxBodyBytes > 0 && requestPreview.length >= state.options.maxBodyBytes,
        responseBodyTruncated: state.options.maxBodyBytes > 0 && responsePreview.length >= state.options.maxBodyBytes,
        droppedBeforeEvent: state.droppedCount,
        traceId,
        correlationId: req.headers && typeof req.headers['x-saptools-trace-id'] === 'string' ? req.headers['x-saptools-trace-id'] : null
      };
      enqueue(event);
    };
    res.once('finish', finish);
    res.once('close', finish);
  };
  const patchEmit = (serverPrototype) => {
    if (!serverPrototype || serverPrototype.emit.__sapToolsTracePatched) return;
    const original = serverPrototype.emit;
    const patched = function patchedServerEmit(eventName, ...args) {
      if (eventName === 'request') observe(args[0], args[1]);
      return original.apply(this, [eventName, ...args]);
    };
    patched.__sapToolsTracePatched = true;
    serverPrototype.emit = patched;
    return original;
  };
  const api = {
    version: runtimeVersion,
    install(options) {
      state.options = { ...state.options, ...options };
      if (!state.installed) {
        const requireFn = load();
        if (!requireFn) throw new Error('CommonJS require is not available in this process.');
        const http = requireFn('http');
        const https = requireFn('https');
        state.originals.httpServerEmit = patchEmit(http && http.Server && http.Server.prototype);
        state.originals.httpsServerEmit = patchEmit(https && https.Server && https.Server.prototype);
        state.installed = true;
      }
      state.enabled = true;
      return api.status();
    },
    disable() {
      state.enabled = false;
      return api.status();
    },
    drainEvents(maxCount) {
      const count = Math.max(0, Math.min(Number(maxCount) || 0, state.queue.length));
      const events = state.queue.splice(0, count);
      return { events, droppedCount: state.droppedCount, queueSize: state.queue.length };
    },
    status() {
      return { installed: state.installed, enabled: state.enabled, queueSize: state.queue.length, droppedCount: state.droppedCount, maxEvents: state.options.maxEvents };
    },
    uninstall() {
      state.enabled = false;
      const requireFn = load();
      if (requireFn) {
        const http = requireFn('http');
        const https = requireFn('https');
        if (state.originals.httpServerEmit && http && http.Server) http.Server.prototype.emit = state.originals.httpServerEmit;
        if (state.originals.httpsServerEmit && https && https.Server) https.Server.prototype.emit = state.originals.httpsServerEmit;
      }
      state.installed = false;
      return api.status();
    }
  };
  globalThis[name] = api;
  return api;
})()
`;

export function buildApiTraceInstallExpression(options: ApiTraceRuntimeInstallOptions): string {
  return `${API_TRACE_RUNTIME_SOURCE}.install(${JSON.stringify(options)})`;
}

export function buildApiTraceDrainExpression(maxCount: number): string {
  return `globalThis.${API_TRACE_GLOBAL_NAME}?.drainEvents(${String(maxCount)}) ?? { events: [], droppedCount: 0, queueSize: 0 }`;
}

export function buildApiTraceStopExpression(uninstallRuntimeHook: boolean): string {
  return uninstallRuntimeHook
    ? `globalThis.${API_TRACE_GLOBAL_NAME}?.uninstall() ?? { installed: false, enabled: false }`
    : `globalThis.${API_TRACE_GLOBAL_NAME}?.disable() ?? { installed: false, enabled: false }`;
}
