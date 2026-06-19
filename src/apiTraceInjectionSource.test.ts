import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  API_TRACE_GLOBAL_NAME,
  API_TRACE_RUNTIME_SOURCE,
  API_TRACE_RUNTIME_VERSION,
  buildApiTraceDrainExpression,
  buildApiTraceInstallExpression,
  buildApiTraceStopExpression,
} from './apiTraceInjectionSource';

interface RuntimeApi {
  readonly version: number;
  install(options: unknown): unknown;
  drainEvents(maxCount: number): { readonly events: readonly RuntimeTraceEvent[] };
}

interface RuntimeTraceEvent {
  readonly url: string;
  readonly normalizedUrl: string;
  readonly path: string;
  readonly responseBodyPreview: string;
}

describe('apiTraceInjectionSource', () => {
  it('defines a bounded runtime queue with install, drain, disable, and uninstall controls', () => {
    expect(API_TRACE_GLOBAL_NAME).toBe('__SAP_TOOLS_HTTP_TRACE__');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('__SAP_TOOLS_HTTP_TRACE__');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('drainEvents');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('uninstall');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('disable');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('maxEvents');
    expect(API_TRACE_RUNTIME_SOURCE).not.toContain('console.log');
    expect(API_TRACE_RUNTIME_SOURCE).not.toContain(['S', 'MDG_REQUEST_TRACE'].join(''));
  });

  it('builds static Runtime.evaluate expressions for install, drain, and stop', () => {
    expect(
      buildApiTraceInstallExpression({
        appId: 'finance-uat-api',
        instance: '0',
        captureHeaders: true,
        captureRequestBody: true,
        captureResponseBody: true,
        maxBodyBytes: 4096,
        maxEvents: 1000,
      })
    ).toContain('.install({');
    expect(buildApiTraceDrainExpression(50)).toContain('.drainEvents(50)');
    expect(buildApiTraceStopExpression(true)).toContain('.uninstall()');
    expect(buildApiTraceStopExpression(false)).toContain('.disable()');
  });

  it('supports unlimited body preview capture when maxBodyBytes is zero', () => {
    expect(API_TRACE_RUNTIME_SOURCE).toContain('state.options.maxBodyBytes <= 0');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('return current + text;');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('state.options.maxBodyBytes > 0 && requestPreview.length >= state.options.maxBodyBytes');
    expect(API_TRACE_RUNTIME_SOURCE).toContain('state.options.maxBodyBytes > 0 && responsePreview.length >= state.options.maxBodyBytes');
    expect(
      buildApiTraceInstallExpression({
        appId: 'orders-api',
        instance: '0',
        captureHeaders: true,
        captureRequestBody: true,
        captureResponseBody: true,
        maxBodyBytes: 0,
        maxEvents: 1000,
      })
    ).toContain('"maxBodyBytes":0');
  });

  it('replaces stale injected runtime hooks before installing unlimited body capture', () => {
    const staleUninstall = vi.fn(() => ({ installed: false, enabled: false }));
    const staleRuntime = {
      version: API_TRACE_RUNTIME_VERSION - 1,
      uninstall: staleUninstall,
    };
    const context: Record<string, unknown> = {
      [API_TRACE_GLOBAL_NAME]: staleRuntime,
      Buffer,
      WeakSet,
      require: createRuntimeRequireStub(),
    };

    const runtimeApi = runInNewContext(API_TRACE_RUNTIME_SOURCE, context);

    expect(staleUninstall).toHaveBeenCalledTimes(1);
    expect(isRuntimeApi(runtimeApi)).toBe(true);
    if (!isRuntimeApi(runtimeApi)) {
      throw new Error('Runtime source did not return a trace API.');
    }
    expect(runtimeApi).not.toBe(staleRuntime);
    expect(runtimeApi.version).toBe(API_TRACE_RUNTIME_VERSION);
    expect(context[API_TRACE_GLOBAL_NAME]).toBe(runtimeApi);
  });

  it('reuses an already current injected runtime hook', () => {
    const currentUninstall = vi.fn(() => ({ installed: false, enabled: false }));
    const currentRuntime = {
      version: API_TRACE_RUNTIME_VERSION,
      uninstall: currentUninstall,
    };
    const context: Record<string, unknown> = {
      [API_TRACE_GLOBAL_NAME]: currentRuntime,
      Buffer,
      WeakSet,
      require: createRuntimeRequireStub(),
    };

    const runtimeApi = runInNewContext(API_TRACE_RUNTIME_SOURCE, context);

    expect(runtimeApi).toBe(currentRuntime);
    expect(currentUninstall).not.toHaveBeenCalled();
  });

  it('captures the original incoming URL before frameworks mutate request paths', () => {
    const { runtimeApi, httpModule } = installRuntimeSource();
    const req = createRuntimeRequest('/service/demo1?$top=5');
    const res = createRuntimeResponse();

    httpModule.Server.prototype.emit('request', req, res);
    req.url = '/demo1?$top=5';
    res.end('{"ok":true}');
    res.emit('finish');

    const drained = runtimeApi.drainEvents(10);

    expect(drained.events).toHaveLength(1);
    expect(drained.events[0]).toEqual(
      expect.objectContaining({
        url: '/service/demo1?$top=5',
        normalizedUrl: '/service/demo1?$top=5',
        path: '/service/demo1',
        responseBodyPreview: '{"ok":true}',
      })
    );
  });
});

