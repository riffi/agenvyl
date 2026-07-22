import type {
  ConnectorExecutionEvent,
  ConnectorRequestSnapshot,
  ConnectorRequestAnswer,
  ExecutionSnapshot,
  ExecutionStatus,
  StartExecutionRequest,
  UpstreamStatus,
  TokenUsage,
} from '@agenvyl/connector-contract';
import {createHash} from 'node:crypto';
import { CONNECTOR_API_VERSION } from '@agenvyl/connector-contract';
import type { AdapterExecution, AdapterExecutionEvent, ConnectorAdapter } from './adapter.js';
import { safeAdapterError, sanitizeAdapterEvent } from './safety.js';
import { WorkspacePolicy } from './workspace-policy.js';

const terminalStatuses = new Set<ExecutionStatus>(['completed', 'failed', 'cancelled']);
const upstreamConfirmationEvents = new Set<AdapterExecutionEvent['type']>([
  'output.text.delta',
  'output.reasoning.delta',
  'tool.started',
  'tool.updated',
  'tool.completed',
  'request.opened',
  'usage.updated',
]);
const textDeltaBatchCharacters = 256;
const textDeltaBatchDelayMs = 200;

export class RegistryError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

type ExecutionRecord = {
  request: StartExecutionRequest;
  requestKey: string;
  workspacePath: string;
  adapter: ConnectorAdapter;
  upstream?: AdapterExecution;
  startPromise: Promise<void>;
  status: ExecutionStatus;
  cursor: number;
  events: ConnectorExecutionEvent[];
  pendingRequests: Map<string, ConnectorRequestSnapshot>;
  requestResolutions: Map<string, { answerKey: string; promise: Promise<ConnectorRequestSnapshot> }>;
  error?: { code: string; message: string };
  upstreamStatus?: UpstreamStatus;
  usage?: TokenUsage;
  listeners: Set<(event: ConnectorExecutionEvent | null) => void>;
};

export class ExecutionRegistry {
  private readonly executions = new Map<string, ExecutionRecord>();

  constructor(
    private readonly connectorEpoch: string,
    private readonly instanceTypes: ReadonlyMap<string, string>,
    private readonly adapters: ReadonlyMap<string, ConnectorAdapter>,
    private readonly workspacePolicy: WorkspacePolicy,
    private readonly replayLimit = 1_000,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    if (!Number.isSafeInteger(replayLimit) || replayLimit < 1) throw new Error('replayLimit must be a positive integer');
  }

  start(request: StartExecutionRequest): { execution: ExecutionSnapshot; created: boolean } {
    const existing = this.executions.get(request.executionId);
    const requestKey = stableRequestKey(request);
    if (existing) {
      if (existing.requestKey !== requestKey) throw new RegistryError('execution_conflict', 'Execution ID is already used with different input', 409);
      return { execution: this.snapshot(existing), created: false };
    }

    const harnessType = this.instanceTypes.get(request.harnessInstanceId);
    if (!harnessType) throw new RegistryError('instance_not_found', 'Connector instance not found', 404);
    const adapter = this.adapters.get(request.harnessInstanceId);
    if (!adapter) throw new RegistryError('instance_unavailable', 'Connector instance adapter is not loaded', 503);
    if (adapter.type !== harnessType) throw new RegistryError('adapter_type_mismatch', 'Connector adapter type does not match instance configuration', 500);
    const workspacePath = this.workspacePolicy.resolve(request.workspace.roomId, request.workspace.relativePath);

    const record: ExecutionRecord = {
      request: structuredClone(request),
      requestKey,
      workspacePath,
      adapter,
      status: 'queued',
      cursor: 0,
      events: [],
      pendingRequests: new Map(),
      requestResolutions: new Map(),
      listeners: new Set(),
      startPromise: Promise.resolve(),
    };
    this.executions.set(request.executionId, record);
    this.append(record, 'execution.accepted', {});
    record.startPromise = this.startAdapter(record);
    return { execution: this.snapshot(record), created: true };
  }

  inspect(executionId: string): ExecutionSnapshot {
    return this.snapshot(this.require(executionId));
  }

