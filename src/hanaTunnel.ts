import { connect as netConnect, createServer, type Socket } from 'node:net';

import { prepareCfCliSession, spawnCfSshPortForward, type CfPortForwardHandle } from './cfClient';
import type { HanaConnection } from './hanaSqlService';
import {
  recordTunnelForward,
  removeTunnelForwardByPid,
  removeTunnelForwardsByOwner,
} from './hanaTunnelRegistry';

/**
 * Auto-tunnel for HANA Cloud SQL access.
 *
 * Some HANA Cloud instances are unreachable directly from a developer machine
 * (stopped, IP-allowlisted, or behind a corporate network) — the TLS handshake
 * is reset and table discovery / queries fail. When that happens the SQL
 * workbench falls back here: we open a `cf ssh` local port-forward through a
 * running app in the same space (whose egress IS allowed to reach HANA) and
 * route the hdb connection through it.
 *
 * Two subtleties, both proven out manually before this was built:
 *   1. HANA Cloud routes by SNI and then REDIRECTS the connection to a tenant
 *      host (`<guid>-0.<tenant>.hna0…`). hdb opens a brand-new socket to that
 *      host, so we must also forward it. The redirect host is not in the CF
 *      binding, so we DISCOVER it: on the first tunneled attempt the redirect
 *      socket is captured by a `net.Socket.prototype.connect` interceptor, then
 *      forwarded and cached for next time.
 *   2. The tunneled socket targets 127.0.0.1:<ephemeral>, so TLS must be forced
 *      (hdb only auto-enables it for port 443), SNI must stay the real host, and
 *      certificate validation is disabled (the cert host differs from
 *      127.0.0.1; bytes still travel end-to-end TLS to the real HANA over the
 *      authenticated SSH forward).
 *
 * This module is inert until a tunnel is actually requested: the socket
 * interceptor is installed lazily and, with an empty reroute map, is a no-op —
 * the normal (non-tunnel) connection path is never altered.
 */

export interface HanaTunnelCfSession {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir: string;
}

export interface ActiveHanaTunnel {
  readonly mainHost: string;
  readonly localPort: number;
}

interface TunnelRecord {
  readonly mainHost: string;
  readonly localPort: number;
  readonly app: string;
  redirectHost: string | undefined;
  readonly handles: CfPortForwardHandle[];
}

const TUNNEL_KEEPALIVE_SECONDS = 6 * 60 * 60;
const TUNNEL_READY_TIMEOUT_MS = 20_000;
const TUNNEL_READY_POLL_MS = 200;

// --- process-wide socket reroute (installed lazily, no-op when map empty) ----
//
// Keyed by the REAL HANA host that hdb tries to reach (the redirect host); the
// value is the local forward port it should be sent to instead. The main
// connection already targets 127.0.0.1 directly, so only redirect hosts ever
// appear here.
const rerouteMap = new Map<string, number>();
// Hosts hdb tried to reach that we are not yet forwarding — redirect-host
// candidates. A Set (rather than a single slot) keeps concurrent tunnels from
// clobbering each other; the consumer matches by instance GUID.
const capturedHosts = new Set<string>();
// Capture is armed only during an active redirect-discovery window (a tunneled
// connect attempt that has no redirect forward yet), refcounted so concurrent
// discoveries don't disarm each other. Outside that window the interceptor
// never records anything — direct connections to other HANA instances are
// untouched.
let captureDepth = 0;
let interceptorInstalled = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHanaCloudHost(host: string): boolean {
  return host.endsWith('.hanacloud.ondemand.com');
}

/** The instance identifier shared by a HANA Cloud host and its tenant-redirect host. */
function instanceGuidOf(host: string): string {
  return host.split('.')[0] ?? host;
}

function installSocketInterceptor(): void {
  if (interceptorInstalled) {
    return;
  }
  // Loaded lazily so the patch only exists once tunneling is actually used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const net = require('node:net') as typeof import('node:net');
  type ConnectFn = (this: Socket, ...args: unknown[]) => unknown;
  const prototype = net.Socket.prototype as unknown as { connect: ConnectFn };
  const original = prototype.connect;
  prototype.connect = function patchedConnect(this: Socket, ...args: unknown[]): unknown {
    const options = args[0];
    if (isRecord(options) && typeof options['host'] === 'string') {
      const host = options['host'];
      const localPort = rerouteMap.get(host);
      if (localPort !== undefined) {
        // Redirect hdb's connection to the local forward; keep every other
        // option (servername, TLS settings, callbacks) intact.
        args[0] = { ...options, host: '127.0.0.1', port: localPort };
      } else if (captureDepth > 0 && isHanaCloudHost(host)) {
        // A HANA Cloud host we are NOT forwarding yet — the tenant redirect
        // target. Record it so the caller can open a forward and retry.
        capturedHosts.add(host);
      }
    }
    return original.apply(this, args);
  };
  interceptorInstalled = true;
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
          reject(new Error('Failed to allocate a local port for the HANA tunnel.'));
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
        setTimeout(attempt, TUNNEL_READY_POLL_MS);
      });
    };
    attempt();
  });
}

