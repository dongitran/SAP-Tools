#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(scriptDir);
const e2eDir = join(rootDir, 'e2e');
const timingsFile = join(e2eDir, 'shard-timings.md');

function writeOut(message) {
  process.stdout.write(`${message}\n`);
}

function writeErr(message) {
  process.stderr.write(`${message}\n`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLane(rawLane) {
  const numericLane = Number(rawLane);

  if (!Number.isInteger(numericLane) || numericLane < 1 || numericLane > 12) {
    throw new Error(`Lane must be a number from 1 to 12. Received: ${rawLane}`);
  }

  return String(numericLane).padStart(2, '0');
}

function parseTimingRows(markdown) {
  const rows = [];
  const rowPattern = /^\|\s*(\d{2})\s*\|\s*([\d.]+)\s*\|\s*(tests\/[^|]+?)\s*\|\s*(.+?)\s*\|$/;

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(rowPattern);
    if (!match) continue;

    rows.push({
      lane: match[1],
      seconds: Number(match[2]),
      selector: match[3].trim(),
      title: match[4].trim(),
    });
  }

  return rows;
}

function specPathFromSelector(selector) {
  const separatorIndex = selector.lastIndexOf(':');

  if (separatorIndex === -1) {
    throw new Error(`Selector must include a line suffix: ${selector}`);
  }

  return selector.slice(0, separatorIndex);
}

function validateRows(rows) {
  if (rows.length === 0) {
    throw new Error(`No E2E timing rows found in ${timingsFile}`);
  }

  const lanes = new Set(rows.map((row) => row.lane));
  const keys = new Set();
  const titles = rows.map((row) => row.title);

  for (const row of rows) {
    if (!Number.isFinite(row.seconds) || row.seconds <= 0) {
      throw new Error(`Invalid duration for "${row.title}"`);
    }

    if (!row.selector.startsWith('tests/')) {
      throw new Error(`Selector must be relative to e2e/: ${row.selector}`);
    }

    const key = row.title;
    if (keys.has(key)) {
      throw new Error(`Duplicate test title in E2E lane map: ${row.title}`);
    }

    keys.add(key);
  }

  for (const title of titles) {
    const titleLower = title.toLowerCase();
    const overlapping = titles.find(
      (candidate) => candidate !== title && candidate.toLowerCase().includes(titleLower)
    );
    if (overlapping !== undefined) {
      throw new Error(`Ambiguous E2E title substring: "${title}" also matches "${overlapping}"`);
    }
  }

  for (let lane = 1; lane <= 12; lane += 1) {
    const normalizedLane = String(lane).padStart(2, '0');
    if (!lanes.has(normalizedLane)) {
      throw new Error(`Missing E2E lane ${normalizedLane}`);
    }
  }
}

function summarizeRows(rows) {
  const totals = new Map();

  for (const row of rows) {
    const total = totals.get(row.lane) ?? { count: 0 };
    total.count += 1;
    totals.set(row.lane, total);
  }

  for (const [lane, total] of [...totals.entries()].sort()) {
    writeOut(`Lane ${lane}: ${total.count} tests`);
  }
}

async function main() {
  const [laneArg, ...extraArgs] = process.argv.slice(2);
  const markdown = await readFile(timingsFile, 'utf8');
  const rows = parseTimingRows(markdown);

  validateRows(rows);

  if (laneArg === '--validate') {
    summarizeRows(rows);
    return;
  }

  if (!laneArg) {
    throw new Error('Usage: node scripts/run-e2e-lane.mjs <lane 1-12> [playwright args...]');
  }

  const lane = normalizeLane(laneArg);
  const laneRows = rows.filter((row) => row.lane === lane);
  const specFiles = [...new Set(laneRows.map((row) => specPathFromSelector(row.selector)))];
  const grepPattern = `(?:${laneRows.map((row) => escapeRegExp(row.title)).join('|')})`;
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['exec', '--', 'playwright', 'test', '--grep', grepPattern, ...extraArgs, ...specFiles];

  writeOut(`Running E2E lane ${lane}: ${laneRows.length} tests`);

  const child = spawn(npmCommand, args, {
    cwd: e2eDir,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('close', (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  writeErr(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
