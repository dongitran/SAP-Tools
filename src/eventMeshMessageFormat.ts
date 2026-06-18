export type EventMeshPayloadEncoding = 'json' | 'text' | 'base64';

export interface FormattedEventMeshPayload {
  readonly value: string;
  readonly encoding: EventMeshPayloadEncoding;
  readonly truncated: boolean;
  readonly size: number;
}

function isProbablyUtf8(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }
  return !buffer.toString('utf8').includes('�');
}

export function formatEventMeshPayload(
  buffer: Buffer,
  contentType: string,
  limit: number
): FormattedEventMeshPayload {
  const size = buffer.length;
  const limited = limit > 0 && buffer.length > limit ? buffer.subarray(0, limit) : buffer;
  const truncated = limited.length !== buffer.length;
  const lower = contentType.toLowerCase();

  if (lower.includes('json')) {
    const text = limited.toString('utf8');
    try {
      return { value: JSON.stringify(JSON.parse(text), null, 2), encoding: 'json', truncated, size };
    } catch {
      return { value: text, encoding: 'text', truncated, size };
    }
  }

  if (lower.startsWith('text/') || isProbablyUtf8(limited)) {
    return { value: limited.toString('utf8'), encoding: 'text', truncated, size };
  }
  return { value: limited.toString('base64'), encoding: 'base64', truncated, size };
}

export function toSerializableEventMeshHeaders(headers: Record<string, unknown>): unknown {
  try {
    const json = JSON.stringify(headers);
    if (json.length > 8000) {
      return { note: 'headers omitted (too large)' };
    }
    return JSON.parse(json);
  } catch {
    return {};
  }
}
