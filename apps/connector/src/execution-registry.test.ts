import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectorContractFixtures, type StartExecutionRequest } from '@agenvyl/connector-contract';
import type { AdapterExecution, AdapterExecutionEvent, ConnectorAdapter } from './adapter.js';
import { ExecutionRegistry } from './execution-registry.js';
import { WorkspacePolicy } from './workspace-policy.js';

let workspaceRoot = '';
beforeAll(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'agenvyl-registry-'));
  await mkdir(join(workspaceRoot, 'room-1'));
});
afterAll(async () => { await rm(workspaceRoot, { recursive: true, force: true }); });

describe('ExecutionRegistry live subscriptions', () => {
  it('delivers events emitted after replay capture without a cursor gap', async () => {
    const adapter = new LiveAdapter();
    const registry = new ExecutionRegistry(
      'epoch-test',
      new Map([['local-hermes', 'hermes']]),
      new Map([['local-hermes', adapter]]),
      new WorkspacePolicy([workspaceRoot]),
    );
    const request = structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;
    registry.start(request);
    await waitFor(() => registry.inspect(request.executionId).upstreamStatus?.state === 'waiting_upstream');
    expect(registry.inspect(request.executionId).upstreamStatus).toEqual({state:'waiting_upstream',reason:'awaiting_response',retryable:true});

    const iterator = registry.subscribe(request.executionId, 3)[Symbol.asyncIterator]();
    const recovered = iterator.next();
    adapter.emit({ type: 'output.text.delta', payload: { text: 'live' } });
    expect(await recovered).toMatchObject({ done: false, value: { cursor: 4, type: 'execution.upstream_status', payload: {state:'recovered',reason:'awaiting_response'} } });
    expect(await iterator.next()).toMatchObject({ done: false, value: { cursor: 5, type: 'output.text.delta' } });

    const terminal = iterator.next();
    adapter.emit({ type: 'execution.completed', payload: {} });
    expect(await terminal).toMatchObject({ done: false, value: { cursor: 6, type: 'execution.completed' } });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('coalesces micro text deltas before assigning durable cursors', async () => {
    const adapter = new LiveAdapter();
    const registry = new ExecutionRegistry(
      'epoch-test',
      new Map([['local-hermes', 'hermes']]),
      new Map([['local-hermes', adapter]]),
      new WorkspacePolicy([workspaceRoot]),
    );
    const request = structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;
    registry.start(request);
    await waitFor(() => registry.inspect(request.executionId).status === 'running');

    for (let index = 0; index < 100; index += 1) adapter.emit({ type: 'output.text.delta', payload: { text: 'x' } });
    adapter.emit({ type: 'execution.completed', payload: {} });
    await waitFor(() => registry.inspect(request.executionId).status === 'completed');

    const events = await collect(registry.subscribe(request.executionId, 0));
    expect(events.map(event => [event.cursor, event.type])).toEqual([
      [1, 'execution.accepted'],
      [2, 'execution.started'],
      [3, 'execution.upstream_status'],
      [4, 'execution.upstream_status'],
      [5, 'output.text.delta'],
      [6, 'execution.completed'],
    ]);
    expect(events[4]).toMatchObject({ payload: { text: 'x'.repeat(100) } });
  });

  it('keeps reasoning and answer deltas in separate durable channels', async () => {
    const adapter = new LiveAdapter();
    const registry = new ExecutionRegistry(
      'epoch-test',
      new Map([['local-hermes', 'hermes']]),
      new Map([['local-hermes', adapter]]),
      new WorkspacePolicy([workspaceRoot]),
    );
    const request = structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;
    registry.start(request);
    await waitFor(() => registry.inspect(request.executionId).status === 'running');

    adapter.emit({ type: 'output.reasoning.delta', payload: { text: 'private ' } });
    adapter.emit({ type: 'output.reasoning.delta', payload: { text: 'analysis' } });
    adapter.emit({ type: 'output.text.delta', payload: { text: 'public answer' } });
    adapter.emit({ type: 'execution.completed', payload: {} });
    await waitFor(() => registry.inspect(request.executionId).status === 'completed');

    const events = await collect(registry.subscribe(request.executionId, 0));
    expect(events.map(event => event.type)).toEqual([
      'execution.accepted',
      'execution.started',
      'execution.upstream_status',
      'execution.upstream_status',
      'output.reasoning.delta',
      'output.text.delta',
      'execution.completed',
    ]);
    expect(events[4]).toMatchObject({payload:{text:'private analysis'}});
    expect(events[5]).toMatchObject({payload:{text:'public answer'}});
  });

  it('flushes buffered text before a non-text event', async () => {
    const adapter = new LiveAdapter();
    const registry = new ExecutionRegistry(
      'epoch-test',
      new Map([['local-hermes', 'hermes']]),
      new Map([['local-hermes', adapter]]),
      new WorkspacePolicy([workspaceRoot]),
    );
    const request = structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;
    registry.start(request);
    await waitFor(() => registry.inspect(request.executionId).status === 'running');

    adapter.emit({ type: 'output.text.delta', payload: { text: 'before tool' } });
    adapter.emit({ type: 'tool.started', payload: { toolId: 'tool-1', name: 'search', safeSummary: 'Searching' } });
    adapter.emit({ type: 'execution.completed', payload: {} });
    await waitFor(() => registry.inspect(request.executionId).status === 'completed');

    const events = await collect(registry.subscribe(request.executionId, 0));
    expect(events.map(event => event.type)).toEqual([
      'execution.accepted',
      'execution.started',
      'execution.upstream_status',
      'execution.upstream_status',
      'output.text.delta',
      'tool.started',
      'execution.completed',
    ]);
  });

  it('applies waiting and one-shot recovery to a generic Hermes output path',async()=>{
    const adapter=new LiveAdapter(),registry=new ExecutionRegistry('epoch-test',new Map([['local-hermes','hermes']]),new Map([['local-hermes',adapter]]),new WorkspacePolicy([workspaceRoot]));
    const request=structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;
    registry.start(request);
    await waitFor(()=>registry.inspect(request.executionId).upstreamStatus?.state==='waiting_upstream');
    adapter.emit({type:'output.text.delta',payload:{text:'first'}});
    adapter.emit({type:'tool.started',payload:{toolId:'tool-1',name:'search',safeSummary:'Searching'}});
    await waitFor(()=>registry.inspect(request.executionId).upstreamStatus===undefined);
    adapter.emit({type:'output.reasoning.delta',payload:{text:'later'}});
    adapter.emit({type:'execution.completed',payload:{}});
    await waitFor(()=>registry.inspect(request.executionId).status==='completed');
    const replay=await collect(registry.subscribe(request.executionId,0));
    expect(replay.filter(event=>event.type==='execution.upstream_status').map(event=>event.payload)).toEqual([
      {state:'waiting_upstream',reason:'awaiting_response',retryable:true},
      {state:'recovered',reason:'awaiting_response',retryable:false},
    ]);
    expect(replay.map(event=>event.type)).toEqual([
      'execution.accepted','execution.started','execution.upstream_status','execution.upstream_status',
      'output.text.delta','tool.started','output.reasoning.delta','execution.completed',
    ]);
  });

  it('stores generic upstream degradation in snapshots and replays recovery without changing lifecycle',async()=>{
    const adapter=new LiveAdapter(),registry=new ExecutionRegistry('epoch-test',new Map([['local-hermes','hermes']]),new Map([['local-hermes',adapter]]),new WorkspacePolicy([workspaceRoot]));
    const request=structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;registry.start(request);await waitFor(()=>registry.inspect(request.executionId).status==='running');
    adapter.emit({type:'execution.upstream_status',payload:{state:'retrying',reason:'provider_timeout',retryable:true,attempt:1,retryAt:'2026-07-20T12:00:00.000Z'}});
    await waitFor(()=>registry.inspect(request.executionId).upstreamStatus?.state==='retrying');
    expect(registry.inspect(request.executionId)).toMatchObject({status:'running',upstreamStatus:{state:'retrying',reason:'provider_timeout'}});
    adapter.emit({type:'output.text.delta',payload:{text:'resumed'}});adapter.emit({type:'execution.completed',payload:{}});
    await waitFor(()=>registry.inspect(request.executionId).status==='completed');
    expect(registry.inspect(request.executionId).upstreamStatus).toBeUndefined();
    const replay=await collect(registry.subscribe(request.executionId,0));
    expect(replay.map(event=>event.type)).toEqual(['execution.accepted','execution.started','execution.upstream_status','execution.upstream_status','execution.upstream_status','output.text.delta','execution.completed']);
    expect(replay.slice(2,6)).toMatchObject([
      {type:'execution.upstream_status',payload:{state:'waiting_upstream',reason:'awaiting_response'}},
      {type:'execution.upstream_status',payload:{state:'retrying',reason:'provider_timeout',attempt:1,retryAt:'2026-07-20T12:00:00.000Z'}},
      {type:'execution.upstream_status',payload:{state:'recovered',reason:'provider_timeout',retryable:false,attempt:1,retryAt:'2026-07-20T12:00:00.000Z'}},
      {type:'output.text.delta',payload:{text:'resumed'}},
    ]);
    expect(replay.filter(event=>['execution.completed','execution.failed','execution.cancelled'].includes(event.type))).toHaveLength(1);
  });

  it('persists buffered text before an adapter stream failure', async () => {
    const adapter: ConnectorAdapter = {
      type: 'hermes',
      capabilities: ['text_streaming'],
      async start() { return { upstreamId: 'upstream-failure' }; },
      async inspect() { return { status: 'running' }; },
      async stop() {},
      async *events() {
        yield { type: 'output.text.delta' as const, payload: { text: 'partial response' } };
        throw new Error('fixture stream failure');
      },
    };
    const registry = new ExecutionRegistry(
      'epoch-test',
      new Map([['local-hermes', 'hermes']]),
      new Map([['local-hermes', adapter]]),
      new WorkspacePolicy([workspaceRoot]),
    );
    const request = structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;
    registry.start(request);
    await waitFor(() => registry.inspect(request.executionId).status === 'failed');

    const events = await collect(registry.subscribe(request.executionId, 0));
    expect(events.map(event => event.type)).toEqual([
      'execution.accepted',
      'execution.started',
      'execution.upstream_status',
      'execution.upstream_status',
      'output.text.delta',
      'execution.failed',
    ]);
    expect(events[4]).toMatchObject({ payload: { text: 'partial response' } });
  });
});

class LiveAdapter implements ConnectorAdapter {
  readonly type = 'hermes';
  readonly capabilities = ['text_streaming'] satisfies ConnectorAdapter['capabilities'];
  private readonly queue: AdapterExecutionEvent[] = [];
  private waiter?: (result: IteratorResult<AdapterExecutionEvent>) => void;

  async start(): Promise<AdapterExecution> { return { upstreamId: 'upstream-1' }; }
  async inspect() { return { status: 'running' as const }; }
  async stop() {}

  events(): AsyncIterable<AdapterExecutionEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const event = this.queue.shift();
          if (event) return { value: event, done: false };
          return new Promise(resolve => { this.waiter = resolve; });
        },
      }),
    };
  }

  emit(event: AdapterExecutionEvent) {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached');
}

async function collect<T>(source: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
