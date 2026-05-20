export const REGION_AREAS = [
  'Americas',
  'Europe',
  'Middle East and Africa',
  'Asia Pacific',
  'China',
] as const;

export type RegionArea = (typeof REGION_AREAS)[number];

export const PROVIDERS = ['AWS', 'Azure', 'GCP', 'SAP', 'Alibaba'] as const;

export type Provider = (typeof PROVIDERS)[number];

export interface SapBtpRegion {
  readonly id: string;
  readonly displayName: string;
  readonly area: RegionArea;
  readonly provider: Provider;
}

export const SAP_BTP_REGIONS: readonly SapBtpRegion[] = [
  { id: 'br10', displayName: 'Brazil (Sao Paulo)', area: 'Americas', provider: 'AWS' },
  { id: 'br20', displayName: 'Brazil (Sao Paulo) - Azure', area: 'Americas', provider: 'Azure' },
  { id: 'br30', displayName: 'Brazil (Sao Paulo) - GCP', area: 'Americas', provider: 'GCP' },
  { id: 'ca10', displayName: 'Canada (Montreal)', area: 'Americas', provider: 'AWS' },
  {
    id: 'ca20',
    displayName: 'Canada Central (Toronto)',
    area: 'Americas',
    provider: 'Azure',
  },
  { id: 'us01', displayName: 'US (Sterling)', area: 'Americas', provider: 'SAP' },
  { id: 'us30', displayName: 'US Central (IA)', area: 'Americas', provider: 'GCP' },
  { id: 'us10', displayName: 'US East (VA)', area: 'Americas', provider: 'AWS' },
  {
    id: 'us10-001',
    displayName: 'US East (VA) - AWS Extension',
    area: 'Americas',
    provider: 'AWS',
  },
  {
    id: 'us10-002',
    displayName: 'US East (VA) - AWS Extension',
    area: 'Americas',
    provider: 'AWS',
  },
  { id: 'us21', displayName: 'US East (VA) - Azure', area: 'Americas', provider: 'Azure' },
  { id: 'us02', displayName: 'US West (Colorado)', area: 'Americas', provider: 'SAP' },
  { id: 'us11', displayName: 'US West (Oregon)', area: 'Americas', provider: 'AWS' },
  { id: 'us20', displayName: 'US West (WA)', area: 'Americas', provider: 'Azure' },

  { id: 'eu10', displayName: 'Europe (Frankfurt)', area: 'Europe', provider: 'AWS' },
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
    id: 'eu11',
    displayName: 'Europe (Frankfurt) - AWS Secondary',
    area: 'Europe',
    provider: 'AWS',
  },
  { id: 'eu22', displayName: 'Europe (Frankfurt) - Azure', area: 'Europe', provider: 'Azure' },
  { id: 'eu01', displayName: 'Europe (Frankfurt) - EU Access', area: 'Europe', provider: 'SAP' },
  { id: 'eu30', displayName: 'Europe (Frankfurt) - GCP', area: 'Europe', provider: 'GCP' },
  { id: 'eu13', displayName: 'Europe (Milan)', area: 'Europe', provider: 'AWS' },
  { id: 'eu20', displayName: 'Europe (Netherlands)', area: 'Europe', provider: 'Azure' },
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
  { id: 'eu02', displayName: 'Europe (Rot) - SAP EU Access', area: 'Europe', provider: 'SAP' },
  { id: 'ch20', displayName: 'Switzerland (Zurich)', area: 'Europe', provider: 'Azure' },
  { id: 'uk20', displayName: 'UK South (London)', area: 'Europe', provider: 'Azure' },

  {
    id: 'il30',
    displayName: 'Israel (Tel Aviv)',
    area: 'Middle East and Africa',
    provider: 'GCP',
  },
  {
    id: 'sa31',
    displayName: 'KSA (Dammam - Non-Regulated)',
    area: 'Middle East and Africa',
    provider: 'GCP',
  },
  {
    id: 'sa30',
    displayName: 'KSA (Dammam - Regulated)',
    area: 'Middle East and Africa',
    provider: 'GCP',
  },
  { id: 'ae01', displayName: 'UAE (Dubai)', area: 'Middle East and Africa', provider: 'SAP' },

  { id: 'ap12', displayName: 'Asia Pacific (Seoul)', area: 'Asia Pacific', provider: 'AWS' },
  {
    id: 'ap11',
    displayName: 'Asia Pacific (Singapore)',
    area: 'Asia Pacific',
    provider: 'AWS',
  },
  { id: 'ap10', displayName: 'Australia (Sydney)', area: 'Asia Pacific', provider: 'AWS' },
  { id: 'ap20', displayName: 'Australia (Sydney) - Azure', area: 'Asia Pacific', provider: 'Azure' },
  { id: 'ap30', displayName: 'Australia (Sydney) - GCP', area: 'Asia Pacific', provider: 'GCP' },
  { id: 'ap01', displayName: 'Australia (Sydney) - SAP', area: 'Asia Pacific', provider: 'SAP' },
  { id: 'in30', displayName: 'India (Mumbai)', area: 'Asia Pacific', provider: 'GCP' },
  { id: 'jp30', displayName: 'Japan (Osaka)', area: 'Asia Pacific', provider: 'GCP' },
  { id: 'jp10', displayName: 'Japan (Tokyo)', area: 'Asia Pacific', provider: 'AWS' },
  { id: 'jp20', displayName: 'Japan (Tokyo) - Azure', area: 'Asia Pacific', provider: 'Azure' },
  { id: 'jp31', displayName: 'Japan (Tokyo) - GCP', area: 'Asia Pacific', provider: 'GCP' },
  { id: 'jp01', displayName: 'Japan (Tokyo) - SAP', area: 'Asia Pacific', provider: 'SAP' },
  { id: 'ap21', displayName: 'Singapore - Azure', area: 'Asia Pacific', provider: 'Azure' },

  { id: 'cn20', displayName: 'China (North 3)', area: 'China', provider: 'Azure' },
  { id: 'cn40', displayName: 'China (Shanghai)', area: 'China', provider: 'Alibaba' },
] as const;

/**
 * Convert region id from catalog form (`us10`) into hyphen form (`us-10`).
 */
export function toHyphenatedRegionCode(regionId: string): string {
  const normalized = regionId.trim().toLowerCase();
  if (normalized.length < 3) {
    return normalized;
  }

  const compact = normalized.replaceAll('-', '');
  if (/^[a-z]{2}\d{5}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }

  if (normalized.includes('-')) {
    return normalized;
  }

  const head = normalized.slice(0, 2);
  const tail = normalized.slice(2);
  return `${head}-${tail}`;
}
