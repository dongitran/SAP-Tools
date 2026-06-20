// cspell:ignore clientid clientsecret msgVpns SEMP Semp semp tokenendpoint Vpns
import type { AdvancedEventMeshBinding, AdvancedEventMeshOAuth } from './advancedEventMeshBindings';

const SEMP_CONFIG_PREFIX = '/SEMP/v2/config';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_SEMP_TIMEOUT_MS = 15000;
const DEFAULT_SUBSCRIPTION_DISCOVERY_CONCURRENCY = 6;
const MAX_SEMP_PAGES = 100;

export type AdvancedEventMeshFetchFn = typeof fetch;

export interface AdvancedEventMeshQueueSummary {
  readonly queueName: string;
  readonly permission?: string;
  readonly ingressEnabled?: boolean;
  readonly egressEnabled?: boolean;
  readonly subscriptionCount?: number;
}

export interface AdvancedEventMeshTopicSummary {
  readonly topic: string;
  readonly queues: string[];
}

export interface AdvancedEventMeshQueueDiscovery {
  readonly queues: AdvancedEventMeshQueueSummary[];
  readonly topics: AdvancedEventMeshTopicSummary[];
  readonly unreadableQueueCount: number;
}

export class AdvancedEventMeshSempError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number
  ) {
    super(`${method} ${url} failed with HTTP ${String(status)}.`);
    this.name = 'AdvancedEventMeshSempError';
  }
}

class AdvancedEventMeshTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${String(timeoutMs)} ms.`);
    this.name = 'AdvancedEventMeshTimeoutError';
  }
}

interface SempPage {
  readonly items: readonly unknown[];
  readonly nextPageUri: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readCollection(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  for (const key of ['data', 'queues', 'subscriptions', 'value', 'results']) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function readNextPageUri(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value['meta']) || !isRecord(value['meta']['pagination'])) {
    return null;
  }
  return readString(value['meta']['pagination'], ['nextPageUri', 'nextPageUrl', 'next']);
}

function parseQueue(entry: unknown): AdvancedEventMeshQueueSummary | null {
  if (!isRecord(entry)) {
    return null;
  }
  const queueName = readString(entry, ['queueName', 'name', 'qname']);
  if (queueName === null) {
    return null;
  }
  const queue: {
    queueName: string;
    permission?: string;
    ingressEnabled?: boolean;
    egressEnabled?: boolean;
    subscriptionCount?: number;
  } = { queueName };
  const permission = readString(entry, ['permission']);
  const ingressEnabled = readBoolean(entry, 'ingressEnabled');
  const egressEnabled = readBoolean(entry, 'egressEnabled');
  const subscriptionCount = readNumber(entry, 'subscriptionCount');
  if (permission !== null) queue.permission = permission;
  if (ingressEnabled !== null) queue.ingressEnabled = ingressEnabled;
  if (egressEnabled !== null) queue.egressEnabled = egressEnabled;
  if (subscriptionCount !== null) queue.subscriptionCount = subscriptionCount;
  return queue;
}

function parseSubscriptionTopic(entry: unknown): string | null {
  if (typeof entry === 'string' && entry.length > 0) {
    return entry;
  }
  return isRecord(entry)
    ? readString(entry, ['subscriptionTopic', 'topic', 'topicName', 'topicPattern', 'name'])
    : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && /aborted/i.test(error.message);
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) {
        await work(item);
      }
    }
  });
  await Promise.all(workers);
}

async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (parentSignal?.aborted === true) {
    throw new Error(`${label} was aborted.`);
  }
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abortFromParent = (): void => {
    rejectAbort(new Error(`${label} was aborted.`));
    controller.abort(parentSignal?.reason);
  };
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    const error = new AdvancedEventMeshTimeoutError(label, timeoutMs);
    rejectAbort(error);
    controller.abort(error);
  }, timeoutMs);
  try {
    return await Promise.race([work(controller.signal), abortPromise]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function requestOAuthToken(
  authentication: AdvancedEventMeshOAuth,
  fetchImpl: AdvancedEventMeshFetchFn,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const body = new URLSearchParams({
    grant_type: authentication.granttype ?? 'client_credentials',
    response_type: 'token',
    client_id: authentication.clientid,
    client_secret: authentication.clientsecret,
  });
  const response = await fetchImpl(authentication.tokenendpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    ...(signal !== undefined ? { signal } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new AdvancedEventMeshSempError('POST', authentication.tokenendpoint, response.status);
  }
  const payload = parseJson(text);
  if (!isRecord(payload) || typeof payload['access_token'] !== 'string') {
    throw new Error(`OAuth token response from ${authentication.tokenendpoint} did not include access_token.`);
  }
  const expiresIn = payload['expires_in'];
  return {
    accessToken: payload['access_token'],
    expiresInSeconds: typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 300,
  };
}

export class AdvancedEventMeshSempClient {
  private cachedToken: { readonly accessToken: string; readonly expiresAt: number } | null = null;

  constructor(
    private readonly binding: AdvancedEventMeshBinding,
    private readonly fetchImpl: AdvancedEventMeshFetchFn = fetch,
    private readonly now: () => number = Date.now,
    private readonly requestTimeoutMs: number = DEFAULT_SEMP_TIMEOUT_MS
  ) {}

  async listQueues(signal?: AbortSignal): Promise<AdvancedEventMeshQueueSummary[]> {
    const path = `/msgVpns/${encodeSegment(this.binding.vpn)}/queues?count=${String(DEFAULT_PAGE_SIZE)}`;
    const entries = await this.readCollectionPages(path, signal);
    return entries
      .map(parseQueue)
      .filter((queue): queue is AdvancedEventMeshQueueSummary => queue !== null)
      .sort((left, right) => left.queueName.localeCompare(right.queueName));
  }

  async listQueueSubscriptions(queueName: string, signal?: AbortSignal): Promise<string[]> {
    const path =
      `/msgVpns/${encodeSegment(this.binding.vpn)}` +
      `/queues/${encodeSegment(queueName)}/subscriptions?count=${String(DEFAULT_PAGE_SIZE)}`;
    const entries = await this.readCollectionPages(path, signal);
    return entries
      .map(parseSubscriptionTopic)
      .filter((topic): topic is string => topic !== null)
      .sort((left, right) => left.localeCompare(right));
  }

  async discoverQueueSubscriptions(signal?: AbortSignal): Promise<AdvancedEventMeshQueueDiscovery> {
    const queues = await this.listQueues(signal);
    const topicsByName = new Map<string, Set<string>>();
    let unreadableQueueCount = 0;
    await runWithConcurrency(queues, DEFAULT_SUBSCRIPTION_DISCOVERY_CONCURRENCY, async (queue) => {
      try {
        const topics = await this.listQueueSubscriptions(queue.queueName, signal);
        for (const topic of topics) {
          const queueNames = topicsByName.get(topic) ?? new Set<string>();
          queueNames.add(queue.queueName);
          topicsByName.set(topic, queueNames);
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        // Keep discovery useful when one queue is unreadable.
        unreadableQueueCount += 1;
      }
    });
    return { queues, topics: this.toTopicSummaries(topicsByName), unreadableQueueCount };
  }

  private toTopicSummaries(topicsByName: Map<string, Set<string>>): AdvancedEventMeshTopicSummary[] {
    return [...topicsByName.entries()]
      .map(([topic, queueNames]) => ({
        topic,
        queues: [...queueNames].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.topic.localeCompare(right.topic));
  }

  private async readCollectionPages(path: string, signal?: AbortSignal): Promise<readonly unknown[]> {
    const items: unknown[] = [];
    let nextPath: string | null = path;
    const seenUrls = new Set<string>();
    for (let pageCount = 0; nextPath !== null; pageCount += 1) {
      if (pageCount >= MAX_SEMP_PAGES) {
        throw new Error(`Advanced Event Mesh SEMP pagination exceeded ${String(MAX_SEMP_PAGES)} pages.`);
      }
      const url = this.buildSempUrl(nextPath);
      if (seenUrls.has(url)) {
        throw new Error('Advanced Event Mesh SEMP pagination loop detected.');
      }
      seenUrls.add(url);
      const page = await this.readCollectionPageUrl(url, signal);
      items.push(...page.items);
      nextPath = page.nextPageUri;
    }
    return items;
  }

  private async readCollectionPageUrl(url: string, signal?: AbortSignal): Promise<SempPage> {
    const payload = await this.sempGetJsonUrl(url, signal);
    return {
      items: readCollection(payload),
      nextPageUri: readNextPageUri(payload),
    };
  }

  private async sempGetJsonUrl(url: string, signal?: AbortSignal): Promise<unknown> {
    return withTimeout('GET Advanced Event Mesh SEMP request', this.requestTimeoutMs, signal, async (requestSignal) => {
      const token = await this.getToken(requestSignal);
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: requestSignal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new AdvancedEventMeshSempError('GET', url, response.status);
      }
      return parseJson(body);
    });
  }

  private buildSempUrl(path: string): string {
    const base = new URL(this.binding.managementUri);
    if (/^https?:\/\//u.test(path)) {
      const url = new URL(path);
      if (url.origin !== base.origin) {
        throw new Error('Advanced Event Mesh SEMP pagination link points outside the management endpoint.');
      }
      return url.toString();
    }
    const prefixedPath = path.startsWith(SEMP_CONFIG_PREFIX)
      ? path
      : `${SEMP_CONFIG_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
    return new URL(prefixedPath, base.origin).toString();
  }

  private async getToken(signal?: AbortSignal): Promise<string> {
    const current = this.cachedToken;
    if (current !== null && current.expiresAt - 60000 > this.now()) {
      return current.accessToken;
    }
    const { accessToken, expiresInSeconds } = await requestOAuthToken(
      this.binding.authentication,
      this.fetchImpl,
      signal
    );
    this.cachedToken = { accessToken, expiresAt: this.now() + expiresInSeconds * 1000 };
    return accessToken;
  }
}