  async stop(executionId: string): Promise<ExecutionSnapshot> {
    const record = this.require(executionId);
    if (terminalStatuses.has(record.status)) return this.snapshot(record);
    if (record.status !== 'stopping') {
      record.status = 'stopping';
      this.append(record, 'execution.status', { status: 'stopping' });
    }
    await record.startPromise;
    if (terminalStatuses.has(record.status)) return this.snapshot(record);
    if (!record.upstream) return this.fail(record, 'adapter_start_failed', 'Adapter did not create an execution');
    try {
      await record.adapter.stop(record.upstream);
      this.appendTerminal(record, 'execution.cancelled', {});
    } catch (error) {
      this.appendTerminal(record, 'execution.failed', { error: safeAdapterError(error, 'adapter_stop_failed') });
    }
    return this.snapshot(record);
  }

  async resolveRequest(executionId: string, requestId: string, answer: ConnectorRequestAnswer): Promise<{ execution: ExecutionSnapshot; request: ConnectorRequestSnapshot }> {
    const record = this.require(executionId);
    const normalized = normalizeRequestAnswer(answer);
    const answerKey = stableAnswerKey(normalized);
    const existing = record.requestResolutions.get(requestId);
    if (existing) {
      if (existing.answerKey !== answerKey) throw new RegistryError('request_resolution_conflict', 'Request was already resolved differently', 409);
      const request = await existing.promise;
      return { execution: this.snapshot(record), request: structuredClone(request) };
    }
    if (terminalStatuses.has(record.status)) throw new RegistryError('execution_terminal', 'Terminal execution requests cannot be resolved', 409);
    const request = record.pendingRequests.get(requestId);
    if (!request) throw new RegistryError('request_not_found', 'Pending Connector request not found', 404);
    if (request.kind === 'approval' && (!('resolution' in normalized) || (request.choices?.length && !request.choices.includes(normalized.resolution)))) throw new RegistryError('invalid_resolution', 'Resolution is not one of the offered choices', 400);
    if (request.questions?.length) {
      if (!('answers' in normalized)) throw new RegistryError('invalid_resolution', 'Structured clarification requires an answer map', 400);
      const expected=request.questions.map(question=>question.id).sort(),received=Object.keys(normalized.answers).sort();
      if(JSON.stringify(expected)!==JSON.stringify(received))throw new RegistryError('invalid_resolution','Structured clarification must answer every offered question exactly once',400);
    }
    if (!record.upstream) throw new RegistryError('adapter_unavailable', 'Adapter execution is not available', 503);
    if (!record.adapter.resolveRequest) throw new RegistryError('request_resolution_unavailable', 'Adapter cannot resolve this request kind', 501);

    const promise = this.resolveAdapterRequest(record, record.upstream, request, normalized);
    record.requestResolutions.set(requestId, { answerKey, promise });
    try {
      const resolvedRequest = await promise;
      return { execution: this.snapshot(record), request: structuredClone(resolvedRequest) };
    } catch (error) {
      if (record.requestResolutions.get(requestId)?.promise === promise) record.requestResolutions.delete(requestId);
      if (error instanceof RegistryError) throw error;
      throw new RegistryError('adapter_request_failed', 'Adapter failed to resolve the pending request', 502);
    }
  }

  subscribe(executionId: string, after: number, signal?: AbortSignal): AsyncIterable<ConnectorExecutionEvent> {
    const record = this.require(executionId);
    if (!Number.isSafeInteger(after) || after < 0) throw new RegistryError('invalid_cursor', 'Event cursor must be a non-negative integer', 400);
    if (after > record.cursor) throw new RegistryError('invalid_cursor', 'Event cursor is ahead of the execution', 400);
    const earliest = this.earliestReplayableCursor(record);
    if (after < earliest - 1) throw new RegistryError('replay_unavailable', 'Requested events are no longer replayable', 409);

    const replay = record.events.filter(event => event.cursor > after);
    return eventStream(record, replay, signal);
  }

