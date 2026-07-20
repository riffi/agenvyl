import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { HermesConnectorAdapter } from '../../../connector/src/adapters/hermes/adapter.js';
import { buildConnectorApp } from '../../../connector/src/app.js';
import type { ConnectorConfig } from '../../../connector/src/config.js';
import { buildApp } from '../app/buildApp.js';

const hermesUrl = requiredEnvironment('AGENVYL_CONNECTOR_HERMES_URL');
const hermesToken = requiredEnvironment('AGENVYL_CONNECTOR_HERMES_TOKEN');
const connectorToken = 'agenvyl-live-smoke-connector-token';
const roomId = 'demo-room';
const modelId = process.env.AGENVYL_LIVE_HERMES_MODEL?.trim() || 'sol';

describe.sequential('Core -> Connector -> installed Hermes live smoke', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('covers catalog, text, workspace tool, approval and stop with a real model', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'agenvyl-hermes-live-'));
    cleanups.push(() => rm(workspaceRoot, { recursive: true, force: true }));

    const database = liveDatabaseUrl();
    cleanups.push(() => dropSchema(database.url, database.schema));

    const connectorConfig: ConnectorConfig = {
      version: 1,
      listen: { host: '127.0.0.1', port: 0 },
      workspaces: { roots: [workspaceRoot] },
      instances: [{ id: 'local-hermes', type: 'hermes', enabled: true }],
      token: connectorToken,
    };
    const connector = buildConnectorApp(connectorConfig, {
      logger: false,
      connectorEpoch: `hermes-live-${randomUUID()}`,
      adapters: new Map([
        ['local-hermes', new HermesConnectorAdapter({ baseUrl: hermesUrl, token: hermesToken })],
      ]),
    });
    const connectorUrl = await listen(connector);
    cleanups.push(() => connector.close());

    const core = await buildApp({
      databaseUrl: database.url,
      connectorUrl,
      connectorToken,
      workspaceRoot,
      workspaceAgentRoot: workspaceRoot,
      distPath: 'missing-live-smoke-dist',
      shutdownTimeoutMs: 5_000,
      logger: false,
    });
    const coreUrl = await listen(core);
    cleanups.push(() => core.close());

    const catalog = await getJson(`${coreUrl}/api/v1/harnesses`) as HarnessCatalog;
    const hermes = catalog.instances.find(instance => instance.id === 'local-hermes');
    expect(hermes).toMatchObject({ type: 'hermes', status: 'healthy' });
    expect(hermes?.models.some(model => model.id === modelId)).toBe(true);
    report('catalog');

    const textRunId = await createRun(coreUrl, 'Reply with exactly LIVE_SMOKE_OK and do not use tools.');
    const textRun = await waitForRun(coreUrl, textRunId, run => terminalStatuses.has(run.status));
    expect(textRun.status, safeFailure(textRun)).toBe('completed');
    expect(textRun.text).toContain('LIVE_SMOKE_OK');
    expect(textRun.usage).toMatchObject({inputTokens:expect.any(Number),outputTokens:expect.any(Number),totalTokens:expect.any(Number)});
    report('text run');

    const artifactName = '.agenvyl-live-smoke';
    const toolRunId = await createRun(
      coreUrl,
      `Create a file named ${artifactName} in the execution working directory with exactly one line: workspace-ok. `
        + 'Use one filesystem tool. After the file is written, reply with exactly WORKSPACE_SMOKE_OK.',
    );
    const toolRun = await waitForRun(coreUrl, toolRunId, run => terminalStatuses.has(run.status));
    expect(toolRun.status, safeFailure(toolRun)).toBe('completed');
    expect(toolRun.text).toContain('WORKSPACE_SMOKE_OK');
    expect(toolRun.tools.length).toBeGreaterThan(0);
    const artifactPath = join(workspaceRoot, roomId, artifactName);
    await access(artifactPath);
    expect(await readFile(artifactPath, 'utf8')).toBe('workspace-ok\n');
    report('workspace tool');

    const approvalRunId = await createRun(
      coreUrl,
      "Use the terminal to run exactly: bash -c 'printf approval-smoke'. Do not use another tool or command. "
        + 'If approval is requested, wait for it. After the command succeeds, reply with exactly APPROVAL_SMOKE_OK.',
    );
    const waiting = await waitForRun(coreUrl, approvalRunId, run => run.status === 'waiting_approval' || terminalStatuses.has(run.status));
    expect(waiting.status, `Hermes did not request approval; ${safeFailure(waiting)}`).toBe('waiting_approval');
    expect(waiting.request).toMatchObject({ kind: 'approval' });
    const approval = await fetch(`${coreUrl}/api/v1/runs/${approvalRunId}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'approved' }),
    });
    expect(approval.status, await safeResponse(approval)).toBe(200);
    const approvalRun = await waitForRun(coreUrl, approvalRunId, run => terminalStatuses.has(run.status));
    expect(approvalRun.status, safeFailure(approvalRun)).toBe('completed');
    expect(approvalRun.text).toContain('APPROVAL_SMOKE_OK');
    report('approval');

    const stoppedRunId = await createRun(
      coreUrl,
      'Use the terminal to run exactly: sleep 60. If approval is requested, wait for it. Do not answer before it finishes.',
    );
    await waitForRun(coreUrl, stoppedRunId, run => run.status === 'waiting_approval' || run.status === 'streaming');
    const cancellation = await fetch(`${coreUrl}/api/v1/runs/${stoppedRunId}/cancel`, { method: 'POST' });
    expect(cancellation.status, await safeResponse(cancellation)).toBe(200);
    const stoppedRun = await waitForRun(coreUrl, stoppedRunId, run => terminalStatuses.has(run.status));
    expect(stoppedRun.status, safeFailure(stoppedRun)).toBe('cancelled');
    report('stop');
  }, 180_000);

  it('enforces the Core deadline through Connector on a real long-running command',async()=>{
    const workspaceRoot=await mkdtemp(join(tmpdir(),'agenvyl-hermes-live-timeout-'));cleanups.push(()=>rm(workspaceRoot,{recursive:true,force:true}));
    const database=liveDatabaseUrl();cleanups.push(()=>dropSchema(database.url,database.schema));
    const connector=buildConnectorApp({version:1,listen:{host:'127.0.0.1',port:0},workspaces:{roots:[workspaceRoot]},instances:[{id:'local-hermes',type:'hermes',enabled:true}],token:connectorToken},{logger:false,connectorEpoch:`hermes-live-timeout-${randomUUID()}`,adapters:new Map([['local-hermes',new HermesConnectorAdapter({baseUrl:hermesUrl,token:hermesToken})]])});
    const connectorUrl=await listen(connector);cleanups.push(()=>connector.close());
    const core=await buildApp({databaseUrl:database.url,connectorUrl,connectorToken,workspaceRoot,workspaceAgentRoot:workspaceRoot,runTimeoutMs:2_500,distPath:'missing-live-smoke-dist',shutdownTimeoutMs:5_000,logger:false});
    const coreUrl=await listen(core);cleanups.push(()=>core.close());
    const runId=await createRun(coreUrl,"Use the terminal to run exactly: sleep 60. Do not answer before it finishes.");
    const timedOut=await waitForRun(coreUrl,runId,run=>terminalStatuses.has(run.status));
    expect(timedOut.status,safeFailure(timedOut)).toBe('failed');expect(timedOut.errorCode).toBe('run_timeout');
    const sql=connectLiveDatabase(database.url);try{const[row]=await sql`SELECT error_code,execution_deadline_at FROM agent_runs WHERE id=${runId}`;expect(row).toMatchObject({error_code:'run_timeout',execution_deadline_at:expect.any(Date)});}finally{await sql.end();}
    report('timeout');
  },60_000);
});

type HarnessCatalog = {
  instances: Array<{ id: string; type: string; status: string; models: Array<{ id: string }> }>;
};

type TimelineRun = {
  id: string;
  status: string;
  text: string;
  tools: Array<{ id: string; name: string; detail: string; status: string }>;
  request?: { kind: string; resolved?: string };
  usage?:{inputTokens:number;outputTokens:number;totalTokens?:number};
  error?: { code?: string; message?: string };
  errorCode?:string;
};

const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

async function createRun(coreUrl: string, text: string) {
  const response = await fetch(`${coreUrl}/api/v1/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, targets: ['architect'] }),
  });
  expect(response.status, await safeResponse(response)).toBe(202);
  const body = await response.json() as { runIds: string[] };
  expect(body.runIds).toHaveLength(1);
  return body.runIds[0]!;
}

