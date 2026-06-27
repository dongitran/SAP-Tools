/* eslint-disable */
// @ts-nocheck

import {
    EMPTY_CF_TOPOLOGY,
    getCfTopologySnapshot,
    getCfTopologySnapshotSync,
    type CfTopology
} from '../../cfTopology';
import { SAP_BTP_REGIONS, toHyphenatedRegionCode } from '../../regions';
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    isTestMode,
    sanitizeForLog
} from '../../sidebarProvider.helpers';
import {
    MSG_CF_TOPOLOGY, MSG_TOPOLOGY_SCOPE_RESOLVED,
    RegionSelectionPayload,
    TopologyOrgSelectedPayload
} from '../../sidebarProvider.types';
import {
    resolveMockCfTopology,
    resolveMockOrgsForRegion
} from '../../testModeData';

const CONFIRMED_SCOPE_BY_EMAIL_GLOBAL_STATE_KEY = 'sapTools.confirmedScopeByEmail.v1';
const SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY = 'sapTools.serviceMappingsByScope.v1';


export function resolveCfTopologySync(this: any): CfTopology {
if (isTestMode()) {
  return resolveMockCfTopology();
}
return getCfTopologySnapshotSync();
}

export async function resolveCfTopologyAsync(this: any): Promise<CfTopology> {
if (isTestMode()) {
  return resolveMockCfTopology();
}
return getCfTopologySnapshot();
}

export async function pushCfTopology(this: any): Promise<void> {
try {
  const topology = await this.resolveCfTopologyAsync();
  this.postCfTopologySnapshot(topology);
} catch (error) {
  const errorMessage =
    error instanceof Error ? error.message : 'Failed to read CF topology snapshot.';
  this.outputChannel.appendLine(
    `[topology] Failed to read cf-sync topology: ${sanitizeForLog(errorMessage)}`
  );
  this.postCfTopologySnapshot(EMPTY_CF_TOPOLOGY);
}
}

export function postCfTopologySnapshot(this: any, topology: CfTopology): void {
this.outputChannel.appendLine(
  `[topology] Pushed snapshot ready=${topology.ready ? 'true' : 'false'} accounts=${String(topology.accounts.length)}`
);
this.postMessage({
  type: MSG_CF_TOPOLOGY,
  topology: {
    ready: topology.ready,
    accounts: topology.accounts.map((account) => ({
      regionKey: account.regionKey,
      regionLabel: account.regionLabel,
      apiEndpoint: account.apiEndpoint,
      orgName: account.orgName,
      spaces: [...account.spaces],
    })),
  },
});
}

export async function handleTopologyOrgSelected(this: RegionSidebarProvider, payload: TopologyOrgSelectedPayload): Promise<void> {
    const region = SAP_BTP_REGIONS.find((entry) => entry.id === payload.regionKey);
    if (region === undefined) {
      this.outputChannel.appendLine(
        `[topology] Quick org pick rejected: unknown region key=${sanitizeForLog(payload.regionKey)}`
      );
      this.postOrgsError(`Region "${payload.regionKey}" is not known to SAP Tools.`);
      return;
    }

    this.outputChannel.appendLine(
      `[topology] Quick org pick region=${region.id} org=${sanitizeForLog(payload.orgName)}`
    );
    const regionPayload: RegionSelectionPayload = {
          id: region.id,
          name: region.displayName,
          code: toHyphenatedRegionCode(region.id),
          area: region.area,
        };
    this.logRegionSelection(regionPayload);
    await this.handleRegionSelected(regionPayload);
    const regionRequestId = this.regionSelectionRequestId;
    if (this.selectedRegionId !== region.id) {
      return;
    }

    let orgGuid = '';
    if (isTestMode()) {
      const mockOrg = resolveMockOrgsForRegion(regionPayload.code).find(
        (entry) => entry.name === payload.orgName
      );
      orgGuid = mockOrg?.guid ?? '';
    } else {
      orgGuid = await this.resolveOrgGuidByName(region.id, payload.orgName);
    }

    if (!this.isCurrentRegionRequest(regionRequestId)) {
      return;
    }

    if (orgGuid.length === 0) {
      this.outputChannel.appendLine(
        `[topology] Quick org pick failed: org "${sanitizeForLog(payload.orgName)}" not found in region ${region.id}`
      );
      this.postSpacesError(
        `Org "${payload.orgName}" was not found in region ${region.id}.`
      );
      return;
    }

    this.postMessage({
      type: MSG_TOPOLOGY_SCOPE_RESOLVED,
      scope: {
        regionId: region.id,
        regionCode: regionPayload.code,
        regionName: region.displayName,
        regionArea: region.area,
        orgGuid,
        orgName: payload.orgName,
      },
    });
    await this.handleOrgSelected({ guid: orgGuid, name: payload.orgName });
}
