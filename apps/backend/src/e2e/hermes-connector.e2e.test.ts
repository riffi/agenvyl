import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConnectorApp } from '../../../connector/src/app.js';
import { HermesConnectorAdapter } from '../../../connector/src/adapters/hermes/adapter.js';
import type { ConnectorConfig } from '../../../connector/src/config.js';
import { buildApp } from '../app/buildApp.js';
import { connectTestDatabase } from '../testDatabase.js';

const connectorToken = 'connector-e2e-token-0123456789abcdef';
const hermesToken = 'hermes-e2e-token';
const roomId = 'demo-room';

describe.sequential('Core -> Connector -> Hermes black-box gate', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('covers completion, tools, approval, stop and same-epoch Core replay over HTTP/SSE', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'agenvyl-hermes-e2e-'));
    cleanups.push(() => rm(workspaceRoot, { recursive: true, force: true }));

    const database = e2eDatabaseUrl();
    cleanups.push(() => dropSchema(database.url, database.schema));

    const hermes = new HermesFixture(hermesToken);
    const hermesUrl = await listen(hermes.app);
    cleanups.push(() => hermes.app.close());

    const connectorConfig: ConnectorConfig = {
      version: 1,
      listen: { host: '127.0.0.1', port: 0 },
      workspaces: { roots: [workspaceRoot] },
      instances: [{ id: 'local-hermes', type: 'hermes', enabled: true }],
      token: connectorToken,
    };
    const connector = buildConnectorApp(connectorConfig, {
      logger: false,
      connectorEpoch: 'hermes-e2e-epoch',
      adapters: new Map([
        ['local-hermes', new HermesConnectorAdapter({ baseUrl: hermesUrl, token: hermesToken })],
      ]),
    });
    const connectorUrl = await listen(connector);
    cleanups.push(() => connector.close());

    expect(await getJson(`${connectorUrl}/v2/health`, connectorHeaders())).toMatchObject({
      status: 'ready',
      connectorEpoch: 'hermes-e2e-epoch',
    });

    let core = await startCore(database.url, workspaceRoot, connectorUrl);
    cleanups.push(async () => { if (core) await core.app.close(); });

    const completedId = await createRun(core.url, '[e2e:complete]');
    const completed = await waitForRun(core.url, completedId, run => run.status === 'completed');
    expect(completed).toMatchObject({
      text: 'alpha omega',
      status: 'completed',
      harnessInstanceId: 'local-hermes',
      harnessType: 'hermes',
      modelId: 'sol',
    });
    expect(completed.tools).toEqual([
      { id: 'terminal-1', name: 'terminal', detail: 'exit 0', status: 'completed' },
    ]);

    const microDeltaText = 'micro '.repeat(100);
    const microDeltaId = await createRun(core.url, '[e2e:micro-deltas]');
    const microDeltaRun = await waitForRun(core.url, microDeltaId, run => run.status === 'completed');
    expect(microDeltaRun.text).toBe(microDeltaText);

    const approvalId = await createRun(core.url, '[e2e:approval]');
    const waiting = await waitForRun(core.url, approvalId, run => run.status === 'waiting_approval');
    expect(waiting.request).toMatchObject({ kind: 'approval', prompt: 'Allow fixture tool?' });
    const approval = await fetch(`${core.url}/api/v1/runs/${approvalId}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'approved' }),
    });
    const approvalBody = await approval.json() as unknown;
    expect(approval.status, JSON.stringify(approvalBody)).toBe(200);
    const approved = await waitForRun(core.url, approvalId, run => run.status === 'completed');
    expect(approved.text).toBe('before after');
    expect(approved.request).toMatchObject({ resolved: 'answered' });
    expect(hermes.approvalChoices).toEqual(['once']);

    const cancelledId = await createRun(core.url, '[e2e:cancel]');
    await waitForRun(core.url, cancelledId, run => run.status === 'streaming' && run.text === 'cancel-started');
    const cancellation = await fetch(`${core.url}/api/v1/runs/${cancelledId}/cancel`, { method: 'POST' });
    expect(cancellation.status).toBe(200);
    expect(await cancellation.json()).toMatchObject({ status: 'stopping' });
    const cancelled = await waitForRun(core.url, cancelledId, run => run.status === 'cancelled');
    expect(cancelled.text).toBe('cancel-started');
    expect(hermes.stopCount).toBe(1);

    const replayedId = await createRun(core.url, '[e2e:restart]');
    await waitForRun(core.url, replayedId, run => run.status === 'streaming' && run.text === 'before-restart ');
    await core.app.close();
    core = undefined;

    core = await startCore(database.url, workspaceRoot, connectorUrl);
    await waitForRun(core.url, replayedId, run => run.status === 'streaming');
    hermes.releaseRestartRun();
    const replayed = await waitForRun(core.url, replayedId, run => run.status === 'completed');
    expect(replayed.text).toBe('before-restart after-restart');

    const execution = await getJson(
      `${connectorUrl}/v2/executions/${encodeURIComponent(replayedId)}`,
      connectorHeaders(),
    );
    expect(execution).toMatchObject({
      execution: {
        executionId: replayedId,
        connectorEpoch: 'hermes-e2e-epoch',
        status: 'completed',
      },
    });

    const sql = connectTestDatabase(database.url);
    try {
      for (const runId of [completedId, microDeltaId, approvalId, cancelledId, replayedId]) {
        const [{ count }] = await sql`
          SELECT COUNT(*)::int count
          FROM room_events
          WHERE type = 'run.status'
            AND payload->>'runId' = ${runId}
            AND payload->>'status' = ANY(${['completed', 'failed', 'cancelled']})
        `;
        expect(count, `terminal event count for ${runId}`).toBe(1);
      }
      const [{ count: microDeltaCount }] = await sql`
        SELECT COUNT(*)::int count
        FROM room_events
        WHERE type = 'run.delta'
          AND payload->>'runId' = ${microDeltaId}
      `;
      expect(microDeltaCount).toBeGreaterThan(0);
      expect(microDeltaCount).toBeLessThan(20);
      const [checkpoint] = await sql`
        SELECT connector_execution_id, connector_epoch, connector_cursor
        FROM agent_runs WHERE id = ${replayedId}
      `;
      expect(checkpoint).toMatchObject({
        connector_execution_id: replayedId,
        connector_epoch: 'hermes-e2e-epoch',
      });
      expect(Number(checkpoint.connector_cursor)).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }

    expect(hermes.runRequests).toHaveLength(5);
    expect(hermes.runRequests.every(request => request.instructions.includes(join(workspaceRoot, roomId)))).toBe(true);
    expect(new Set(hermes.runRequests.map(request => request.session_id)).size).toBe(5);
  }, 30_000);

  it('enforces a durable Core deadline and stops Hermes exactly once',async()=>{
    const workspaceRoot=await mkdtemp(join(tmpdir(),'agenvyl-hermes-timeout-e2e-'));cleanups.push(()=>rm(workspaceRoot,{recursive:true,force:true}));
    const database=e2eDatabaseUrl();cleanups.push(()=>dropSchema(database.url,database.schema));
    const hermes=new HermesFixture(hermesToken),hermesUrl=await listen(hermes.app);cleanups.push(()=>hermes.app.close());
    const connector=buildConnectorApp({version:1,listen:{host:'127.0.0.1',port:0},workspaces:{roots:[workspaceRoot]},instances:[{id:'local-hermes',type:'hermes',enabled:true}],token:connectorToken},{logger:false,connectorEpoch:'hermes-timeout-e2e-epoch',adapters:new Map([['local-hermes',new HermesConnectorAdapter({baseUrl:hermesUrl,token:hermesToken})]])});
    const connectorUrl=await listen(connector);cleanups.push(()=>connector.close());
    const core=await startCore(database.url,workspaceRoot,connectorUrl,75);cleanups.push(()=>core.app.close());
    const runId=await createRun(core.url,'[e2e:timeout]'),timedOut=await waitForRun(core.url,runId,run=>run.status==='failed');
    expect(timedOut).toMatchObject({status:'failed',error:'Run exceeded the configured execution deadline',errorCode:'run_timeout'});
    await new Promise(resolve=>setTimeout(resolve,50));expect(hermes.stopCount).toBe(1);
    const sql=connectTestDatabase(database.url);try{const[run]=await sql`SELECT status,error,error_code,execution_deadline_at FROM agent_runs WHERE id=${runId}`;expect(run).toMatchObject({status:'failed',error:'Run exceeded the configured execution deadline',error_code:'run_timeout',execution_deadline_at:expect.any(Date)});const[{count}]=await sql`SELECT COUNT(*)::int count FROM room_events WHERE type='run.status' AND payload->>'runId'=${runId} AND payload->>'status'=ANY(${['completed','failed','cancelled']})`;expect(count).toBe(1);}finally{await sql.end();}
  },15_000);
});

type TimelineRun = {
  id: string;
  status: string;
  text: string;
  tools: Array<{ id: string; name: string; detail: string; status: string }>;
  request?: { kind: string; prompt: string; resolved?: string };
  harnessInstanceId: string;
  harnessType: string;
  modelId: string;
  error?:string;
  errorCode?:string;
};

type RunningCore = { app: FastifyInstance; url: string };

async function startCore(databaseUrl: string, workspaceRoot: string, connectorUrl: string,runTimeoutMs?:number): Promise<RunningCore> {
  const app = await buildApp({
    databaseUrl,
    connectorUrl,
    connectorToken,
    workspaceRoot,
    workspaceAgentRoot: workspaceRoot,
    distPath: 'missing-e2e-dist',
    shutdownTimeoutMs: 2_000,
    runTimeoutMs,
    logger: false,
  });
  return { app, url: await listen(app) };
}

async function createRun(coreUrl: string, marker: string) {
  const response = await fetch(`${coreUrl}/api/v1/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: marker, targets: ['architect'] }),
  });
  expect(response.status).toBe(202);
  const body = await response.json() as { runIds: string[] };
  expect(body.runIds).toHaveLength(1);
  return body.runIds[0]!;
}