  private async startAdapter(record: ExecutionRecord) {
    try {
      record.upstream = await record.adapter.start({
        ...record.request,
        workspace: { ...record.request.workspace, absolutePath: record.workspacePath },
      });
      if (record.status === 'stopping') return;
      record.status = 'running';
      this.append(record, 'execution.started', {});
      record.upstreamStatus = { state: 'waiting_upstream', reason: 'awaiting_response', retryable: true };
      this.append(record, 'execution.upstream_status', record.upstreamStatus);
      void this.consumeAdapterEvents(record);
    } catch (error) {
      if (!terminalStatuses.has(record.status)) this.appendTerminal(record, 'execution.failed', { error: safeAdapterError(error, 'adapter_execution_failed') });
    }
  }

  private async consumeAdapterEvents(record: ExecutionRecord) {
    if (!record.upstream) return;
    try {
      for await (const event of coalesceTextDeltas(record.adapter.events(record.upstream))) {
        if (terminalStatuses.has(record.status)) break;
        this.applyAdapterEvent(record, event);
      }
      if (!isStoppingOrTerminal(record.status)) {
        this.appendTerminal(record, 'execution.failed', { error: { code: 'adapter_stream_ended', message: 'Adapter event stream ended without a terminal event' } });
      }
    } catch (error) {
      if (!terminalStatuses.has(record.status)) this.appendTerminal(record, 'execution.failed', { error: safeAdapterError(error, 'adapter_execution_failed') });
    }
  }

  private async resolveAdapterRequest(record: ExecutionRecord, upstream: AdapterExecution, request: ConnectorRequestSnapshot, answer: ConnectorRequestAnswer) {
    const result = await record.adapter.resolveRequest!(upstream, structuredClone(request), 'resolution' in answer?answer.resolution:structuredClone(answer));
    const resolvedRequest: ConnectorRequestSnapshot = { ...structuredClone(request), resolution: { outcome: result.outcome, ...('resolution' in answer ? { value: answer.resolution } : {}) } };
    if (terminalStatuses.has(record.status) || !record.pendingRequests.has(request.id)) return resolvedRequest;
    record.pendingRequests.delete(request.id);
    this.append(record, 'request.resolved', { requestId: request.id, outcome: result.outcome });
    if (!record.pendingRequests.size) {
      record.status = 'running';
      this.append(record, 'execution.status', { status: 'running' });
    }
    return resolvedRequest;
  }

  private applyAdapterEvent(record: ExecutionRecord, event: AdapterExecutionEvent) {
    if (upstreamConfirmationEvents.has(event.type)) this.recoverUpstream(record);
    switch (event.type) {
      case 'execution.upstream_status':
        // Adapters report degradation; only a concrete successful signal lets
        // Connector core decide that the upstream has recovered.
        if (event.payload.state === 'recovered') return;
        record.upstreamStatus = structuredClone(event.payload);
        this.append(record, event.type, event.payload);
        return;
      case 'request.opened':
        if (record.pendingRequests.has(event.payload.request.id) || record.requestResolutions.has(event.payload.request.id)) return;
        record.pendingRequests.set(event.payload.request.id, structuredClone(event.payload.request));
        this.append(record, event.type, event.payload);
        if (record.status !== 'waiting_for_user') {
          record.status = 'waiting_for_user';
          this.append(record, 'execution.status', { status: 'waiting_for_user' });
        }
        return;
      case 'request.resolved':
        if (!record.pendingRequests.has(event.payload.requestId)) return;
        record.pendingRequests.delete(event.payload.requestId);
        this.append(record, event.type, event.payload);
        if (!record.pendingRequests.size) {
          record.status = 'running';
          this.append(record, 'execution.status', { status: 'running' });
        }
        return;
      case 'usage.updated':
        if(equalUsage(record.usage,event.payload.usage))return;
        record.usage=structuredClone(event.payload.usage);
        this.append(record,event.type,event.payload);
        return;
      case 'execution.completed':
      case 'execution.failed':
      case 'execution.cancelled':
        this.appendTerminal(record, event.type, event.payload);
        return;
      default:
        this.append(record, event.type, event.payload);
    }
  }

