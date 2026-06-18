export type ApiTraceLifecycleState =
  | 'idle'
  | 'preparingCli'
  | 'checkingRuntime'
  | 'needsInspector'
  | 'openingTunnel'
  | 'injecting'
  | 'streaming'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

export type ApiTraceStopReason =
  | 'user'
  | 'panel-closed'
  | 'scope-changed'
  | 'shutdown'
  | 'target-changed';

export interface ApiTraceStartOptions {
  readonly mode: 'runtime-http';
  readonly instanceIndex: number | 'all';
  readonly processName: string;
  readonly captureHeaders: boolean;
  readonly captureRequestBody: boolean;
  readonly captureResponseBody: boolean;
  readonly maxBodyBytes: number;
  readonly filters: {
    readonly method: readonly string[];
    readonly pathContains: string;
    readonly statusClass: 'all' | '2xx' | '3xx' | '4xx' | '5xx';
  };
}

export interface ApiTraceStatePayload {
  readonly state: ApiTraceLifecycleState;
  readonly appId: string;
  readonly mode: 'runtime-http';
  readonly message: string;
  readonly runtimeHookInstalled: boolean;
  readonly runtimeHookMayRemain: boolean;
}

export interface ApiTraceEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly appId: string;
  readonly instance: string;
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly normalizedUrl: string;
  readonly status: number | null;
  readonly durationMs: number | null;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly requestHeaders: Record<string, string>;
  readonly responseHeaders: Record<string, string>;
  readonly requestBodyPreview: string;
  readonly responseBodyPreview: string;
  readonly requestBodyTruncated: boolean;
  readonly responseBodyTruncated: boolean;
  readonly droppedBeforeEvent: number;
  readonly source: 'runtime-http';
  readonly traceId: string;
  readonly correlationId: string | null;
}

export interface ApiTraceUrlSummary {
  readonly normalizedUrl: string;
  readonly displayUrl: string;
  readonly methods: readonly string[];
  readonly totalCount: number;
  readonly statusCounts: {
    readonly '2xx': number;
    readonly '3xx': number;
    readonly '4xx': number;
    readonly '5xx': number;
    readonly unknown: number;
  };
  readonly latestStatus: number | null;
  readonly latestDurationMs: number | null;
  readonly latestSeenAt: string;
}

export interface ApiTraceBatchPayload {
  readonly events: readonly ApiTraceEvent[];
}

export interface ApiTraceUrlSummaryPayload {
  readonly urls: readonly ApiTraceUrlSummary[];
  readonly selectedUrl: string;
}
