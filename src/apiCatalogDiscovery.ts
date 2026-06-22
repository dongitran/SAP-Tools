import {
  fetchRemoteCdsServicesFromTarget,
  fetchXsuaaTokenFromTarget,
} from './cfClient.js';

interface ApiCatalogTargetParams {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
}

export interface DiscoveredApiEntity {
  readonly name: string;
  readonly methods: readonly string[];
  readonly schema: unknown;
  readonly path: string;
}

interface ApiCatalogDiscoveryOptions {
  readonly appId: string;
  readonly baseUrl: string;
  readonly targetParams: ApiCatalogTargetParams;
  readonly log: (message: string) => void;
  readonly onDeepDiscoveryStart: () => void;
}

const API_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const;

export async function discoverApiEntities(
  options: ApiCatalogDiscoveryOptions
): Promise<readonly DiscoveredApiEntity[]> {
  let entities = await discoverRootEntities(options);
  if (entities.length === 0) {
    entities = await discoverCdsEntities(options);
  }
  if (entities.length === 0) {
    return [];
  }
  options.log(`Attempting deep discovery on ${String(entities.length)} root endpoints...`);
  options.onDeepDiscoveryStart();
  const expanded = await expandEntities(options, entities);
  options.log(`Deep discovery complete. Found ${String(expanded.length)} total endpoints.`);
  return expanded;
}

async function discoverRootEntities(
  options: ApiCatalogDiscoveryOptions
): Promise<readonly DiscoveredApiEntity[]> {
  try {
    const token = await fetchXsuaaTokenFromTarget({
      ...options.targetParams,
      appName: options.appId,
    });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token !== null && token !== '') {
      headers['Authorization'] = normalizeBearerToken(token);
    }
    const response = await fetch(`${options.baseUrl}/`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? parseRootCatalog(await response.json()) : [];
  } catch (error) {
    options.log(`Failed to discover APIs from root endpoint: ${errorMessage(error)}`);
    return [];
  }
}

function parseRootCatalog(value: unknown): readonly DiscoveredApiEntity[] {
  if (!isRecord(value)) return [];
  const endpoints = value['endpoints'];
  if (Array.isArray(endpoints) && endpoints.length > 0) {
    return endpoints.map((endpoint) => {
      const record = isRecord(endpoint) ? endpoint : {};
      const path = typeof record['path'] === 'string' ? record['path'] : '';
      const normalizedPath = path.replace(/[^a-zA-Z0-9]/g, '');
      const fallbackName = normalizedPath === '' ? 'Unknown' : normalizedPath;
      const name = typeof record['name'] === 'string' && record['name'] !== ''
        ? record['name']
        : fallbackName;
      return createEntity(name, path);
    });
  }
  const entries = value['value'];
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return entries.map((entry) => {
    const record = isRecord(entry) ? entry : {};
    const name = typeof record['name'] === 'string' ? record['name'] : 'Unknown';
    const path = typeof record['url'] === 'string' ? `/${record['url']}` : '';
    return createEntity(name, path);
  });
}

async function discoverCdsEntities(
  options: ApiCatalogDiscoveryOptions
): Promise<readonly DiscoveredApiEntity[]> {
  options.log(
    `Warning: No API entities discovered remotely from root endpoint for ${options.appId}. Attempting fallback via CF SSH remote .cds scan...`
  );
  try {
    const content = await fetchRemoteCdsServicesFromTarget({
      ...options.targetParams,
      appName: options.appId,
    });
    const entities = typeof content === 'string' ? parseCdsServices(content) : [];
    if (entities.length > 0) {
      options.log(`Discovered ${String(entities.length)} entities via remote CF SSH scan.`);
    }
    return entities;
  } catch (error) {
    options.log(`CF SSH fallback failed: ${errorMessage(error)}`);
    return [];
  }
}

function parseCdsServices(content: string): readonly DiscoveredApiEntity[] {
  const entities: DiscoveredApiEntity[] = [];
  const discovered = new Set<string>();
  const withPath = /service\s+([A-Za-z0-9_]+)[^{]*?@\(\s*path\s*:\s*['"]([^'"]+)['"]\s*\)/g;
  let match = withPath.exec(content);
  while (match !== null) {
    const name = match[1] ?? '';
    if (name !== '' && !discovered.has(name)) {
      discovered.add(name);
      entities.push(createEntity(name, match[2] ?? ''));
    }
    match = withPath.exec(content);
  }
  if (entities.length > 0) return entities;
  const byName = /service\s+([A-Za-z0-9_]+)/g;
  match = byName.exec(content);
  while (match !== null) {
    const name = match[1] ?? '';
    if (name !== '' && !discovered.has(name)) {
      discovered.add(name);
      entities.push(createEntity(name, `/odata/v4/${name.replace(/Service$/, '').toLowerCase()}`));
    }
    match = byName.exec(content);
  }
  return entities;
}

async function expandEntities(
  options: ApiCatalogDiscoveryOptions,
  entities: readonly DiscoveredApiEntity[]
): Promise<readonly DiscoveredApiEntity[]> {
  const token = await fetchXsuaaTokenFromTarget({
    ...options.targetParams,
    appName: options.appId,
  });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token !== null && token !== '') {
    headers['Authorization'] = normalizeBearerToken(token);
  }
  const results = await Promise.allSettled(
    entities.map(async (entity): Promise<readonly DiscoveredApiEntity[]> =>
      expandEntity(options.baseUrl, entity, headers)
    )
  );
  const expanded: DiscoveredApiEntity[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') expanded.push(...result.value);
  }
  return expanded.length > 0 ? expanded : entities;
}

async function expandEntity(
  baseUrl: string,
  entity: DiscoveredApiEntity,
  headers: Readonly<Record<string, string>>
): Promise<readonly DiscoveredApiEntity[]> {
  if (entity.path === '' || entity.path === '/') return [entity];
  try {
    const separator = entity.path.startsWith('/') ? '' : '/';
    const response = await fetch(`${baseUrl}${separator}${entity.path}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [entity];
    const subEntities = parseSubEntities(await response.json(), entity);
    return subEntities.length > 0 ? subEntities : [entity];
  } catch {
    return [entity];
  }
}

function parseSubEntities(
  value: unknown,
  parent: DiscoveredApiEntity
): readonly DiscoveredApiEntity[] {
  if (!isRecord(value) || !Array.isArray(value['value'])) return [];
  const entities: DiscoveredApiEntity[] = [];
  for (const rawEntry of value['value']) {
    if (!isRecord(rawEntry) || typeof rawEntry['name'] !== 'string') continue;
    if (rawEntry['name'] === '') continue;
    const path = typeof rawEntry['url'] === 'string' && rawEntry['url'] !== ''
      ? rawEntry['url']
      : rawEntry['name'];
    entities.push(createEntity(`${parent.name} / ${rawEntry['name']}`, `${parent.path}/${path}`));
  }
  return entities;
}

function createEntity(name: string, path: string): DiscoveredApiEntity {
  return {
    name,
    methods: API_METHODS,
    schema: { type: 'object', properties: {} },
    path,
  };
}

function normalizeBearerToken(token: string): string {
  return token.startsWith('bearer') || token.startsWith('Bearer') ? token : `Bearer ${token}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
