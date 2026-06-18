import type { ApiTraceEvent, ApiTraceUrlSummary } from './apiTraceTypes';

type StatusBucket = '2xx' | '3xx' | '4xx' | '5xx' | 'unknown';

interface MutableSummary {
  readonly normalizedUrl: string;
  readonly displayUrl: string;
  readonly methods: Set<string>;
  totalCount: number;
  readonly statusCounts: {
    '2xx': number;
    '3xx': number;
    '4xx': number;
    '5xx': number;
    unknown: number;
  };
  latestStatus: number | null;
  latestDurationMs: number | null;
  latestSeenAt: string;
}

export function buildTraceUrlSummaries(
  events: readonly ApiTraceEvent[]
): ApiTraceUrlSummary[] {
  const summaries = new Map<string, MutableSummary>();

  for (const event of events) {
    const normalizedUrl = normalizeTraceEventUrl(event);
    const current = summaries.get(normalizedUrl) ?? createSummary(normalizedUrl);
    current.methods.add(event.method);
    current.totalCount += 1;
    current.statusCounts[toStatusBucket(event.status)] += 1;
    if (event.timestamp >= current.latestSeenAt) {
      current.latestStatus = event.status;
      current.latestDurationMs = event.durationMs;
      current.latestSeenAt = event.timestamp;
    }
    summaries.set(normalizedUrl, current);
  }

  return [...summaries.values()]
    .map(toImmutableSummary)
    .sort((left, right) => right.latestSeenAt.localeCompare(left.latestSeenAt));
}

export function normalizeTraceEventUrl(event: ApiTraceEvent): string {
  const candidate = event.normalizedUrl.length > 0
    ? event.normalizedUrl
    : event.url.length > 0
      ? event.url
      : event.path;
  return normalizeUrlForSummary(candidate);
}

function normalizeUrlForSummary(rawUrl: string): string {
  if (rawUrl.trim().length === 0) {
    return rawUrl;
  }
  try {
    const parsed = new URL(rawUrl, 'https://saptools.local');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

function createSummary(normalizedUrl: string): MutableSummary {
  return {
    normalizedUrl,
    displayUrl: normalizedUrl,
    methods: new Set<string>(),
    totalCount: 0,
    statusCounts: {
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0,
      unknown: 0,
    },
    latestStatus: null,
    latestDurationMs: null,
    latestSeenAt: '',
  };
}

function toImmutableSummary(summary: MutableSummary): ApiTraceUrlSummary {
  return {
    normalizedUrl: summary.normalizedUrl,
    displayUrl: summary.displayUrl,
    methods: [...summary.methods].sort(),
    totalCount: summary.totalCount,
    statusCounts: { ...summary.statusCounts },
    latestStatus: summary.latestStatus,
    latestDurationMs: summary.latestDurationMs,
    latestSeenAt: summary.latestSeenAt,
  };
}

function toStatusBucket(status: number | null): StatusBucket {
  if (status === null) return 'unknown';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'unknown';
}
