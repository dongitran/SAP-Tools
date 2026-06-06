import { spawn } from 'node:child_process';

/**
 * Small streaming command runner shared by the local-package build/publish/install
 * steps and the Verdaccio installer. Mirrors the `child_process` usage in
 * `cfClient.ts` but streams combined stdout+stderr line-by-line to an optional sink
 * (so it can feed the `SAP Tools: NPM Build` Output channel) and stays free of any
 * VS Code dependency for testability.
 */

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunCommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Called with each chunk of combined stdout/stderr as it streams in. */
  readonly onOutput?: (chunk: string) => void;
  readonly timeoutMs?: number;
}

export class CommandFailedError extends Error {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(command: string, code: number, stdout: string, stderr: string) {
    const detail = stderr.trim().length > 0 ? stderr.trim() : stdout.trim();
    super(`Command "${command}" failed with exit code ${String(code)}: ${detail}`);
    this.name = 'CommandFailedError';
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Runs `command args` to completion, streaming output to `onOutput`. Resolves with the
 * captured output on exit code 0, rejects with {@link CommandFailedError} otherwise
 * (or a plain Error if the process could not be spawned, e.g. the binary is missing).
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? setTimeout(() => {
            if (!child.killed) {
              child.kill();
            }
          }, options.timeoutMs)
        : undefined;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      fn();
    };

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options.onOutput?.(text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options.onOutput?.(text);
    });

    child.on('error', (error) => {
      finish(() => {
        reject(error);
      });
    });

    child.on('close', (code) => {
      const exitCode = code ?? 0;
      if (exitCode === 0) {
        finish(() => {
          resolve({ code: exitCode, stdout, stderr });
        });
      } else {
        finish(() => {
          reject(new CommandFailedError(command, exitCode, stdout, stderr));
        });
      }
    });
  });
}
