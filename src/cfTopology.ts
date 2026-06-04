import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

const CF_STRUCTURE_PATH_ENV = 'SAP_TOOLS_CF_STRUCTURE_PATH';
const SAPTOOLS_DIR_NAME = '.saptools';
const CF_STRUCTURE_FILE_NAME = 'cf-structure.json';

export interface CfTopologyOrg {
  readonly regionKey: string;
  readonly regionLabel: string;
  readonly apiEndpoint: string;
  readonly orgName: string;
  readonly spaces: readonly string[];
}

export interface CfTopology {
  readonly ready: boolean;
  readonly accounts: readonly CfTopologyOrg[];
}

/**
 * A single app entry resolved from the shared `~/.saptools/cf-structure.json`.
 * Shape matches the sidebar/CF logs app entry so it can be used directly as the
 * dashboard app list. Includes every app regardless of running state (running,
 * scaled-to-zero "empty", and stopped) — mirrors the CDS Debug app list.
 */
export interface CfTopologyApp {
  readonly id: string;
  readonly name: string;
  readonly runningInstances: number;
}

export const EMPTY_CF_TOPOLOGY: CfTopology = { ready: false, accounts: [] };

interface ParsedAppNode {
  readonly name: string;
  readonly runningInstances: number;
}

interface ParsedSpaceNode {
  readonly name: string;
  readonly apps: readonly ParsedAppNode[];
}

interface ParsedOrgNode {
  readonly name: string;
  readonly spaces: readonly ParsedSpaceNode[];
}

interface ParsedRegionNode {
  readonly key: string;
  readonly label: string;
  readonly apiEndpoint: string;
  readonly accessible: boolean;
  readonly orgs: readonly ParsedOrgNode[];
}

interface ParsedCfStructure {
  readonly syncedAt: string;
  readonly regions: readonly ParsedRegionNode[];
}

function structurePath(): string {
  const override = process.env[CF_STRUCTURE_PATH_ENV];
  if (typeof override === 'string' && override.trim().length > 0) {
    return override;
  }
  return path.join(homedir(), SAPTOOLS_DIR_NAME, CF_STRUCTURE_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function parseAppNode(value: unknown): ParsedAppNode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const name = value['name'];
  if (typeof name !== 'string' || name.length === 0) {
    return undefined;
  }
  const runningInstancesRaw = value['runningInstances'];
  const runningInstances =
    typeof runningInstancesRaw === 'number' && Number.isFinite(runningInstancesRaw)
      ? runningInstancesRaw
      : 0;
  return { name, runningInstances };
}

function parseSpaceNode(value: unknown): ParsedSpaceNode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const name = value['name'];
  if (typeof name !== 'string' || name.length === 0) {
    return undefined;
  }
  const appsRaw = value['apps'];
  const apps: ParsedAppNode[] = [];
  if (Array.isArray(appsRaw)) {
    for (const appRaw of appsRaw) {
      const app = parseAppNode(appRaw);
      if (app !== undefined) {
        apps.push(app);
      }
    }
  }
  return { name, apps };
}

function parseOrgNode(value: unknown): ParsedOrgNode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const name = value['name'];
  const spacesRaw = value['spaces'];
  if (typeof name !== 'string' || name.length === 0 || !Array.isArray(spacesRaw)) {
    return undefined;
  }
  const spaces: ParsedSpaceNode[] = [];
  for (const spaceRaw of spacesRaw) {
    const space = parseSpaceNode(spaceRaw);
    if (space !== undefined) {
      spaces.push(space);
    }
  }
  return { name, spaces };
}

function parseRegionNode(value: unknown): ParsedRegionNode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const key = value['key'];
  const label = value['label'];
  const apiEndpoint = value['apiEndpoint'];
  const accessible = value['accessible'];
  const orgsRaw = value['orgs'];
  if (
    typeof key !== 'string' ||
    typeof label !== 'string' ||
    typeof apiEndpoint !== 'string' ||
    typeof accessible !== 'boolean' ||
    !Array.isArray(orgsRaw)
  ) {
    return undefined;
  }
  const orgs: ParsedOrgNode[] = [];
  for (const orgRaw of orgsRaw) {
    const org = parseOrgNode(orgRaw);
    if (org !== undefined) {
      orgs.push(org);
    }
  }
  return { key, label, apiEndpoint, accessible, orgs };
}

