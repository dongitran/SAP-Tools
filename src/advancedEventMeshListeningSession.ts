import type { AdvancedEventMeshBinding } from './advancedEventMeshBindings';
import type { AdvancedEventMeshNormalizedMessage } from './advancedEventMeshSolaceListener';

export interface AdvancedEventMeshListenerLike {
  start(): Promise<void>;
  stop(): void;
}

export interface AdvancedEventMeshManagementClientLike {
  createQueue(queueName: string): Promise<void>;
  addSubscription(queueName: string, topic: string): Promise<void>;
  deleteQueue(queueName: string): Promise<void>;
}

export interface AdvancedEventMeshListenRequest {
  readonly binding: AdvancedEventMeshBinding;
  readonly topics: readonly string[];
}

export interface AdvancedEventMeshListenSummary {
  readonly bindingIndex: number;
  readonly bindingName: string;
  readonly vpn: string;
  readonly queueName: string;
  readonly topics: readonly string[];
}

export interface AdvancedEventMeshListenCallbacks {
  readonly onMessage: (
    binding: AdvancedEventMeshBinding,
    queueName: string,
    message: AdvancedEventMeshNormalizedMessage
  ) => void;
  readonly onStatus: (bindingIndex: number, message: string) => void;
  readonly onConnected: (binding: AdvancedEventMeshBinding, description: string) => void;
}

export interface AdvancedEventMeshListenerCallbacks {
  readonly onMessage: (message: AdvancedEventMeshNormalizedMessage) => void;
  readonly onError: (message: string) => void;
  readonly onConnected: (description: string) => void;
}

export interface AdvancedEventMeshListeningSessionOptions {
  readonly buildQueueName: (binding: AdvancedEventMeshBinding) => string;
  readonly getClient: (binding: AdvancedEventMeshBinding) => AdvancedEventMeshManagementClientLike;
  readonly createListener: (
    binding: AdvancedEventMeshBinding,
    queueName: string,
    callbacks: AdvancedEventMeshListenerCallbacks
  ) => AdvancedEventMeshListenerLike;
  readonly onCleanupError?: (message: string) => void;
}

interface ActiveAdvancedEventMeshListen {
  readonly binding: AdvancedEventMeshBinding;
  readonly client: AdvancedEventMeshManagementClientLike;
  readonly listener: AdvancedEventMeshListenerLike;
  readonly queueName: string;
  readonly topics: string[];
}

interface PendingAdvancedEventMeshListen {
  readonly binding: AdvancedEventMeshBinding;
  readonly client: AdvancedEventMeshManagementClientLike;
  readonly queueName: string;
  listener: AdvancedEventMeshListenerLike | null;
  queueCreated: boolean;
  stopRequested: boolean;
}

class AdvancedEventMeshStartupStoppedError extends Error {
  constructor(queueName: string) {
    super(`Advanced Event Mesh listener startup was stopped before queue ${queueName} became active.`);
    this.name = 'AdvancedEventMeshStartupStoppedError';
  }
}

export function isAdvancedEventMeshStartupStoppedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AdvancedEventMeshStartupStoppedError';
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
    const trimmed = topic.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }
  return [...unique];
}

function summarizeActive(active: ActiveAdvancedEventMeshListen): AdvancedEventMeshListenSummary {
  return {
    bindingIndex: active.binding.index,
    bindingName: active.binding.name,
    vpn: active.binding.vpn,
    queueName: active.queueName,
    topics: [...active.topics],
  };
}

export class AdvancedEventMeshListeningSession {
  private active: ActiveAdvancedEventMeshListen | null = null;
  private pending: PendingAdvancedEventMeshListen | null = null;

  constructor(private readonly options: AdvancedEventMeshListeningSessionOptions) {}

  hasActiveListener(): boolean {
    return this.active !== null;
  }

  activeSummary(): AdvancedEventMeshListenSummary | null {
    return this.active === null ? null : summarizeActive(this.active);
  }

  async startBinding(
    request: AdvancedEventMeshListenRequest,
    callbacks: AdvancedEventMeshListenCallbacks
  ): Promise<AdvancedEventMeshListenSummary> {
    this.assertCanStart(request);
    const pending = this.createPendingListen(request);
    this.pending = pending;
    try {
      await pending.client.createQueue(pending.queueName);
      pending.queueCreated = true;
      this.throwIfStartupStopped(pending);
      const topics = uniqueTopics(request.topics);
      await this.addSubscriptions(pending.client, pending.queueName, topics);
      this.throwIfStartupStopped(pending);
      pending.listener = this.createListener(pending, callbacks);
      await pending.listener.start();
      this.throwIfStartupStopped(pending);
      return this.promotePending(pending, topics);
    } catch (error) {
      pending.listener?.stop();
      await this.cleanupPendingQueue(pending);
      if (this.pending === pending) {
        this.pending = null;
      }
      throw error;
    }
  }

