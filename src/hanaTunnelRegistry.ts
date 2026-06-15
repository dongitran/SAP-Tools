import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * On-disk registry of live `cf ssh` HANA-tunnel forwards, used purely for crash
 * recovery. Normal lifecycle (window close, scope change) tears tunnels down
 * in-process; but if the extension host is SIGKILLed, the spawned `cf ssh`
 * children are not killed and survive. Each forward is recorded here keyed by
 * the OWNER extension-host pid; on the next activation we reap entries whose
 * owner is gone (so other live windows' tunnels are left alone), killing the
 * `cf ssh` pid only after verifying it still points at the recorded HANA host
 * (guarding against pid reuse).
 *
 * File lives next to the other shared SAP-tools data; the name is
 * extension-specific because ~/.saptools is shared with the CDS Debug extension.
 * `os.homedir()` resolves to the user profile on Windows too, so the path is the
 * same on every platform.
 */

const SAPTOOLS_DIR_NAME = '.saptools';
const REGISTRY_FILENAME = 'sap-tools-vscode-tunnels.json';
const PROCESS_QUERY_TIMEOUT_MS = 4000;

export interface TunnelRegistryEntry {
  /** Extension-host pid that opened the forward (its liveness = tunnel ownership). */
  readonly ownerPid: number;
  /** The `cf ssh` process pid. */
  readonly pid: number;
  /** HANA instance host the tunnel serves (key shared by main + redirect forwards). */
  readonly mainHost: string;
  /** The actual forward target (main host or the tenant-redirect host). */
  readonly remoteHost: string;
  readonly localPort: number;
  readonly scope: string;
  readonly startedAt: string;
}

function saptoolsDir(): string {
  return join(homedir(), SAPTOOLS_DIR_NAME);
}

function registryPath(): string {
  return join(saptoolsDir(), REGISTRY_FILENAME);
}

function isEntry(value: unknown): value is TunnelRegistryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['ownerPid'] === 'number' &&
    typeof entry['pid'] === 'number' &&
    typeof entry['remoteHost'] === 'string'
  );
}

// Serialize read-modify-write within this process; cross-process writes are rare
// (tunnel open/close events) and the atomic rename keeps the file consistent.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function readEntries(): Promise<TunnelRegistryEntry[]> {
  try {
    const raw = await readFile(registryPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const tunnels =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['tunnels']
        : undefined;
    return Array.isArray(tunnels) ? tunnels.filter(isEntry) : [];
  } catch {
    return [];
  }
}

async function writeEntries(entries: readonly TunnelRegistryEntry[]): Promise<void> {
  const path = registryPath();
  await mkdir(saptoolsDir(), { recursive: true });
  const tempPath = `${path}.${String(process.pid)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ tunnels: entries }, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

export async function recordTunnelForward(entry: TunnelRegistryEntry): Promise<void> {
  await serialize(async () => {
    const entries = await readEntries();
    entries.push(entry);
    await writeEntries(entries);
  }).catch(() => undefined);
}

export async function removeTunnelForwardByPid(pid: number): Promise<void> {
  await serialize(async () => {
    const entries = await readEntries();
    const next = entries.filter((entry) => entry.pid !== pid);
    if (next.length !== entries.length) {
      await writeEntries(next);
    }
  }).catch(() => undefined);
}

export async function removeTunnelForwardsByOwner(ownerPid: number): Promise<void> {
  await serialize(async () => {
    const entries = await readEntries();
    const next = entries.filter((entry) => entry.ownerPid !== ownerPid);
    if (next.length !== entries.length) {
      await writeEntries(next);
    }
  }).catch(() => undefined);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readProcessCommandLine(pid: number): Promise<string | null> {
  try {
    if (platform() === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").CommandLine`,
        ],
        { timeout: PROCESS_QUERY_TIMEOUT_MS }
      );
      return stdout;
    }
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], {
      timeout: PROCESS_QUERY_TIMEOUT_MS,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function killOrphanedForward(
  entry: TunnelRegistryEntry,
  log: (message: string) => void
): Promise<void> {
  if (!isPidAlive(entry.pid)) {
    return;
  }
  // Guard against pid reuse: only kill if the live process still looks like our
  // `cf ssh` forward to the recorded HANA host. If we cannot read the command
  // line at all, fall back to killing (the owner window is gone and the pid is
  // alive — most likely still our orphan).
  const commandLine = await readProcessCommandLine(entry.pid);
  if (commandLine !== null && !commandLine.includes(entry.remoteHost)) {
    log(
      `[tunnel] skipped reaping pid ${String(entry.pid)} (reused by an unrelated process)`
    );
    return;
  }
  try {
    process.kill(entry.pid);
    log(
      `[tunnel] reaped orphaned tunnel pid ${String(entry.pid)} → ${entry.remoteHost} (from a previous session)`
    );
  } catch {
    /* already gone or no permission */
  }
}

/**
 * Reap forwards left behind by a crashed/killed previous session: kill any whose
 * owner extension-host pid is no longer alive, then rewrite the file with the
 * survivors (forwards still owned by other live windows). Call once on activate.
 */
export async function reapOrphanedTunnels(log: (message: string) => void): Promise<void> {
  await serialize(async () => {
    const entries = await readEntries();
    if (entries.length === 0) {
      return;
    }
    const survivors: TunnelRegistryEntry[] = [];
    const orphans: TunnelRegistryEntry[] = [];
    for (const entry of entries) {
      // An entry is owned by a live OTHER window → keep it. Our own freshly
      // started pid cannot legitimately own anything yet, so treat a match as a
      // reused pid → orphan.
      if (entry.ownerPid !== process.pid && isPidAlive(entry.ownerPid)) {
        survivors.push(entry);
      } else {
        orphans.push(entry);
      }
    }
    for (const orphan of orphans) {
      await killOrphanedForward(orphan, log);
    }
    if (orphans.length > 0) {
      await writeEntries(survivors);
    }
  }).catch(() => undefined);
}
