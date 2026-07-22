import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { AntigravityConnectorAdapter } from '../../../connector/src/adapters/antigravity/adapter.js';
import { buildConnectorApp } from '../../../connector/src/app.js';
import type { ConnectorConfig } from '../../../connector/src/config.js';
import { buildApp } from '../app/buildApp.js';

const command = process.env.AGENVYL_CONNECTOR_AGY_COMMAND?.trim() || 'agy';
const connectorToken = 'agenvyl-antigravity-live-connector-token';
const roomId = 'demo-room';

describe.sequential('Core -> Connector -> installed Antigravity live smoke', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

  it('covers catalog, plan text, accept-edits workspace mutation and cancel', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'agenvyl-antigravity-live-'));
    cleanups.push(() => rm(workspaceRoot, { recursive: true, force: true }));
    const database = liveDatabaseUrl();
    cleanups.push(() => dropSchema(database.url, database.schema));
    const connectorConfig: ConnectorConfig = {
      version: 1,
      listen: { host: '127.0.0.1', port: 0 },
      workspaces: { roots: [workspaceRoot] },
      instances: [{ id: 'local-antigravity', type: 'antigravity', enabled: true }],
      token: connectorToken,
    };
    const adapter = new AntigravityConnectorAdapter({ command, env: process.env, printTimeoutMs: 10 * 60_000 });
    const connector = buildConnectorApp(connectorConfig, { logger: false, connectorEpoch: `antigravity-live-${randomUUID()}`, adapters: new Map([['local-antigravity', adapter]]) });
    const connectorUrl = await listen(connector);
    cleanups.push(() => connector.close());
    const core = await buildApp({ databaseUrl: database.url, connectorUrl, connectorToken, workspaceRoot, workspaceAgentRoot: workspaceRoot, distPath: 'missing-live-smoke-dist', shutdownTimeoutMs: 5_000, logger: false });
    const coreUrl = await listen(core);
    cleanups.push(() => core.close());

    const catalog = await getJson(`${coreUrl}/api/v1/harnesses`) as HarnessCatalog;
    const instance = catalog.instances.find(item => item.id === 'local-antigravity');
    expect(instance).toMatchObject({ type: 'antigravity', status: 'healthy', capabilities: ['model_catalog', 'execution_profiles'] });
    const modelId = process.env.AGENVYL_LIVE_AGY_MODEL?.trim() || instance?.models[0]?.id;
    if (!modelId) throw new Error('Antigravity live catalog returned no selectable model');

    await selectPersona(coreUrl, modelId, 'plan');await selectWorkflow(coreUrl,'plan');
    const textRunId = await createRun(coreUrl, 'Do not use tools. Reply with exactly AGENVYL_AGY_OK and nothing else.');
    const textRun = await waitForRun(coreUrl, textRunId, run => terminalStatuses.has(run.status));
    expect(textRun.status, safeFailure(textRun)).toBe('completed');
    expect(textRun.text).toContain('AGENVYL_AGY_OK');
    expect(textRun).toMatchObject({ harnessInstanceId: 'local-antigravity', harnessType: 'antigravity', modelId, executionProfile:{workflowMode:'plan'} });

    await selectPersona(coreUrl, modelId, 'accept-edits');await selectWorkflow(coreUrl,'work');
    const artifactName = '.agenvyl-agy-live-smoke';
    const editRunId = await createRun(coreUrl, `Create ${artifactName} in the current working directory containing exactly one line: agy-workspace-ok. Then reply with exactly AGENVYL_AGY_EDIT_OK.`);
    const editRun = await waitForRun(coreUrl, editRunId, run => terminalStatuses.has(run.status));
    expect(editRun.status, safeFailure(editRun)).toBe('completed');
    expect(editRun.text).toContain('AGENVYL_AGY_EDIT_OK');
    const artifactPath = join(workspaceRoot, roomId, artifactName);
    await access(artifactPath);
    expect(await readFile(artifactPath, 'utf8')).toBe('agy-workspace-ok\n');

    const stoppedRunId = await createRun(coreUrl, 'Run the terminal command sleep 60 and do not answer before it finishes.');
    await waitForRun(coreUrl, stoppedRunId, run => run.status === 'streaming' || terminalStatuses.has(run.status));
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const cancellation = await fetch(`${coreUrl}/api/v1/runs/${stoppedRunId}/cancel`, { method: 'POST' });
    expect(cancellation.status, await safeResponse(cancellation)).toBe(200);
    const stoppedRun = await waitForRun(coreUrl, stoppedRunId, run => terminalStatuses.has(run.status));
    expect(stoppedRun.status, safeFailure(stoppedRun)).toBe('cancelled');
  }, 360_000);
});