  async addTopics(bindingIndex: number, topics: readonly string[]): Promise<string[]> {
    const active = this.active;
    if (active?.binding.index !== bindingIndex) {
      throw new Error('Selected Advanced Event Mesh binding is not listening.');
    }
    const additions = uniqueTopics(topics).filter((topic) => !active.topics.includes(topic));
    for (const topic of additions) {
      await active.client.addSubscription(active.queueName, topic);
      active.topics.push(topic);
    }
    return additions;
  }

  async stopAll(): Promise<void> {
    await this.stopPending();
    const active = this.active;
    if (active === null) {
      return;
    }
    this.active = null;
    active.listener.stop();
    await this.deleteQueueSafely(active.client, active.queueName);
  }

  private assertCanStart(request: AdvancedEventMeshListenRequest): void {
    if (this.active !== null || this.pending !== null) {
      throw new Error('Selected Advanced Event Mesh binding is already listening.');
    }
    if (uniqueTopics(request.topics).length === 0) {
      throw new Error('Select at least one Advanced Event Mesh topic to listen to.');
    }
  }

  private createPendingListen(request: AdvancedEventMeshListenRequest): PendingAdvancedEventMeshListen {
    return {
      binding: request.binding,
      client: this.options.getClient(request.binding),
      queueName: this.options.buildQueueName(request.binding),
      listener: null,
      queueCreated: false,
      stopRequested: false,
    };
  }

  private throwIfStartupStopped(pending: PendingAdvancedEventMeshListen): void {
    if (pending.stopRequested) {
      throw new AdvancedEventMeshStartupStoppedError(pending.queueName);
    }
  }

  private createListener(
    pending: PendingAdvancedEventMeshListen,
    callbacks: AdvancedEventMeshListenCallbacks
  ): AdvancedEventMeshListenerLike {
    return this.options.createListener(
      pending.binding,
      pending.queueName,
      this.createCallbacks(pending.binding, pending.queueName, callbacks)
    );
  }

  private createCallbacks(
    binding: AdvancedEventMeshBinding,
    queueName: string,
    callbacks: AdvancedEventMeshListenCallbacks
  ): AdvancedEventMeshListenerCallbacks {
    return {
      onMessage: (message): void => { callbacks.onMessage(binding, queueName, message); },
      onError: (message): void => { callbacks.onStatus(binding.index, message); },
      onConnected: (description): void => { callbacks.onConnected(binding, description); },
    };
  }

  private async addSubscriptions(
    client: AdvancedEventMeshManagementClientLike,
    queueName: string,
    topics: readonly string[]
  ): Promise<void> {
    for (const topic of topics) {
      await client.addSubscription(queueName, topic);
    }
  }

  private promotePending(
    pending: PendingAdvancedEventMeshListen,
    topics: readonly string[]
  ): AdvancedEventMeshListenSummary {
    const listener = pending.listener;
    if (listener === null) {
      throw new Error('Advanced Event Mesh listener was not created.');
    }
    const active = { binding: pending.binding, client: pending.client, listener, queueName: pending.queueName, topics: [...topics] };
    this.pending = null;
    this.active = active;
    return summarizeActive(active);
  }

  private async stopPending(): Promise<void> {
    const pending = this.pending;
    if (pending === null) {
      return;
    }
    pending.stopRequested = true;
    pending.listener?.stop();
    await this.cleanupPendingQueue(pending);
  }

  private async cleanupPendingQueue(pending: PendingAdvancedEventMeshListen): Promise<void> {
    if (!pending.queueCreated) {
      return;
    }
    pending.queueCreated = false;
    await this.deleteQueueSafely(pending.client, pending.queueName);
  }

  private async deleteQueueSafely(
    client: AdvancedEventMeshManagementClientLike,
    queueName: string
  ): Promise<void> {
    try {
      await client.deleteQueue(queueName);
    } catch (error) {
      this.options.onCleanupError?.(
        `Failed to delete Advanced Event Mesh debug queue ${queueName}: ${describeError(error)}`
      );
    }
  }
}
