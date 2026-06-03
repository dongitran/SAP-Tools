// cspell:words dgimsuvy
import { dirname } from 'node:path';

/**
 * Resolves the remote container folder that artifact exports (e.g. pnpm-lock.yaml)
 * should be read from. The setting is shared in shape with the cds-debug extension
 * (`cdsDebug.sharedCapDebugConfig.remoteRoot`): a value can be a literal path, or a
 * regex (`regex:<pattern>` or `/pattern/flags`) that is matched against the folders
 * holding a `package.json` inside the running CF app container.
 */

const REGEX_PREFIX = 'regex:';
const PACKAGE_JSON_SUFFIX = '/package.json';
const REGEX_FLAGS_PATTERN = /^[dgimsuvy]*$/;

export type RemoteRootSetting =
  | { readonly kind: 'none' }
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'regex'; readonly pattern: string; readonly flags: string; readonly regex: RegExp }
  | { readonly kind: 'invalid-regex'; readonly value: string; readonly error: string };

export type RemoteRootResolution =
  | { readonly status: 'none' }
  | { readonly status: 'literal'; readonly remoteRoot: string }
  | { readonly status: 'resolved'; readonly remoteRoot: string; readonly pattern: string }
  | { readonly status: 'unmatched'; readonly pattern: string }
  | { readonly status: 'invalid-regex'; readonly error: string };

export interface ResolveRemoteRootOptions {
  readonly findPackageJsonPaths?: (appName: string) => Promise<readonly string[]>;
}

/**
 * Classifies the configured value into none/literal/regex/invalid-regex without
 * touching the network so callers can short-circuit the cheap cases.
 */
export function parseRemoteRootSetting(value: string | undefined): RemoteRootSetting {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return { kind: 'none' };
  }

  if (trimmed.startsWith(REGEX_PREFIX)) {
    return toRegexSetting(trimmed.slice(REGEX_PREFIX.length), '', trimmed);
  }

  const slashRegex = parseSlashDelimitedRegex(trimmed);
  if (slashRegex !== null) {
    return toRegexSetting(slashRegex.pattern, slashRegex.flags, trimmed);
  }

  return { kind: 'literal', value: trimmed };
}

/**
 * Reduces an absolute `.../package.json` path to its containing folder, rejecting
 * anything that is not a clean absolute package.json path.
 */
export function normalizeRemotePackageJsonPath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed.startsWith('/') || !trimmed.endsWith(PACKAGE_JSON_SUFFIX)) {
    return null;
  }

  const folder = trimTrailingSlash(dirname(trimmed));
  return folder.length > 0 ? folder : '/';
}

/**
 * Resolves the configured remoteRoot for a single CF app. Literal and empty values
 * resolve without I/O; regex values list the container's package.json folders via
 * the injected `findPackageJsonPaths` and return the shallowest folder that matches.
 */
export async function resolveRemoteRootForApp(
  appName: string,
  configuredRemoteRoot: string | undefined,
  options: ResolveRemoteRootOptions = {}
): Promise<RemoteRootResolution> {
  const setting = parseRemoteRootSetting(configuredRemoteRoot);
  if (setting.kind === 'none') {
    return { status: 'none' };
  }
  if (setting.kind === 'literal') {
    return { status: 'literal', remoteRoot: setting.value };
  }
  if (setting.kind === 'invalid-regex') {
    return { status: 'invalid-regex', error: setting.error };
  }

  const { findPackageJsonPaths } = options;
  if (findPackageJsonPaths === undefined) {
    throw new Error('findPackageJsonPaths is required to resolve a regex remoteRoot.');
  }

  const packageJsonPaths = await findPackageJsonPaths(appName);
  const candidates = toSortedRemoteRootCandidates(packageJsonPaths);
  const matched = candidates.find((candidate) => regexTest(setting.regex, candidate));
  return matched !== undefined
    ? { status: 'resolved', remoteRoot: matched, pattern: setting.pattern }
    : { status: 'unmatched', pattern: setting.pattern };
}

function toRegexSetting(pattern: string, flags: string, rawValue: string): RemoteRootSetting {
  try {
    return { kind: 'regex', pattern, flags, regex: new RegExp(pattern, flags) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'invalid-regex', value: rawValue, error: message };
  }
}

function parseSlashDelimitedRegex(value: string): { pattern: string; flags: string } | null {
  if (!value.startsWith('/')) {
    return null;
  }
  const closingSlash = findLastUnescapedSlash(value);
  if (closingSlash <= 0) {
    return null;
  }

  const flags = value.slice(closingSlash + 1);
  if (!REGEX_FLAGS_PATTERN.test(flags)) {
    return null;
  }

  return {
    pattern: value.slice(1, closingSlash),
    flags,
  };
}

function findLastUnescapedSlash(value: string): number {
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] === '/' && !isEscaped(value, index)) {
      return index;
    }
  }
  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function toSortedRemoteRootCandidates(packageJsonPaths: readonly string[]): string[] {
  const candidates = packageJsonPaths
    .map((path) => normalizeRemotePackageJsonPath(path))
    .filter((path): path is string => path !== null);

  return [...new Set(candidates)].sort(compareRemoteRootCandidates);
}

function compareRemoteRootCandidates(left: string, right: string): number {
  const depthDiff = remoteRootDepth(left) - remoteRootDepth(right);
  if (depthDiff !== 0) {
    return depthDiff;
  }

  const lengthDiff = left.length - right.length;
  return lengthDiff !== 0 ? lengthDiff : left.localeCompare(right);
}

function remoteRootDepth(value: string): number {
  return value.split('/').filter(Boolean).length;
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function regexTest(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  return regex.test(value);
}