export class HanaTunnelManager {
  private readonly tunnels = new Map<string, TunnelRecord>();
  private readonly pending = new Map<string, Promise<ActiveHanaTunnel | null>>();
  // Discovered tenant-redirect host per HANA instance; stable for the session,
  // so later tunnels open both forwards upfront and skip rediscovery.
  private readonly redirectCache = new Map<string, string>();

  constructor(
    private readonly log: (message: string) => void,
    private readonly onClosed: (mainHost: string) => void = () => undefined
  ) {}

  isActive(mainHost: string): boolean {
    return this.tunnels.has(mainHost);
  }

  /**
   * Return (and consume) a captured tenant-redirect host belonging to the given
   * HANA instance. Matching by instance GUID prevents a host captured for a
   * different, directly-connected instance from being mistaken for this one's
   * redirect target.
   */
  takeCapturedRedirectHost(mainHost: string): string | undefined {
    const guid = instanceGuidOf(mainHost);
    for (const host of capturedHosts) {
      // The redirect host is `<guid>-<n>.<tenant>…`; require a separator right
      // after the guid so one instance id can never prefix-match another.
      if (host !== mainHost && (host.startsWith(`${guid}-`) || host.startsWith(`${guid}.`))) {
        capturedHosts.delete(host);
        return host;
      }
    }
    return undefined;
  }

  /** Arm/disarm redirect-host capture for the duration of a discovery attempt. */
  beginRedirectCapture(): void {
    captureDepth += 1;
  }

  endRedirectCapture(): void {
    captureDepth = Math.max(0, captureDepth - 1);
  }

  /**
   * Build the hdb connection that routes through an already-open tunnel for
   * `direct.host`. Returns `direct` unchanged when no tunnel exists.
   */
  buildTunneledConnection(direct: HanaConnection): HanaConnection {
    const tunnel = this.tunnels.get(direct.host);
    if (tunnel === undefined) {
      return direct;
    }
    return {
      host: '127.0.0.1',
      port: tunnel.localPort,
      user: direct.user,
      password: direct.password,
      ...(direct.database !== undefined ? { database: direct.database } : {}),
      servername: direct.host,
      forceTls: true,
      validateCertificate: false,
    };
  }

  async ensureTunnel(
    session: HanaTunnelCfSession,
    mainHost: string,
    appCandidates: readonly string[]
  ): Promise<ActiveHanaTunnel | null> {
    const existing = this.tunnels.get(mainHost);
    if (existing !== undefined) {
      return { mainHost, localPort: existing.localPort };
    }
    const inFlight = this.pending.get(mainHost);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const created = this.createMainTunnel(session, mainHost, appCandidates).finally(() => {
      this.pending.delete(mainHost);
    });
    this.pending.set(mainHost, created);
    return created;
  }

  async ensureRedirectForward(
    session: HanaTunnelCfSession,
    mainHost: string,
    redirectHost: string,
    appCandidates: readonly string[]
  ): Promise<boolean> {
    const tunnel = this.tunnels.get(mainHost);
    if (tunnel === undefined) {
      return false;
    }
    if (tunnel.redirectHost === redirectHost && rerouteMap.has(redirectHost)) {
      return true;
    }
    return this.openRedirect(session, tunnel, redirectHost, appCandidates);
  }

  /** Tear down the tunnel for one host (dead forward, scope change). Idempotent. */
  invalidate(mainHost: string): void {
    const tunnel = this.tunnels.get(mainHost);
    if (tunnel === undefined) {
      return;
    }
    this.tunnels.delete(mainHost);
    if (tunnel.redirectHost !== undefined) {
      rerouteMap.delete(tunnel.redirectHost);
    }
    for (const handle of tunnel.handles) {
      handle.stop();
      this.forgetForward(handle);
    }
    this.log(`[tunnel] closed HANA tunnel for ${mainHost}`);
    this.onClosed(mainHost);
  }

  dispose(): void {
    // Clear the map first so the forwards' 'exit' handlers (which call
    // invalidate) become no-ops and we don't mutate while iterating.
    const records = [...this.tunnels.values()];
    this.tunnels.clear();
    this.pending.clear();
    rerouteMap.clear();
    capturedHosts.clear();
    captureDepth = 0;
    for (const tunnel of records) {
      for (const handle of tunnel.handles) {
        handle.stop();
      }
    }
    void removeTunnelForwardsByOwner(process.pid);
  }

  private persistForward(
    session: HanaTunnelCfSession,
    mainHost: string,
    remoteHost: string,
    handle: CfPortForwardHandle
  ): void {
    const pid = handle.process.pid;
    if (pid === undefined) {
      return;
    }
    void recordTunnelForward({
      ownerPid: process.pid,
      pid,
      mainHost,
      remoteHost,
      localPort: handle.localPort,
      scope: `${session.orgName}/${session.spaceName}`,
      startedAt: new Date().toISOString(),
    });
  }

  private forgetForward(handle: CfPortForwardHandle): void {
    const pid = handle.process.pid;
    if (pid !== undefined) {
      void removeTunnelForwardByPid(pid);
    }
  }

