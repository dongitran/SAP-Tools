import { access, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

const MAX_SCAN_DEPTH = 6;
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.vscode',
  '.idea',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
]);

export interface ServiceFolderMapping {
  readonly appId: string;
  readonly appName: string;
  readonly folderPath: string;
  readonly matchType: 'exact' | 'underscore' | 'none' | 'ambiguous';
  readonly candidateFolderPaths: readonly string[];
  readonly hasConflict: boolean;
}

/**
 * Explicit CF app name → local folder basename override. Shared in shape with the
 * cds-debug extension's `cdsDebug.appFolderMappings` so a single configuration maps
 * apps whose CF name differs too much from their local folder for `-`↔`_`.
 */
export interface AppFolderMapping {
  readonly appName: string;
  readonly folderName: string;
}

/**
 * Returns the explicitly configured folder name for an app, if any. App-name match
 * is case-sensitive exact, matching cds-debug semantics.
 */
export function resolveOverrideFolder(
  appName: string,
  overrides?: readonly AppFolderMapping[]
): string | undefined {
  const match = overrides?.find((mapping) => mapping.appName === appName)?.folderName.trim();
  return match !== undefined && match.length > 0 ? match : undefined;
}

export async function buildServiceFolderMappings(
  rootFolderPath: string,
  appNames: readonly string[],
  overrides?: readonly AppFolderMapping[]
): Promise<readonly ServiceFolderMapping[]> {
  const normalizedRootFolderPath = rootFolderPath.trim();
  if (normalizedRootFolderPath.length === 0) {
    throw new Error('Local root folder path is empty.');
  }

  const normalizedAppNames = normalizeAppNames(appNames);
  if (normalizedAppNames.length === 0) {
    return [];
  }

  const repoFolders = await collectRepoFolders(normalizedRootFolderPath);
  const folderIndex = createFolderIndex(repoFolders);

  return normalizedAppNames.map((appName) => {
    const overrideFolder = resolveOverrideFolder(appName, overrides);
    const candidates = getFolderNameCandidates(appName, overrides);
    for (const candidate of candidates) {
      const candidateKey = candidate.toLowerCase();
      const candidatePaths = folderIndex.get(candidateKey);
      if (candidatePaths === undefined || candidatePaths.length === 0) {
        continue;
      }

      if (candidatePaths.length > 1) {
        return {
          appId: appName,
          appName,
          folderPath: '',
          matchType: 'ambiguous',
          candidateFolderPaths: sortCandidatePaths(candidatePaths),
          hasConflict: true,
        } satisfies ServiceFolderMapping;
      }

      const bestPath = candidatePaths[0] ?? '';
      // An explicit override that resolves is a user-intended exact mapping.
      const isExactMatch = candidate === appName || candidate === overrideFolder;
      return {
        appId: appName,
        appName,
        folderPath: bestPath,
        matchType: isExactMatch ? 'exact' : 'underscore',
        candidateFolderPaths: bestPath.length > 0 ? [bestPath] : [],
        hasConflict: false,
      } satisfies ServiceFolderMapping;
    }

    return {
      appId: appName,
      appName,
      folderPath: '',
      matchType: 'none',
      candidateFolderPaths: [],
      hasConflict: false,
    } satisfies ServiceFolderMapping;
  });
}

export function getFolderNameCandidates(
  appName: string,
  overrides?: readonly AppFolderMapping[]
): string[] {
  const normalizedAppName = appName.trim();
  if (normalizedAppName.length === 0) {
    return [];
  }

  const candidates: string[] = [];
  const overrideFolder = resolveOverrideFolder(normalizedAppName, overrides);
  if (overrideFolder !== undefined) {
    candidates.push(overrideFolder);
  }
  if (!candidates.includes(normalizedAppName)) {
    candidates.push(normalizedAppName);
  }
  const underscoreVariant = normalizedAppName.replaceAll('-', '_');
  if (underscoreVariant !== normalizedAppName && !candidates.includes(underscoreVariant)) {
    candidates.push(underscoreVariant);
  }
  return candidates;
}

function normalizeAppNames(appNames: readonly string[]): string[] {
  const uniqueNames = new Set<string>();
  const normalizedNames: string[] = [];

  for (const appName of appNames) {
    const normalizedName = appName.trim();
    if (
      normalizedName.length === 0 ||
      normalizedName.length > 128 ||
      uniqueNames.has(normalizedName)
    ) {
      continue;
    }
    uniqueNames.add(normalizedName);
    normalizedNames.push(normalizedName);
  }

  return normalizedNames;
}

/**
 * Walks `rootFolderPath` (depth ≤ {@link MAX_SCAN_DEPTH}, skipping
 * {@link SKIPPED_DIRECTORIES} such as `node_modules`) and returns every folder that
 * directly contains a `package.json`. Exported so the local-package scanner can reuse
 * the exact same traversal rules as the Apps-tab service-folder mapping.
 */
export async function collectRepoFolders(rootFolderPath: string): Promise<string[]> {
  const repoFolders: string[] = [];
  await walkDirectories(rootFolderPath, 0, repoFolders);
  return repoFolders;
}

async function walkDirectories(
  currentFolderPath: string,
  depth: number,
  repoFolders: string[]
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) {
    return;
  }

  let entries;
  try {
    entries = await readdir(currentFolderPath, { withFileTypes: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to read directory entries.';
    throw new Error(`Failed to scan "${currentFolderPath}": ${message}`);
  }

  const hasPackageJson = await directoryHasPackageJson(currentFolderPath);
  if (hasPackageJson) {
    repoFolders.push(currentFolderPath);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const childFolderPath = join(currentFolderPath, entry.name);
    await walkDirectories(childFolderPath, depth + 1, repoFolders);
  }
}

async function directoryHasPackageJson(folderPath: string): Promise<boolean> {
  try {
    await access(join(folderPath, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

function createFolderIndex(repoFolders: readonly string[]): Map<string, string[]> {
  const folderIndex = new Map<string, string[]>();

  for (const folderPath of repoFolders) {
    const folderName = basename(folderPath).trim();
    if (folderName.length === 0) {
      continue;
    }

    const folderKey = folderName.toLowerCase();
    const currentPaths = folderIndex.get(folderKey);
    if (currentPaths === undefined) {
      folderIndex.set(folderKey, [folderPath]);
      continue;
    }

    currentPaths.push(folderPath);
  }

  return folderIndex;
}

function sortCandidatePaths(paths: readonly string[]): string[] {
  return [...paths].sort((leftPath, rightPath) => {
    const leftDepth = resolvePathDepth(leftPath);
    const rightDepth = resolvePathDepth(rightPath);
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    if (leftPath.length !== rightPath.length) {
      return leftPath.length - rightPath.length;
    }

    return leftPath.localeCompare(rightPath);
  });
}

function resolvePathDepth(pathValue: string): number {
  return pathValue.split(/[\\/]+/).length;
}