function parseStructure(value: unknown): ParsedCfStructure | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const syncedAt = value['syncedAt'];
  const regionsRaw = value['regions'];
  if (typeof syncedAt !== 'string' || !Array.isArray(regionsRaw)) {
    return undefined;
  }
  const regions: ParsedRegionNode[] = [];
  for (const regionRaw of regionsRaw) {
    const region = parseRegionNode(regionRaw);
    if (region !== undefined) {
      regions.push(region);
    }
  }
  return { syncedAt, regions };
}

function buildOrgEntry(region: ParsedRegionNode, org: ParsedOrgNode): CfTopologyOrg {
  return {
    regionKey: region.key,
    regionLabel: region.label,
    apiEndpoint: region.apiEndpoint,
    orgName: org.name,
    spaces: org.spaces.map((space) => space.name),
  };
}

function buildOrgEntries(structure: ParsedCfStructure): CfTopologyOrg[] {
  const entries: CfTopologyOrg[] = [];
  for (const region of structure.regions) {
    if (!region.accessible) continue;
    for (const org of region.orgs) {
      entries.push(buildOrgEntry(region, org));
    }
  }
  entries.sort((left, right) => {
    const orgCompare = left.orgName.localeCompare(right.orgName);
    if (orgCompare !== 0) return orgCompare;
    return left.regionKey.localeCompare(right.regionKey);
  });
  return entries;
}

function readStructureSyncSafe(): ParsedCfStructure | undefined {
  try {
    const raw = fs.readFileSync(structurePath(), 'utf8');
    return parseStructure(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

async function readStructureAsyncSafe(): Promise<ParsedCfStructure | undefined> {
  try {
    const raw = await fsPromises.readFile(structurePath(), 'utf8');
    return parseStructure(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

export function getCfTopologySnapshotSync(): CfTopology {
  const structure = readStructureSyncSafe();
  if (structure === undefined) {
    return EMPTY_CF_TOPOLOGY;
  }
  const accounts = buildOrgEntries(structure);
  return {
    ready: true,
    accounts,
  };
}

export async function getCfTopologySnapshot(): Promise<CfTopology> {
  const structure = await readStructureAsyncSafe();
  if (structure === undefined) {
    return EMPTY_CF_TOPOLOGY;
  }
  const accounts = buildOrgEntries(structure);
  return {
    ready: true,
    accounts,
  };
}

/**
 * Resolve the apps for one org/space from the shared `~/.saptools/cf-structure.json`
 * (synced by the cf-sync engine and shared with the CDS Debug extension). Returns
 * every app in the space — running, scaled-to-zero, and stopped — matching the CDS
 * Debug app list. Returns `null` when no structure file exists, or the region (matched
 * by API endpoint), org, or space is not present, so the caller can fall back or refresh.
 */
export function getAppsFromTopologySync(
  apiEndpoint: string,
  orgName: string,
  spaceName: string
): CfTopologyApp[] | null {
  const structure = readStructureSyncSafe();
  if (structure === undefined) {
    return null;
  }

  const endpoint = normalizeEndpoint(apiEndpoint);
  for (const region of structure.regions) {
    if (!region.accessible || normalizeEndpoint(region.apiEndpoint) !== endpoint) {
      continue;
    }
    const org = region.orgs.find((candidate) => candidate.name === orgName);
    if (org === undefined) {
      return null;
    }
    const space = org.spaces.find((candidate) => candidate.name === spaceName);
    if (space === undefined) {
      return null;
    }
    return space.apps.map((app) => ({
      id: app.name,
      name: app.name,
      runningInstances: app.runningInstances,
    }));
  }

  return null;
}
