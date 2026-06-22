import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { AdvancedEventMeshBinding } from './advancedEventMeshBindings';
import {
  requestAdvancedEventMeshOAuthToken,
  type AdvancedEventMeshFetchFn,
} from './advancedEventMeshClient';

// cspell:ignore solclientjs Solclient

export interface AdvancedEventMeshNormalizedMessage {
  readonly body: Buffer;
  readonly contentType: string;
  readonly topic: string | null;
  readonly messageId: string | null;
  readonly headers: Record<string, unknown>;
}

export interface AdvancedEventMeshSolaceCallbacks {
  readonly onMessage: (message: AdvancedEventMeshNormalizedMessage) => void;
  readonly onError: (message: string) => void;
  readonly onConnected?: (description: string) => void;
}

type SolaceEventName = string | number | symbol;

interface SolaceEmitter {
  on(event: SolaceEventName, listener: (...args: unknown[]) => void): unknown;
}

interface SolaceSession extends SolaceEmitter {
  connect(): void;
  disconnect(): void;
  dispose?: () => void;
  createMessageConsumer(options: unknown): SolaceMessageConsumer;
}

interface SolaceMessageConsumer extends SolaceEmitter {
  connect(): void;
  disconnect?: () => void;
  dispose?: () => void;
}

export interface SolclientjsModule {
  readonly AuthenticationScheme: { readonly OAUTH2: unknown };
  readonly LogLevel: { readonly ERROR: unknown };
  readonly MessageConsumerAcknowledgeMode: { readonly AUTO: unknown };
  readonly MessageConsumerEventName: {
    readonly CONNECT_FAILED_ERROR: SolaceEventName;
    readonly DOWN: SolaceEventName;
    readonly DOWN_ERROR: SolaceEventName;
    readonly MESSAGE: SolaceEventName;
    readonly UP: SolaceEventName;
  };
  readonly QueueDescriptor: new (options: unknown) => unknown;
  readonly QueueType: { readonly QUEUE: unknown };
  readonly SessionEventCode: {
    readonly CONNECT_FAILED_ERROR: SolaceEventName;
    readonly DISCONNECTED: SolaceEventName;
    readonly DOWN_ERROR?: SolaceEventName;
    readonly UP_NOTICE: SolaceEventName;
  };
  readonly SessionProperties: new (options: unknown) => unknown;
  readonly SolclientFactory: {
    createSession(properties: unknown): SolaceSession;
    init(properties?: unknown): unknown;
  };
  readonly SolclientFactoryProfiles: { readonly version10: unknown };
  readonly SolclientFactoryProperties: new (options: unknown) => unknown;
}

export type SolclientjsModuleLoader = () => SolclientjsModule;

const DEFAULT_SOLACE_STARTUP_TIMEOUT_MS = 30000;

let cachedModule: SolclientjsModule | null = null;
let factoryInitialized = false;

export function loadSolclientjsModule(distDir: string = __dirname): SolclientjsModule {
  if (cachedModule !== null) {
    return cachedModule;
  }
  const runtimeRequire = createRequire(__filename);
  const vendoredEntry = join(distDir, 'vendor', 'solclientjs', 'lib', 'solclientjs-exports.js');
  const specifier = existsSync(vendoredEntry) ? vendoredEntry : 'solclientjs';
  cachedModule = runtimeRequire(specifier) as SolclientjsModule;
  return cachedModule;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error['message'] === 'string') {
    return error['message'];
  }
  return typeof error === 'string' ? error : String(error);
}

function callNoArg(target: unknown, methodName: string): unknown {
  if (!isRecord(target)) {
    return null;
  }
  const method = target[methodName];
  return typeof method === 'function' ? (method as () => unknown).call(target) : null;
}

function stringFromMethod(target: unknown, methodName: string): string | null {
  const value = callNoArg(target, methodName);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function bodyToBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  return Buffer.alloc(0);
}

function safeHeaderValue(target: unknown, methodName: string): unknown {
  try {
    return callNoArg(target, methodName);
  } catch {
    return null;
  }
}

