import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const sshTargetDir = join(rootDir, 'dist', 'vendor', 'ssh2');
const socksTargetDir = join(rootDir, 'dist', 'vendor', '@pondwader', 'socks5-server');

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

async function collectDependencyTree(rootPkgDirs) {
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
      if (depDir === undefined) {
        continue;
      }
      await visit(depDir);
    }
  }

  for (const rootPkgDir of rootPkgDirs) {
    await visit(rootPkgDir);
  }
  return visited;
}

async function smokeTestVendoredSsh() {
  const entrySsh = join(sshTargetDir, 'lib', 'client.js');
  const entrySocks = join(socksTargetDir, 'dist', 'index.js');
  
  const script = `
    const ssh2 = require(${JSON.stringify(entrySsh)});
    const socks = require(${JSON.stringify(entrySocks)});
    if (typeof socks.createServer !== 'function') {
      throw new Error('Vendored socks5-server is missing createServer.');
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(`Vendored ssh2 failed smoke test:\n${stderr}`);
  }
}

async function main() {
  const sshSourceDir = join(rootDir, 'node_modules', 'ssh2');
  const socksSourceDir = join(rootDir, 'node_modules', '@pondwader', 'socks5-server');
  
  if (!(await exists(sshSourceDir)) || !(await exists(socksSourceDir))) {
    throw new Error('Missing node_modules for ssh2 or socks5-server. Run npm install before building SAP Tools.');
  }

  const tree = await collectDependencyTree([sshSourceDir, socksSourceDir]);

  await rm(sshTargetDir, { recursive: true, force: true });
  await rm(socksTargetDir, { recursive: true, force: true });
  await mkdir(dirname(sshTargetDir), { recursive: true });
  await mkdir(dirname(socksTargetDir), { recursive: true });

  for (const [name, sourceDir] of tree) {
    let targetDir;
    if (name === 'ssh2') {
      targetDir = sshTargetDir;
    } else if (name === '@pondwader/socks5-server') {
      targetDir = socksTargetDir;
    } else {
      targetDir = join(sshTargetDir, 'node_modules', name);
    }
    await mkdir(dirname(targetDir), { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true, force: true });
  }

  // Remove test directories that contain private keys and cause vsce to fail
  await rm(join(sshTargetDir, 'test'), { recursive: true, force: true });

  await smokeTestVendoredSsh();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
