import { describe, expect, it } from 'vitest';

import {
  readExecuteRequestPayload,
  readTracePreferencesPayload,
  readTraceStartOptions,
  readUninstallRuntimeHook,
} from './apisExplorerMessages';

describe('APIs Explorer webview message parsing', () => {
  it('accepts a valid execute payload', () => {
    expect(
      readExecuteRequestPayload({
        url: 'https://app.example.com/odata/v4/products',
        method: 'GET',
        auth: 'xsuaa-auto',
      })
    ).toEqual({
      url: 'https://app.example.com/odata/v4/products',
      method: 'GET',
      auth: 'xsuaa-auto',
    });
    expect(
      readExecuteRequestPayload({
        url: 'http://localhost:4004/odata/v4/products',
        method: 'POST',
        auth: 'local',
        body: '{"name":"demo"}',
      })
    ).toEqual({
      url: 'http://localhost:4004/odata/v4/products',
      method: 'POST',
      auth: 'local',
      body: '{"name":"demo"}',
    });
  });

  it('accepts trace replay markers on execute payloads', () => {
    expect(
      readExecuteRequestPayload({
        url: 'https://app.example.com/odata/v4/orders',
        method: 'POST',
        auth: 'none',
        body: '{"amount":1200}',
        source: 'traceReplay',
        requestId: 'trace-replay-trace-002-123',
        headers: {
          Authorization: 'Bearer replay-token',
          'Content-Type': 'application/json',
          Host: 'app.example.com',
          'Content-Length': '15',
          'X-Trace-ID': 'abc-123',
        },
      })
    ).toEqual({
      url: 'https://app.example.com/odata/v4/orders',
      method: 'POST',
      auth: 'none',
      body: '{"amount":1200}',
      source: 'traceReplay',
      requestId: 'trace-replay-trace-002-123',
      headers: {
        authorization: 'Bearer replay-token',
        'content-type': 'application/json',
        'x-trace-id': 'abc-123',
      },
    });
  });

  it('rejects replay headers outside trace replay payloads', () => {
    expect(
      readExecuteRequestPayload({
        url: 'https://app.example.com/odata/v4/orders',
        method: 'GET',
        auth: 'none',
        headers: { Authorization: 'Bearer replay-token' },
      })
    ).toBeNull();
  });

  it('rejects trace replay headers with unsafe names or values', () => {
    expect(
      readExecuteRequestPayload({
        url: 'https://app.example.com/odata/v4/orders',
        method: 'GET',
        auth: 'none',
        source: 'traceReplay',
        requestId: 'trace-replay-trace-002-123',
        headers: { 'Bad Header': 'value' },
      })
    ).toBeNull();

    expect(
      readExecuteRequestPayload({
        url: 'https://app.example.com/odata/v4/orders',
        method: 'GET',
        auth: 'none',
        source: 'traceReplay',
        requestId: 'trace-replay-trace-002-123',
        headers: { Authorization: 'Bearer replay-token\nInjected: yes' },
      })
    ).toBeNull();
  });

  it('rejects execute payloads with unsafe URLs, methods, or auth modes', () => {
    expect(
      readExecuteRequestPayload({
        url: 'file:///etc/passwd',
        method: 'GET',
        auth: 'xsuaa-auto',
      })
    ).toBeNull();
    expect(
      readExecuteRequestPayload({
        url: 'https://app.example.com/odata/v4/products',
        method: 'TRACE',
        auth: 'xsuaa-auto',
      })
    ).toBeNull();
    expect(
      readExecuteRequestPayload({
        url: 'https://app.example.com/odata/v4/products',
        method: 'GET',
        auth: 'raw-token-from-webview',
      })
    ).toBeNull();
  });

  it('parses trace start options with bounded capture settings', () => {
    expect(
      readTraceStartOptions({
        mode: 'runtime-http',
        instanceIndex: 1,
        processName: 'web',
        captureHeaders: true,
        captureRequestBody: true,
        captureResponseBody: true,
        maxBodyBytes: 999_999,
        filters: {
          method: ['GET', 'POST'],
          pathContains: '/odata',
          statusClass: '4xx',
        },
      })
    ).toEqual({
      mode: 'runtime-http',
      instanceIndex: 1,
      processName: 'web',
      captureHeaders: true,
      captureRequestBody: true,
      captureResponseBody: true,
      maxBodyBytes: 20000,
      filters: {
        method: ['GET', 'POST'],
        pathContains: '/odata',
        statusClass: '4xx',
      },
    });
  });

  it('accepts zero max body bytes as the unlimited trace body sentinel', () => {
    expect(
      readTraceStartOptions({
        mode: 'runtime-http',
        instanceIndex: 0,
        processName: 'web',
        captureHeaders: true,
        captureRequestBody: true,
        captureResponseBody: true,
        maxBodyBytes: 0,
        filters: {
          method: [],
          pathContains: '',
          statusClass: 'all',
        },
      })
    ).toEqual({
      mode: 'runtime-http',
      instanceIndex: 0,
      processName: 'web',
      captureHeaders: true,
      captureRequestBody: true,
      captureResponseBody: true,
      maxBodyBytes: 0,
      filters: {
        method: [],
        pathContains: '',
        statusClass: 'all',
      },
    });
  });

  it('defaults uninstallRuntimeHook to true unless explicitly false', () => {
    expect(readUninstallRuntimeHook(undefined)).toBe(true);
    expect(readUninstallRuntimeHook({ uninstallRuntimeHook: true })).toBe(true);
    expect(readUninstallRuntimeHook({ uninstallRuntimeHook: false })).toBe(false);
  });

  it('parses trace preferences with enabled-by-default booleans', () => {
    expect(readTracePreferencesPayload(undefined)).toBeNull();
    expect(readTracePreferencesPayload({})).toEqual({
      captureHeaders: true,
      captureRequestBody: true,
      captureResponseBody: true,
    });
    expect(
      readTracePreferencesPayload({
        captureHeaders: false,
        captureRequestBody: true,
        captureResponseBody: false,
      })
    ).toEqual({
      captureHeaders: false,
      captureRequestBody: true,
      captureResponseBody: false,
    });
  });
});
