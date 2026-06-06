import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { collectRepoFolders } from '../serviceFolderMapping';

/**
 * A locally-developed npm package discovered under the Apps-tab root folder. These are
 * publishable sibling repos (detected by their `package.json` `name`), distinct from
 * the CAP service repos that consume them.
 */
export interface LocalPackage {
  readonly name: string;
  readonly dir: string;
  readonly version: string;
  /** The `scripts.build` command, or `undefined` when the package has none. */
  readonly buildScript: string | undefined;
  /** All dependency names declared by the package (deps + optional/peer not included). */
  readonly dependencyNames: readonly string[];
  /** name → version spec for the package's `dependencies` (e.g. `@example/core` → `staging`). */
  readonly dependencySpecs: Readonly<Record<string, string>>;
}

/**
 * Compiles the user's comma-separated detection patterns into regexes tested against
 * each package's `name`. A pattern that is not valid regex is matched literally (so a
 * plain scope prefix like `@example/` just works). Blank entries are dropped.
 */
export function compileNamePatterns(rawPatterns: string): RegExp[] {
  const compiled: RegExp[] = [];
  for (const part of rawPatterns.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      compiled.push(new RegExp(trimmed));
    } catch {
      compiled.push(new RegExp(escapeRegExp(trimmed)));
    }
  }
  return compiled;
}

export function matchesAnyPattern(name: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(name));
}

/**
 * Scans `rootFolderPath` for locally-developed packages whose `package.json` `name`
 * matches one of the configured `namePatterns`. Reuses the Apps-tab folder walk
 * (depth ≤ 6, skips `node_modules`/`dist`/`.git`). Returns at most one entry per
 * package name (the shallowest path wins on duplicates). Returns `[]` when no
 * patterns are configured.
 */
export async function scanLocalPackages(
  rootFolderPath: string,
  namePatterns: string
): Promise<LocalPackage[]> {
  const normalizedRoot = rootFolderPath.trim();
  if (normalizedRoot.length === 0) {
    return [];
  }

  const patterns = compileNamePatterns(namePatterns);
  if (patterns.length === 0) {
    return [];
  }

  const repoFolders = await collectRepoFolders(normalizedRoot);
  const byName = new Map<string, LocalPackage>();

  for (const folderPath of repoFolders) {
    const localPackage = await readLocalPackage(folderPath, patterns);
    if (localPackage === null) {
      continue;
    }
    const existing = byName.get(localPackage.name);
    if (existing === undefined || isShallower(localPackage.dir, existing.dir)) {
      byName.set(localPackage.name, localPackage);
    }
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function readLocalPackage(
  folderPath: string,
  patterns: readonly RegExp[]
): Promise<LocalPackage | null> {
  let raw: string;
  try {
    raw = await readFile(join(folderPath, 'package.json'), 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const name = typeof parsed['name'] === 'string' ? parsed['name'].trim() : '';
  if (name.length === 0 || !matchesAnyPattern(name, patterns)) {
    return null;
  }

  const version = typeof parsed['version'] === 'string' ? parsed['version'].trim() : '0.0.0';
  const buildScript = readBuildScript(parsed['scripts']);
  const dependencySpecs = readDependencySpecs(parsed['dependencies']);

  return {
    name,
    dir: folderPath,
    version,
    buildScript,
    dependencyNames: Object.keys(dependencySpecs),
    dependencySpecs,
  };
}

function readBuildScript(scripts: unknown): string | undefined {
  if (!isRecord(scripts)) {
    return undefined;
  }
  const build = scripts['build'];
  if (typeof build !== 'string' || build.trim().length === 0) {
    return undefined;
  }
  return build;
}

function readDependencySpecs(dependencies: unknown): Record<string, string> {
  if (!isRecord(dependencies)) {
    return {};
  }
  const specs: Record<string, string> = {};
  for (const [name, spec] of Object.entries(dependencies)) {
    if (typeof spec === 'string') {
      specs[name] = spec;
    }
  }
  return specs;
}

function isShallower(candidate: string, current: string): boolean {
  return pathDepth(candidate) < pathDepth(current);
}

function pathDepth(value: string): number {
  return value.split(/[\\/]+/).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
