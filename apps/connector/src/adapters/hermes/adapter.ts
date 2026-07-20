import { createHash } from 'node:crypto';
import type { ExecutionStatus } from '@agenvyl/connector-contract';
import type { AdapterExecution, AdapterStartExecutionRequest, ConnectorAdapter } from '../../adapter.js';
import { mapHermesEvent } from './events.js';
import { parseSse } from './parse-sse.js';

export type HermesAdapterOptions = { baseUrl: string; token?: string; request?: typeof fetch };

export class HermesConnectorAdapter implements ConnectorAdapter {
  readonly type = 'hermes';
  readonly capabilities: ConnectorAdapter['capabilities'] = ['model_catalog', 'text_streaming', 'tools', 'approvals', 'usage'];
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly request: typeof fetch;
  private readonly streams = new Map<string, AbortController>();
  private readonly pendingRequests = new Map<string, { upstreamId: string }>();
  private readonly requestCounters = new Map<string, number>();

  constructor(options: HermesAdapterOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token || undefined;
    this.request = options.request ?? fetch;
  }

  async catalog(){
    const response=await this.request(`${this.baseUrl}/v1/models`,{headers:this.headers()}),body=await safeJson(response);
    if(!response.ok)throw httpError('model catalog',response.status);
    if(!isRecord(body)||!Array.isArray(body.data))throw new Error('Hermes model catalog returned an invalid response');
    const models=body.data.map(item=>{if(!isRecord(item)||typeof item.id!=='string'||!item.id)throw new Error('Hermes model catalog returned an invalid response');return{id:item.id,...(typeof item.root==='string'&&item.root?{label:item.root}: {})};});
    return{models,modes:[]};
  }

  async start(request: AdapterStartExecutionRequest): Promise<AdapterExecution> {
    const response = await this.request(`${this.baseUrl}/v1/runs`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        input: request.input.message,
        session_id: sessionId(request.executionId),
        instructions: workspaceInstructions(request.input.systemPrompt, request.workspace.absolutePath),
        conversation_history: request.input.history,
        model: request.modelId,
      }),
    });
    const body = await safeJson(response);
    if (!response.ok) throw httpError('creation', response.status);
    const upstreamId = isRecord(body) && typeof body.run_id === 'string' && body.run_id ? body.run_id : undefined;
    if (!upstreamId) throw new Error('Hermes execution creation returned an invalid response');
    return { upstreamId };
  }

  async inspect(execution: AdapterExecution): Promise<{ status: ExecutionStatus }> {
    const response = await this.request(this.runUrl(execution.upstreamId), { headers: this.headers() });
    const body = await safeJson(response);
    if (!response.ok) throw httpError('inspection', response.status);
    if (!isRecord(body) || typeof body.status !== 'string') throw new Error('Hermes execution inspection returned an invalid response');
    return { status: normalizeStatus(body.status) };
  }

  async *events(execution: AdapterExecution) {
    const controller = new AbortController();
    this.streams.get(execution.upstreamId)?.abort();
    this.streams.set(execution.upstreamId, controller);
    try {
      const response = await this.request(`${this.runUrl(execution.upstreamId)}/events`, { headers: this.headers(), signal: controller.signal });
      if (!response.ok || !response.body) throw httpError('event stream', response.status);
      for await (const item of parseSse(response.body)) {
        const mapped = mapHermesEvent(execution.upstreamId, item.event, item.data);
        if (!mapped) continue;
        if (mapped.kind === 'approval-request') {
          const requestId = this.nextRequestId(execution.upstreamId);
          this.pendingRequests.set(requestId, { upstreamId: execution.upstreamId });
          yield { type: 'request.opened' as const, payload: { request: { id: requestId, kind: 'approval' as const, prompt: mapped.prompt, choices: mapped.choices } } };
          continue;
        }
        if (mapped.kind === 'unsupported-interaction') {
          try { await this.stopUpstream(execution.upstreamId); } catch { /* preserve the stable interaction error */ }
          yield { type: 'execution.failed' as const, payload: { error: { code: 'unsupported_interaction', message: 'Hermes requested an interaction that this Connector version does not support' } } };
          return;
        }
        if(mapped.before)yield mapped.before;
        yield mapped.event;
        if (mapped.event.type.startsWith('execution.')) {
          this.clearPending(execution.upstreamId);
          return;
        }
      }
    } catch (error) {
      if (controller.signal.aborted && isAbortError(error)) return;
      throw error;
    } finally {
      if (this.streams.get(execution.upstreamId) === controller) this.streams.delete(execution.upstreamId);
    }
  }

  async stop(execution: AdapterExecution): Promise<void> {
    await this.stopUpstream(execution.upstreamId);
    this.streams.get(execution.upstreamId)?.abort();
    this.clearPending(execution.upstreamId);
  }

  async resolveRequest(execution: AdapterExecution, request: import('@agenvyl/connector-contract').ConnectorRequestSnapshot, resolution: string) {
    const pending = this.pendingRequests.get(request.id);
    if (!pending || pending.upstreamId !== execution.upstreamId || request.kind !== 'approval') throw new Error('Hermes approval request is not pending');
    const choice = normalizeApprovalChoice(resolution);
    if (request.choices?.length && !request.choices.includes(choice)) throw new Error('Hermes approval resolution is not an offered choice');
    const response = await this.request(`${this.runUrl(execution.upstreamId)}/approval`, {
      method: 'POST', headers: this.headers(true), body: JSON.stringify({ choice }),
    });
    if (!response.ok) throw httpError('approval', response.status);
    this.pendingRequests.delete(request.id);
    return { outcome: choice === 'deny' ? 'declined' as const : 'answered' as const };
  }

  private async stopUpstream(upstreamId: string) {
    const response = await this.request(`${this.runUrl(upstreamId)}/stop`, { method: 'POST', headers: this.headers() });
    if (!response.ok) throw httpError('stop', response.status);
  }

  private runUrl(upstreamId: string) { return `${this.baseUrl}/v1/runs/${encodeURIComponent(upstreamId)}`; }
  private nextRequestId(upstreamId: string) {
    const sequence = (this.requestCounters.get(upstreamId) ?? 0) + 1;
    this.requestCounters.set(upstreamId, sequence);
    return `req-${createHash('sha256').update(`${upstreamId}:approval:${sequence}`).digest('hex').slice(0, 32)}`;
  }
  private clearPending(upstreamId: string) {
    for (const [requestId, request] of this.pendingRequests) if (request.upstreamId === upstreamId) this.pendingRequests.delete(requestId);
    this.requestCounters.delete(upstreamId);
  }
  private headers(json = false) {
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(this.token ? { authorization: `Bearer ${this.token}`, 'x-api-key': this.token } : {}),
    };
  }
}

function normalizeBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('AGENVYL_CONNECTOR_HERMES_URL must be a valid URL'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new Error('AGENVYL_CONNECTOR_HERMES_URL must be an HTTP URL without credentials, query, or fragment');
  }
  return url.toString().replace(/\/$/, '');
}

function sessionId(executionId: string) {
  return `gc-${createHash('sha256').update(executionId).digest('hex').slice(0, 48)}`;
}

function workspaceInstructions(systemPrompt: string, absolutePath: string) {
  const workspace = `Use ${absolutePath} as the working directory for this execution. Do not access files outside this directory.`;
  return systemPrompt.trim() ? `${systemPrompt}\n\n${workspace}` : workspace;
}

function normalizeApprovalChoice(resolution: string) {
  const normalized = resolution.trim().toLowerCase();
  if (normalized === 'approve' || normalized === 'approved' || normalized === 'allow') return 'once';
  if (normalized === 'decline' || normalized === 'declined' || normalized === 'denied') return 'deny';
  if (normalized === 'once' || normalized === 'session' || normalized === 'always' || normalized === 'deny') return normalized;
  throw new Error('Hermes approval resolution is invalid');
}

function normalizeStatus(status: string): ExecutionStatus {
  switch (status) {
    case 'queued': return 'queued';
    case 'running': case 'started': return 'running';
    case 'waiting_for_approval': case 'waiting_for_user': return 'waiting_for_user';
    case 'stopping': return 'stopping';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': case 'canceled': return 'cancelled';
    default: throw new Error('Hermes execution inspection returned an unsupported status');
  }
}

function httpError(action: string, status: number) { return new Error(`Hermes execution ${action} failed with HTTP ${status}`); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isAbortError(error: unknown) { return error instanceof Error && error.name === 'AbortError'; }
async function safeJson(response: Response): Promise<unknown> { try { return await response.json() as unknown; } catch { return undefined; } }
