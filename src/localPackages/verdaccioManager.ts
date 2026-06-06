import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type * as vscode from 'vscode';

import { runCommand } from './processRunner';
import { generateVerdaccioConfigYaml } from './verdaccioConfig';

/**
 * Owns the lifecycle of a self-hosted Verdaccio registry used to publish locally-built
 * packages. Verdaccio is installed on first use into a managed folder
 * (`~/.saptools/verdaccio`) — it is an external managed process (like the `cf`/`cds`
 * CLIs), never bundled into the VSIX — and SAP Tools starts/stops/pings it.
 */

const VERDACCIO_VERSION = '5';
const VERDACCIO_HOME = join(homedir(), '.saptools', 'verdaccio');
const CONFIG_PATH = join(VERDACCIO_HOME, 'config.yaml');
const READY_TIMEOUT_MS = 40_000;
const READY_POLL_INTERVAL_MS = 400;

export interface VerdaccioStartOptions {
  readonly port: number;
  readonly scopes: readonly string[];
}

export interface VerdaccioStatus {
  readonly installed: boolean;
  readonly running: boolean;
  readonly installing: boolean;
  readonly url: string;
}

export class VerdaccioManager implements vscode.Disposable {
  private process: ChildProcess | undefined;
  private running = false;
  private installing = false;
  private startPromise: Promise<void> | undefined;
  private lastPort: number;
  private readonly authToken = randomBytes(16).toString('hex');

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    defaultPort = 4873
  ) {
    this.lastPort = defaultPort;
  }

  getRegistryUrl(port = this.lastPort): string {
    return `http://localhost:${String(port)}`;
  }

  /**
   * A bearer token sent on publish/install so the npm CLI is satisfied; the generated
   * config grants the configured scopes `$all` publish access, so Verdaccio accepts it
   * (an unknown token simply falls back to the anonymous user).
   */
  getAuthToken(): string {
    return this.authToken;
  }

  async isInstalled(): Promise<boolean> {
    return fileExists(join(VERDACCIO_HOME, 'node_modules', 'verdaccio', 'package.json'));
  }

  async status(): Promise<VerdaccioStatus> {
    return {
      installed: await this.isInstalled(),
      running: this.running,
      installing: this.installing,
      url: this.getRegistryUrl(),
    };
  }

  /**
   * Ensures Verdaccio is installed and running on `options.port`. Idempotent: if it is
   * already up and answering `/-/ping`, returns immediately; concurrent calls share a
   * single in-flight start.
   */
  async start(options: VerdaccioStartOptions): Promise<void> {
    this.lastPort = options.port;
    if (this.running && (await this.ping(options.port))) {
      return;
    }
    if (this.startPromise !== undefined) {
      return this.startPromise;
    }
    this.startPromise = this.doStart(options).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async doStart(options: VerdaccioStartOptions): Promise<void> {
    await this.ensureInstalled();
    await this.writeConfig(options);

    const entry = await this.resolveVerdaccioEntry();
    this.log(`Starting Verdaccio on ${this.getRegistryUrl(options.port)} …`);
    const child = spawn(
      process.execPath,
      [entry, '--config', CONFIG_PATH, '--listen', `localhost:${String(options.port)}`],
      { cwd: VERDACCIO_HOME, env: process.env }
    );
    this.process = child;

    child.stdout.on('data', (data: Buffer) => {
      this.logRaw(data.toString());
    });
    child.stderr.on('data', (data: Buffer) => {
      this.logRaw(data.toString());
    });
    child.on('exit', (code) => {
      this.running = false;
      if (this.process === child) {
        this.process = undefined;
      }
      this.log(`Verdaccio stopped (exit code ${String(code ?? 0)}).`);
    });

    await this.waitForReady(options.port);
    this.running = true;
    this.log('Verdaccio is ready.');
  }

  async ensureInstalled(): Promise<void> {
    if (await this.isInstalled()) {
      return;
    }
    this.installing = true;
    try {
      await mkdir(VERDACCIO_HOME, { recursive: true });
      await writeFile(
        join(VERDACCIO_HOME, 'package.json'),
        `${JSON.stringify({ name: 'saptools-local-registry', private: true }, null, 2)}\n`,
        'utf8'
      );
      this.log(
        `Installing verdaccio@${VERDACCIO_VERSION} into ${VERDACCIO_HOME} (first run only) …`
      );
      await runCommand(
        'npm',
        [
          'install',
          `verdaccio@${VERDACCIO_VERSION}`,
          '--prefix',
          VERDACCIO_HOME,
          '--no-audit',
          '--no-fund',
          '--loglevel=http',
        ],
        {
          cwd: VERDACCIO_HOME,
          onOutput: (chunk) => {
            this.logRaw(chunk);
          },
        }
      );
      this.log('Verdaccio installed.');
    } finally {
      this.installing = false;
    }
  }

  private async writeConfig(options: VerdaccioStartOptions): Promise<void> {
    await mkdir(join(VERDACCIO_HOME, 'storage'), { recursive: true });
    await writeFile(CONFIG_PATH, generateVerdaccioConfigYaml(options), 'utf8');
  }

  private async resolveVerdaccioEntry(): Promise<string> {
    const packageDir = join(VERDACCIO_HOME, 'node_modules', 'verdaccio');
    try {
      const raw = await readFile(join(packageDir, 'package.json'), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const bin = isRecord(parsed) ? parsed['bin'] : undefined;
      let relative = 'bin/verdaccio';
      if (typeof bin === 'string') {
        relative = bin;
      } else if (isRecord(bin) && typeof bin['verdaccio'] === 'string') {
        relative = bin['verdaccio'];
      }
      return join(packageDir, relative);
    } catch {
      return join(packageDir, 'bin', 'verdaccio');
    }
  }

  private async waitForReady(port: number): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.ping(port)) {
        return;
      }
      await delay(READY_POLL_INTERVAL_MS);
    }
    this.stop();
    throw new Error(
      `Verdaccio did not become ready on ${this.getRegistryUrl(port)} within ${String(
        READY_TIMEOUT_MS / 1000
      )}s.`
    );
  }

  private ping(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const request = httpGet(
        { host: 'localhost', port, path: '/-/ping', timeout: 2000 },
        (response) => {
          response.resume();
          resolve(response.statusCode === 200);
        }
      );
      request.on('error', () => {
        resolve(false);
      });
      request.on('timeout', () => {
        request.destroy();
        resolve(false);
      });
    });
  }

  stop(): void {
    const child = this.process;
    this.process = undefined;
    this.running = false;
    if (child !== undefined && !child.killed) {
      child.kill();
    }
  }

  dispose(): void {
    this.stop();
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[local-registry] ${message}`);
  }

  private logRaw(chunk: string): void {
    if (chunk.trim().length > 0) {
      this.outputChannel.append(chunk);
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