interface RuntimeModule {
  readonly Server: {
    readonly prototype: {
      emit(eventName: string, ...args: unknown[]): boolean;
    };
  };
}

function installRuntimeSource(): {
  readonly runtimeApi: RuntimeApi;
  readonly httpModule: RuntimeModule;
} {
  const httpModule = createRuntimeHttpModule();
  const httpsModule = createRuntimeHttpModule();
  const context: Record<string, unknown> = {
    Buffer,
    WeakSet,
    require: createRuntimeRequireStub({ httpModule, httpsModule }),
  };
  const runtimeApi = runInNewContext(API_TRACE_RUNTIME_SOURCE, context);
  if (!isRuntimeApi(runtimeApi)) {
    throw new Error('Runtime source did not return a trace API.');
  }
  runtimeApi.install({
    appId: 'orders-api',
    instance: '0',
    captureHeaders: true,
    captureRequestBody: true,
    captureResponseBody: true,
    maxBodyBytes: 0,
    maxEvents: 1000,
  });
  return { runtimeApi, httpModule };
}

function createRuntimeHttpModule(): RuntimeModule {
  return {
    Server: {
      prototype: {
        emit() {
          return true;
        },
      },
    },
  };
}

function createRuntimeRequest(url: string): EventEmitter & {
  url: string;
  method: string;
  headers: Record<string, string>;
} {
  return Object.assign(new EventEmitter(), {
    url,
    method: 'GET',
    headers: {
      host: 'app.example.com',
      accept: 'application/json',
    },
  });
}

function createRuntimeResponse(): EventEmitter & {
  statusCode: number;
  write(chunk: string): boolean;
  end(chunk?: string): boolean;
  getHeaders(): Record<string, string>;
} {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    write() {
      return true;
    },
    end() {
      return true;
    },
    getHeaders() {
      return {
        'content-type': 'application/json',
      };
    },
  });
}

function createRuntimeRequireStub(modules?: {
  readonly httpModule: RuntimeModule;
  readonly httpsModule: RuntimeModule;
}): (moduleName: string) => unknown {
  return (moduleName: string): unknown => {
    if (moduleName === 'http') {
      return modules?.httpModule ?? createRuntimeHttpModule();
    }
    if (moduleName === 'https') {
      return modules?.httpsModule ?? createRuntimeHttpModule();
    }
    throw new Error(`Unexpected runtime require: ${moduleName}`);
  };
}

function isRuntimeApi(value: unknown): value is RuntimeApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly version?: unknown }).version === 'number' &&
    typeof (value as { readonly install?: unknown }).install === 'function' &&
    typeof (value as { readonly drainEvents?: unknown }).drainEvents === 'function'
  );
}
