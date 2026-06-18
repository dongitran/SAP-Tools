import { describe, expect, it } from 'vitest';

import {
  readExecuteRequestPayload,
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
        processName: 'srv',
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
      processName: 'srv',
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

  it('defaults uninstallRuntimeHook to true unless explicitly false', () => {
    expect(readUninstallRuntimeHook(undefined)).toBe(true);
    expect(readUninstallRuntimeHook({ uninstallRuntimeHook: true })).toBe(true);
    expect(readUninstallRuntimeHook({ uninstallRuntimeHook: false })).toBe(false);
  });
});
