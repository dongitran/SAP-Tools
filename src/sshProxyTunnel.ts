
import { createServer as createNetServer, type Server } from 'node:net';
import type { Duplex } from 'node:stream';
import type { Client, ClientChannel, ConnectConfig } from 'ssh2';
import * as vscode from 'vscode';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

let ssh2ClientClass: typeof Client | undefined;
let socks5CreateServer: typeof import('@pondwader/socks5-server').createServer | undefined;

function getSsh2ClientClass(): typeof Client {
  if (ssh2ClientClass !== undefined) return ssh2ClientClass;
  const requireFromHere = createRequire(__filename);
  const vendoredEntry = join(__dirname, 'vendor', 'ssh2', 'lib', 'client.js');
  const specifier = existsSync(vendoredEntry) ? vendoredEntry : 'ssh2';
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  ssh2ClientClass = requireFromHere(specifier).Client;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return ssh2ClientClass!;
}

function getSocks5CreateServer(): typeof import('@pondwader/socks5-server').createServer {
  if (socks5CreateServer !== undefined) return socks5CreateServer;
  const requireFromHere = createRequire(__filename);
  const vendoredEntry = join(__dirname, 'vendor', '@pondwader', 'socks5-server', 'dist', 'index.js');
  const specifier = existsSync(vendoredEntry) ? vendoredEntry : '@pondwader/socks5-server';
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  socks5CreateServer = requireFromHere(specifier).createServer;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return socks5CreateServer!;
}

export interface LocalSocksProxy {
  host: '127.0.0.1';
  port: number;
}

export interface SshProxySettings {
  enabled?: boolean;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

interface SocksConnection {
  command: string;
  destAddress: string;
  destPort: number;
  socket: Duplex;
}

type SocksSendStatus = (status: string) => void;

interface SocksProtocol {
  setConnectionHandler(handler: (connection: SocksConnection, sendStatus: SocksSendStatus) => void): void;
  _handleConnection(socket: Duplex): void;
}

let sshClient: Client | undefined;
let socksServer: Server | undefined;
let activeProxy: LocalSocksProxy | undefined;
let activeIdentity: string | undefined;
let connecting: Promise<LocalSocksProxy | undefined> | undefined;
let cancelPendingConnection: (() => void) | undefined;
let lifecycleVersion = 0;
const activeStreams = new Set<Duplex>();

function getConnectionIdentity(config: SshProxySettings): string {
  return JSON.stringify([config.host ?? '', config.port ?? 22, config.username ?? '', config.password ?? '']);
}

export async function ensureSshProxy(): Promise<LocalSocksProxy | undefined> {
  const config = vscode.workspace.getConfiguration('sapTools').get<SshProxySettings>('sshProxy') ?? {};
  if (config.enabled !== true) {
    return undefined;
  }
  if (typeof config.host !== 'string' || config.host.length === 0 || typeof config.username !== 'string' || config.username.length === 0) {
    throw new Error('SSH proxy is enabled but host/username is not configured in SAP Tools settings.');
  }

  const identity = getConnectionIdentity(config);
  if (activeProxy !== undefined && activeIdentity === identity) {
    return activeProxy;
  }
  if (connecting !== undefined) {
    return connecting;
  }

  const version = ++lifecycleVersion;
  const tracked = connectSshProxy(config, version).finally(() => {
    if (connecting === tracked) {
      connecting = undefined;
    }
  });
  connecting = tracked;
  return tracked;
}

async function connectSshProxy(config: SshProxySettings, version: number): Promise<LocalSocksProxy> {
  await closeRuntime();
  if (version !== lifecycleVersion) {
    throw new Error('SSH proxy connection was canceled.');
  }
  return openSshConnection(config, version);
}

async function openSshConnection(config: SshProxySettings, version: number): Promise<LocalSocksProxy> {
  const ClientClass = getSsh2ClientClass();
  const client = new ClientClass();
  sshClient = client;
  const ready = waitForSshReady(client, config, version);
  
  const connectConfig: ConnectConfig = {
    host: config.host ?? '',
    port: config.port ?? 22,
    username: config.username ?? '',
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
  };
  
  if (typeof config.password === 'string' && config.password.length > 0) {
    connectConfig.password = config.password;
  }

  client.connect(connectConfig);
  return ready;
}

function waitForSshReady(client: Client, config: SshProxySettings, version: number): Promise<LocalSocksProxy> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      client.removeListener('error', fail);
      client.removeListener('ready', ready);
      if (cancelPendingConnection === cancel) {
        cancelPendingConnection = undefined;
      }
    };
    const rejectOnce = (message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const fail = (error: unknown): void => {
      if (sshClient !== client) {
        return;
      }
      const raw = error instanceof Error ? error.message : String(error);
      const message = typeof config.password === 'string' && config.password.length > 0 ? raw.split(config.password).join('[redacted]') : raw;
      rejectOnce(message);
      void handleConnectionFailure(client, message);
    };
    const cancel = (): void => {
      rejectOnce('SSH proxy connection was canceled.');
    };
    const ready = (): void => {
      void finishConnection(client, config, version).then((proxy) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        bindConnectedClientLifecycle(client);
        resolve(proxy);
      }, fail);
    };
    cancelPendingConnection = cancel;
    client.once('error', fail);
    client.once('ready', ready);
  });
}

