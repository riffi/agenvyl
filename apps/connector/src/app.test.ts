import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectorContractFixtures,
  isConnectorExecutionEvent,
  isConnectorHealth,
  isConnectorInstanceList,
  isExecutionSnapshot,
  type StartExecutionRequest,
} from '@agenvyl/connector-contract';
import type { AdapterExecution, AdapterExecutionEvent, AdapterStartExecutionRequest, ConnectorAdapter } from './adapter.js';
import { buildConnectorApp } from './app.js';
import type { ConnectorConfig } from './config.js';

const token = 'connector-test-token-that-is-long-enough';
let workspaceRoot = '';
const config: ConnectorConfig = {
  version: 1,
  listen: { host: '127.0.0.1', port: 4310 },
  workspaces: { roots: [] },
  token,
  instances: [{ id: 'local-hermes', type: 'hermes', enabled: true }, { id: 'disabled', type: 'opencode', enabled: false }],
};
const auth = { authorization: `Bearer ${token}` };

beforeAll(async () => {
  workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'agenvyl-connector-app-')));
  await mkdir(join(workspaceRoot, 'room-1'));
  config.workspaces.roots = [workspaceRoot];
});
afterAll(async () => { await rm(workspaceRoot, { recursive: true, force: true }); });

describe('Connector shell', () => {
  it('protects every v1 endpoint with Bearer auth', async () => {
    const app = buildConnectorApp(config);
    const response = await app.inject('/v1/health');
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ apiVersion: 'v1', error: 'unauthorized', message: 'Valid Connector Bearer token required' });
    await app.close();
  });

  it('reports an ephemeral epoch and independently degraded configured instances', async () => {
    const app = buildConnectorApp(config, { connectorEpoch: 'epoch-test', startedAt: '2026-07-17T00:00:00.000Z' });
    const health = await app.inject({ url: '/v1/health', headers: auth });
    expect(health.statusCode).toBe(200);
    expect(isConnectorHealth(health.json())).toBe(true);
    expect(health.json()).toMatchObject({ connectorEpoch: 'epoch-test', status: 'degraded', instances: { total: 1, healthy: 0, degraded: 1 } });
    const instances = await app.inject({ url: '/v1/instances', headers: auth });
    expect(isConnectorInstanceList(instances.json())).toBe(true);
    expect(instances.json().instances).toEqual([{ id: 'local-hermes', type: 'hermes', status: 'unavailable', capabilities: [], error: { code: 'adapter_not_loaded', message: expect.any(String) } }]);
    await app.close();
  });

  it('reports managed OpenCode ownership even when its adapter is unavailable',async()=>{
    const app=buildConnectorApp({...config,instances:[{id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true}]});
    const response=await app.inject({url:'/v1/instances',headers:auth});
    expect(isConnectorInstanceList(response.json())).toBe(true);
    expect(response.json().instances[0]).toMatchObject({id:'local-opencode',status:'unavailable',managed:true});
    await app.close();
  });

  it('discovers and atomically applies bootstrap configuration behind bearer auth',async()=>{
    const adapter=new ControlledAdapter(),persisted:unknown[]=[];
    const app=buildConnectorApp({...config,instances:[]},{discover:async()=>({apiVersion:'v1',candidates:[]}),configureInstances:async instances=>new Map(instances.map(instance=>[instance.id,adapter])),persistInstances:async instances=>{persisted.push(structuredClone(instances));}});
    expect((await app.inject('/v1/discovery')).statusCode).toBe(401);
    expect((await app.inject({url:'/v1/discovery',headers:auth})).json()).toEqual({apiVersion:'v1',candidates:[]});
    const response=await app.inject({method:'PUT',url:'/v1/instances',headers:auth,payload:{instances:[{id:'local-hermes',type:'hermes',enabled:true,endpoint:'http://127.0.0.1:8642'}]}});
    expect(response.statusCode).toBe(200);expect(persisted).toHaveLength(1);
    expect((await app.inject({url:'/v1/instances',headers:auth})).json().instances[0]).toMatchObject({id:'local-hermes',status:'healthy'});
    await app.close();
  });

  it('fails closed until adapters implement catalog and execution lifecycle', async () => {
    const app = buildConnectorApp(config);
    expect((await app.inject({ url: '/v1/instances/missing/catalog', headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ url: '/v1/instances/local-hermes/catalog', headers: auth })).statusCode).toBe(503);
    const invalid = await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: {} });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'invalid_request' });
    const unavailable = await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: connectorContractFixtures.startExecution });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ error: 'instance_unavailable' });
    await app.close();
  });

  it('serves a versioned catalog from a capable adapter',async()=>{
    const adapter=new ControlledAdapter(),app=buildConnectorApp(config,{connectorEpoch:'epoch-test',adapters:new Map([['local-hermes',adapter]])});
    const response=await app.inject({url:'/v1/instances/local-hermes/catalog',headers:auth});
    expect(response.statusCode).toBe(200);expect(response.json()).toEqual({...connectorContractFixtures.catalog,connectorEpoch:'epoch-test'});await app.close();
  });

  it('keeps loaded adapters degraded until workspace roots are configured', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp({ ...config, workspaces: { roots: [] } }, { adapters: new Map([['local-hermes', adapter]]) });
    const health = await app.inject({ url: '/v1/health', headers: auth });
    expect(health.json()).toMatchObject({ status: 'degraded', instances: { total: 1, healthy: 0, degraded: 1 } });
    const instances = await app.inject({ url: '/v1/instances', headers: auth });
    expect(instances.json().instances[0]).toMatchObject({ status: 'degraded', error: { code: 'workspace_not_configured' } });
    await app.close();
  });

  it('runs idempotent executions and replays ordered terminal SSE events', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp(config, {
      connectorEpoch: 'epoch-test',
      adapters: new Map([['local-hermes', adapter]]),
      now: sequenceClock(),
    });
    const request = structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;

    const created = await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: request });
    expect(created.statusCode).toBe(201);
    expect(isExecutionSnapshot(created.json().execution)).toBe(true);
    expect(created.json().execution).toMatchObject({ status: 'queued', cursor: 1 });
    await waitForStatus(app, request.executionId, 'running');
    expect(adapter.lastRequest?.workspace).toEqual({ roomId: 'room-1', relativePath: '.', absolutePath: join(workspaceRoot, 'room-1') });

    const repeated = await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: request });
    expect(repeated.statusCode).toBe(200);
    expect(adapter.startCount).toBe(1);
    const conflict = await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: { ...request, modelId: 'different' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'execution_conflict' });

    adapter.emit(request.executionId, { type: 'output.text.delta', payload: { text: 'Hello' } });
    adapter.emit(request.executionId, { type: 'execution.completed', payload: {} });
    await waitForStatus(app, request.executionId, 'completed');

    const replay = await app.inject({ url: `/v1/executions/${request.executionId}/events?after=0`, headers: auth });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['content-type']).toContain('text/event-stream');
    const events = parseEvents(replay.body);
    expect(events.map(event => [event.cursor, event.type])).toEqual([
      [1, 'execution.accepted'],
      [2, 'execution.started'],
      [3, 'execution.upstream_status'],
      [4, 'execution.upstream_status'],
      [5, 'output.text.delta'],
      [6, 'execution.completed'],
    ]);
    expect(events.every(isConnectorExecutionEvent)).toBe(true);

    const resumed = await app.inject({ url: `/v1/executions/${request.executionId}/events?after=2`, headers: auth });
    expect(parseEvents(resumed.body).map(event => event.cursor)).toEqual([3, 4, 5, 6]);
    await app.close();
  });

  it('rejects unsafe or missing room workspaces before invoking an adapter', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp(config, { adapters: new Map([['local-hermes', adapter]]) });
    const request = structuredClone(connectorContractFixtures.startExecution) as StartExecutionRequest;
    const traversal = await app.inject({
      method: 'POST', url: '/v1/executions', headers: auth,
      payload: { ...request, workspace: { ...request.workspace, relativePath: '../escape' } },
    });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json()).toMatchObject({ error: 'workspace_invalid' });
    const missing = await app.inject({
      method: 'POST', url: '/v1/executions', headers: auth,
      payload: { ...request, executionId: 'missing-workspace', workspace: { roomId: 'missing-room', relativePath: '.' } },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'workspace_not_found' });
    expect(adapter.startCount).toBe(0);
    await app.close();
  });

  it('keeps cancellation terminal when an adapter completes late', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp(config, { connectorEpoch: 'epoch-test', adapters: new Map([['local-hermes', adapter]]) });
    const request = { ...structuredClone(connectorContractFixtures.startExecution), executionId: 'run-stop' } as StartExecutionRequest;
    await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: request });
    await waitForStatus(app, request.executionId, 'running');
    adapter.emit(request.executionId, { type: 'request.opened', payload: { request: { id: 'request-stop', kind: 'clarification', prompt: 'Continue?' } } });
    await waitForStatus(app, request.executionId, 'waiting_for_user');

    const stopped = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/stop`, headers: auth });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().execution.status).toBe('cancelled');
    expect(adapter.stopCount).toBe(1);
    adapter.emit(request.executionId, { type: 'execution.completed', payload: {} });
    await Promise.resolve();

    const inspected = await app.inject({ url: `/v1/executions/${request.executionId}`, headers: auth });
    expect(inspected.json().execution.status).toBe('cancelled');
    const stoppedAgain = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/stop`, headers: auth });
    expect(stoppedAgain.json().execution.status).toBe('cancelled');
    expect(adapter.stopCount).toBe(1);
    const replay = await app.inject({ url: `/v1/executions/${request.executionId}/events?after=2`, headers: auth });
    expect(parseEvents(replay.body).map(event => [event.type, event.type === 'request.resolved' ? event.payload.outcome : undefined])).toEqual([
      ['execution.upstream_status', undefined],
      ['execution.upstream_status', undefined],
      ['request.opened', undefined],
      ['execution.status', undefined],
      ['execution.status', undefined],
      ['request.resolved', 'cancelled'],
      ['execution.cancelled', undefined],
    ]);
    await app.close();
  });

  it('resolves pending requests idempotently and rejects a different second resolution', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp(config, { connectorEpoch: 'epoch-test', adapters: new Map([['local-hermes', adapter]]), now: sequenceClock() });
    const request = { ...structuredClone(connectorContractFixtures.startExecution), executionId: 'run-approval' } as StartExecutionRequest;
    await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: request });
    await waitForStatus(app, request.executionId, 'running');
    adapter.emit(request.executionId, { type: 'request.opened', payload: { request: { id: 'request-1', kind: 'approval', prompt: 'Allow?', choices: ['once', 'deny'] } } });
    await waitForStatus(app, request.executionId, 'waiting_for_user');

    const waiting = await app.inject({ url: `/v1/executions/${request.executionId}`, headers: auth });
    expect(waiting.json().execution).toMatchObject({ status: 'waiting_for_user', cursor: 6, pendingRequests: [{ id: 'request-1' }] });
    const invalid = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/requests/request-1/resolve`, headers: auth, payload: { resolution: '' } });
    expect(invalid.statusCode).toBe(400);
    const notOffered = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/requests/request-1/resolve`, headers: auth, payload: { resolution: 'always' } });
    expect(notOffered.statusCode).toBe(400);
    expect(notOffered.json()).toMatchObject({ error: 'invalid_resolution' });

    const resolved = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/requests/request-1/resolve`, headers: auth, payload: { resolution: 'once' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      execution: { status: 'running', cursor: 8, pendingRequests: [] },
      request: { id: 'request-1', resolution: { outcome: 'answered', value: 'once' } },
    });
    expect(adapter.resolutions).toEqual([{ upstreamId: request.executionId, requestId: 'request-1', resolution: 'once' }]);

    const repeated = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/requests/request-1/resolve`, headers: auth, payload: { resolution: 'once' } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().execution.cursor).toBe(8);
    expect(repeated.json().request).toEqual(resolved.json().request);
    expect(adapter.resolutions).toHaveLength(1);
    const conflict = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/requests/request-1/resolve`, headers: auth, payload: { resolution: 'deny' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'request_resolution_conflict' });

    adapter.emit(request.executionId, { type: 'execution.completed', payload: {} });
    await waitForStatus(app, request.executionId, 'completed');
    const replay = await app.inject({ url: `/v1/executions/${request.executionId}/events?after=2`, headers: auth });
    expect(parseEvents(replay.body).map(event => [event.cursor, event.type])).toEqual([
      [3, 'execution.upstream_status'], [4, 'execution.upstream_status'], [5, 'request.opened'], [6, 'execution.status'],
      [7, 'request.resolved'], [8, 'execution.status'], [9, 'execution.completed'],
    ]);
    await app.close();
  });

  it('accepts a custom clarification answer even when choices are suggestions', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp(config, { connectorEpoch: 'epoch-test', adapters: new Map([['local-hermes', adapter]]), now: sequenceClock() });
    const request = { ...structuredClone(connectorContractFixtures.startExecution), executionId: 'run-clarification' } as StartExecutionRequest;
    await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: request });
    await waitForStatus(app, request.executionId, 'running');
    adapter.emit(request.executionId, { type: 'request.opened', payload: { request: { id: 'question-1', kind: 'clarification', prompt: 'Which format?', choices: ['PNG', 'SVG'] } } });
    await waitForStatus(app, request.executionId, 'waiting_for_user');

    const resolved = await app.inject({ method: 'POST', url: `/v1/executions/${request.executionId}/requests/question-1/resolve`, headers: auth, payload: { resolution: 'WebP, please' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ execution: { status: 'running', pendingRequests: [] }, request: { kind: 'clarification', resolution: { outcome: 'answered', value: 'WebP, please' } } });
    expect(adapter.resolutions).toEqual([{ upstreamId: request.executionId, requestId: 'question-1', resolution: 'WebP, please' }]);
    await app.close();
  });

  it('keeps one bounded usage snapshot while suppressing duplicate vendor updates',async()=>{
    const adapter=new ControlledAdapter(),app=buildConnectorApp(config,{connectorEpoch:'epoch-test',adapters:new Map([['local-hermes',adapter]]),now:sequenceClock()}),request={...structuredClone(connectorContractFixtures.startExecution),executionId:'run-usage'} as StartExecutionRequest;
    await app.inject({method:'POST',url:'/v1/executions',headers:auth,payload:request});await waitForStatus(app,request.executionId,'running');
    const usage={inputTokens:40,outputTokens:10,totalTokens:50};adapter.emit(request.executionId,{type:'usage.updated',payload:{usage}});adapter.emit(request.executionId,{type:'usage.updated',payload:{usage}});adapter.emit(request.executionId,{type:'execution.completed',payload:{}});await waitForStatus(app,request.executionId,'completed');
    const inspected=await app.inject({url:`/v1/executions/${request.executionId}`,headers:auth});expect(inspected.json().execution).toMatchObject({status:'completed',usage});
    const replay=await app.inject({url:`/v1/executions/${request.executionId}/events?after=2`,headers:auth}),events=parseEvents(replay.body);expect(events.filter(event=>event.type==='usage.updated')).toHaveLength(1);expect(events.find(event=>event.type==='usage.updated')).toMatchObject({payload:{usage}});await app.close();
  });

  it('fails explicitly when a requested cursor predates the replay window', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp(config, { connectorEpoch: 'epoch-test', adapters: new Map([['local-hermes', adapter]]), replayLimit: 2 });
    const request = { ...structuredClone(connectorContractFixtures.startExecution), executionId: 'run-window' } as StartExecutionRequest;
    await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: request });
    await waitForStatus(app, request.executionId, 'running');
    adapter.emit(request.executionId, { type: 'output.text.delta', payload: { text: 'Hello' } });
    adapter.emit(request.executionId, { type: 'execution.completed', payload: {} });
    await waitForStatus(app, request.executionId, 'completed');

    const lost = await app.inject({ url: `/v1/executions/${request.executionId}/events?after=0`, headers: auth });
    expect(lost.statusCode).toBe(409);
    expect(lost.json()).toMatchObject({ error: 'replay_unavailable' });
    const available = await app.inject({ url: `/v1/executions/${request.executionId}/events?after=4`, headers: auth });
    expect(parseEvents(available.body).map(event => event.cursor)).toEqual([5, 6]);
    await app.close();
  });

  it('redacts adapter-controlled events before snapshots and replay', async () => {
    const adapter = new ControlledAdapter();
    const app = buildConnectorApp(config, { connectorEpoch: 'epoch-test', adapters: new Map([['local-hermes', adapter]]) });
    const request = { ...structuredClone(connectorContractFixtures.startExecution), executionId: 'run-redaction' } as StartExecutionRequest;
    await app.inject({ method: 'POST', url: '/v1/executions', headers: auth, payload: request });
    await waitForStatus(app, request.executionId, 'running');
    adapter.emit(request.executionId, { type: 'tool.updated', payload: { toolId: 'tool-1', name: 'shell', safeSummary: 'token=secret-value /home/private/output.txt' } });
    adapter.emit(request.executionId, { type: 'request.opened', payload: { request: { id: 'request-secret', kind: 'approval', prompt: 'Bearer secret-bearer-value', choices: ['once', 'deny'] } } });
    adapter.emit(request.executionId, { type: 'execution.failed', payload: { error: { code: 'BAD CODE', message: 'password=secret-value /srv/private/error.log' } } });
    await waitForStatus(app, request.executionId, 'failed');

    const inspected = await app.inject({ url: `/v1/executions/${request.executionId}`, headers: auth });
    expect(inspected.json().execution.error).toEqual({ code: 'adapter_execution_failed', message: 'password=[REDACTED] [ABSOLUTE_PATH]' });
    const replay = await app.inject({ url: `/v1/executions/${request.executionId}/events?after=0`, headers: auth });
    expect(replay.body).not.toContain('secret-value');
    expect(replay.body).not.toContain('secret-bearer-value');
    expect(replay.body).not.toContain('/home/private');
    expect(replay.body).not.toContain('/srv/private');
    expect(replay.body).toContain('[REDACTED]');
    expect(replay.body).toContain('[ABSOLUTE_PATH]');
    await app.close();
  });
});

class ControlledAdapter implements ConnectorAdapter {
  readonly type = 'hermes';
  readonly capabilities = ['model_catalog','text_streaming'] satisfies ConnectorAdapter['capabilities'];
  readonly queues = new Map<string, AsyncEventQueue>();
  startCount = 0;
  stopCount = 0;
  lastRequest?: AdapterStartExecutionRequest;
  resolutions: Array<{ upstreamId: string; requestId: string; resolution: string }> = [];

  async catalog(){return{models:connectorContractFixtures.catalog.models.map(model=>({...model})),modes:[]};}

  async start(request: AdapterStartExecutionRequest): Promise<AdapterExecution> {
    this.startCount += 1;
    this.lastRequest = request;
    this.queues.set(request.executionId, new AsyncEventQueue());
    return { upstreamId: request.executionId };
  }

  async inspect() { return { status: 'running' as const }; }

  events(execution: AdapterExecution) {
    const queue = this.queues.get(execution.upstreamId);
    if (!queue) throw new Error('Missing fake execution');
    return queue;
  }

  async stop() { this.stopCount += 1; }

  async resolveRequest(execution: AdapterExecution, request: import('@agenvyl/connector-contract').ConnectorRequestSnapshot, resolution: string) {
    this.resolutions.push({ upstreamId: execution.upstreamId, requestId: request.id, resolution });
    return { outcome: resolution === 'deny' ? 'declined' as const : 'answered' as const };
  }

  emit(executionId: string, event: AdapterExecutionEvent) {
    const queue = this.queues.get(executionId);
    if (!queue) throw new Error('Missing fake execution');
    queue.push(event);
  }
}

class AsyncEventQueue implements AsyncIterable<AdapterExecutionEvent> {
  private readonly values: AdapterExecutionEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<AdapterExecutionEvent>) => void> = [];

  push(event: AdapterExecutionEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.values.push(event);
  }

  [Symbol.asyncIterator](): AsyncIterator<AdapterExecutionEvent> {
    return {
      next: async () => {
        const event = this.values.shift();
        if (event) return { value: event, done: false };
        return new Promise(resolve => this.waiters.push(resolve));
      },
    };
  }
}

async function waitForStatus(app: ReturnType<typeof buildConnectorApp>, executionId: string, status: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ url: `/v1/executions/${executionId}`, headers: auth });
    if (response.json().execution?.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error(`Execution ${executionId} did not reach ${status}`);
}

function parseEvents(body: string) {
  return body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as import('@agenvyl/connector-contract').ConnectorExecutionEvent);
}

function sequenceClock() {
  let second = 0;
  return () => `2026-07-17T00:00:${String(second++).padStart(2, '0')}.000Z`;
}
