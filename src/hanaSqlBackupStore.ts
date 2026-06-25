/**
 * Manages SQL backup files written to disk before mutating statements execute.
 *
 * Directory layout:
 *   ~/.saptools/sql-backups/
 *     YYYYMM/                               ← month bucket
 *       region-org-space-app-type-table-ts/  ← one folder per mutation
 *         query.sql                          ← full original SQL statement
 *         backup.csv                         ← SELECT result before mutation
 *
 * The backup store is purely file-system based — no VSCode globalState involved.
 * All operations are best-effort: failures are caught and logged, never surfaced
 * to the user as hard errors.
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { HanaSqlScopeSession } from './hanaSqlConnectionResolver';
import type { MutatingStatementType } from './hanaSqlMutationAnalyzer';

const SAPTOOLS_BACKUP_ROOT = join(homedir(), '.saptools', 'sql-backups');

export interface HanaSqlBackupEntry {
  /** Unique ID derived from the folder name. */
  readonly id: string;
  /** ISO 8601 timestamp when the backup was created. */
  readonly timestamp: string;
  /** Human-readable timestamp label (e.g. "2026-06-24 19:42"). */
  readonly timestampLabel: string;
  readonly region: string;
  readonly org: string;
  readonly space: string;
  readonly appName: string;
  readonly statementType: MutatingStatementType;
  readonly tableName: string;
  readonly rowCount: number;
  /** Absolute path to the folder containing query.sql and backup.csv. */
  readonly folderPath: string;
}

export interface SaveBackupRequest {
  readonly session: HanaSqlScopeSession;
  readonly appName: string;
  readonly statementType: MutatingStatementType;
  readonly tableName: string;
  readonly originalSql: string;
  readonly csvContent: string;
  readonly rowCount: number;
  readonly timestamp: Date;
}

export class HanaSqlBackupStore {
  /**
   * Save a backup entry to disk. Returns the created entry, or null on failure.
   * Never throws — failures are logged internally and reported as null.
   */
  async saveBackup(request: SaveBackupRequest): Promise<HanaSqlBackupEntry | null> {
    try {
      return await this.doSaveBackup(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Best-effort: log to stderr but never fail the calling flow
      process.stderr.write(`[sql-backup] failed to save backup: ${message}\n`);
      return null;
    }
  }

  /**
   * List backup entries sorted newest-first. Reads folder names from disk without
   * loading file contents. Returns an empty array on failure.
   */
  async listBackups(limit = 200): Promise<HanaSqlBackupEntry[]> {
    try {
      return await this.doListBackups(limit);
    } catch {
      return [];
    }
  }

  /**
   * Read the CSV content for a backup entry. Returns null on failure.
   */
  async readBackupCsv(entry: HanaSqlBackupEntry): Promise<string | null> {
    try {
      const content = await readFile(join(entry.folderPath, 'backup.csv'), 'utf8');
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Read the SQL content for a backup entry. Returns null on failure.
   */
  async readBackupSql(entry: HanaSqlBackupEntry): Promise<string | null> {
    try {
      const content = await readFile(join(entry.folderPath, 'query.sql'), 'utf8');
      return content;
    } catch {
      return null;
    }
  }

  private async doSaveBackup(request: SaveBackupRequest): Promise<HanaSqlBackupEntry> {
    const { timestamp, session, appName, statementType, tableName, originalSql, csvContent, rowCount } = request;

    const monthBucket = formatMonthBucket(timestamp);
    const region = extractRegionFromEndpoint(session.apiEndpoint);
    const folderName = buildFolderName(region, session.orgName, session.spaceName, appName, statementType, tableName, timestamp);
    const folderPath = join(SAPTOOLS_BACKUP_ROOT, monthBucket, folderName);

    const entryData = {
      id: folderName,
      timestamp: timestamp.toISOString(),
      timestampLabel: formatTimestampLabel(timestamp),
      region,
      org: session.orgName,
      space: session.spaceName,
      appName,
      statementType,
      tableName,
      rowCount,
      folderPath,
    };

    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, 'query.sql'), originalSql, 'utf8');
    await writeFile(join(folderPath, 'backup.csv'), csvContent, 'utf8');
    await writeFile(join(folderPath, 'metadata.json'), JSON.stringify(entryData, null, 2), 'utf8');

    return entryData;
  }

  private async doListBackups(limit: number): Promise<HanaSqlBackupEntry[]> {
    let monthBuckets: string[];
    try {
      monthBuckets = await readdir(SAPTOOLS_BACKUP_ROOT);
    } catch {
      // Root folder does not exist yet — no backups
      return [];
    }

    // Sort month buckets newest-first (YYYYMM format sorts lexicographically)
    monthBuckets.sort((a, b) => b.localeCompare(a));

    const entries: HanaSqlBackupEntry[] = [];

    for (const bucket of monthBuckets) {
      if (!/^\d{6}$/.test(bucket)) continue;

      const bucketPath = join(SAPTOOLS_BACKUP_ROOT, bucket);
      let folderNames: string[];
      try {
        folderNames = await readdir(bucketPath);
      } catch {
        continue;
      }

      // Sort newest-first within each bucket
      folderNames.sort((a, b) => b.localeCompare(a));

      for (const folderName of folderNames) {
        const entryFolderPath = join(bucketPath, folderName);
        let entry: HanaSqlBackupEntry | null = null;
        try {
          const metaStr = await readFile(join(entryFolderPath, 'metadata.json'), 'utf8');
          entry = JSON.parse(metaStr) as HanaSqlBackupEntry;
        } catch {
          // Fallback to error-prone folder name parsing for backward compatibility
          entry = parseFolderNameToEntry(folderName, entryFolderPath);
        }
        if (entry !== null) {
          entries.push(entry);
        }
      }
    }

    // Metadata is canonical because legacy or manually moved folders may not sort by creation time.
    entries.sort((a, b) => {
      const timeA = Date.parse(a.timestamp);
      const timeB = Date.parse(b.timestamp);
      const validA = Number.isFinite(timeA);
      const validB = Number.isFinite(timeB);
      if (validA && validB && timeA !== timeB) return timeB - timeA;
      if (validA !== validB) return validA ? -1 : 1;
      return b.id.localeCompare(a.id);
    });

    return entries.slice(0, limit);
  }
}

// ── Folder naming ──────────────────────────────────────────────────────────────

/**
 * Build a safe folder name from all the relevant dimensions.
 * Pattern: region-org-space-app-type-table-YYYYMMDDTHHmmss
 */
function buildFolderName(
  region: string,
  org: string,
  space: string,
  appName: string,
  statementType: MutatingStatementType,
  tableName: string,
  timestamp: Date
): string {
  const slugify = (s: string): string =>
    s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

  const ts = formatTimestampForFolder(timestamp);
  return [
    slugify(region),
    slugify(org),
    slugify(space),
    slugify(appName),
    statementType.toLowerCase(),
    slugify(tableName.replace(/^[^.]+\./, '')), // strip schema prefix for folder name
    ts,
  ].join('-');
}

/**
 * Parse a folder name back into a backup entry (best-effort).
 * Pattern: region-org-space-app-type-table-ts
 * We store region+org+space+app+type+table as slugs, and timestamp at the end.
 * Since each segment is separated by '-' and can itself contain '-', we anchor
 * on the ISO timestamp suffix (14 digits: YYYYMMDDHHmmss).
 */
export function parseFolderNameToEntry(
  folderName: string,
  folderPath: string
): HanaSqlBackupEntry | null {
  // Timestamp is always the last 15 chars: YYYYMMDDTHHmmss
  const tsMatch = /(\d{8}T\d{6})$/.exec(folderName);
  if (tsMatch === null) return null;

  const tsStr = tsMatch[1] ?? '';
  if (tsStr.length === 0) return null;
  const timestamp = parseTimestampFolder(tsStr);
  if (timestamp === null) return null;

  // Parse remaining parts: region-org-space-app-type-table
  const withoutTs = folderName.slice(0, -(tsStr.length + 1)); // remove -TS suffix
  const parts = withoutTs.split('-');
  if (parts.length < 6) return null;

  // Last part before timestamp is table, second-to-last is type, etc.
  // Since slugified parts may contain '-', we use positional rules:
  // type is one of: update, delete, merge — find rightmost occurrence
  let typeIdx = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    if (p === 'update' || p === 'delete' || p === 'merge') {
      typeIdx = i;
      break;
    }
  }
  if (typeIdx < 0) return null;

