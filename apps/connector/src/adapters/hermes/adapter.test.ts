import { describe, expect, it } from 'vitest';
import type { AdapterStartExecutionRequest } from '../../adapter.js';
import { HermesConnectorAdapter } from './adapter.js';

describe('HermesConnectorAdapter', () => {
  it('advertises and normalizes the Hermes model catalog',async()=>{
    const mock=fetchMock([jsonResponse({object:'list',data:[{id:'sol',root:'anthropic/claude-sonnet-4'},{id:'local'}]})]),adapter=new HermesConnectorAdapter({baseUrl:'http://localhost:8642',request:mock.request});
    expect(adapter.capabilities).toContain('model_catalog');
    await expect(adapter.catalog()).resolves.toEqual({models:[{id:'sol',label:'anthropic/claude-sonnet-4'},{id:'local'}],controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]}});
    expect(mock.calls[0]?.url).toBe('http://localhost:8642/v1/models');
  });

  it('creates a fresh Hermes run with the canonical workspace and env-only auth', async () => {
    const mock = fetchMock([jsonResponse({ run_id: 'upstream-1' })]);
    const adapter = new HermesConnectorAdapter({ baseUrl: 'http://127.0.0.1:8642/', token: 'secret', request: mock.request });
    await expect(adapter.start(startRequest())).resolves.toEqual({ upstreamId: 'upstream-1' });

    expect(mock.calls[0]?.url).toBe('http://127.0.0.1:8642/v1/runs');
    const init = mock.calls[0]?.init;
    expect(init?.headers).toMatchObject({ authorization: 'Bearer secret', 'x-api-key': 'secret' });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ input: 'Continue', model: 'sol', conversation_history: [{ role: 'user', content: 'Earlier' }] });
    expect(body.session_id).toMatch(/^gc-[a-f0-9]{48}$/);
    expect(body.instructions).toContain('Be useful.');
    expect(body.instructions).toContain('/srv/workspaces/room-1/subdir');
  });

  it('normalizes text, tool, and terminal events without exposing tool arguments', async () => {
    const stream = sse([
      { event: 'assistant.delta', delta: 'Hello' },
      { event: 'tool.started', tid: 'tool-1', name: 'read_file', preview: 'Reading file', args: { token: 'do-not-leak' } },
      { event: 'tool.completed', tid: 'tool-1', name: 'read_file', detail: 'Done' },
      { event: 'run.completed', usage:{input_tokens:120,output_tokens:30,total_tokens:150} },
    ]);
    const adapter = new HermesConnectorAdapter({ baseUrl: 'http://localhost:8642', request: fetchMock([new Response(stream, { status: 200 })]).request });
    const events = await collect(adapter.events({ upstreamId: 'upstream-1' }));
    expect(events).toEqual([
      { type: 'output.text.delta', payload: { text: 'Hello' } },
      { type: 'tool.started', payload: { toolId: 'tool-1', name: 'read_file', safeSummary: 'Reading file' } },
      { type: 'tool.completed', payload: { toolId: 'tool-1', name: 'read_file', safeSummary: 'Done' } },
      {type:'usage.updated',payload:{usage:{inputTokens:120,outputTokens:30,totalTokens:150}}},
      { type: 'execution.completed', payload: {} },
    ]);
    expect(JSON.stringify(events)).not.toContain('do-not-leak');
  });

  it('drops unknown raw vendor events instead of retaining their payload', async () => {
    const adapter = new HermesConnectorAdapter({
      baseUrl: 'http://localhost:8642',
      request: fetchMock([new Response(sse([{ event: 'run.retrying', reason: 'raw-vendor-reason', payload: { token: 'raw-secret' } }, { event: 'run.completed' }]), { status: 200 })]).request,
    });
    const events = await collect(adapter.events({ upstreamId: 'upstream-1' }));
    expect(events).toEqual([{ type: 'execution.completed', payload: {} }]);
    expect(JSON.stringify(events)).not.toContain('raw-secret');
  });

  it('inspects status and stops an upstream execution', async () => {
    const mock = fetchMock([jsonResponse({ status: 'waiting_for_approval' }), jsonResponse({ ok: true })]);
    const adapter = new HermesConnectorAdapter({ baseUrl: 'http://localhost:8642', request: mock.request });
    await expect(adapter.inspect({ upstreamId: 'run/one' })).resolves.toEqual({ status: 'waiting_for_user' });
    await adapter.stop({ upstreamId: 'run/one' });
    expect(mock.calls.map(call => [call.url, call.init?.method])).toEqual([
      ['http://localhost:8642/v1/runs/run%2Fone', undefined],
      ['http://localhost:8642/v1/runs/run%2Fone/stop', 'POST'],
    ]);
  });

  it('opens a stable approval request and resolves it through the Hermes endpoint', async () => {
    const mock = fetchMock([
      new Response(sse([{ event: 'approval.request', description: 'Run command?', command: 'secret command', choices: ['once', 'always', 'deny'] }]), { status: 200 }),
      jsonResponse({ resolved: 1 }),
    ]);
    const adapter = new HermesConnectorAdapter({ baseUrl: 'http://localhost:8642', request: mock.request });
    const events = await collect(adapter.events({ upstreamId: 'upstream-1' }));
    expect(events).toEqual([
      { type: 'request.opened', payload: { request: { id: expect.stringMatching(/^req-[a-f0-9]{32}$/), kind: 'approval', prompt: 'Run command?', choices: ['once', 'always', 'deny'] } } },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret command');
    const opened = events[0];
    if (opened?.type !== 'request.opened') throw new Error('Expected approval request');
    await expect(adapter.resolveRequest({ upstreamId: 'upstream-1' }, opened.payload.request, 'once')).resolves.toEqual({ outcome: 'answered' });
    expect(mock.calls[1]).toMatchObject({ url: 'http://localhost:8642/v1/runs/upstream-1/approval', init: { method: 'POST', body: '{"choice":"once"}' } });
  });

  it('fails closed and stops Hermes when an unsupported clarification appears', async () => {
    const mock = fetchMock([new Response(sse([{ event: 'clarification.request', prompt: 'Which file?' }]), { status: 200 }), jsonResponse({ ok: true })]);
    const adapter = new HermesConnectorAdapter({ baseUrl: 'http://localhost:8642', request: mock.request });
    await expect(collect(adapter.events({ upstreamId: 'upstream-1' }))).resolves.toEqual([
      { type: 'execution.failed', payload: { error: { code: 'unsupported_interaction', message: 'Hermes requested an interaction that this Connector version does not support' } } },
    ]);
    expect(mock.calls[1]).toMatchObject({ url: 'http://localhost:8642/v1/runs/upstream-1/stop', init: { method: 'POST' } });
  });

  it('rejects unsafe endpoint URLs without echoing credentials', () => {
    expect(() => new HermesConnectorAdapter({ baseUrl: 'http://user:password@localhost:8642' })).toThrow('without credentials');
  });
});

function startRequest(): AdapterStartExecutionRequest {
  return {
    executionId: 'execution-1', harnessInstanceId: 'local-hermes', modelId: 'sol', executionProfile:{workflowMode:'work',reasoningEffort:null,permissionProfileId:null,agentVariantId:null,planEnforcement:null},
    workspace: { roomId: 'room-1', relativePath: 'subdir', absolutePath: '/srv/workspaces/room-1/subdir' },
    input: { systemPrompt: 'Be useful.', history: [{ role: 'user', content: 'Earlier' }], message: 'Continue' },
  };
}

function fetchMock(responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fetch');
    return response;
  }) as typeof fetch;
  return { calls, request };
}

function jsonResponse(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
function sse(events: Array<Record<string, unknown>>) {
  const source = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(source)); controller.close(); } });
}
async function collect<T>(source: AsyncIterable<T>) { const values: T[] = []; for await (const value of source) values.push(value); return values; }
