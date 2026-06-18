import { describe, expect, it } from 'vitest';

import { buildTraceUrlSummaries } from './apiTraceSummary';
import type { ApiTraceEvent } from './apiTraceTypes';

function makeEvent(
  id: string,
  normalizedUrl: string,
  method: string,
  status: number,
  durationMs: number
): ApiTraceEvent {
  return {
    id,
    timestamp: `2026-06-18T07:22:1${id}.000Z`,
    appId: 'finance-uat-api',
    instance: '0',
    method,
    path: normalizedUrl,
    url: `https://app.example.com${normalizedUrl}`,
    normalizedUrl,
    status,
    durationMs,
    requestBytes: 0,
    responseBytes: 0,
    requestHeaders: {},
    responseHeaders: {},
    requestBodyPreview: '',
    responseBodyPreview: '',
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    droppedBeforeEvent: 0,
    source: 'runtime-http',
    traceId: id,
    correlationId: null,
  };
}

describe('API trace URL summaries', () => {
  it('aggregates hits, methods, status buckets and latest timing by normalized URL', () => {
    const summaries = buildTraceUrlSummaries([
      makeEvent('1', '/odata/v4/products?$top=5', 'GET', 200, 84),
      makeEvent('2', '/odata/v4/products?$top=5', 'GET', 500, 240),
      makeEvent('3', '/odata/v4/orders', 'POST', 201, 120),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toEqual(
      expect.objectContaining({
        normalizedUrl: '/odata/v4/orders',
        methods: ['POST'],
        totalCount: 1,
        latestStatus: 201,
        latestDurationMs: 120,
      })
    );
    expect(summaries[1]).toEqual(
      expect.objectContaining({
        normalizedUrl: '/odata/v4/products?$top=5',
        methods: ['GET'],
        totalCount: 2,
        latestStatus: 500,
        latestDurationMs: 240,
      })
    );
    expect(summaries[1]?.statusCounts).toEqual({
      '2xx': 1,
      '3xx': 0,
      '4xx': 0,
      '5xx': 1,
      unknown: 0,
    });
  });

  it('normalizes URL query values when normalizedUrl is missing', () => {
    const event = makeEvent('1', '', 'GET', 200, 10);
    const summaries = buildTraceUrlSummaries([
      {
        ...event,
        path: '/odata/v4/products',
        url: 'https://app.example.com/odata/v4/products?token=secret&$top=5',
        normalizedUrl: '',
      },
    ]);

    expect(summaries[0]?.normalizedUrl).toBe('/odata/v4/products?token=secret&$top=5');
  });
});