  const statementType = (parts[typeIdx] ?? '').toUpperCase() as MutatingStatementType;
  const tableName = parts.slice(typeIdx + 1).join('-');
  // region is first segment (can be multi-part like eu10-002)
  const region = parts[0] ?? '';
  // org and space are uncertain — we store what we can from remaining prefix
  const prefix = parts.slice(1, typeIdx).join('-');

  return {
    id: folderName,
    timestamp: timestamp.toISOString(),
    timestampLabel: formatTimestampLabel(timestamp),
    region,
    org: prefix,
    space: '',
    appName: basename(folderPath),
    statementType,
    tableName: tableName.length > 0 ? tableName.toUpperCase() : 'UNKNOWN',
    rowCount: 0, // unknown without reading CSV; loaded lazily
    folderPath,
  };
}

// ── Timestamp helpers ──────────────────────────────────────────────────────────

function formatMonthBucket(date: Date): string {
  const y = date.getUTCFullYear().toString();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function formatTimestampForFolder(date: Date): string {
  const y = date.getUTCFullYear().toString();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${d}T${h}${mi}${s}`;
}

function formatTimestampLabel(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function parseTimestampFolder(ts: string): Date | null {
  // YYYYMMDDTHHmmss
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (match === null) return null;
  const y = match[1] ?? '';
  const mo = match[2] ?? '';
  const d = match[3] ?? '';
  const h = match[4] ?? '';
  const mi = match[5] ?? '';
  const s = match[6] ?? '';
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return isNaN(date.getTime()) ? null : date;
}

// ── Region extraction ──────────────────────────────────────────────────────────

/**
 * Extract a short region slug from a CF API endpoint URL.
 * E.g. "https://api.cf.eu10.hana.ondemand.com" → "eu10"
 *      "https://api.cf.us10-001.hana.ondemand.com" → "us10-001"
 */
export function extractRegionFromEndpoint(apiEndpoint: string): string {
  try {
    const url = new URL(apiEndpoint);
    const hostname = url.hostname;
    // Pattern: api.cf.<region>.hana.ondemand.com
    const match = /^api\.cf\.([^.]+)\./i.exec(hostname);
    if (match?.[1] !== undefined) return match[1];
    // Fallback: use the third hostname segment
    const parts = hostname.split('.');
    return parts[2] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
