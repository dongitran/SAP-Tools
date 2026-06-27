import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  ALL_COLUMN_IDS,
  CF_SESSION_NOT_READY_PATTERNS,
  FILE_LOG_MODES,
  FONT_SIZE_PRESETS,
  LOG_LIMIT_PRESETS,
  REQUIRED_COLUMN_IDS,
} from './cfLogsPanel.types';
import type { FileLogMode } from './cfLogsPanel.types';

export function isTestMode(): boolean {
  return process.env['SAP_TOOLS_TEST_MODE'] === '1';
}

export function isCfSessionNotReadyLine(line: string): boolean {
  return CF_SESSION_NOT_READY_PATTERNS.some((pattern) => pattern.test(line));
}

export function isCfCliFailedMarkerLine(line: string): boolean {
  return line.trim().toUpperCase() === 'FAILED';
}

export function shouldRetryPreparedSession(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes('not logged in') ||
    normalized.includes('cf login') ||
    normalized.includes('no org and space targeted') ||
    normalized.includes('not targeted')
  );
}

export function splitLinesWithRemainder(
  existingRemainder: string,
  incomingChunk: string
): { lines: string[]; remainder: string } {
  const combined = `${existingRemainder}${incomingChunk}`;
  const parts = combined.split(/\r?\n/);
  const remainder = parts.pop() ?? '';
  const lines = parts.filter((line) => line.length > 0);
  return { lines, remainder };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractStringColumns(values: readonly unknown[]): string[] {
  return values.filter(
    (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 32
  );
}

export function normalizeVisibleColumns(columnIds: readonly string[]): string[] {
  const selected = new Set<string>();

  for (const columnId of columnIds) {
    if (isKnownColumnId(columnId)) {
      selected.add(columnId);
    }
  }

  for (const requiredColumnId of REQUIRED_COLUMN_IDS) {
    selected.add(requiredColumnId);
  }

  return ALL_COLUMN_IDS.filter((columnId) => selected.has(columnId));
}

export function isKnownColumnId(value: string): value is (typeof ALL_COLUMN_IDS)[number] {
  return (ALL_COLUMN_IDS as readonly string[]).includes(value);
}

export function isKnownFontSizePreset(value: string): value is (typeof FONT_SIZE_PRESETS)[number] {
  return (FONT_SIZE_PRESETS as readonly string[]).includes(value);
}

export function isKnownFileLogMode(value: string): value is FileLogMode {
  return (FILE_LOG_MODES as readonly string[]).includes(value);
}

export function expandFileLogDirectory(rawDirectory: string): string {
  if (rawDirectory === '~') {
    return os.homedir();
  }
  if (rawDirectory.startsWith('~/') || rawDirectory.startsWith('~\\')) {
    return path.join(os.homedir(), rawDirectory.slice(2));
  }
  if (path.isAbsolute(rawDirectory)) {
    return rawDirectory;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return path.join(workspaceRoot ?? os.homedir(), rawDirectory);
}

export function buildUniqueLogFilePath(directory: string, appName: string): string {
  const baseName = `${sanitizeFileNameComponent(appName)}_${formatFileLogTimestamp(new Date())}`;
  let candidate = path.join(directory, `${baseName}.log`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${baseName}_${String(suffix)}.log`);
    suffix += 1;
  }
  return candidate;
}

export const WINDOWS_RESERVED_FILE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFileNameComponent(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  if (sanitized.length === 0) {
    return 'app';
  }
  return WINDOWS_RESERVED_FILE_NAMES.test(sanitized) ? `app-${sanitized}` : sanitized;
}

export function formatFileLogTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const datePart = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${datePart}_${timePart}`;
}

export function isKnownLogLimit(value: number): value is (typeof LOG_LIMIT_PRESETS)[number] {
  return (LOG_LIMIT_PRESETS as readonly number[]).includes(value);
}

export function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 24; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    nonce += alphabet[randomIndex] ?? 'A';
  }
  return nonce;
}