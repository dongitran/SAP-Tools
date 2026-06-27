import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}));

import { openApiTraceInspectorTunnel } from './apiTraceTunnel';
import type { CfPortForwardHandle } from './cfClient';

function createForwardHandle(): CfPortForwardHandle {
  const process = new EventEmitter() as CfPortForwardHandle['process'];
  return {
    process,
    localPort: 51234,
    stop: vi.fn(),
  };
}

describe('apiTraceTunnel', () => {
  it('opens a CF SSH forward to the Node Inspector port on the selected instance', async () => {
    const handle = createForwardHandle();
    const spawnPortForward = vi.fn(() => handle);

    const result = await openApiTraceInspectorTunnel(
      {
        appName: 'finance-uat-api',
        cfHomeDir: '/tmp/cf-home',
        instanceIndex: 0,
      },
      {
        allocatePort: vi.fn(async () => 51234),
        spawnPortForward,
        waitForLocalPort: vi.fn(async () => true),
      }
    );

    expect(result.status).toBe('ready');
    expect(spawnPortForward).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'finance-uat-api',
        cfHomeDir: '/tmp/cf-home',
        instanceIndex: 0,
        localPort: 51234,
        remoteHost: '127.0.0.1',
        remotePort: 9229,
      })
    );
    expect(result.status === 'ready' ? result.handle.localPort : 0).toBe(51234);
  });

  it('stops the forward when the local inspector port never becomes reachable', async () => {
    const handle = createForwardHandle();

    const result = await openApiTraceInspectorTunnel(
      {
        appName: 'finance-uat-api',
        cfHomeDir: '/tmp/cf-home',
        instanceIndex: 0,
      },
      {
        allocatePort: vi.fn(async () => 51234),
        spawnPortForward: vi.fn(() => handle),
        waitForLocalPort: vi.fn(async () => false),
      }
    );

    expect(result.status).toBe('not-reachable');
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });
});
