// cspell:ignore clientid clientsecret smf tokenendpoint

export interface AdvancedEventMeshOAuth {
  readonly clientid: string;
  readonly clientsecret: string;
  readonly tokenendpoint: string;
  readonly granttype?: string;
}

export interface AdvancedEventMeshBinding {
  readonly index: number;
  readonly name: string;
  readonly instanceName: string;
  readonly vpn: string;
  readonly managementUri: string;
  readonly smfUri: string;
  readonly authentication: AdvancedEventMeshOAuth;
}

export interface AdvancedEventMeshValidationBinding {
  readonly index: number;
  readonly name: string;
  readonly instanceName: string;
  readonly handshakeUri: string;
  readonly authentication: AdvancedEventMeshOAuth;
}

export interface AdvancedEventMeshDiscovery {
  readonly brokerBindings: AdvancedEventMeshBinding[];
  readonly validationBindings: AdvancedEventMeshValidationBinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readName(service: Record<string, unknown>, fallback: string): string {
  return readNonEmptyString(service, 'name') ?? fallback;
}

function readInstanceName(service: Record<string, unknown>, fallback: string): string {
  return readNonEmptyString(service, 'instance_name') ?? fallback;
}

function parseOAuth(value: unknown): AdvancedEventMeshOAuth | null {
  if (!isRecord(value)) {
    return null;
  }
  const clientid = readNonEmptyString(value, 'clientid');
  const clientsecret = readNonEmptyString(value, 'clientsecret');
  const tokenendpoint = readNonEmptyString(value, 'tokenendpoint');
  if (clientid === null || clientsecret === null || tokenendpoint === null) {
    return null;
  }
  const granttype = readNonEmptyString(value, 'granttype');
  return granttype === null
    ? { clientid, clientsecret, tokenendpoint: stripTrailingSlash(tokenendpoint) }
    : { clientid, clientsecret, tokenendpoint: stripTrailingSlash(tokenendpoint), granttype };
}

function normalizeBrokerBinding(service: unknown, index: number): AdvancedEventMeshBinding | null {
  if (!isRecord(service) || !isRecord(service['credentials'])) {
    return null;
  }
  const credentials = service['credentials'];
  const authentication = parseOAuth(credentials['authentication-service']);
  const endpoints = credentials['endpoints'];
  const endpoint = isRecord(endpoints) ? endpoints['advanced-event-mesh'] : null;
  if (!isRecord(endpoint) || authentication === null) {
    return null;
  }
  const vpn = readNonEmptyString(credentials, 'vpn');
  const managementUri = readNonEmptyString(endpoint, 'uri');
  const smfUri = readNonEmptyString(endpoint, 'smf_uri');
  if (vpn === null || managementUri === null || smfUri === null) {
    return null;
  }
  const name = readName(service, `advanced-event-mesh-${String(index)}`);
  return {
    index,
    name,
    instanceName: readInstanceName(service, name),
    vpn,
    managementUri: stripTrailingSlash(managementUri),
    smfUri: stripTrailingSlash(smfUri),
    authentication,
  };
}

function normalizeValidationBinding(
  service: unknown,
  index: number
): AdvancedEventMeshValidationBinding | null {
  if (!isRecord(service) || !isRecord(service['credentials'])) {
    return null;
  }
  const handshake = service['credentials']['handshake'];
  if (!isRecord(handshake)) {
    return null;
  }
  const handshakeUri = readNonEmptyString(handshake, 'uri');
  const authentication = parseOAuth(handshake['oa2']);
  if (handshakeUri === null || authentication === null) {
    return null;
  }
  const name = readName(service, `aem-validation-service-${String(index)}`);
  return {
    index,
    name,
    instanceName: readInstanceName(service, name),
    handshakeUri: stripTrailingSlash(handshakeUri),
    authentication,
  };
}

function parseArray<T>(
  services: unknown,
  normalize: (service: unknown, index: number) => T | null
): T[] {
  if (!Array.isArray(services)) {
    return [];
  }
  const parsed: T[] = [];
  services.forEach((service, index) => {
    const binding = normalize(service, index);
    if (binding !== null) {
      parsed.push(binding);
    }
  });
  return parsed;
}

export function extractAdvancedEventMeshDiscovery(defaultEnv: unknown): AdvancedEventMeshDiscovery {
  if (!isRecord(defaultEnv) || !isRecord(defaultEnv['VCAP_SERVICES'])) {
    return { brokerBindings: [], validationBindings: [] };
  }
  const vcap = defaultEnv['VCAP_SERVICES'];
  return {
    brokerBindings: parseArray(vcap['user-provided'], normalizeBrokerBinding),
    validationBindings: parseArray(vcap['aem-validation-service'], normalizeValidationBinding),
  };
}
