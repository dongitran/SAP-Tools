import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAppsFromTopologySync, getCfTopologySnapshotSync } from './cfTopology';

const CF_STRUCTURE_PATH_ENV = 'SAP_TOOLS_CF_STRUCTURE_PATH';

let tempDir = '';

function writeStructure(value: unknown): string {
  const filePath = path.join(tempDir, 'cf-structure.json');
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  process.env[CF_STRUCTURE_PATH_ENV] = filePath;
  return filePath;
}

function clearStructurePathEnv(): void {
  delete process.env.SAP_TOOLS_CF_STRUCTURE_PATH;
}

describe('CF topology snapshot parsing', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-tools-cf-topology-'));
    clearStructurePathEnv();
  });

  afterEach(() => {
    clearStructurePathEnv();
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  });

  it('reports unavailable topology when no structure file exists', () => {
    process.env[CF_STRUCTURE_PATH_ENV] = path.join(tempDir, 'missing.json');

    expect(getCfTopologySnapshotSync()).toEqual({
      ready: false,
      accounts: [],
    });
  });

  it('reports ready empty topology when a valid sync snapshot has no org accounts', () => {
    writeStructure({
      syncedAt: '2026-05-09T00:00:00.000Z',
      regions: [
        {
          key: 'us10',
          label: 'US East (VA) - AWS (us10)',
          apiEndpoint: 'https://api.cf.us10.hana.ondemand.com',
          accessible: true,
          orgs: [],
        },
      ],
    });

    expect(getCfTopologySnapshotSync()).toEqual({
      ready: true,
      accounts: [],
    });
  });

  it('returns accessible org accounts with space names from a valid sync snapshot', () => {
    writeStructure({
      syncedAt: '2026-05-09T00:00:00.000Z',
      regions: [
        {
          key: 'br10',
          label: 'Brazil (Sao Paulo) - AWS (br10)',
          apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
          accessible: true,
          orgs: [
            {
              name: 'finance-services-prod',
              spaces: [{ name: 'prod' }, { name: 'uat' }],
            },
          ],
        },
      ],
    });

    expect(getCfTopologySnapshotSync()).toEqual({
      ready: true,
      accounts: [
        {
          regionKey: 'br10',
          regionLabel: 'Brazil (Sao Paulo) - AWS (br10)',
          apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
          orgName: 'finance-services-prod',
          spaces: ['prod', 'uat'],
        },
      ],
    });
  });

  it('returns every app for a matching scope, including scaled-to-zero and stopped apps', () => {
    writeStructure({
      syncedAt: '2026-05-09T00:00:00.000Z',
      regions: [
        {
          key: 'ap10',
          label: 'Australia (Sydney) - AWS (ap10)',
          apiEndpoint: 'https://api.cf.ap10.hana.ondemand.com',
          accessible: true,
          orgs: [
            {
              name: 'dev-org',
              spaces: [
                {
                  name: 'app',
                  apps: [
                    { name: 'srv-running', requestedState: 'started', runningInstances: 2 },
                    { name: 'srv-empty', requestedState: 'started', runningInstances: 0 },
                    { name: 'srv-stopped', requestedState: 'stopped', runningInstances: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // Endpoint matching is case-insensitive and ignores trailing slashes.
    expect(
      getAppsFromTopologySync('https://API.CF.ap10.hana.ondemand.com/', 'dev-org', 'app')
    ).toEqual([
      { id: 'srv-running', name: 'srv-running', runningInstances: 2 },
      { id: 'srv-empty', name: 'srv-empty', runningInstances: 0 },
      { id: 'srv-stopped', name: 'srv-stopped', runningInstances: 0 },
    ]);
  });

  it('treats a space with no apps field as an empty app list', () => {
    writeStructure({
      syncedAt: '2026-05-09T00:00:00.000Z',
      regions: [
        {
          key: 'br10',
          label: 'Brazil (Sao Paulo) - AWS (br10)',
          apiEndpoint: 'https://api.cf.br10.hana.ondemand.com',
          accessible: true,
          orgs: [{ name: 'finance', spaces: [{ name: 'prod' }] }],
        },
      ],
    });

    expect(
      getAppsFromTopologySync('https://api.cf.br10.hana.ondemand.com', 'finance', 'prod')
    ).toEqual([]);
  });

  it('returns null when the structure, region, org, or space is missing', () => {
    process.env[CF_STRUCTURE_PATH_ENV] = path.join(tempDir, 'missing.json');
    expect(
      getAppsFromTopologySync('https://api.cf.ap10.hana.ondemand.com', 'o', 's')
    ).toBeNull();

    writeStructure({
      syncedAt: '2026-05-09T00:00:00.000Z',
      regions: [
        {
          key: 'ap10',
          label: 'Australia (Sydney) - AWS (ap10)',
          apiEndpoint: 'https://api.cf.ap10.hana.ondemand.com',
          accessible: true,
          orgs: [{ name: 'dev-org', spaces: [{ name: 'app', apps: [] }] }],
        },
      ],
    });

    expect(
      getAppsFromTopologySync('https://api.cf.eu10.hana.ondemand.com', 'dev-org', 'app')
    ).toBeNull();
    expect(
      getAppsFromTopologySync('https://api.cf.ap10.hana.ondemand.com', 'nope', 'app')
    ).toBeNull();
    expect(
      getAppsFromTopologySync('https://api.cf.ap10.hana.ondemand.com', 'dev-org', 'nope')
    ).toBeNull();
  });
});