  private recoverUpstream(record: ExecutionRecord) {
    const status = record.upstreamStatus;
    if (!status) return;
    record.upstreamStatus = undefined;
    this.append(record, 'execution.upstream_status', {
      state: 'recovered',
      reason: status.reason,
      retryable: false,
      ...(status.attempt === undefined ? {} : { attempt: status.attempt }),
      ...(status.retryAt === undefined ? {} : { retryAt: status.retryAt }),
    });
  }

  private appendTerminal(record: ExecutionRecord, type: 'execution.completed' | 'execution.failed' | 'execution.cancelled', payload: Record<string, never> | { error: { code: string; message: string } }) {
    if (terminalStatuses.has(record.status)) return;
    const requestOutcome = type === 'execution.completed' ? 'superseded' : 'cancelled';
    for (const request of record.pendingRequests.values()) this.append(record, 'request.resolved', { requestId: request.id, outcome: requestOutcome });
    record.status = type === 'execution.completed' ? 'completed' : type === 'execution.cancelled' ? 'cancelled' : 'failed';
    record.pendingRequests.clear();
    record.upstreamStatus = undefined;
    if (type === 'execution.failed' && 'error' in payload) record.error = payload.error;
    this.append(record, type, payload);
    for (const listener of record.listeners) listener(null);
    record.listeners.clear();
  }

  private fail(record: ExecutionRecord, code: string, message: string) {
    this.appendTerminal(record, 'execution.failed', { error: { code, message } });
    return this.snapshot(record);
  }

  private append<T extends ConnectorExecutionEvent['type']>(record: ExecutionRecord, type: T, payload: Extract<ConnectorExecutionEvent, { type: T }>['payload']) {
    const event = {
      apiVersion: CONNECTOR_API_VERSION,
      connectorEpoch: this.connectorEpoch,
      executionId: record.request.executionId,
      cursor: ++record.cursor,
      occurredAt: this.now(),
      type,
      payload,
    } as ConnectorExecutionEvent;
    record.events.push(event);
    if (record.events.length > this.replayLimit) record.events.splice(0, record.events.length - this.replayLimit);
    for (const listener of record.listeners) listener(event);
  }

  private snapshot(record: ExecutionRecord): ExecutionSnapshot {
    return {
      apiVersion: CONNECTOR_API_VERSION,
      executionId: record.request.executionId,
      connectorEpoch: this.connectorEpoch,
      harnessInstanceId: record.request.harnessInstanceId,
      harnessType: this.instanceTypes.get(record.request.harnessInstanceId) ?? record.adapter.type,
      modelId: record.request.modelId,
      executionProfile: structuredClone(record.request.executionProfile),
      status: record.status,
      cursor: record.cursor,
      earliestReplayableCursor: this.earliestReplayableCursor(record),
      pendingRequests: [...record.pendingRequests.values()].map(request => structuredClone(request)),
      ...(record.usage ? { usage: structuredClone(record.usage) } : {}),
      ...(record.upstreamStatus ? { upstreamStatus: structuredClone(record.upstreamStatus) } : {}),
      ...(record.error ? { error: { ...record.error } } : {}),
    };
  }

  private earliestReplayableCursor(record: ExecutionRecord) {
    return record.events[0]?.cursor ?? record.cursor + 1;
  }

  private require(executionId: string) {
    const record = this.executions.get(executionId);
    if (!record) throw new RegistryError('execution_not_found', 'Connector execution not found', 404);
    return record;
  }
}

function equalUsage(left:TokenUsage|undefined,right:TokenUsage){return left!==undefined&&JSON.stringify(left)===JSON.stringify(right);}

