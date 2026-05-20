import { describe, expect, it } from 'vitest';
import { REGION_KEYS } from '@saptools/cf-sync';

import { REGION_AREAS, SAP_BTP_REGIONS, toHyphenatedRegionCode } from './regions';

type SapBtpRegion = (typeof SAP_BTP_REGIONS)[number];

function countByArea(area: string): number {
  return SAP_BTP_REGIONS.filter((region) => region.area === area).length;
}

describe('SAP_BTP_REGIONS', () => {
  it('contains 50 regions', () => {
    expect(SAP_BTP_REGIONS).toHaveLength(50);
  });

  it('keeps grouped distribution across areas', () => {
    expect(countByArea('Americas')).toBe(14);
    expect(countByArea('Europe')).toBe(17);
    expect(countByArea('Middle East and Africa')).toBe(4);
    expect(countByArea('Asia Pacific')).toBe(13);
    expect(countByArea('China')).toBe(2);
  });

  it('orders regions within each area by display name and id', () => {
    for (const area of REGION_AREAS) {
      const areaRegions = SAP_BTP_REGIONS.filter((region) => region.area === area);
      const sortedAreaRegions = [...areaRegions].sort(compareRegionDisplayOrder);
      expect(areaRegions.map((region) => region.id)).toEqual(
        sortedAreaRegions.map((region) => region.id)
      );
    }
  });

  it('lists eu10-004 extension landscape in Europe picker group', () => {
    expect(SAP_BTP_REGIONS).toContainEqual({
      id: 'eu10-004',
      displayName: 'Europe (Frankfurt) - AWS Extension',
      area: 'Europe',
      provider: 'AWS',
    });
  });

  it('lists us10-001 extension landscape in Americas picker group', () => {
    expect(SAP_BTP_REGIONS).toContainEqual({
      id: 'us10-001',
      displayName: 'US East (VA) - AWS Extension',
      area: 'Americas',
      provider: 'AWS',
    });
  });

  it('lists current Cloud Foundry extension landscapes from SAP Help', () => {
    const extensionRegions = [
      {
        id: 'us10-002',
        displayName: 'US East (VA) - AWS Extension',
        area: 'Americas',
        provider: 'AWS',
      },
      {
        id: 'eu10-002',
        displayName: 'Europe (Frankfurt) - AWS Extension',
        area: 'Europe',
        provider: 'AWS',
      },
      {
        id: 'eu10-003',
        displayName: 'Europe (Frankfurt) - AWS Extension',
        area: 'Europe',
        provider: 'AWS',
      },
      {
        id: 'eu10-004',
        displayName: 'Europe (Frankfurt) - AWS Extension',
        area: 'Europe',
        provider: 'AWS',
      },
      {
        id: 'eu10-005',
        displayName: 'Europe (Frankfurt) - AWS Extension',
        area: 'Europe',
        provider: 'AWS',
      },
      {
        id: 'eu10-006',
        displayName: 'Europe (Frankfurt) - AWS Extension',
        area: 'Europe',
        provider: 'AWS',
      },
      {
        id: 'eu20-001',
        displayName: 'Europe (Netherlands) - Azure Extension',
        area: 'Europe',
        provider: 'Azure',
      },
      {
        id: 'eu20-002',
        displayName: 'Europe (Netherlands) - Azure Extension',
        area: 'Europe',
        provider: 'Azure',
      },
    ];

    for (const extensionRegion of extensionRegions) {
      expect(SAP_BTP_REGIONS).toContainEqual(extensionRegion);
    }
  });

  it('keeps SAP Tools region catalog covered by cf-sync', () => {
    const cfSyncRegionKeys = new Set<string>(REGION_KEYS);
    const missingFromCfSync = SAP_BTP_REGIONS.map((region) => region.id).filter(
      (regionId) => !cfSyncRegionKeys.has(regionId)
    );

    expect(missingFromCfSync).toEqual([]);
  });

  it('formats region code into hyphen form', () => {
    expect(toHyphenatedRegionCode('us10')).toBe('us-10');
    expect(toHyphenatedRegionCode('us-10')).toBe('us-10');
    expect(toHyphenatedRegionCode('CN40')).toBe('cn-40');
    expect(toHyphenatedRegionCode('us10001')).toBe('us10-001');
    expect(toHyphenatedRegionCode('US10-001')).toBe('us10-001');
    expect(toHyphenatedRegionCode('us10002')).toBe('us10-002');
    expect(toHyphenatedRegionCode('eu10002')).toBe('eu10-002');
    expect(toHyphenatedRegionCode('eu10003')).toBe('eu10-003');
    expect(toHyphenatedRegionCode('eu10004')).toBe('eu10-004');
    expect(toHyphenatedRegionCode('EU10-004')).toBe('eu10-004');
    expect(toHyphenatedRegionCode('eu10005')).toBe('eu10-005');
    expect(toHyphenatedRegionCode('eu20001')).toBe('eu20-001');
    expect(toHyphenatedRegionCode('EU20-002')).toBe('eu20-002');
  });
});

function compareRegionDisplayOrder(left: SapBtpRegion, right: SapBtpRegion): number {
  const displayNameCompare = left.displayName.localeCompare(right.displayName);
  if (displayNameCompare !== 0) {
    return displayNameCompare;
  }

  return left.id.localeCompare(right.id);
}
