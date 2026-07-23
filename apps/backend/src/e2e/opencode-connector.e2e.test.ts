import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenCodeConnectorAdapter } from '../../../connector/src/adapters/opencode/adapter.js';
import { buildConnectorApp } from '../../../connector/src/app.js';
import type { ConnectorConfig } from '../../../connector/src/config.js';
import { buildApp } from '../app/buildApp.js';
import { connectTestDatabase } from '../testDatabase.js';

const connectorToken = 'opencode-e2e-token-0123456789abcdef';
const roomId = 'demo-room';

describe.sequential('Core -> Connector -> OpenCode-compatible black-box gate', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('persists reasoning separately from the public answer through HTTP and SSE', async () => {
    const runtime = await startRuntime(cleanups);
    const runId = await createRun(runtime.coreUrl, '[opencode:reasoning]');
    const completed = await waitForRun(runtime.coreUrl, runId, run => run.status === 'completed');
    expect(completed).toMatchObject({reasoning:'private analysis',text:'public answer',usage:{inputTokens:120,outputTokens:30,totalTokens:155,reasoningTokens:5,cacheReadTokens:40,cacheWriteTokens:2}});
    expect(runtime.fixture.promptVariants).toEqual(['high']);
    const sql=connectTestDatabase(runtime.databaseUrl);
    try {
      const [run]=await sql`SELECT reasoning,text,usage FROM agent_runs WHERE id=${runId}`;
      expect(run).toEqual({reasoning:'private analysis',text:'public answer',usage:{inputTokens:120,outputTokens:30,totalTokens:155,reasoningTokens:5,cacheReadTokens:40,cacheWriteTokens:2}});
      const [counts]=await sql`SELECT COUNT(*) FILTER (WHERE type='run.reasoning.delta')::int reasoning_count,COUNT(*) FILTER (WHERE type='run.delta')::int text_count FROM room_events WHERE payload->>'runId'=${runId}`;
      expect(counts).toEqual({reasoning_count:1,text_count:1});
    } finally { await sql.end(); }
  }, 20_000);

  it('aborts active and approval-waiting sessions with one terminal state', async () => {
    const runtime = await startRuntime(cleanups);

    const activeId = await createRun(runtime.coreUrl, '[opencode:cancel-active]');
    await waitForRun(runtime.coreUrl, activeId, run => run.status === 'streaming' && run.text === 'cancel-started');
    await cancelRun(runtime.coreUrl, activeId);
    expect(await waitForRun(runtime.coreUrl, activeId, run => run.status === 'cancelled')).toMatchObject({
      status: 'cancelled', harnessInstanceId: 'local-opencode', harnessType: 'opencode', modelId: 'fixture/model',
    });

    const approvalId = await createRun(runtime.coreUrl, '[opencode:cancel-approval]');
    const waiting = await waitForRun(runtime.coreUrl, approvalId, run => run.status === 'waiting_approval');
    expect(waiting.request).toMatchObject({ kind: 'approval' });
    await cancelRun(runtime.coreUrl, approvalId);
    const cancelled = await waitForRun(runtime.coreUrl, approvalId, run => run.status === 'cancelled');
    expect(cancelled.request).toMatchObject({ kind: 'approval', resolved: 'cancelled' });

    expect(runtime.fixture.abortCount).toBe(2);
    expect(new Set(runtime.fixture.abortedSessionIds).size).toBe(2);
    await expectSingleTerminal(runtime.databaseUrl, [activeId, approvalId]);
  }, 20_000);

  it('enforces a durable Core timeout and aborts OpenCode exactly once', async () => {
    const runtime = await startRuntime(cleanups, 250);
    const runId = await createRun(runtime.coreUrl, '[opencode:timeout]');
    const timedOut = await waitForRun(runtime.coreUrl, runId, run => run.status === 'failed');
    expect(timedOut).toMatchObject({
      status: 'failed', error: 'Run exceeded the configured execution deadline', errorCode: 'run_timeout',
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(runtime.fixture.abortCount).toBe(1);

    const sql = connectTestDatabase(runtime.databaseUrl);
    try {
      const [run] = await sql`SELECT status,error,error_code,execution_deadline_at FROM agent_runs WHERE id=${runId}`;
      expect(run).toMatchObject({ status: 'failed', error: 'Run exceeded the configured execution deadline', error_code: 'run_timeout', execution_deadline_at: expect.any(Date) });
    } finally {
      await sql.end();
    }
    await expectSingleTerminal(runtime.databaseUrl, [runId]);
  }, 20_000);

  it('reattaches after a Core restart without replay duplicates and restores approval control', async () => {
    const runtime = await startRuntime(cleanups);
    const runId = await createRun(runtime.coreUrl, '[opencode:restart-approval]');
    const beforeRestart = await waitForRun(runtime.coreUrl, runId, run => run.status === 'waiting_approval');
    expect(beforeRestart).toMatchObject({ text: 'before-restart ', request: { kind: 'approval' } });

    await runtime.restartCore();
    const restored = await waitForRun(runtime.coreUrl, runId, run => run.status === 'waiting_approval');
    expect(restored).toMatchObject({ text: 'before-restart ', request: beforeRestart.request });

    const approval = await fetch(`${runtime.coreUrl}/api/v1/runs/${runId}/approval`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution: 'approved' }),
    });
    expect(approval.status, await approval.clone().text()).toBe(200);
    const completed = await waitForRun(runtime.coreUrl, runId, run => run.status === 'completed');
    expect(completed).toMatchObject({ text: 'before-restart after-restart', request: { kind: 'approval', resolved: 'answered' } });
    expect(runtime.fixture.permissionReplies).toHaveLength(1);

    const sql = connectTestDatabase(runtime.databaseUrl);
    try {
      const [counts] = await sql`
        SELECT
          COUNT(*) FILTER (WHERE type='request.created')::int request_count,
          COUNT(*) FILTER (WHERE type='request.resolved')::int resolved_count,
          COUNT(*) FILTER (WHERE type='tool.updated')::int tool_count,
          COUNT(*) FILTER (WHERE type='run.status' AND payload->>'status'=ANY(${['completed', 'failed', 'cancelled']}))::int terminal_count
        FROM room_events WHERE payload->>'runId'=${runId}
      `;
      expect(counts).toEqual({ request_count: 1, resolved_count: 1, tool_count: 3, terminal_count: 1 });
      const [checkpoint] = await sql`SELECT connector_epoch,connector_cursor FROM agent_runs WHERE id=${runId}`;
      expect(checkpoint.connector_epoch).toBe(runtime.connectorEpoch);
      expect(Number(checkpoint.connector_cursor)).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  }, 20_000);

  it('restores a clarification after Core restart and resumes from one explicit answer', async () => {
    const runtime = await startRuntime(cleanups);
    const runId = await createRun(runtime.coreUrl, '[opencode:clarification]');
    const beforeRestart = await waitForRun(runtime.coreUrl, runId, run => run.status === 'waiting_clarification');
    expect(beforeRestart.request).toMatchObject({ kind: 'clarification', choices: ['PNG', 'SVG'] });

    await runtime.restartCore();
    const restored = await waitForRun(runtime.coreUrl, runId, run => run.status === 'waiting_clarification');
    expect(restored.request).toEqual(beforeRestart.request);
    const answer = await fetch(`${runtime.coreUrl}/api/v1/runs/${runId}/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution: 'WebP, please' }),
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const completed = await waitForRun(runtime.coreUrl, runId, run => run.status === 'completed');
    expect(completed).toMatchObject({ text: 'clarification-answer-received', request: { kind: 'clarification', resolved: 'answered' } });
    expect(runtime.fixture.questionReplies).toEqual([{ requestId: expect.stringContaining('question-'), answers: [['WebP, please']] }]);
    await expectSingleTerminal(runtime.databaseUrl, [runId]);
  }, 20_000);

  it('retries with a fresh OpenCode session and preserves the immutable harness snapshot', async () => {
    const runtime = await startRuntime(cleanups);
    const sourceId = await createRun(runtime.coreUrl, '[opencode:retry]');
    await waitForRun(runtime.coreUrl, sourceId, run => run.status === 'streaming' && run.text === 'retry-first-attempt');
    await cancelRun(runtime.coreUrl, sourceId);
    await waitForRun(runtime.coreUrl, sourceId, run => run.status === 'cancelled');

    const retry = await fetch(`${runtime.coreUrl}/api/v1/runs/${sourceId}/retry`, { method: 'POST' });
    expect(retry.status, await retry.clone().text()).toBe(202);
    const { run_id: retryId } = await retry.json() as { run_id: string };
    const completed = await waitForRun(runtime.coreUrl, retryId, run => run.status === 'completed');
    expect(completed).toMatchObject({ text: 'retry-completed', harnessInstanceId: 'local-opencode', harnessType: 'opencode', modelId: 'fixture/model' });
    expect(new Set(runtime.fixture.createdSessionIds).size).toBe(2);

    const sql = connectTestDatabase(runtime.databaseUrl);
    try {
      const [retried] = await sql`SELECT retry_of_run_id,harness_instance_id,harness_type,model_id,execution_profile FROM agent_runs WHERE id=${retryId}`;
      expect(retried).toMatchObject({ retry_of_run_id: sourceId, harness_instance_id: 'local-opencode', harness_type: 'opencode', model_id: 'fixture/model', execution_profile:{workflowMode:'work',agentVariantId:'build',implementationPlanVersionId:null} });
    } finally {
      await sql.end();
    }
    await expectSingleTerminal(runtime.databaseUrl, [sourceId, retryId]);
  }, 20_000);
});

type TimelineRun = {
  id: string;
  status: string;
  text: string;
  reasoning?: string;
  harnessInstanceId: string;
  harnessType: string;
  modelId: string;
  request?: { kind: string; choices?: string[]; resolved?: string };
  error?: string;
  errorCode?: string;
};

async function startRuntime(cleanups: Array<() => Promise<void>>, runTimeoutMs?: number) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'agenvyl-opencode-e2e-'));
  cleanups.push(() => rm(workspaceRoot, { recursive: true, force: true }));
  const database = e2eDatabaseUrl();
  cleanups.push(() => dropSchema(database.url, database.schema));

  const fixture = new OpenCodeFixture();
  const fixtureUrl = await listen(fixture.app);
  cleanups.push(() => fixture.app.close());
  const connectorConfig: ConnectorConfig = {
    version: 1,
    listen: { host: '127.0.0.1', port: 0 },
    workspaces: { roots: [workspaceRoot] },
    instances: [{ id: 'local-opencode', type: 'opencode', enabled: true }],
    token: connectorToken,
  };
  const connectorEpoch = `opencode-e2e-${randomUUID()}`;
  const connector = buildConnectorApp(connectorConfig, {
    logger: false,
    connectorEpoch,
    adapters: new Map([['local-opencode', new OpenCodeConnectorAdapter({ baseUrl: fixtureUrl })]]),
  });
  const connectorUrl = await listen(connector);
  cleanups.push(() => connector.close());

  const startCore = async () => {
    const app = await buildApp({
      databaseUrl: database.url, connectorUrl, connectorToken, workspaceRoot,
      workspaceAgentRoot: workspaceRoot, distPath: 'missing-opencode-e2e-dist', shutdownTimeoutMs: 2_000, runTimeoutMs, logger: false,
    });
    return { app, url: await listen(app) };
  };
  let core = await startCore();
  cleanups.push(() => core.app.close());
  await configureArchitect(database.url);
  return {
    get coreUrl() { return core.url; },
    databaseUrl: database.url, fixture, connectorEpoch,
    async restartCore() { await core.app.close(); core = await startCore(); },
  };
}

async function configureArchitect(databaseUrl: string) {
  const sql = connectTestDatabase(databaseUrl);
  try {
    await sql`UPDATE personas SET requested_model='fixture/model',harness_instance_id='local-opencode',harness_type='opencode',model_id='fixture/model',agent_variant_id='build',default_reasoning_effort='high' WHERE id='persona-architect'`;
    await sql`UPDATE persona_versions SET requested_model='fixture/model',harness_instance_id='local-opencode',harness_type='opencode',model_id='fixture/model',agent_variant_id='build',default_reasoning_effort='high' WHERE persona_id='persona-architect'`;
  } finally {
    await sql.end();
  }
}

async function createRun(coreUrl: string, text: string) {
  const response = await fetch(`${coreUrl}/api/v1/rooms/${roomId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, targets: ['architect'] }),
  });
  expect(response.status, await response.clone().text()).toBe(202);
  const body = await response.json() as { runIds: string[] };
  return body.runIds[0]!;
}