  private async createMainTunnel(
    session: HanaTunnelCfSession,
    mainHost: string,
    appCandidates: readonly string[]
  ): Promise<ActiveHanaTunnel | null> {
    installSocketInterceptor();
    // Prepare the CF session once (api/auth/target are app-independent), not
    // per app/forward attempt.
    if (!(await this.prepareSession(session))) {
      return null;
    }
    for (const app of appCandidates) {
      const handle = await this.openForward(app, mainHost, session.cfHomeDir);
      if (handle === null) {
        continue;
      }
      const tunnel: TunnelRecord = {
        mainHost,
        localPort: handle.localPort,
        app,
        redirectHost: undefined,
        handles: [handle],
      };
      this.tunnels.set(mainHost, tunnel);
      this.persistForward(session, mainHost, mainHost, handle);
      // When the keep-alive ends or the SSH session drops, drop the tunnel so
      // the next operation re-establishes it through the normal fallback.
      handle.process.once('exit', () => {
        this.invalidate(mainHost);
      });
      this.log(
        `[tunnel] opened HANA tunnel for ${mainHost} via app ${app} on 127.0.0.1:${String(handle.localPort)}`
      );
      const cachedRedirect = this.redirectCache.get(mainHost);
      if (cachedRedirect !== undefined) {
        await this.openRedirect(session, tunnel, cachedRedirect, appCandidates);
      }
      return { mainHost, localPort: handle.localPort };
    }
    this.log(
      `[tunnel] could not open a HANA tunnel for ${mainHost}: no SSH-capable running app in the space`
    );
    return null;
  }

  private async prepareSession(session: HanaTunnelCfSession): Promise<boolean> {
    try {
      await prepareCfCliSession(session);
      return true;
    } catch (error) {
      this.log(`[tunnel] CF session preparation failed: ${describeError(error)}`);
      return false;
    }
  }

  private async openRedirect(
    session: HanaTunnelCfSession,
    tunnel: TunnelRecord,
    redirectHost: string,
    appCandidates: readonly string[]
  ): Promise<boolean> {
    if (!(await this.prepareSession(session))) {
      return false;
    }
    const candidates = [tunnel.app, ...appCandidates.filter((app) => app !== tunnel.app)];
    for (const app of candidates) {
      const handle = await this.openForward(app, redirectHost, session.cfHomeDir);
      if (handle === null) {
        continue;
      }
      rerouteMap.set(redirectHost, handle.localPort);
      tunnel.redirectHost = redirectHost;
      tunnel.handles.push(handle);
      this.persistForward(session, tunnel.mainHost, redirectHost, handle);
      this.redirectCache.set(tunnel.mainHost, redirectHost);
      this.log(
        `[tunnel] opened HANA redirect forward ${redirectHost} via app ${app} on 127.0.0.1:${String(handle.localPort)}`
      );
      return true;
    }
    this.log(`[tunnel] could not open redirect forward for ${redirectHost}`);
    return false;
  }

  private async openForward(
    appName: string,
    remoteHost: string,
    cfHomeDir: string
  ): Promise<CfPortForwardHandle | null> {
    let localPort: number;
    try {
      localPort = await findFreePort();
    } catch (error) {
      this.log(`[tunnel] port allocation failed: ${describeError(error)}`);
      return null;
    }

    const handle = spawnCfSshPortForward({
      appName,
      localPort,
      remoteHost,
      remotePort: 443,
      keepAliveSeconds: TUNNEL_KEEPALIVE_SECONDS,
      cfHomeDir,
    });

    let stderr = '';
    const onStderr = (chunk: Buffer): void => {
      if (stderr.length < 4096) {
        stderr += chunk.toString('utf8');
      }
    };
    handle.process.stderr.on('data', onStderr);

    // Race port readiness against the process dying. An app without SSH enabled
    // (or a missing app) makes `cf ssh` exit almost immediately, so racing keeps
    // us from waiting out the full readiness timeout before trying the next app.
    const onFailExit = (): void => {
      resolveFailed();
    };
    let resolveFailed: () => void = () => undefined;
    const failedEarly = new Promise<'failed'>((resolve) => {
      resolveFailed = (): void => {
        resolve('failed');
      };
      handle.process.once('exit', onFailExit);
      handle.process.once('error', onFailExit);
    });
    const outcome = await Promise.race([
      waitForLocalPort(localPort, TUNNEL_READY_TIMEOUT_MS).then((ok) =>
        ok ? ('ready' as const) : ('timeout' as const)
      ),
      failedEarly,
    ]);

    // Stop accumulating stderr / holding the race listeners for the life of a
    // healthy 6-hour forward; the tunnel's own 'exit' handler covers teardown.
    handle.process.stderr.removeListener('data', onStderr);
    handle.process.removeListener('exit', onFailExit);
    handle.process.removeListener('error', onFailExit);

    if (outcome !== 'ready') {
      handle.stop();
      const detail = stderr.trim().split('\n').pop()?.trim() ?? '';
      this.log(
        `[tunnel] forward via ${appName} to ${remoteHost} ${outcome === 'timeout' ? 'timed out' : 'failed'}${detail.length > 0 ? `: ${detail}` : ''}`
      );
      return null;
    }
    return handle;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
