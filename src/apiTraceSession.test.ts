import { describe, expect, it, vi } from 'vitest';

import { ApiTraceSession } from './apiTraceSession';
import type { ApiTraceStatePayload } from './apiTraceTypes';

function createSession(): {
  readonly batches: unknown[];
  readonly session: ApiTraceSession;
  readonly states: ApiTraceStatePayload[];
  readonly summaries: unknown[];
} {
  const states: ApiTraceStatePayload[] = [];
  const batches: unknown[] = [];
  const summaries: unknown[] = [];
  const session = new ApiTraceSession({
    appId: 'finance-uat-api',
    targetParams: undefined,
    isTestMode: true,
    callbacks: {
      postState: (state) => states.push(state),
      postBatch: (batch) => batches.push(batch),
      postUrlSummary: (summary) => summaries.push(summary),
      log: vi.fn(),
    },
  });
  return { batches, session, states, summaries };
}

describe('ApiTraceSession', () => {
  it('starts in test mode and emits raw mock trace events with URL summaries', async () => {
    const { batches, session, states, summaries } = createSession();

    await session.start({
      mode: 'runtime-http',
      instanceIndex: 0,
      processName: 'web',
      captureHeaders: false,
      captureRequestBody: false,
      captureResponseBody: false,
      maxBodyBytes: 4096,
      filters: {
        method: [],
        pathContains: '',
        statusClass: 'all',
      },
    });

    expect(states.map((state) => state.state)).toEqual(['preparingCli', 'streaming']);
    expect(session.isRunning()).toBe(true);
    expect(batches).toHaveLength(1);
    expect(JSON.stringify(batches[0])).toContain('demo-access-token');
    expect(summaries).toHaveLength(1);
    expect(JSON.stringify(summaries[0])).toContain('/odata/v4/products');
  });

  it('stops and disposes idempotently', async () => {
    const { session, states } = createSession();

    await session.start({
      mode: 'runtime-http',
      instanceIndex: 0,
      processName: 'web',
      captureHeaders: false,
      captureRequestBody: false,
      captureResponseBody: false,
      maxBodyBytes: 4096,
      filters: {
        method: [],
        pathContains: '',
        statusClass: 'all',
      },
    });
    await session.stop('user', true);
    await session.stop('user', true);
    session.dispose();

    expect(session.isRunning()).toBe(false);
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        state: 'stopped',
        runtimeHookInstalled: false,
        runtimeHookMayRemain: false,
      })
    );
  });

  it('clears buffered trace summaries without stopping a running session', async () => {
    const { session, summaries } = createSession();

    await session.start({
      mode: 'runtime-http',
      instanceIndex: 0,
      processName: 'web',
      captureHeaders: false,
      captureRequestBody: false,
      captureResponseBody: false,
      maxBodyBytes: 4096,
      filters: {
        method: [],
        pathContains: '',
        statusClass: 'all',
      },
    });
    session.clear();

    expect(session.isRunning()).toBe(true);
    expect(JSON.stringify(summaries.at(-1))).toContain('"urls":[]');
  });

  it('treats needsInspector as stoppable without marking it as actively streaming', () => {
    const states: ApiTraceStatePayload[] = [];
    const session = new ApiTraceSession({
      appId: 'finance-uat-api',
      targetParams: {
        apiEndpoint: 'https://api.example.com',
        email: 'user@example.com',
        password: 'secret',
        orgName: 'demo-org',
        spaceName: 'demo-space',
      },
      isTestMode: false,
      callbacks: {
        postState: (state) => states.push(state),
        postBatch: vi.fn(),
        postUrlSummary: vi.fn(),
        log: vi.fn(),
      },
    });

    session.start({
      mode: 'runtime-http',
      instanceIndex: 0,
      processName: 'web',
      captureHeaders: false,
      captureRequestBody: false,
      captureResponseBody: false,
      maxBodyBytes: 4096,
      filters: {
        method: [],
        pathContains: '',
        statusClass: 'all',
      },
    });

    expect(states.at(-1)?.state).toBe('needsInspector');
    expect(session.isRunning()).toBe(false);
    expect(session.canStop()).toBe(true);

    session.stop('scope-changed', true);

    expect(states.at(-1)?.state).toBe('stopped');
    expect(session.canStop()).toBe(false);
  });
});
