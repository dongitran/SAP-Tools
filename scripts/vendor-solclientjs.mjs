import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vendors solclientjs into dist/vendor so the packaged extension can require it
// even though VS Code packaging is run with `--no-dependencies`.

const PACKAGE_NAME = 'solclientjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const targetRootDir = join(rootDir, 'dist', 'vendor', PACKAGE_NAME);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(pkgDir) {
  const data = await readFile(join(pkgDir, 'package.json'), 'utf8');
  return JSON.parse(data);
}

async function resolvePackageDir(name, fromDir) {
  let cursor = fromDir;
  while (true) {
    const candidate = join(cursor, 'node_modules', name);
    if (await exists(join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return undefined;
    }
    cursor = parent;
  }
}

async function collectDependencyTree(rootPkgDir) {
  const visited = new Map();

  async function visit(pkgDir) {
    const pkg = await readPackageJson(pkgDir);
    if (visited.has(pkg.name)) {
      return;
    }
    visited.set(pkg.name, pkgDir);
    const merged = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    };
    for (const depName of Object.keys(merged)) {
      const depDir = await resolvePackageDir(depName, pkgDir);
      if (depDir !== undefined) {
        await visit(depDir);
      }
    }
  }

  await visit(rootPkgDir);
  return visited;
}

function smokeTestVendoredModule() {
  const entry = join(targetRootDir, 'lib', 'solclientjs-exports.js');
  const script =
    `const solace = require(${JSON.stringify(entry)});\n` +
    `if (typeof solace.SolclientFactory?.createSession !== 'function') {\n` +
    `  throw new Error('Vendored ${PACKAGE_NAME} is missing SolclientFactory.createSession.');\n` +
    `}\n`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Vendored ${PACKAGE_NAME} failed smoke test:\n${result.stderr.trim()}`);
  }
}

async function main() {
  const sourceDir = join(rootDir, 'node_modules', PACKAGE_NAME);
  if (!(await exists(sourceDir))) {
    throw new Error(`Missing node_modules/${PACKAGE_NAME}. Run npm install before building SAP Tools.`);
  }

  const tree = await collectDependencyTree(sourceDir);

  await rm(targetRootDir, { recursive: true, force: true });
  await mkdir(dirname(targetRootDir), { recursive: true });

  for (const [name, dir] of tree) {
    const targetDir = name === PACKAGE_NAME ? targetRootDir : join(targetRootDir, 'node_modules', name);
    await mkdir(dirname(targetDir), { recursive: true });
    await cp(dir, targetDir, { recursive: true, force: true });
  }

  smokeTestVendoredModule();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
