import type { EventMeshBinding } from './eventMeshBindings';

export type PublishDestinationKind = 'topic' | 'queue';

export interface ParsedPublishEventRequest {
  readonly binding: EventMeshBinding;
  readonly destinationKind: PublishDestinationKind;
  readonly destination: string;
  readonly payload: string;
  readonly contentType: string;
}

function readTrimmedString(message: Record<string, unknown>, key: string): string {
  const value = message[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parsePublishDestinationKind(message: Record<string, unknown>): PublishDestinationKind {
  if (message['destinationKind'] === 'queue') {
    return 'queue';
  }
  if (message['destinationKind'] === undefined && readTrimmedString(message, 'queueName').length > 0) {
    return 'queue';
  }
  return 'topic';
}

export function parsePublishEventRequest(
  bindings: readonly EventMeshBinding[],
  message: Record<string, unknown>
): ParsedPublishEventRequest | null {
  const idx = typeof message['bindingIndex'] === 'number' ? message['bindingIndex'] : -1;
  const binding = bindings.find((candidate) => candidate.index === idx);
  if (binding === undefined) return null;

  const destinationKind = parsePublishDestinationKind(message);
  const destinationKey = destinationKind === 'queue' ? 'queueName' : 'topic';
  const explicitDestination = readTrimmedString(message, 'destination');
  const destination = explicitDestination.length > 0
    ? explicitDestination
    : readTrimmedString(message, destinationKey);
  if (destination.length === 0) return null;

  const payload = typeof message['payload'] === 'string' ? message['payload'] : '';
  const contentType =
    typeof message['contentType'] === 'string' ? message['contentType'] : 'application/json';
  return { binding, destinationKind, destination, payload, contentType };
}