type HarnessCatalog = { instances: Array<{ id: string; type: string; status: string; capabilities: string[]; models: Array<{ id: string }> }> };
type TimelineRun = { id: string; status: string; text: string; harnessInstanceId?: string; harnessType?: string; modelId?: string; executionProfile?:{workflowMode:string}; error?: { code?: string; message?: string }; errorCode?: string };
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

async function selectPersona(coreUrl: string, modelId: string, permissionProfileId: string) {
  const response = await fetch(`${coreUrl}/api/v1/personas/persona-architect`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ harness_instance_id: 'local-antigravity', model_id: modelId, permission_profile_id: permissionProfileId }) });
  expect(response.status, await safeResponse(response)).toBe(200);
}
async function selectWorkflow(coreUrl:string,workflow_mode:'plan'|'work'){const response=await fetch(`${coreUrl}/api/v1/rooms/${roomId}/execution-profile`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({workflow_mode})});expect(response.status,await safeResponse(response)).toBe(200);}

async function createRun(coreUrl: string, text: string) {
  const response = await fetch(`${coreUrl}/api/v1/rooms/${roomId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, targets: ['architect'] }) });
  expect(response.status, await safeResponse(response)).toBe(202);
  const body = await response.json() as { runIds: string[] };
  expect(body.runIds).toHaveLength(1);
  return body.runIds[0]!;
}

async function waitForRun(coreUrl: string, runId: string, predicate: (run: TimelineRun) => boolean) {
  const deadline = Date.now() + 180_000;
  let latest: TimelineRun | undefined;
  while (Date.now() < deadline) {
    const timeline = await getJson(`${coreUrl}/api/v1/rooms/${roomId}/timeline`) as { runs: TimelineRun[] };
    latest = timeline.runs.find(run => run.id === runId);
    if (latest && predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Antigravity run ${runId}; status=${latest?.status ?? 'missing'}`);
}

async function listen(app: FastifyInstance) { await app.listen({ host: '127.0.0.1', port: 0 }); return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`; }
async function getJson(url: string) { const response = await fetch(url); expect(response.status, `${url}: ${await safeResponse(response)}`).toBe(200); return await response.json() as unknown; }

function liveDatabaseUrl() {
  const configured = process.env.AGENVYL_E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? process.env.AGENVYL_DATABASE_URL;
  if (!configured) throw new Error('AGENVYL_E2E_DATABASE_URL is required for the opt-in live Antigravity smoke');
  const url = new URL(configured), schema = `agenvyl_agy_live_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  return { url: url.toString(), schema };
}

async function dropSchema(databaseUrl: string, schema: string) { const url = new URL(databaseUrl); url.searchParams.delete('schema'); const sql = postgres(url.toString(), { max: 1, onnotice: () => {} }); try { await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`; } finally { await sql.end(); } }
function safeFailure(run: TimelineRun) { return `status=${run.status}; error=${run.error?.code ?? run.errorCode ?? 'none'}`; }
async function safeResponse(response: Response) { const body = await response.clone().json().catch(() => undefined) as { error?: string; code?: string } | undefined; return JSON.stringify({ status: response.status, error: body?.error, code: body?.code }); }