async function waitForRun(coreUrl: string, runId: string, predicate: (run: TimelineRun) => boolean) {
  const deadline = Date.now() + 90_000;
  let latest: TimelineRun | undefined;
  while (Date.now() < deadline) {
    const timeline = await getJson(`${coreUrl}/api/v1/rooms/${roomId}/timeline`) as { runs: TimelineRun[] };
    latest = timeline.runs.find(run => run.id === runId);
    if (latest && predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for run ${runId}; status=${latest?.status ?? 'missing'}`);
}

async function listen(app: FastifyInstance) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function getJson(url: string) {
  const response = await fetch(url);
  expect(response.status, `${url}: ${await safeResponse(response)}`).toBe(200);
  return await response.json() as unknown;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the opt-in live Hermes smoke`);
  return value;
}

function liveDatabaseUrl() {
  const configured = process.env.AGENVYL_E2E_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? process.env.AGENVYL_DATABASE_URL;
  if (!configured) throw new Error('AGENVYL_E2E_DATABASE_URL is required for the opt-in live Hermes smoke');
  const url = new URL(configured);
  const schema = `agenvyl_live_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  return { url: url.toString(), schema };
}

function connectLiveDatabase(databaseUrl:string){const url=new URL(databaseUrl),schema=url.searchParams.get('schema');url.searchParams.delete('schema');if(schema)url.searchParams.set('options',`-csearch_path=${schema}`);return postgres(url.toString(),{max:1,onnotice:()=>{}});}

async function dropSchema(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);
  url.searchParams.delete('schema');
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try { await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`; } finally { await sql.end(); }
}

function safeFailure(run: TimelineRun) {
  return `status=${run.status}; error=${run.error?.code ?? 'none'}; tools=${run.tools.length}`;
}

async function safeResponse(response: Response) {
  const body = await response.clone().json().catch(() => undefined) as { error?: string; code?: string } | undefined;
  return JSON.stringify({ status: response.status, error: body?.error, code: body?.code });
}

function report(check: string) { console.info(`[live-smoke] ${check}: ok`); }