async function cancelRun(coreUrl: string, runId: string) {
  const response = await fetch(`${coreUrl}/api/v1/runs/${runId}/cancel`, { method: 'POST' });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'stopping' });
}

async function waitForRun(coreUrl: string, runId: string, predicate: (run: TimelineRun) => boolean) {
  const deadline = Date.now() + 8_000;
  let latest: TimelineRun | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${coreUrl}/api/v1/rooms/${roomId}/timeline`);
    expect(response.status).toBe(200);
    const timeline = await response.json() as { runs: TimelineRun[] };
    latest = timeline.runs.find(run => run.id === runId);
    if (latest && predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${runId}; latest=${JSON.stringify(latest)}`);
}

async function expectSingleTerminal(databaseUrl: string, runIds: string[]) {
  const sql = connectTestDatabase(databaseUrl);
  try {
    for (const runId of runIds) {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int count FROM room_events
        WHERE type='run.status' AND payload->>'runId'=${runId}
          AND payload->>'status'=ANY(${['completed', 'failed', 'cancelled']})
      `;
      expect(count, `terminal event count for ${runId}`).toBe(1);
    }
  } finally {
    await sql.end();
  }
}

async function listen(app: FastifyInstance) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function e2eDatabaseUrl() {
  const url = new URL(process.env.AGENVYL_E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? process.env.AGENVYL_DATABASE_URL ?? 'postgres://hermes_group_chat:hermes_group_chat@127.0.0.1:8793/hermes_group_chat');
  const schema = `agenvyl_e2e_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  return { url: url.toString(), schema };
}

async function dropSchema(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl); url.searchParams.delete('schema');
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try { await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`; } finally { await sql.end(); }
}

type FixtureSession = { id: string; status: 'busy' | 'idle'; queue: AsyncEventQueue; subscribed: boolean; scenario?: string };

class OpenCodeFixture {
  readonly app = Fastify({ logger: false });
  readonly abortedSessionIds: string[] = [];
  readonly createdSessionIds: string[] = [];
  readonly permissionReplies: Array<{ requestId: string; reply: string }> = [];
  readonly questionReplies: Array<{ requestId: string; answers: string[][] }> = [];
  readonly promptVariants: Array<string | null> = [];
  private readonly sessions = new Map<string, FixtureSession>();
  private readonly scenarioAttempts = new Map<string, number>();
  private sequence = 0;

  get abortCount() { return this.abortedSessionIds.length; }

  constructor() {
    this.app.get('/v1/models', async () => ({ object: 'list', data: [{ id: 'fixture/model', root: 'Fixture Model' }] }));
    this.app.get('/provider', async () => ({
      all: [{ id: 'fixture', name: 'Fixture', models: { model: { id: 'model', name: 'Fixture Model', variants: { high: { reasoningEffort: 'high' } } } } }],
      default: { fixture: 'model' }, connected: ['fixture'],
    }));
    this.app.get('/agent', async () => [{ name: 'build', description: 'Fixture build agent', mode: 'primary' }]);
    this.app.get('/session/status', async () => Object.fromEntries([...this.sessions].map(([id, session]) => [id, { type: session.status }])));
    this.app.post<{ Querystring: { directory?: string }; Body: { title?: string } }>('/session', async (request) => {
      const id = `fixture-session-${++this.sequence}`;
      this.sessions.set(id, { id, status: 'idle', queue: new AsyncEventQueue(), subscribed: false });
      this.createdSessionIds.push(id);
      return { id, projectID: 'fixture-project', directory: request.query.directory ?? '/', title: request.body?.title ?? id, version: '1', time: { created: Date.now(), updated: Date.now() } };
    });
    this.app.get('/event', async (_request, reply) => {
      const session = [...this.sessions.values()].find(candidate => !candidate.subscribed);
      if (!session) return reply.code(409).send({ error: 'no_session' });
      session.subscribed = true;
      return reply.header('content-type', 'text/event-stream; charset=utf-8').header('cache-control', 'no-cache').send(Readable.from(session.queue));
    });
    this.app.post<{ Params: { id: string }; Body: { parts?: Array<{ type?: string; text?: string }>; variant?: string } }>('/session/:id/prompt_async', async (request, reply) => {
      const session = this.sessions.get(request.params.id);
      if (!session) return reply.code(404).send({ error: 'not_found' });
      this.promptVariants.push(request.body?.variant ?? null);
      session.status = 'busy';
      const text = request.body?.parts?.find(part => part.type === 'text')?.text ?? '';
      session.scenario = text;
      const attempt = (this.scenarioAttempts.get(text) ?? 0) + 1;
      this.scenarioAttempts.set(text, attempt);
      if (text.includes('restart-approval')) {
        pushPart(session,'text','before-restart ');
        session.queue.push(toolEvent(session.id, 'pending'));
        session.queue.push(toolEvent(session.id, 'running'));
        session.queue.push({ type: 'permission.asked', properties: { id: `permission-${session.id}`, sessionID: session.id, permission: 'bash', patterns: ['printf restart'], metadata: {}, always: [] } });
      } else if (text.includes('cancel-approval')) {
        session.queue.push({ type: 'permission.asked', properties: { id: `permission-${session.id}`, sessionID: session.id, permission: 'bash', patterns: ['sleep 60'], metadata: {}, always: [] } });
      } else if (text.includes('[opencode:clarification]')) {
        session.queue.push({ type: 'question.asked', properties: { id: `question-${session.id}`, sessionID: session.id, questions: [{ question: 'Which image format?', header: 'Format', options: [{ label: 'PNG', description: 'Raster' }, { label: 'SVG', description: 'Vector' }], custom: true }] } });
      } else if (text.includes('[opencode:retry]')) {
        const delta = attempt === 1 ? 'retry-first-attempt' : 'retry-completed';
        pushPart(session,'text',delta);
        if (attempt > 1) { session.status = 'idle'; session.queue.push({ type: 'session.idle', properties: { sessionID: session.id } }); }
      } else if (text.includes('[opencode:reasoning]')) {
        session.queue.push({type:'message.updated',properties:{info:{id:`assistant-${session.id}`,sessionID:session.id,role:'assistant',tokens:{total:155,input:120,output:30,reasoning:5,cache:{read:40,write:2}}}}});
        pushPart(session,'reasoning','private analysis');
        pushPart(session,'text','public answer');
        session.status='idle';
        session.queue.push({type:'session.idle',properties:{sessionID:session.id}});
      } else {
        const delta = text.includes('timeout') ? 'timeout-started' : 'cancel-started';
        pushPart(session,'text',delta);
      }
      return reply.code(204).send();
    });
    this.app.post<{ Params: { requestId: string }; Body: { reply?: string } }>('/permission/:requestId/reply', async (request) => {
      this.permissionReplies.push({ requestId: request.params.requestId, reply: request.body?.reply ?? '' });
      const session = [...this.sessions.values()].find(candidate => `permission-${candidate.id}` === request.params.requestId);
      if (!session) return false;
      session.queue.push(toolEvent(session.id, 'completed'));
      pushPart(session,'text','after-restart');
      session.status = 'idle';
      session.queue.push({ type: 'session.idle', properties: { sessionID: session.id } });
      return true;
    });
    this.app.post<{ Params: { requestId: string }; Body: { answers?: string[][] } }>('/question/:requestId/reply', async (request) => {
      this.questionReplies.push({ requestId: request.params.requestId, answers: request.body?.answers ?? [] });
      const session = [...this.sessions.values()].find(candidate => `question-${candidate.id}` === request.params.requestId);
      if (!session) return false;
      pushPart(session,'text','clarification-answer-received');
      session.status = 'idle';
      session.queue.push({ type: 'session.idle', properties: { sessionID: session.id } });
      return true;
    });
    this.app.post<{ Params: { id: string } }>('/session/:id/abort', async (request, reply) => {
      const session = this.sessions.get(request.params.id);
      if (!session) return reply.code(404).send({ error: 'not_found' });
      this.abortedSessionIds.push(session.id);
      session.status = 'idle';
      session.queue.close();
      return true;
    });
  }
}

function toolEvent(sessionId: string, status: 'pending' | 'running' | 'completed') {
  return { type: 'message.part.updated', properties: { sessionID: sessionId, part: { type: 'tool', callID: 'restart-tool', tool: 'bash', state: { status, title: `bash ${status}` } } } };
}

function pushPart(session:FixtureSession,type:'text'|'reasoning',delta:string) {
  const partID=`${type}-part`;
  session.queue.push({type:'message.part.updated',properties:{sessionID:session.id,part:{id:partID,type}}});
  session.queue.push({type:'message.part.delta',properties:{sessionID:session.id,partID,field:'text',delta}});
}

class AsyncEventQueue implements AsyncIterable<string> {
  private readonly values: string[] = [];
  private readonly waiters: Array<(value: IteratorResult<string>) => void> = [];
  private ended = false;

  push(event: unknown) {
    if (this.ended) throw new Error('Cannot append to a closed fixture stream');
    const value = `data: ${JSON.stringify(event)}\n\n`, waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false }); else this.values.push(value);
  }

  close() {
    if (this.ended) return;
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