async function* coalesceTextDeltas(source: AsyncIterable<AdapterExecutionEvent>): AsyncIterable<AdapterExecutionEvent> {
  const iterator = source[Symbol.asyncIterator]();
  let pendingNext: Promise<IteratorResult<AdapterExecutionEvent>> | undefined;
  let bufferedText = '';
  let bufferedType: 'output.text.delta' | 'output.reasoning.delta' | undefined;
  let flushAt = 0;

  const flush = () => {
    const event: AdapterExecutionEvent = { type: bufferedType!, payload: { text: bufferedText } };
    bufferedText = '';
    bufferedType = undefined;
    flushAt = 0;
    return event;
  };

  try {
    while (true) {
      pendingNext ??= iterator.next();
      const result = bufferedText
        ? await nextBefore(pendingNext, Math.max(0, flushAt - Date.now()))
        : await pendingNext;

      if (!result) {
        yield flush();
        continue;
      }

      pendingNext = undefined;
      if (result.done) {
        if (bufferedText) yield flush();
        return;
      }

      const event = sanitizeAdapterEvent(result.value);
      if (event.type === 'output.text.delta' || event.type === 'output.reasoning.delta') {
        if (!event.payload.text) continue;
        if (bufferedType && bufferedType !== event.type) yield flush();
        bufferedType = event.type;
        if (!bufferedText) flushAt = Date.now() + textDeltaBatchDelayMs;
        bufferedText += event.payload.text;
        if (bufferedText.length >= textDeltaBatchCharacters) yield flush();
        continue;
      }

      if (bufferedText) yield flush();
      yield event;
    }
  } catch (error) {
    if (bufferedText) yield flush();
    throw error;
  } finally {
    await iterator.return?.();
  }
}

function nextBefore<T>(pending: Promise<IteratorResult<T>>, timeoutMs: number): Promise<IteratorResult<T> | undefined> {
  if (timeoutMs <= 0) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(undefined), timeoutMs);
    pending.then(
      result => { clearTimeout(timeout); resolve(result); },
      error => { clearTimeout(timeout); reject(error); },
    );
  });
}

function isStoppingOrTerminal(status: ExecutionStatus) {
  return status === 'stopping' || terminalStatuses.has(status);
}

function stableRequestKey(request: StartExecutionRequest) {
  return JSON.stringify({
    executionId: request.executionId,
    harnessInstanceId: request.harnessInstanceId,
    modelId: request.modelId,
    executionProfile: request.executionProfile,
    workspace: { roomId: request.workspace.roomId, relativePath: request.workspace.relativePath },
    input: {
      systemPrompt: request.input.systemPrompt,
      history: request.input.history.map(item => ({ role: item.role, content: item.content })),
      message: request.input.message,
    },
  });
}

function normalizeRequestAnswer(answer: ConnectorRequestAnswer): ConnectorRequestAnswer {
  if ('resolution' in answer) {
    const resolution = answer.resolution.trim();
    if (!resolution) throw new RegistryError('invalid_resolution', 'Resolution must not be empty', 400);
    return { resolution };
  }
  const entries = Object.entries(answer.answers).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) throw new RegistryError('invalid_resolution', 'Answer map must not be empty', 400);
  return { answers: Object.fromEntries(entries.map(([id, values]) => [id, values.map(value => value.trim())])) };
}

function stableAnswerKey(answer: ConnectorRequestAnswer) {
  return createHash('sha256').update(JSON.stringify(answer)).digest('hex');
}

function eventStream(record: ExecutionRecord, replay: ConnectorExecutionEvent[], signal?: AbortSignal): AsyncIterable<ConnectorExecutionEvent> {
  const queue = [...replay];
  const waiters: Array<(result: IteratorResult<ConnectorExecutionEvent>) => void> = [];
  let ended = terminalStatuses.has(record.status) || Boolean(signal?.aborted);
  const listener = (event: ConnectorExecutionEvent | null) => {
    if (event) {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
      return;
    }
    ended = true;
    for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true });
  };
  const abort = () => listener(null);
  if (!ended) record.listeners.add(listener);
  signal?.addEventListener('abort', abort, { once: true });

  const cleanup = () => {
    ended = true;
    record.listeners.delete(listener);
    signal?.removeEventListener('abort', abort);
  };
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          const event = queue.shift();
          if (event) return { value: event, done: false };
          if (ended) {
            cleanup();
            return { value: undefined, done: true };
          }
          return new Promise(resolve => waiters.push(resolve));
        },
        return: async () => {
          cleanup();
          for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true });
          return { value: undefined, done: true };
        },
      };
    },
  };
}
