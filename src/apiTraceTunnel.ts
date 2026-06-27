import { connect as netConnect, createServer } from 'node:net';

import { spawnCfSshPortForward, type CfPortForwardHandle } from './cfClient';
import { ensureSshProxy } from './sshProxyTunnel';

const INSPECTOR_REMOTE_HOST = '127.0.0.1';
const INSPECTOR_REMOTE_PORT = 9229;
const TRACE_TUNNEL_KEEPALIVE_SECONDS = 6 * 60 * 60;
const TRACE_TUNNEL_READY_TIMEOUT_MS = 20_000;
const TRACE_TUNNEL_READY_POLL_MS = 200;

export interface ApiTraceTunnelParams {
  readonly appName: string;
  readonly cfHomeDir?: string;
  readonly instanceIndex: number;
}

export interface ApiTraceTunnelReadyResult {
  readonly status: 'ready';
  readonly handle: Pick<CfPortForwardHandle, 'localPort' | 'stop'>;
}

export type ApiTraceTunnelOpenResult =
  | ApiTraceTunnelReadyResult
  | {
      readonly status: 'not-reachable';
    };

export interface ApiTraceTunnelDependencies {
  allocatePort(): Promise<number>;
  spawnPortForward(params: {
    readonly appName: string;
    readonly localPort: number;
    readonly remoteHost: string;
    readonly remotePort: number;
    readonly keepAliveSeconds: number;
    readonly cfHomeDir?: string;
    readonly instanceIndex?: number;
  }): CfPortForwardHandle;
  waitForLocalPort(port: number, timeoutMs: number): Promise<boolean>;
}

export async function openApiTraceInspectorTunnel(
  params: ApiTraceTunnelParams,
  dependencies: ApiTraceTunnelDependencies = defaultApiTraceTunnelDependencies
): Promise<ApiTraceTunnelOpenResult> {
  const localPort = await dependencies.allocatePort();
  const proxy = await ensureSshProxy();
  const envOverrides: Record<string, string> = {};
  if (proxy !== undefined) {
    const proxyUrl = `socks5://${proxy.host}:${proxy.port.toString()}`;
    envOverrides['http_proxy'] = proxyUrl;
    envOverrides['HTTP_PROXY'] = proxyUrl;
    envOverrides['https_proxy'] = proxyUrl;
    envOverrides['HTTPS_PROXY'] = proxyUrl;
    envOverrides['all_proxy'] = proxyUrl;
    envOverrides['ALL_PROXY'] = proxyUrl;
  }
  const forwardParams = {
    appName: params.appName,
    localPort,
    remoteHost: INSPECTOR_REMOTE_HOST,
    remotePort: INSPECTOR_REMOTE_PORT,
    keepAliveSeconds: TRACE_TUNNEL_KEEPALIVE_SECONDS,
    instanceIndex: params.instanceIndex,
    ...(Object.keys(envOverrides).length > 0 ? { envOverrides } : {}),
  };
  const handle = dependencies.spawnPortForward(
    params.cfHomeDir === undefined ? forwardParams : { ...forwardParams, cfHomeDir: params.cfHomeDir }
  );

  const ready = await raceForwardReadiness(handle, dependencies);
  if (!ready) {
    handle.stop();
    return { status: 'not-reachable' };
  }

  return { status: 'ready', handle };
}

export const defaultApiTraceTunnelDependencies: ApiTraceTunnelDependencies = {
  allocatePort: findFreePort,
  spawnPortForward: spawnCfSshPortForward,
  waitForLocalPort,
};

async function raceForwardReadiness(
  handle: CfPortForwardHandle,
  dependencies: ApiTraceTunnelDependencies
): Promise<boolean> {
  let markFailed: () => void = () => undefined;
  const failedEarly = new Promise<false>((resolve) => {
    markFailed = (): void => {
      resolve(false);
    };
    handle.process.once('exit', markFailed);
    handle.process.once('error', markFailed);
  });
  const ready = dependencies.waitForLocalPort(handle.localPort, TRACE_TUNNEL_READY_TIMEOUT_MS);
  const outcome = await Promise.race([ready, failedEarly]);
  handle.process.removeListener('exit', markFailed);
  handle.process.removeListener('error', markFailed);
  return outcome;
}

function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        if (port === 0) {
          reject(new Error('Failed to allocate a local port.'));
          return;
        }
        resolve(port);
      });
    });
  });
}

function waitForLocalPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      const socket = netConnect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(attempt, TRACE_TUNNEL_READY_POLL_MS);
      });
    };
    attempt();
  });
}
