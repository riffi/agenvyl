import { describe, expect, it, vi } from 'vitest';
import type { AdapterStartExecutionRequest } from '../../adapter.js';
import { OpenCodeConnectorAdapter, type OpenCodeClientPort } from './adapter.js';

describe('OpenCodeConnectorAdapter', () => {
  it('advertises connected models and primary modes from the native SDK', async () => {
    const client = fixtureClient();
    client.providers = vi.fn().mockResolvedValue({
      connected: ['anthropic'],
      all: [
        { id: 'anthropic', name: 'Anthropic', models: { sonnet: { id: 'claude-sonnet', name: 'Claude Sonnet', variants: { max: { thinking: { budgetTokens: 32000 } }, high: { thinking: { budgetTokens: 16000 } }, disabled: { disabled: true }, malformed: null } } } },
        { id: 'unavailable', name: 'Unavailable', models: { hidden: { id: 'hidden', name: 'Hidden' } } },
      ],
    });
    client.agents = vi.fn().mockResolvedValue([
      { name: 'build', description: 'Build mode', mode: 'primary' },
      { name: 'plan', mode: 'all' },
      { name: 'research', mode: 'subagent' },
      { name: 'hidden', mode: 'primary', hidden: true },
    ]);
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://127.0.0.1:4096', client, catalogDirectory: '/workspace/catalog' });

    expect(adapter.capabilities).toEqual(['model_catalog', 'execution_profiles', 'text_streaming', 'reasoning', 'tools', 'approvals', 'clarifications', 'usage']);
    await expect(adapter.catalog()).resolves.toEqual({
      models: [{ id: 'anthropic/claude-sonnet', label: 'Anthropic/Claude Sonnet', reasoningEfforts: ['high', 'max'] }],
      controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[],agentVariants:[{id:'build',label:'build'}]},
    });
    expect(client.providers).toHaveBeenCalledWith('/workspace/catalog');
    expect(client.agents).toHaveBeenCalledWith('/workspace/catalog');
  });

  it('subscribes before prompting a fresh session with isolated workspace and role-preserving context', async () => {
    const calls: string[] = [], client = fixtureClient(calls);
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });

    await expect(adapter.start(startRequest())).resolves.toEqual({ upstreamId: 'session-1' });

    expect(calls).toEqual(['create', 'subscribe', 'prompt']);
    expect(client.createSession).toHaveBeenCalledWith({
      directory: '/srv/workspaces/room-1/subdir',
      title: 'Agenvyl execution execution-1',
      agent: 'build',
      model: { id: 'claude-sonnet', providerID: 'anthropic' },
    });
    expect(client.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'session-1', directory: '/srv/workspaces/room-1/subdir', message: 'Continue', agent: 'build',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
      system: expect.stringContaining('Be useful.'),
    }));
    const system = vi.mocked(client.prompt).mock.calls[0]?.[0].system ?? '';
    expect(system).toContain('/srv/workspaces/room-1/subdir');
    expect(system).toContain('never stage them in /tmp');
    expect(system).toContain('Do not use sudo');
    expect(system).toContain(JSON.stringify(startRequest().input.history));
    expect(system).not.toContain('Continue');
    expect(system).not.toContain('tool named `question`');
  });

  it('passes a supported model variant as the per-run reasoning effort',async()=>{
    const client=fixtureClient();
    client.providers=vi.fn().mockResolvedValue({connected:['anthropic'],all:[{id:'anthropic',name:'Anthropic',models:{sonnet:{id:'claude-sonnet',name:'Claude Sonnet',variants:{high:{reasoningEffort:'high'}}}}}]});
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});

    await adapter.start({...startRequest(),executionProfile:{...startRequest().executionProfile,reasoningEffort:'high'}});

    expect(client.prompt).toHaveBeenCalledWith(expect.objectContaining({variant:'high'}));
  });

  it('rejects a model variant that the current catalog does not expose',async()=>{
    const client=fixtureClient();
    client.providers=vi.fn().mockResolvedValue({connected:['anthropic'],all:[{id:'anthropic',name:'Anthropic',models:{sonnet:{id:'claude-sonnet',name:'Claude Sonnet',variants:{high:{reasoningEffort:'high'}}}}}]});
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});

    await expect(adapter.start({...startRequest(),executionProfile:{...startRequest().executionProfile,reasoningEffort:'max'}})).rejects.toThrow('model variant is not supported');
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it('names the structured question tool and its interaction shape in native Plan',async()=>{
    const client=fixtureClient();client.agents=vi.fn().mockResolvedValue([{name:'build',mode:'primary'},{name:'plan',mode:'primary'}]);
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});

    await adapter.start({...startRequest(),executionProfile:{...startRequest().executionProfile,workflowMode:'plan',agentVariantId:null,planEnforcement:'native'}});

    expect(client.createSession).toHaveBeenCalledWith(expect.objectContaining({agent:'plan'}));
    const system=vi.mocked(client.prompt).mock.calls[0]?.[0].system??'';
    expect(system).toContain('tool named `question`');
    expect(system).toContain('MUST call `question` instead of printing unanswered questions');
    expect(system).toContain('all currently required questions in one tool call');
    expect(system).toContain('no more than four focused questions');
  });

  it('normalizes only matching text deltas and the terminal idle event', async () => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { id: 'reasoning-1', type: 'reasoning' } } },
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { id: 'text-1', type: 'text' } } },
      { type: 'message.part.delta', properties: { sessionID: 'other', partID: 'text-1', field: 'text', delta: 'ignore' } },
      { type: 'message.part.delta', properties: { sessionID: 'session-1', partID: 'unknown', field: 'text', delta: 'do-not-leak' } },
      { type: 'message.part.delta', properties: { sessionID: 'session-1', partID: 'reasoning-1', field: 'text', delta: 'private' } },
      { type: 'message.part.delta', properties: { sessionID: 'session-1', partID: 'text-1', field: 'text', delta: 'Hello' } },
      { type: 'vendor.raw', properties: { sessionID: 'session-1', token: 'do-not-leak' } },
      { type: 'session.status', properties: { sessionID: 'session-1', status: { type: 'idle' } } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());

    const normalized = await collect(adapter.events(execution));
    expect(normalized).toEqual([
      { type: 'output.reasoning.delta', payload: { text: 'private' } },
      { type: 'output.text.delta', payload: { text: 'Hello' } },
      { type: 'execution.completed', payload: {} },
    ]);
    expect(JSON.stringify(normalized)).not.toContain('do-not-leak');
  });

  it('aggregates exact assistant message usage and suppresses repeated updates',async()=>{
    const client=fixtureClient(),first={id:'assistant-1',sessionID:'session-1',role:'assistant',tokens:{input:10,output:3,reasoning:2,cache:{read:4,write:1}}};
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'message.updated',properties:{info:first}},
      {type:'message.updated',properties:{info:first}},
      {type:'message.updated',properties:{info:{...first,tokens:{input:12,output:5,reasoning:2,cache:{read:4,write:1}}}}},
      {type:'message.updated',properties:{info:{id:'assistant-2',sessionID:'session-1',role:'assistant',tokens:{total:11,input:8,output:2,reasoning:1,cache:{read:0,write:0}}}}},
      {type:'message.updated',properties:{info:{id:'user-1',sessionID:'session-1',role:'user'}}},
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),normalized=await collect(adapter.events(await adapter.start(startRequest())));
    expect(normalized).toEqual([
      {type:'usage.updated',payload:{usage:{inputTokens:10,outputTokens:3,reasoningTokens:2,cacheReadTokens:4,cacheWriteTokens:1}}},
      {type:'usage.updated',payload:{usage:{inputTokens:12,outputTokens:5,reasoningTokens:2,cacheReadTokens:4,cacheWriteTokens:1}}},
      {type:'usage.updated',payload:{usage:{inputTokens:20,outputTokens:7,reasoningTokens:3,cacheReadTokens:4,cacheWriteTokens:1}}},
      {type:'execution.completed',payload:{}},
    ]);
  });

  it('normalizes retry but does not treat busy as recovery before resumed model output', async () => {
    const client=fixtureClient(),next=Date.parse('2026-07-20T12:00:05.000Z');
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'text-1',type:'text'}}},
      {type:'session.status',properties:{sessionID:'session-1',status:{type:'retry',attempt:2,message:'429 rate limit token=vendor-secret /srv/private/body.json',next,action:{reason:'rate_limit',provider:'private-provider',title:'raw title',message:'raw body',label:'raw label',link:'https://private.example/path'}}}},
      {type:'session.status',properties:{sessionID:'session-1',status:{type:'busy'}}},
      {type:'message.part.delta',properties:{sessionID:'session-1',partID:'text-1',field:'text',delta:'Recovered'}},
      {type:'session.error',properties:{sessionID:'session-1',error:{responseBody:'do-not-leak'}}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest());
    const normalized=await collect(adapter.events(execution));
    expect(normalized).toEqual([
      {type:'execution.upstream_status',payload:{state:'retrying',reason:'rate_limited',retryable:true,attempt:2,retryAt:'2026-07-20T12:00:05.000Z'}},
      {type:'output.text.delta',payload:{text:'Recovered'}},
      {type:'execution.failed',payload:{error:{code:'opencode_execution_failed',message:'OpenCode execution failed'}}},
    ]);
    expect(JSON.stringify(normalized)).not.toContain('vendor-secret');
    expect(JSON.stringify(normalized)).not.toContain('private-provider');
    expect(JSON.stringify(normalized)).not.toContain('do-not-leak');
  });

  it('keeps repeated retries transient until one final session failure',async()=>{
    const client=fixtureClient();client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'session.status',properties:{sessionID:'session-1',status:{type:'retry',attempt:1,message:'Service Unavailable',next:Date.parse('2026-07-20T12:00:01.000Z')}}},
      {type:'session.status',properties:{sessionID:'session-1',status:{type:'retry',attempt:2,message:'Service Unavailable',next:Date.parse('2026-07-20T12:00:02.000Z')}}},
      {type:'session.error',properties:{sessionID:'session-1',error:{message:'raw final body'}}},
      {type:'session.error',properties:{sessionID:'session-1',error:{message:'late duplicate'}}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),normalized=await collect(adapter.events(await adapter.start(startRequest())));
    expect(normalized.filter(event=>event.type==='execution.upstream_status')).toHaveLength(2);
    expect(normalized.filter(event=>event.type==='execution.failed')).toHaveLength(1);
    expect(normalized.at(-1)).toEqual({type:'execution.failed',payload:{error:{code:'opencode_execution_failed',message:'OpenCode execution failed'}}});
    expect(JSON.stringify(normalized)).not.toContain('raw final body');
  });

  it('normalizes native tool states without exposing inputs, outputs, metadata, or errors', async () => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-1', tool: 'bash', state: { status: 'pending', input: { token: 'secret' }, raw: 'secret' } } } },
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-1', tool: 'bash', state: { status: 'running', title: 'Run /srv/private/script.sh', input: { token: 'secret' }, metadata: { token: 'secret' }, time: { start: 1 } } } } },
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-1', tool: 'bash', state: { status: 'completed', title: 'Command finished', input: { token: 'secret' }, output: 'secret output', metadata: { token: 'secret' }, time: { start: 1, end: 2 } } } } },
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-2', tool: 'edit', state: { status: 'error', input: { token: 'secret' }, error: 'secret failure', time: { start: 1, end: 2 } } } } },
      { type: 'session.idle', properties: { sessionID: 'session-1' } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());

    const normalized = await collect(adapter.events(execution));
    expect(normalized).toEqual([
      { type: 'tool.started', payload: { toolId: 'call-1', name: 'bash', safeSummary: 'Preparing bash' } },
      { type: 'tool.updated', payload: { toolId: 'call-1', name: 'bash', safeSummary: 'Run [ABSOLUTE_PATH]' } },
      { type: 'tool.completed', payload: { toolId: 'call-1', name: 'bash', safeSummary: 'Command finished' } },
      { type: 'tool.completed', payload: { toolId: 'call-2', name: 'edit', safeSummary: 'edit failed' } },
      { type: 'execution.completed', payload: {} },
    ]);
    expect(JSON.stringify(normalized)).not.toContain('secret');
  });

  it.each([
    ['permission.asked', 'legacy'],
    ['permission.v2.asked', 'v2'],
  ] as const)('opens a stable approval for %s and resolves it through the matching SDK endpoint', async (eventType, version) => {
    const client = fixtureClient();
    const properties = eventType === 'permission.asked'
      ? { id: 'native-request-1', sessionID: 'session-1', permission: 'bash', patterns: ['git status'], metadata: { token: 'secret' }, always: ['git status'] }
      : { id: 'native-request-1', sessionID: 'session-1', action: 'bash', resources: ['git status'], metadata: { token: 'secret' }, save: ['git status'] };
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: eventType, properties },
      { type: 'session.idle', properties: { sessionID: 'session-1' } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());
    const iterator = adapter.events(execution)[Symbol.asyncIterator]();

    const opened = await iterator.next();
    expect(opened.value).toEqual({
      type: 'request.opened',
      payload: { request: { id: expect.stringMatching(/^req-[a-f0-9]{32}$/), kind: 'approval', prompt: 'Allow OpenCode bash: git status?', choices: ['once', 'always', 'deny'] } },
    });
    if (!opened.value || opened.value.type !== 'request.opened') throw new Error('Expected approval request');
    await expect(adapter.resolveRequest(execution, opened.value.payload.request, 'once')).resolves.toEqual({ outcome: 'answered' });
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'session-1', requestID: 'native-request-1', directory: '/srv/workspaces/room-1/subdir', reply: 'once', version,
    });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: 'execution.completed', payload: {} } });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it.each([
    ['permission.asked', 'legacy'],
    ['permission.v2.asked', 'v2'],
  ] as const)('rejects %s external-directory access without opening a user approval', async (eventType, version) => {
    const client = fixtureClient();
    const properties = eventType === 'permission.asked'
      ? { id: 'native-request-1', sessionID: 'session-1', permission: 'external_directory', patterns: ['/tmp/file.jpg'], metadata: {}, always: [] }
      : { id: 'native-request-1', sessionID: 'session-1', action: 'external_directory', resources: ['/tmp/file.jpg'], metadata: {}, save: [] };
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: eventType, properties },
      { type: 'session.idle', properties: { sessionID: 'session-1' } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());

    await expect(collect(adapter.events(execution))).resolves.toEqual([
      { type: 'execution.completed', payload: {} },
    ]);
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'session-1', requestID: 'native-request-1', directory: '/srv/workspaces/room-1/subdir', reply: 'reject', version,
    });
  });

  it('maps denial to reject and refuses stale or foreign approval requests', async () => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: 'permission.asked', properties: { id: 'native-request-1', sessionID: 'session-1', permission: 'bash', patterns: [], metadata: {}, always: [] } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());
    const iterator = adapter.events(execution)[Symbol.asyncIterator]();
    const opened = await iterator.next();
    if (!opened.value || opened.value.type !== 'request.opened') throw new Error('Expected approval request');

    await expect(adapter.resolveRequest({ upstreamId: 'foreign' }, opened.value.payload.request, 'deny')).rejects.toThrow('not pending');
    await expect(adapter.resolveRequest(execution, opened.value.payload.request, 'deny')).resolves.toEqual({ outcome: 'declined' });
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({ reply: 'reject' }));
    await expect(adapter.resolveRequest(execution, opened.value.payload.request, 'deny')).rejects.toThrow('not pending');
    await iterator.return?.();
  });

  it('inspects active status and aborts the matching session on stop', async () => {
    const client = fixtureClient();
    client.sessionStatuses = vi.fn().mockResolvedValue({ 'session-1': { type: 'busy' } });
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());

    await expect(adapter.inspect(execution)).resolves.toEqual({ status: 'running' });
    await adapter.stop(execution);
    expect(client.sessionStatuses).toHaveBeenCalledWith('/srv/workspaces/room-1/subdir');
    expect(client.abortSession).toHaveBeenCalledWith('session-1', '/srv/workspaces/room-1/subdir');
  });

  it('clears a pending approval when stopping and still cleans local state if SDK abort fails', async () => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: 'permission.asked', properties: { id: 'native-request-1', sessionID: 'session-1', permission: 'bash', patterns: ['sleep 60'], metadata: {}, always: [] } },
    ]));
    client.abortSession = vi.fn().mockRejectedValue(new Error('abort failed'));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());
    const iterator = adapter.events(execution)[Symbol.asyncIterator]();
    const opened = await iterator.next();
    if (!opened.value || opened.value.type !== 'request.opened') throw new Error('Expected approval request');

    await expect(adapter.stop(execution)).rejects.toThrow('abort failed');
    await expect(adapter.resolveRequest(execution, opened.value.payload.request, 'once')).rejects.toThrow('not pending');
    await iterator.return?.();
  });

  it.each([
    ['question.asked', 'legacy'],
    ['question.v2.asked', 'v2'],
  ] as const)('opens a stable clarification for %s and replies through the matching SDK endpoint', async (eventType, version) => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: eventType, properties: { id: 'native-question-1', sessionID: 'session-1', questions: [{ question: 'Which format?', header: 'Format', options: [{ label: 'PNG', description: 'Raster' }, { label: 'SVG', description: 'Vector' }], custom: true }] } },
      { type: 'session.idle', properties: { sessionID: 'session-1' } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());
    const iterator = adapter.events(execution)[Symbol.asyncIterator]();

    const opened = await iterator.next();
    expect(opened.value).toEqual({ type: 'request.opened', payload: { request: { id: expect.stringMatching(/^req-[a-f0-9]{32}$/), kind: 'clarification', prompt: 'Which format?', choices: ['PNG', 'SVG'] } } });
    if (!opened.value || opened.value.type !== 'request.opened') throw new Error('Expected clarification request');
    await expect(adapter.resolveRequest(execution, opened.value.payload.request, 'SVG')).resolves.toEqual({ outcome: 'answered' });
    expect(client.replyQuestion).toHaveBeenCalledWith({ sessionID: 'session-1', requestID: 'native-question-1', directory: '/srv/workspaces/room-1/subdir', answers: [['SVG']], version });
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'execution.completed' } });
  });

  it('round-trips batched and multi-select questions as structured answers',async()=>{
    const client=fixtureClient();client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'question.asked',properties:{id:'native-question-1',sessionID:'session-1',questions:[{question:'Pick several',header:'Formats',options:[{label:'PNG'},{label:'SVG'}],multiple:true},{question:'Theme?',header:'Theme',options:[{label:'Nature',description:'Outdoors'}],custom:true}]}},
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest()),iterator=adapter.events(execution)[Symbol.asyncIterator](),opened=await iterator.next();
    expect(opened.value).toMatchObject({type:'request.opened',payload:{request:{kind:'clarification',prompt:'OpenCode needs additional input',questions:[{id:'question-1',header:'Formats',multiSelect:true,options:[{label:'PNG'},{label:'SVG'}]},{id:'question-2',header:'Theme',isOther:true,options:[{label:'Nature',description:'Outdoors'}]}]}}});
    if(!opened.value||opened.value.type!=='request.opened')throw new Error('Expected clarification request');
    await expect(adapter.resolveRequest(execution,opened.value.payload.request,{answers:{'question-1':['PNG','SVG'],'question-2':['Nature']}})).resolves.toEqual({outcome:'answered'});
    expect(client.replyQuestion).toHaveBeenCalledWith({sessionID:'session-1',requestID:'native-question-1',directory:'/srv/workspaces/room-1/subdir',answers:[['PNG','SVG'],['Nature']],version:'legacy'});
    await expect(iterator.next()).resolves.toMatchObject({value:{type:'execution.completed'}});
  });

  it('fails closed and aborts malformed questions', async () => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: 'question.asked', properties: { id: 'native-question-1', sessionID: 'session-1', questions: [{ question: '', options: [] }] } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());

    await expect(collect(adapter.events(execution))).resolves.toEqual([
      { type: 'execution.failed', payload: { error: { code: 'unsupported_interaction', message: 'OpenCode requested a malformed clarification' } } },
    ]);
    expect(client.abortSession).toHaveBeenCalledWith('session-1', '/srv/workspaces/room-1/subdir');
  });

  it('rejects malformed model IDs and endpoint URLs without exposing credentials', async () => {
    expect(() => new OpenCodeConnectorAdapter({ baseUrl: 'http://user:password@localhost:4096', client: fixtureClient() })).toThrow('without credentials');
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client: fixtureClient() });
    await expect(adapter.start({ ...startRequest(), modelId: 'missing-provider' })).rejects.toThrow('provider/model');
  });
});

