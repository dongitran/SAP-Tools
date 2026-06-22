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

export interface EventMeshStartProgress {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly bindingIndex: number;
  readonly bindingName: string;
}

export interface EventMeshStartManyOptions {
  readonly concurrency?: number;
  readonly onProgress?: (progress: EventMeshStartProgress) => void | Promise<void>;
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
  readonly onQueueCreated?: (binding: EventMeshBinding, queueName: string) => Promise<void>;
  readonly onQueueDeleted?: (binding: EventMeshBinding, queueName: string) => Promise<void>;
  readonly onCleanupError?: (message: string) => void;
}

interface ActiveEventMeshListen {
  readonly binding: EventMeshBinding;
  readonly client: EventMeshManagementClientLike;
  readonly listener: EventMeshListenerLike;
  readonly queueName: string;
  readonly topics: string[];
}

interface PendingEventMeshListen {
  readonly binding: EventMeshBinding;
  readonly client: EventMeshManagementClientLike;
  readonly queueName: string;
  listener: EventMeshListenerLike | null;
  queueCreated: boolean;
  stopRequested: boolean;
}

class EventMeshStartupStoppedError extends Error {
  constructor(queueName: string) {
    super(`Event Mesh listener startup was stopped before queue ${queueName} became active.`);
    this.name = 'EventMeshStartupStoppedError';
  }
}

export function isEventMeshStartupStoppedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'EventMeshStartupStoppedError';
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

function startConcurrencyLimit(requestCount: number, requested?: number): number {
  if (requestCount <= 0) {
    return 0;
  }
  if (requested === undefined || !Number.isFinite(requested)) {
    return Math.min(requestCount, 6);
  }
  return Math.min(requestCount, Math.max(1, Math.floor(requested)));
}

export class EventMeshListeningSession {
  private readonly activeByBinding = new Map<number, ActiveEventMeshListen>();
  private readonly pendingByBinding = new Map<number, PendingEventMeshListen>();

  constructor(private readonly options: EventMeshListeningSessionOptions) {}

  hasActiveListeners(): boolean {
    return this.activeByBinding.size > 0;
  }

  activeSummaries(): EventMeshBindingSummary[] {
    return [...this.activeByBinding.values()].map(summarizeActive);
  }

  async startMany(
    requests: readonly EventMeshListenRequest[],
    callbacks: EventMeshListenCallbacks,
    options: EventMeshStartManyOptions = {}
  ): Promise<EventMeshBindingSummary[]> {
    const summaries = new Array<EventMeshBindingSummary | undefined>(requests.length);
    const startedIndexes: number[] = [];
    let nextIndex = 0;
    let completed = 0;
    let firstError: unknown;

    const worker = async (): Promise<void> => {
      while (firstError === undefined) {
        const requestIndex = nextIndex;
        nextIndex += 1;
        const request = requests[requestIndex];
        if (request === undefined) return;
        const summary = await this.startBinding(request, callbacks);
        summaries[requestIndex] = summary;
        startedIndexes.push(request.binding.index);
        completed += 1;
        await this.postStartProgress(options, summary, completed, requests.length);
      }
    };

    try {
      const workerCount = startConcurrencyLimit(requests.length, options.concurrency);
      await Promise.all(Array.from({ length: workerCount }, () => worker()).map(async (task) => {
        try {
          await task;
        } catch (error) {
          firstError ??= error;
        }
      }));
      if (firstError !== undefined) {
        throw firstError instanceof Error
          ? firstError
          : new Error('Event Mesh listener startup failed.');
      }
      return summaries.filter((summary): summary is EventMeshBindingSummary => summary !== undefined);
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
    const pending: PendingEventMeshListen = {
      binding,
      client,
      queueName,
      listener: null,
      queueCreated: false,
      stopRequested: false,
    };
    this.pendingByBinding.set(binding.index, pending);

    try {
      await this.options.beforeCreateQueue?.(binding, client);
      this.throwIfStartupStopped(pending);
      await client.createQueue(queueName);
      pending.queueCreated = true;
      await this.options.onQueueCreated?.(binding, queueName);
      this.throwIfStartupStopped(pending);
      await this.addSubscriptions(client, queueName, topics);
      this.throwIfStartupStopped(pending);
      pending.listener = this.options.createListener(binding, queueName, this.createCallbacks(binding, queueName, callbacks));
      await pending.listener.start();
      this.throwIfStartupStopped(pending);
      const listener = pending.listener;
      const active = { binding, client, listener, queueName, topics };
      this.pendingByBinding.delete(binding.index);
      this.activeByBinding.set(binding.index, active);
      return summarizeActive(active);
    } catch (error) {
      pending.listener?.stop();
      await this.cleanupPendingQueue(pending);
      this.pendingByBinding.delete(binding.index);
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
    await this.stopPendingBindings();
    const indexes = [...this.activeByBinding.keys()];
    for (const index of indexes) {
      await this.stopBindingByIndex(index);
    }
  }

  private async postStartProgress(
    options: EventMeshStartManyOptions,
    summary: EventMeshBindingSummary,
    completed: number,
    total: number
  ): Promise<void> {
    try {
      await options.onProgress?.({
        completed,
        total,
        percent: total === 0 ? 100 : Math.round((completed / total) * 100),
        bindingIndex: summary.bindingIndex,
        bindingName: summary.bindingName,
      });
    } catch (error) {
      this.options.onCleanupError?.(`Event Mesh start progress callback failed: ${describeError(error)}`);
    }
  }

  private assertCanStart(request: EventMeshListenRequest): void {
    if (
      this.activeByBinding.has(request.binding.index) ||
      this.pendingByBinding.has(request.binding.index)
    ) {
      throw new Error('Selected messaging binding is already listening.');
    }
    if (uniqueTopics(request.topics).length === 0) {
      throw new Error('Select at least one topic to listen to.');
    }
  }

  private throwIfStartupStopped(pending: PendingEventMeshListen): void {
    if (pending.stopRequested) {
      throw new EventMeshStartupStoppedError(pending.queueName);
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
    await this.deleteQueueSafely(active.binding, active.client, active.queueName);
  }

  private async stopPendingBindings(): Promise<void> {
    const pendingList = [...this.pendingByBinding.values()];
    for (const pending of pendingList) {
      pending.stopRequested = true;
      pending.listener?.stop();
      await this.cleanupPendingQueue(pending);
    }
  }

  private async cleanupPendingQueue(pending: PendingEventMeshListen): Promise<void> {
    if (!pending.queueCreated) {
      return;
    }
    pending.queueCreated = false;
    await this.deleteQueueSafely(pending.binding, pending.client, pending.queueName);
  }

  private async deleteQueueSafely(
    binding: EventMeshBinding,
    client: EventMeshManagementClientLike,
    queueName: string
  ): Promise<void> {
    try {
      await client.deleteQueue(queueName);
      await this.options.onQueueDeleted?.(binding, queueName);
    } catch (error) {
      this.options.onCleanupError?.(
        `Failed to delete debug queue ${queueName}: ${describeError(error)}`
      );
    }
  }
}