async function finishConnection(client: Client, config: SshProxySettings, version: number): Promise<LocalSocksProxy> {
  if (sshClient !== client || version !== lifecycleVersion) {
    throw new Error('SSH proxy connection was canceled.');
  }
  const port = await startSocksServer(client);
  if (sshClient !== client || version !== lifecycleVersion) {
    throw new Error('SSH proxy connection was canceled.');
  }
  activeIdentity = getConnectionIdentity(config);
  activeProxy = { host: '127.0.0.1', port };
  return activeProxy;
}

async function startSocksServer(client: Client): Promise<number> {
  const protocol = getSocks5CreateServer()() as unknown as SocksProtocol;
  protocol.setConnectionHandler((connection: SocksConnection, sendStatus: SocksSendStatus) => {
    if (connection.command !== 'connect') {
      sendStatus('COMMAND_NOT_SUPPORTED');
      return;
    }
    client.forwardOut('127.0.0.1', 0, connection.destAddress, connection.destPort, (error: Error | undefined, channel: ClientChannel) => {
      if (error !== undefined) {
        sendStatus('HOST_UNREACHABLE');
        return;
      }
      sendStatus('REQUEST_GRANTED');
      pipeProxyStreams(connection.socket, channel);
    });
  });
  const server = createNetServer((socket) => {
    socket.setNoDelay();
    protocol._handleConnection(socket);
  });
  socksServer = server;
  return listenOnLoopback(server);
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => {
      server.removeListener('error', fail);
      reject(error);
    };
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', fail);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not allocate a local SOCKS port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function pipeProxyStreams(socket: Duplex, channel: ClientChannel): void {
  activeStreams.add(socket);
  activeStreams.add(channel);
  const cleanup = (): void => {
    activeStreams.delete(socket);
    activeStreams.delete(channel);
  };
  socket.once('close', cleanup);
  channel.once('close', cleanup);
  socket.pipe(channel);
  channel.pipe(socket);
}

function bindConnectedClientLifecycle(client: Client): void {
  client.once('close', () => {
    if (sshClient !== client) {
      return;
    }
    void handleConnectionFailure(client, 'SSH proxy connection closed.');
  });
  client.on('error', (error: Error) => {
    if (sshClient !== client) {
      return;
    }
    void handleConnectionFailure(client, error.message);
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleConnectionFailure(client: Client, message: string): Promise<void> {
  if (sshClient !== client) {
    return;
  }
  await closeRuntime();
}

async function closeRuntime(): Promise<void> {
  const cancel = cancelPendingConnection;
  cancelPendingConnection = undefined;
  cancel?.();
  for (const stream of activeStreams) {
    stream.destroy();
  }
  activeStreams.clear();
  const server = socksServer;
  socksServer = undefined;
  if (server !== undefined) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  const client = sshClient;
  sshClient = undefined;
  client?.end();
  activeProxy = undefined;
  activeIdentity = undefined;
}

export async function disposeSshProxy(): Promise<void> {
  await closeRuntime();
}