function startRequest(): AdapterStartExecutionRequest {
  return {
    executionId: 'execution-1', harnessInstanceId: 'local-opencode', modelId: 'anthropic/claude-sonnet', executionProfile:{workflowMode:'work',reasoningEffort:null,permissionProfileId:null,agentVariantId:'build',planEnforcement:null},
    workspace: { roomId: 'room-1', relativePath: 'subdir', absolutePath: '/srv/workspaces/room-1/subdir' },
    input: { systemPrompt: 'Be useful.', history: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Previous answer' }], message: 'Continue' },
  };
}

function fixtureClient(calls: string[] = []): OpenCodeClientPort {
  return {
    providers: vi.fn().mockResolvedValue({ all: [], connected: [] }),
    agents: vi.fn().mockResolvedValue([{name:'build',mode:'primary'}]),
    createSession: vi.fn(async () => { calls.push('create'); return { id: 'session-1' }; }),
    sessionStatuses: vi.fn().mockResolvedValue({ 'session-1': { type: 'idle' } }),
    subscribe: vi.fn(async () => { calls.push('subscribe'); return events([]); }),
    prompt: vi.fn(async () => { calls.push('prompt'); }),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    replyQuestion: vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
  };
}

async function* events(values: unknown[]) { yield* values; }
async function collect<T>(source: AsyncIterable<T>) { const values: T[] = []; for await (const value of source) values.push(value); return values; }