function normalizeSolaceMessage(message: unknown): AdvancedEventMeshNormalizedMessage {
  const destination = safeHeaderValue(message, 'getDestination');
  return {
    body: bodyToBuffer(safeHeaderValue(message, 'getBinaryAttachment')),
    contentType: stringFromMethod(message, 'getHttpContentType') ?? 'application/octet-stream',
    topic: stringFromMethod(destination, 'getName'),
    messageId:
      stringFromMethod(message, 'getApplicationMessageId') ??
      stringFromMethod(message, 'getCorrelationId'),
    headers: {
      applicationMessageType: safeHeaderValue(message, 'getApplicationMessageType'),
      destinationName: stringFromMethod(destination, 'getName'),
      senderId: safeHeaderValue(message, 'getSenderId'),
    },
  };
}

function initializeFactory(solace: SolclientjsModule): void {
  if (factoryInitialized) {
    return;
  }
  solace.SolclientFactory.init(
    new solace.SolclientFactoryProperties({
      profile: solace.SolclientFactoryProfiles.version10,
      logLevel: solace.LogLevel.ERROR,
    })
  );
  factoryInitialized = true;
}

function buildSessionProperties(
  solace: SolclientjsModule,
  binding: AdvancedEventMeshBinding,
  accessToken: string
): unknown {
  return new solace.SessionProperties({
    url: binding.smfUri,
    vpnName: binding.vpn,
    userName: binding.authentication.clientid,
    authenticationScheme: solace.AuthenticationScheme.OAUTH2,
    accessToken,
    clientName: `sap-tools-aem-${String(process.pid)}-${String(binding.index)}`,
    connectRetries: 0,
    reconnectRetries: 0,
  });
}

function buildConsumerProperties(solace: SolclientjsModule, queueName: string): Record<string, unknown> {
  return {
    queueDescriptor: new solace.QueueDescriptor({
      name: queueName,
      type: solace.QueueType.QUEUE,
      durable: true,
    }),
    acknowledgeMode: solace.MessageConsumerAcknowledgeMode.AUTO,
    createIfMissing: false,
    connectAttempts: 1,
    reconnectAttempts: 0,
    windowSize: 20,
  };
}

export class AdvancedEventMeshSolaceListener {
  private session: SolaceSession | null = null;
  private consumer: SolaceMessageConsumer | null = null;
  private closed = false;
  private startupController: AbortController | null = null;
  private startupResolve: (() => void) | null = null;
  private startupReject: ((error: Error) => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly binding: AdvancedEventMeshBinding,
    private readonly queueName: string,
    private readonly callbacks: AdvancedEventMeshSolaceCallbacks,
    private readonly moduleLoader: SolclientjsModuleLoader = loadSolclientjsModule,
    private readonly fetchImpl: AdvancedEventMeshFetchFn = fetch,
    private readonly startupTimeoutMs: number = DEFAULT_SOLACE_STARTUP_TIMEOUT_MS
  ) {}

  start(): Promise<void> {
    if (this.startupReject !== null || this.session !== null) {
      return Promise.reject(new Error('Advanced Event Mesh Solace listener is already starting.'));
    }
    return new Promise<void>((resolve, reject) => {
      this.closed = false;
      this.startupController = new AbortController();
      this.startupResolve = resolve;
      this.startupReject = reject;
      this.scheduleStartupTimeout();
      void this.openTransport().catch((error: unknown) => {
        this.rejectStartup(error, reject);
      });
    });
  }

  stop(): void {
    this.closed = true;
    this.startupController?.abort();
    if (this.startupReject !== null) {
      this.settleStartup(
        new Error(`Advanced Event Mesh listener stopped before subscription became active for queue ${this.queueName}.`)
      );
    }
    this.closeTransport();
  }

  private async openTransport(): Promise<void> {
    const solace = this.moduleLoader();
    initializeFactory(solace);
    const { accessToken } = await requestAdvancedEventMeshOAuthToken(
      this.binding.authentication,
      this.fetchImpl,
      this.startupController?.signal
    );
    if (this.closed) {
      throw new Error(`Advanced Event Mesh listener stopped before connecting to queue ${this.queueName}.`);
    }
    const session = solace.SolclientFactory.createSession(
      buildSessionProperties(solace, this.binding, accessToken)
    );
    this.session = session;
    this.attachSessionHandlers(solace, session);
    session.connect();
  }

