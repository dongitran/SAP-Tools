import type { EventMeshBinding } from './eventMeshBindings';
import type { NormalizedEventMessage } from './eventMeshAmqpListener';

export interface EventMeshListenerLike {
  start(): Promise<void>;
  stop(): void;
}

export interface EventMeshManagementClientLike {
  createQueue(queueName: string): Promise<void>;
  addSubscription(queueName: string, topic: string): Promise<void>;
  deleteQueue(queueName: string): Promise<void>;
}

export interface EventMeshListenRequest {
  readonly binding: EventMeshBinding;
  readonly topics: readonly string[];
}

export interface EventMeshBindingSummary {
  readonly bindingIndex: number;
  readonly bindingName: string;
  readonly bindingNamespace: string;
  readonly queueName: string;
  readonly topics: readonly string[];
}

export interface EventMeshListenCallbacks {
  readonly onMessage: (
    binding: EventMeshBinding,
    queueName: string,
    message: NormalizedEventMessage
  ) => void;
  readonly onStatus: (bindingIndex: number, message: string) => void;
  readonly onConnected: (binding: EventMeshBinding, description: string) => void;
}

export interface EventMeshListenerCallbacks {
  readonly onMessage: (message: NormalizedEventMessage) => void;
  readonly onError: (message: string) => void;
  readonly onConnected: (description: string) => void;
}

export interface EventMeshListeningSessionOptions {
  readonly debugQueueSegment: string;
  readonly buildRunId: (binding: EventMeshBinding) => string;
  readonly getClient: (binding: EventMeshBinding) => EventMeshManagementClientLike;
  readonly createListener: (
    binding: EventMeshBinding,
    queueName: string,
    callbacks: EventMeshListenerCallbacks
  ) => EventMeshListenerLike;
  readonly beforeCreateQueue?: (
    binding: EventMeshBinding,
    client: EventMeshManagementClientLike
  ) => Promise<void>;
  readonly onCleanupError?: (message: string) => void;
}

interface ActiveEventMeshListen {
  readonly binding: EventMeshBinding;
  readonly client: EventMeshManagementClientLike;
  readonly listener: EventMeshListenerLike;
  readonly queueName: string;
  readonly topics: string[];
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : String(error);
}

function uniqueTopics(topics: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const topic of topics) {
    if (topic.length > 0) {
      unique.add(topic);
    }
  }
  return [...unique];
}

function summarizeActive(active: ActiveEventMeshListen): EventMeshBindingSummary {
  return {
    bindingIndex: active.binding.index,
    bindingName: active.binding.name,
    bindingNamespace: active.binding.namespace,
    queueName: active.queueName,
    topics: [...active.topics],
  };
}

export class EventMeshListeningSession {
  private readonly activeByBinding = new Map<number, ActiveEventMeshListen>();

  constructor(private readonly options: EventMeshListeningSessionOptions) {}

  hasActiveListeners(): boolean {
    return this.activeByBinding.size > 0;
  }

  activeSummaries(): EventMeshBindingSummary[] {
    return [...this.activeByBinding.values()].map(summarizeActive);
  }

  async startMany(
    requests: readonly EventMeshListenRequest[],
    callbacks: EventMeshListenCallbacks
  ): Promise<EventMeshBindingSummary[]> {
    const startedIndexes: number[] = [];
    try {
      const summaries: EventMeshBindingSummary[] = [];
      for (const request of requests) {
        const summary = await this.startBinding(request, callbacks);
        summaries.push(summary);
        startedIndexes.push(request.binding.index);
      }
      return summaries;
    } catch (error) {
      await this.stopStartedBindings(startedIndexes);
      throw error;
    }
  }

  async startBinding(
    request: EventMeshListenRequest,
    callbacks: EventMeshListenCallbacks
  ): Promise<EventMeshBindingSummary> {
    this.assertCanStart(request);
    const binding = request.binding;
    const client = this.options.getClient(binding);
    const queueName = `${binding.namespace}/${this.options.debugQueueSegment}/${this.options.buildRunId(binding)}`;
    const topics = uniqueTopics(request.topics);
    let queueCreated = false;
    let listener: EventMeshListenerLike | null = null;

    try {
      await this.options.beforeCreateQueue?.(binding, client);
      await client.createQueue(queueName);
      queueCreated = true;
      await this.addSubscriptions(client, queueName, topics);
      listener = this.options.createListener(binding, queueName, this.createCallbacks(binding, queueName, callbacks));
      await listener.start();
      const active = { binding, client, listener, queueName, topics };
      this.activeByBinding.set(binding.index, active);
      return summarizeActive(active);
    } catch (error) {
      listener?.stop();
      if (queueCreated) {
        await this.deleteQueueSafely(client, queueName);
      }
      throw error;
    }
  }

  async addTopics(bindingIndex: number, topics: readonly string[]): Promise<string[]> {
    const active = this.activeByBinding.get(bindingIndex);
    if (active === undefined) {
      throw new Error('Selected messaging binding is not listening.');
    }
    const additions = uniqueTopics(topics).filter((topic) => !active.topics.includes(topic));
    for (const topic of additions) {
      await active.client.addSubscription(active.queueName, topic);
      active.topics.push(topic);
    }
    return additions;
  }

  async stopAll(): Promise<void> {
    const indexes = [...this.activeByBinding.keys()];
    for (const index of indexes) {
      await this.stopBindingByIndex(index);
    }
  }

  private assertCanStart(request: EventMeshListenRequest): void {
    if (this.activeByBinding.has(request.binding.index)) {
      throw new Error('Selected messaging binding is already listening.');
    }
    if (uniqueTopics(request.topics).length === 0) {
      throw new Error('Select at least one topic to listen to.');
    }
  }

  private createCallbacks(
    binding: EventMeshBinding,
    queueName: string,
    callbacks: EventMeshListenCallbacks
  ): EventMeshListenerCallbacks {
    return {
      onMessage: (message): void => { callbacks.onMessage(binding, queueName, message); },
      onError: (message): void => { callbacks.onStatus(binding.index, message); },
      onConnected: (description): void => { callbacks.onConnected(binding, description); },
    };
  }

  private async addSubscriptions(
    client: EventMeshManagementClientLike,
    queueName: string,
    topics: readonly string[]
  ): Promise<void> {
    for (const topic of topics) {
      await client.addSubscription(queueName, topic);
    }
  }

  private async stopStartedBindings(startedIndexes: readonly number[]): Promise<void> {
    for (const index of [...startedIndexes].reverse()) {
      await this.stopBindingByIndex(index);
    }
  }

  private async stopBindingByIndex(bindingIndex: number): Promise<void> {
    const active = this.activeByBinding.get(bindingIndex);
    if (active === undefined) {
      return;
    }
    this.activeByBinding.delete(bindingIndex);
    active.listener.stop();
    await this.deleteQueueSafely(active.client, active.queueName);
  }

  private async deleteQueueSafely(
    client: EventMeshManagementClientLike,
    queueName: string
  ): Promise<void> {
    try {
      await client.deleteQueue(queueName);
    } catch (error) {
      this.options.onCleanupError?.(
        `Failed to delete debug queue ${queueName}: ${describeError(error)}`
      );
    }
  }
}
