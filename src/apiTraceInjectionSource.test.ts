import { runInNewContext } from 'node:vm';

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
});

function createRuntimeRequireStub(): (moduleName: string) => unknown {
  return (moduleName: string): unknown => {
    if (moduleName === 'http' || moduleName === 'https') {
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
    throw new Error(`Unexpected runtime require: ${moduleName}`);
  };
}

function isRuntimeApi(value: unknown): value is RuntimeApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly version?: unknown }).version === 'number' &&
    typeof (value as { readonly install?: unknown }).install === 'function'
  );
}