async function waitForRun(coreUrl: string, runId: string, predicate: (run: TimelineRun) => boolean) {
  const deadline = Date.now() + 8_000;
  let latest: TimelineRun | undefined;
  while (Date.now() < deadline) {
    const timeline = await getJson(`${coreUrl}/api/v1/rooms/${roomId}/timeline`) as { runs: TimelineRun[] };
    latest = timeline.runs.find(run => run.id === runId);
    if (latest && predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for run ${runId}; latest=${JSON.stringify(latest)}`);
}

async function listen(app: FastifyInstance) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function getJson(url: string, headers?: HeadersInit) {
  const response = await fetch(url, { headers });
  expect(response.status, `${url}: ${await response.clone().text()}`).toBe(200);
  return await response.json() as unknown;
}

function connectorHeaders() { return { authorization: `Bearer ${connectorToken}` }; }

function e2eDatabaseUrl() {
  const url = new URL(
    process.env.AGENVYL_E2E_DATABASE_URL
      ?? process.env.TEST_DATABASE_URL
      ?? process.env.AGENVYL_DATABASE_URL
      ?? 'postgres://hermes_group_chat:hermes_group_chat@127.0.0.1:8793/hermes_group_chat',
  );
  const schema = `agenvyl_e2e_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  return { url: url.toString(), schema };
}

async function dropSchema(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);
  url.searchParams.delete('schema');
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try { await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`; } finally { await sql.end(); }
}

type HermesRunRequest = {
  input: string;
  session_id: string;
  instructions: string;
  conversation_history: Array<{ role: string; content: string }>;
  model: string;
};

type FixtureRun = {
  id: string;
  scenario: 'complete' | 'micro-deltas' | 'approval' | 'cancel' | 'restart'|'timeout';
  status: string;
  events: AsyncEventQueue;
};

class HermesFixture {
  readonly app = Fastify({ logger: false });
  readonly runRequests: HermesRunRequest[] = [];
  readonly approvalChoices: string[] = [];
  stopCount = 0;
  private sequence = 0;
  private readonly runs = new Map<string, FixtureRun>();

  constructor(private readonly token: string) {
    this.app.addHook('onRequest', async (request, reply) => {
      if (request.headers.authorization === `Bearer ${this.token}` && request.headers['x-api-key'] === this.token) return;
      return reply.code(401).send({ error: { code: 'invalid_api_key' } });
    });

    this.app.get('/v1/models', async () => ({
      object: 'list',
      data: [{ id: 'sol', root: 'fixture/sol' }],
    }));

    this.app.post<{ Body: HermesRunRequest }>('/v1/runs', async (request, reply) => {
      const body = request.body;
      if (!body || typeof body.input !== 'string' || typeof body.instructions !== 'string') {
        return reply.code(400).send({ error: { code: 'invalid_request' } });
      }
      this.runRequests.push(structuredClone(body));
      const scenario = fixtureScenario(body.input);
      const id = `fixture-run-${++this.sequence}`;
      const run: FixtureRun = { id, scenario, status: 'running', events: new AsyncEventQueue() };
      this.runs.set(id, run);
      this.seed(run);
      return reply.code(202).send({ run_id: id });
    });

    this.app.get<{ Params: { id: string } }>('/v1/runs/:id', async (request, reply) => {
      const run = this.runs.get(request.params.id);
      return run ? { status: run.status } : reply.code(404).send({ error: { code: 'not_found' } });
    });

    this.app.get<{ Params: { id: string } }>('/v1/runs/:id/events', async (request, reply) => {
      const run = this.runs.get(request.params.id);
      if (!run) return reply.code(404).send({ error: { code: 'not_found' } });
      return reply
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(Readable.from(run.events));
    });

    this.app.post<{ Params: { id: string }; Body: { choice?: string } }>('/v1/runs/:id/approval', async (request, reply) => {
      const run = this.runs.get(request.params.id);
      if (!run || run.scenario !== 'approval' || typeof request.body?.choice !== 'string') {
        return reply.code(409).send({ error: { code: 'approval_not_active' } });
      }
      this.approvalChoices.push(request.body.choice);
      run.status = 'running';
      setTimeout(() => {
        run.events.push('tool.completed', { event: 'tool.completed', id: 'approval-tool', name: 'write_file', detail: 'approved' });
        run.events.push('message.delta', { event: 'message.delta', delta: 'after' });
        this.complete(run);
      }, 10);
      return { resolved: 1 };
    });

    this.app.post<{ Params: { id: string } }>('/v1/runs/:id/stop', async (request, reply) => {
      const run = this.runs.get(request.params.id);
      if (!run) return reply.code(404).send({ error: { code: 'not_found' } });
      this.stopCount++;
      run.status = 'cancelled';
      setTimeout(() => {
        run.events.push('run.cancelled', { event: 'run.cancelled' });
        run.events.close();
      }, 10);
      return { stopped: 1 };
    });
  }

  releaseRestartRun() {
    const run = [...this.runs.values()].find(candidate => candidate.scenario === 'restart');
    if (!run) throw new Error('Restart fixture run was not created');
    run.events.push('message.delta', { event: 'message.delta', delta: 'after-restart' });
    this.complete(run);
  }

  private seed(run: FixtureRun) {
    switch (run.scenario) {
      case 'complete':
        run.events.push('message.delta', { event: 'message.delta', delta: 'alpha ' });
        run.events.push('tool.started', { event: 'tool.started', id: 'terminal-1', name: 'terminal', detail: 'running fixture command' });
        run.events.push('tool.completed', { event: 'tool.completed', id: 'terminal-1', name: 'terminal', detail: 'exit 0' });
        run.events.push('message.delta', { event: 'message.delta', delta: 'omega' });
        this.complete(run);
        return;
      case 'micro-deltas':
        for (const character of 'micro '.repeat(100)) {
          run.events.push('message.delta', { event: 'message.delta', delta: character });
        }
        this.complete(run);
        return;
      case 'approval':
        run.events.push('message.delta', { event: 'message.delta', delta: 'before ' });
        run.events.push('tool.started', { event: 'tool.started', id: 'approval-tool', name: 'write_file', detail: 'waiting' });
        run.events.push('approval.request', { event: 'approval.request', prompt: 'Allow fixture tool?', choices: ['once', 'deny'] });
        run.status = 'waiting_for_approval';
        return;
      case 'cancel':
        run.events.push('message.delta', { event: 'message.delta', delta: 'cancel-started' });
        return;
      case 'restart':
        run.events.push('message.delta', { event: 'message.delta', delta: 'before-restart ' });
        return;
      case 'timeout':
        run.events.push('message.delta',{event:'message.delta',delta:'timeout-started'});
    }
  }

  private complete(run: FixtureRun) {
    run.status = 'completed';
    run.events.push('run.completed', { event: 'run.completed' });
    run.events.close();
  }
}

function fixtureScenario(input: string): FixtureRun['scenario'] {
  if (input.includes('[e2e:micro-deltas]')) return 'micro-deltas';
  if (input.includes('[e2e:approval]')) return 'approval';
  if (input.includes('[e2e:cancel]')) return 'cancel';
  if (input.includes('[e2e:restart]')) return 'restart';
  if(input.includes('[e2e:timeout]'))return'timeout';
  return 'complete';
}

class AsyncEventQueue implements AsyncIterable<string> {
  private readonly values: string[] = [];
  private readonly waiters: Array<(value: IteratorResult<string>) => void> = [];
  private ended = false;

  push(event: string, payload: Record<string, unknown>) {
    if (this.ended) throw new Error('Cannot append to a closed fixture stream');
    const value = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false }); else this.values.push(value);
  }

  close() {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.ended) return { value: undefined, done: true };
        return await new Promise<IteratorResult<string>>(resolve => this.waiters.push(resolve));
      },
    };
  }
}
