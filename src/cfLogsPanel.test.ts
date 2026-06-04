import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CfLogStreamHandle } from './cfClient';

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(() => ({
      toString: () => 'mock-uri',
    })),
  },
}));

import { CfLogsPanelProvider } from './cfLogsPanel';

interface AppStreamRuntimeForTest {
  readonly appName: string;
  readonly token: number;
  readonly handle: CfLogStreamHandle;
  lineRemainder: string;
  lineBuffer: string[];
  flushTimer: NodeJS.Timeout | null;
  stoppedByRequest: boolean;
}

interface CfLogsPanelTestAccess {
  readonly runningStreams: Map<string, AppStreamRuntimeForTest>;
  attachStreamListeners(stream: AppStreamRuntimeForTest): void;
  stopStream(appName: string, notify: boolean): void;
}

interface MockChildProcess extends EventEmitter {
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
}

function createMockProcess(): MockChildProcess {
  const process = new EventEmitter() as MockChildProcess;
  Object.defineProperties(process, {
    stdout: {
      value: new EventEmitter(),
    },
    stderr: {
      value: new EventEmitter(),
    },
  });
  return process;
}

function createStream(
  appName: string,
  process: MockChildProcess,
  stop: () => void
): AppStreamRuntimeForTest {
  return {
    appName,
    token: 1,
    handle: {
      process: process as unknown as ChildProcessWithoutNullStreams,
      stop,
    },
    lineRemainder: '',
    lineBuffer: [],
    flushTimer: null,
    stoppedByRequest: false,
  };
}

interface MockWebview {
  readonly htmlMessages: unknown[];
  html: string;
  options?: unknown;
  asWebviewUri(uri: unknown): unknown;
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
}

function createMockWebview(): MockWebview {
  return {
    htmlMessages: [],
    html: '',
    asWebviewUri: vi.fn((uri: unknown) => uri),
    postMessage: vi.fn(async function postMessage(
      this: MockWebview,
      message: unknown
    ): Promise<boolean> {
      this.htmlMessages.push(message);
      return true;
    }),
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function createProviderForSettings(globalState?: {
  get?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}): CfLogsPanelProvider {
  return new CfLogsPanelProvider({
    extensionUri: { toString: () => 'extension-uri' },
    globalState: {
      get: globalState?.get ?? vi.fn(),
      update: globalState?.update ?? vi.fn(),
    },
  } as unknown as ConstructorParameters<typeof CfLogsPanelProvider>[0]);
}

describe('CfLogsPanelProvider stream lifecycle', () => {
  it('detaches stream listeners before stopping a requested stream', () => {
    const provider = new CfLogsPanelProvider({
      extensionUri: { toString: () => 'extension-uri' },
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as ConstructorParameters<typeof CfLogsPanelProvider>[0]);
    const access = provider as unknown as CfLogsPanelTestAccess;
    const process = createMockProcess();
    const stop = vi.fn(() => {
      expect(process.stdout.listenerCount('data')).toBe(0);
      expect(process.stderr.listenerCount('data')).toBe(0);
      expect(process.listenerCount('exit')).toBe(0);
      expect(process.listenerCount('error')).toBe(0);
    });
    const stream = createStream('finance-uat-api', process, stop);

    access.runningStreams.set(stream.appName, stream);
    access.attachStreamListeners(stream);
    expect(process.stdout.listenerCount('data')).toBe(1);
    expect(process.stderr.listenerCount('data')).toBe(1);
    expect(process.listenerCount('exit')).toBe(1);
    expect(process.listenerCount('error')).toBe(1);

    access.stopStream(stream.appName, true);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stream.stoppedByRequest).toBe(true);
    expect(access.runningStreams.has(stream.appName)).toBe(false);
  });
});

describe('CfLogsPanelProvider message display setting', () => {
  it('renders a default-off setting to limit long message height', () => {
    const provider = createProviderForSettings();
    const webview = createMockWebview();

    provider.resolveWebviewView(
      { webview } as unknown as Parameters<CfLogsPanelProvider['resolveWebviewView']>[0]
    );

    expect(webview.html).toContain('id="settings-message-limit"');
    expect(webview.html).toContain('aria-label="Limit message height"');
    expect(webview.html).not.toMatch(/<input[^>]*id="settings-message-limit"[^>]*checked/i);
    expect(webview.htmlMessages).toContainEqual({
      type: 'sapTools.messageHeightLimitSettingInit',
      limitMessageHeight: false,
    });
  });

  it('keeps message cells fully expanded by default and limits only in compact mode', () => {
    const css = readFileSync(
      join(process.cwd(), 'docs/designs/prototypes/assets/cf-logs-panel.css'),
      'utf8'
    );

    expect(css).toMatch(
      /\.cf-log-table \.cell-message-text\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/
    );
    expect(css).toMatch(
      /\.cf-log-message-limited \.cf-log-table \.cell-message-text\s*\{[\s\S]*?max-height:\s*8\.5em;[\s\S]*?overflow:\s*auto;/
    );
  });

  it('initializes and persists the message height limit setting', async () => {
    const get = vi.fn((key: string): unknown =>
      key === 'cfLogsPanel.limitMessageHeight' ? true : undefined
    );
    const update = vi.fn(async () => undefined);
    const provider = createProviderForSettings({ get, update });
    const webview = createMockWebview();

    provider.resolveWebviewView(
      { webview } as unknown as Parameters<CfLogsPanelProvider['resolveWebviewView']>[0]
    );

    expect(webview.htmlMessages).toContainEqual({
      type: 'sapTools.messageHeightLimitSettingInit',
      limitMessageHeight: true,
    });

    await (provider as unknown as {
      handleWebviewMessage(message: unknown): Promise<void>;
    }).handleWebviewMessage({
      type: 'sapTools.saveMessageHeightLimitSetting',
      limitMessageHeight: false,
    });

    expect(update).toHaveBeenCalledWith('cfLogsPanel.limitMessageHeight', false);
  });
});