  private attachSessionHandlers(solace: SolclientjsModule, session: SolaceSession): void {
    session.on(solace.SessionEventCode.UP_NOTICE, () => { this.startConsumer(solace, session); });
    session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (error: unknown) => { this.rejectStartup(error); });
    const downError = solace.SessionEventCode.DOWN_ERROR;
    if (downError !== undefined) {
      session.on(downError, (error: unknown) => { this.rejectOrNotify(`session error: ${describeError(error)}`); });
    }
    session.on(solace.SessionEventCode.DISCONNECTED, () => {
      if (this.startupReject !== null) {
        this.settleStartup(new Error(`Advanced Event Mesh session disconnected before queue ${this.queueName} became active.`));
      }
    });
  }

  private startConsumer(solace: SolclientjsModule, session: SolaceSession): void {
    try {
      this.callbacks.onConnected?.(`Connected to ${this.binding.vpn}`);
      const consumer = session.createMessageConsumer(buildConsumerProperties(solace, this.queueName));
      this.consumer = consumer;
      this.attachConsumerHandlers(solace, consumer);
      consumer.connect();
    } catch (error) {
      this.rejectStartup(error);
    }
  }

  private attachConsumerHandlers(solace: SolclientjsModule, consumer: SolaceMessageConsumer): void {
    const names = solace.MessageConsumerEventName;
    consumer.on(names.UP, () => { this.settleStartup(); });
    consumer.on(names.CONNECT_FAILED_ERROR, (error: unknown) => { this.rejectStartup(error); });
    consumer.on(names.DOWN_ERROR, (error: unknown) => { this.rejectOrNotify(`consumer error: ${describeError(error)}`); });
    consumer.on(names.DOWN, () => {
      if (this.startupReject !== null) {
        this.settleStartup(new Error(`Advanced Event Mesh consumer disconnected before queue ${this.queueName} became active.`));
      }
    });
    consumer.on(names.MESSAGE, (message: unknown) => { this.handleMessage(message); });
  }

  private handleMessage(raw: unknown): void {
    try {
      this.callbacks.onMessage(normalizeSolaceMessage(raw));
    } catch (error) {
      this.callbacks.onError(`message handling failed: ${describeError(error)}`);
    }
  }

  private scheduleStartupTimeout(): void {
    if (this.startupTimeoutMs <= 0) {
      return;
    }
    this.startupTimer = setTimeout(() => {
      this.settleStartup(
        new Error(
          `Advanced Event Mesh Solace subscription timed out after ${String(this.startupTimeoutMs)} ms for queue ${this.queueName}.`
        )
      );
      this.closeTransport();
    }, this.startupTimeoutMs);
  }

  private rejectOrNotify(message: string): void {
    if (this.startupReject !== null) {
      this.settleStartup(new Error(message));
      return;
    }
    if (!this.closed) {
      this.callbacks.onError(message);
    }
  }

  private rejectStartup(error: unknown, fallbackReject?: (error: Error) => void): void {
    const normalized = error instanceof Error ? error : new Error(describeError(error));
    if (this.startupReject !== null) {
      this.settleStartup(normalized);
      return;
    }
    fallbackReject?.(normalized);
  }

  private settleStartup(error?: Error): void {
    const resolve = this.startupResolve;
    const reject = this.startupReject;
    if (resolve === null || reject === null) {
      return;
    }
    this.clearStartupTimer();
    this.startupResolve = null;
    this.startupReject = null;
    if (error === undefined) {
      resolve();
    } else {
      reject(error);
    }
  }

  private clearStartupTimer(): void {
    if (this.startupTimer === null) {
      return;
    }
    clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private closeTransport(): void {
    try {
      this.consumer?.disconnect?.();
    } catch {
      // Best-effort close before the debug queue is deleted by the session layer.
    }
    try {
      this.consumer?.dispose?.();
    } catch {
      // Best-effort dispose.
    }
    try {
      this.session?.disconnect();
    } catch {
      // Best-effort disconnect.
    }
    try {
      this.session?.dispose?.();
    } catch {
      // Best-effort dispose.
    }
    this.consumer = null;
    this.session = null;
  }
}
