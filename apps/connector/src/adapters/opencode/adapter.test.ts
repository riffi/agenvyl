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
      controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'standard',label:'Standard'},{id:'auto-approve',label:'Auto-approve'}],agentVariants:[{id:'build',label:'build'}]},
    });
    expect(client.providers).toHaveBeenCalledWith('/workspace/catalog');
    expect(client.agents).toHaveBeenCalledWith('/workspace/catalog');
    expect(adapter.interventionMode).toBe('interrupt_then_continue');
    expect(adapter.postTurnContinuation).toEqual({mode:'native_session',durability:'connector_restart',retention:'explicit_release'});
  });

  it('interrupts an active turn and continues the same session with the original configuration',async()=>{
    const client=fixtureClient(),firstUsage={id:'assistant-1',sessionID:'session-1',role:'assistant',tokens:{input:10,output:2,reasoning:1,cache:{read:3,write:0}}},secondUsage={id:'assistant-2',sessionID:'session-1',role:'assistant',tokens:{input:8,output:4,reasoning:0,cache:{read:2,write:0}}};
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'old-text',type:'text'}}},
      {type:'message.part.delta',properties:{sessionID:'session-1',partID:'old-text',field:'text',delta:'Old answer'}},
      {type:'message.updated',properties:{info:firstUsage}},
      {type:'session.error',properties:{sessionID:'session-1',error:{name:'MessageAbortedError',data:{message:'aborted'}}}},
      {type:'session.idle',properties:{sessionID:'session-1'}},
      {type:'session.status',properties:{sessionID:'session-1',status:{type:'idle'}}},
      {type:'session.status',properties:{sessionID:'session-1',status:{type:'busy'}}},
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'new-text',type:'text'}}},
      {type:'message.part.delta',properties:{sessionID:'session-1',partID:'new-text',field:'text',delta:'New answer'}},
      {type:'message.updated',properties:{info:secondUsage}},
      ...assistantFinished(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest());
    const applying=adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change direction'});

    const normalized=await collect(adapter.events(execution));
    await expect(applying).resolves.toBeUndefined();

    expect(client.abortSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(client.prompt).toHaveBeenCalledTimes(2);
    expect(client.prompt).toHaveBeenNthCalledWith(2,{...vi.mocked(client.prompt).mock.calls[0]![0],message:'Change direction'});
    expect(normalized).toEqual([
      {type:'output.text.delta',payload:{text:'Old answer'}},
      {type:'usage.updated',payload:{usage:{inputTokens:10,outputTokens:2,reasoningTokens:1,cacheReadTokens:3,cacheWriteTokens:0}}},
      {type:'execution.intervention.applied',payload:{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change direction'}},
      {type:'output.text.delta',payload:{text:'New answer'}},
      {type:'usage.updated',payload:{usage:{inputTokens:18,outputTokens:6,reasoningTokens:1,cacheReadTokens:5,cacheWriteTokens:0}}},
      completion(),
    ]);
  });

  it('fails an intervention and the execution when the replacement prompt cannot start',async()=>{
    const client=fixtureClient();client.subscribe=vi.fn().mockResolvedValue(events([{type:'session.idle',properties:{sessionID:'session-1'}}]));
    client.prompt=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('replacement failed token=secret'));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest());
    const applying=adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change direction'}).catch(error=>error);

    const normalized=await collect(adapter.events(execution));

    await expect(applying).resolves.toBeInstanceOf(Error);
    expect(normalized).toEqual([
      {type:'execution.intervention.failed',payload:{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change direction',error:{code:'opencode_turn_start_failed',message:'replacement failed token=[REDACTED]'}}},
      {type:'execution.failed',payload:{error:{code:'opencode_turn_start_failed',message:'replacement failed token=[REDACTED]'}}},
    ]);
    expect(client.deleteSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
  });

  it('keeps the original turn active when the intervention abort fails',async()=>{
    const client=fixtureClient();client.abortSession=vi.fn().mockRejectedValue(new Error('abort unavailable'));
    client.subscribe=vi.fn().mockResolvedValue(events([...completedTurn(),{type:'session.idle',properties:{sessionID:'session-1'}}]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest()),applying=adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change direction'}).catch(error=>error);

    await expect(applying).resolves.toBeInstanceOf(Error);
    await expect(collect(adapter.events(execution))).resolves.toEqual([completion()]);
    expect(client.prompt).toHaveBeenCalledTimes(1);
  });

  it('rejects a pending intervention when the adapter closes',async()=>{
    const client=fixtureClient(),adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest()),applying=adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change direction'}).catch(error=>error);

    await adapter.close();

    await expect(applying).resolves.toBeInstanceOf(Error);
    expect(client.deleteSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
  });

  it('rejects intervention while waiting for user input and while another intervention is pending',async()=>{
    const client=fixtureClient();client.subscribe=vi.fn().mockResolvedValue(events([{type:'permission.asked',properties:{id:'native-request',sessionID:'session-1',permission:'bash',patterns:['git status'],metadata:{},always:[]}}]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({value:{type:'request.opened'}});
    expect(()=>adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change'})).toThrow('waiting for user input');
    await iterator.return?.();

    const otherClient=fixtureClient(),otherAdapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client:otherClient}),other=await otherAdapter.start(startRequest()),first=otherAdapter.intervene(other,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'First'}).catch(error=>error);
    expect(()=>otherAdapter.intervene(other,{interventionId:'777f7444-e6a9-4e85-818f-20d536876ff7',text:'Second'})).toThrow('already being applied');
    await otherAdapter.stop(other);await expect(first).resolves.toBeInstanceOf(Error);
  });

  it('gives Stop priority while an intervention is waiting for idle',async()=>{
    const client=fixtureClient(),adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest()),applying=adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change'}).catch(error=>error);

    await adapter.stop(execution);

    await expect(applying).resolves.toBeInstanceOf(Error);
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(client.abortSession).toHaveBeenCalledTimes(2);
    expect(client.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('does not hide a genuine session failure received during interruption',async()=>{
    const client=fixtureClient();client.subscribe=vi.fn().mockResolvedValue(events([{type:'session.error',properties:{sessionID:'session-1',error:{name:'ProviderAuthError',data:{message:'unauthorized'}}}}]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),execution=await adapter.start(startRequest()),applying=adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Change'}).catch(error=>error);

    const normalized=await collect(adapter.events(execution));

    await expect(applying).resolves.toBeInstanceOf(Error);
    expect(normalized.at(-1)).toMatchObject({type:'execution.failed',payload:{error:{code:'provider_authentication_failed'}}});
    expect(client.prompt).toHaveBeenCalledTimes(1);
  });

  it('resumes a preserved session without replay and releases it explicitly',async()=>{
    const sourceClient=fixtureClient();sourceClient.subscribe=vi.fn().mockResolvedValue(events([...completedTurn(),{type:'session.idle',properties:{sessionID:'session-1'}}]));
    const sourceAdapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client:sourceClient}),terminal=(await collect(sourceAdapter.events(await sourceAdapter.start(startRequest())))).at(-1);
    if(!terminal||terminal.type!=='execution.completed'||!terminal.payload.continuation)throw new Error('Expected OpenCode continuation');
    const system=vi.mocked(sourceClient.prompt).mock.calls[0]![0].system,handle=terminal.payload.continuation.handle,resumedClient=fixtureClient();
    resumedClient.sessionMessages=vi.fn().mockResolvedValue([{info:{role:'user',system}}]);
    resumedClient.subscribe=vi.fn().mockResolvedValue(events([...completedTurn('Continued'),{type:'session.idle',properties:{sessionID:'session-1'}}]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client:resumedClient}),request={...startRequest(),executionId:'execution-2',input:{systemPrompt:'Be useful.',history:[],message:'Continue natively'},continuation:{handle}};

    const resumed=await adapter.startContinuation(request,handle);
    expect(resumed).toEqual({upstreamId:'session-1'});
    expect(resumedClient.createSession).not.toHaveBeenCalled();
    expect(resumedClient.sessionMessages).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(resumedClient.prompt).toHaveBeenCalledWith(expect.objectContaining({sessionID:'session-1',system,message:'Continue natively'}));
    await expect(collect(adapter.events(resumed))).resolves.toEqual([completion()]);
    await expect(adapter.releaseContinuation(handle,{instanceId:'local-opencode'})).resolves.toBe('released');
    expect(resumedClient.deleteSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    resumedClient.deleteSession=vi.fn().mockResolvedValue(false);
    await expect(adapter.releaseContinuation(handle,{instanceId:'local-opencode'})).resolves.toBe('not_found');
    await expect(adapter.releaseContinuation(handle,{instanceId:'other-opencode'})).rejects.toMatchObject({code:'continuation_incompatible'});
    await expect(adapter.releaseContinuation('broken',{instanceId:'local-opencode'})).rejects.toMatchObject({code:'continuation_unavailable'});
    const otherScope=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4097',client:fixtureClient()});
    await expect(otherScope.startContinuation(request,handle)).rejects.toMatchObject({code:'continuation_incompatible'});
    const changedContextClient=fixtureClient();changedContextClient.sessionMessages=vi.fn().mockResolvedValue([{info:{role:'user',system:'changed'}}]);
    const changedContext=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client:changedContextClient});
    await expect(changedContext.startContinuation(request,handle)).rejects.toMatchObject({code:'continuation_incompatible'});
    expect(changedContextClient.deleteSession).not.toHaveBeenCalled();
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
    expect(system).toContain('Use paths relative to the current working directory');
    expect(system).toContain('Never copy, reconstruct, or pass the absolute working-directory path into a tool argument');
    expect(system).toContain('never stage them in /tmp');
    expect(system).toContain('Do not use sudo');
    expect(system).toContain(JSON.stringify(startRequest().input.history));
    expect(system).not.toContain('Continue');
    expect(system).not.toContain('tool named `question`');
  });

  it('preserves a completed session and disposes its OpenCode instance before reporting a continuation',async()=>{
    const calls:string[]=[],client=fixtureClient(calls);
    client.subscribe=vi.fn(async()=>{calls.push('subscribe');return events([...completedTurn(),{type:'session.idle',properties:{sessionID:'session-1'}}]);});
    client.deleteSession=vi.fn(async()=>{calls.push('delete');return true;});
    client.disposeInstance=vi.fn(async()=>{calls.push('dispose');});
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});

    await expect(collect(adapter.events(await adapter.start(startRequest())))).resolves.toEqual([completion()]);

    expect(client.abortSession).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(client.disposeInstance).toHaveBeenCalledWith('/srv/workspaces/room-1/subdir');
    expect(calls).toEqual(['create','subscribe','prompt','dispose']);
    await adapter.close();
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(client.disposeInstance).toHaveBeenCalledTimes(1);
  });

  it('cleans the upstream session and instance when start fails after session creation',async()=>{
    const client=fixtureClient();
    client.prompt=vi.fn().mockRejectedValue(new Error('prompt failed'));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});

    await expect(adapter.start(startRequest())).rejects.toThrow('prompt failed');

    expect(client.abortSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(client.deleteSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(client.disposeInstance).toHaveBeenCalledWith('/srv/workspaces/room-1/subdir');
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
      ...assistantFinished(),
      { type: 'session.status', properties: { sessionID: 'session-1', status: { type: 'idle' } } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());

    const normalized = await collect(adapter.events(execution));
    expect(normalized).toEqual([
      { type: 'output.reasoning.delta', payload: { text: 'private' } },
      { type: 'output.text.delta', payload: { text: 'Hello' } },
      completion(),
    ]);
    expect(JSON.stringify(normalized)).not.toContain('do-not-leak');
  });

  it('separates text parts while preserving deltas within one part',async()=>{
    const client=fixtureClient();client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'text-before',type:'text'}}},
      {type:'message.part.delta',properties:{sessionID:'session-1',partID:'text-before',field:'text',delta:'First'}},
      {type:'message.part.delta',properties:{sessionID:'session-1',partID:'text-before',field:'text',delta:' message.'}},
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'text-after',type:'text'}}},
      {type:'message.part.delta',properties:{sessionID:'session-1',partID:'text-after',field:'text',delta:'Second message.'}},
      ...assistantFinished(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),normalized=await collect(adapter.events(await adapter.start(startRequest())));
    expect(normalized).toEqual([
      {type:'output.text.delta',payload:{text:'First'}},
      {type:'output.text.delta',payload:{text:' message.'}},
      {type:'output.text.delta',payload:{text:'\n\nSecond message.'}},
      completion(),
    ]);
  });

  it('aggregates exact assistant message usage and suppresses repeated updates',async()=>{
    const client=fixtureClient(),first={id:'assistant-1',sessionID:'session-1',role:'assistant',tokens:{input:10,output:3,reasoning:2,cache:{read:4,write:1}}};
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'message.updated',properties:{info:first}},
      {type:'message.updated',properties:{info:first}},
      {type:'message.updated',properties:{info:{...first,tokens:{input:12,output:5,reasoning:2,cache:{read:4,write:1}}}}},
      {type:'message.updated',properties:{info:{id:'assistant-2',sessionID:'session-1',role:'assistant',tokens:{total:11,input:8,output:2,reasoning:1,cache:{read:0,write:0}}}}},
      {type:'message.updated',properties:{info:{id:'user-1',sessionID:'session-1',role:'user'}}},
      ...completedTurn(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),normalized=await collect(adapter.events(await adapter.start(startRequest())));
    expect(normalized).toEqual([
      {type:'usage.updated',payload:{usage:{inputTokens:10,outputTokens:3,reasoningTokens:2,cacheReadTokens:4,cacheWriteTokens:1}}},
      {type:'usage.updated',payload:{usage:{inputTokens:12,outputTokens:5,reasoningTokens:2,cacheReadTokens:4,cacheWriteTokens:1}}},
      {type:'usage.updated',payload:{usage:{inputTokens:20,outputTokens:7,reasoningTokens:3,cacheReadTokens:4,cacheWriteTokens:1}}},
      completion(),
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

  it('turns a provider region failure into safe actionable guidance',async()=>{
    const client=fixtureClient();client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'session.error',properties:{sessionID:'session-1',error:{name:'APIError',data:{statusCode:403,message:'The latest version is only available hosted in China and requires explicit opt in: https://opencode.ai/workspace/private/go',responseHeaders:{authorization:'Bearer secret-token'},responseBody:'{"type":"error","error":{"type":"RegionError"}}'}}}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client}),normalized=await collect(adapter.events(await adapter.start(startRequest())));
    expect(normalized).toEqual([{type:'execution.failed',payload:{error:{code:'provider_region_opt_in_required',message:'This model requires China hosting to be enabled in OpenCode Go settings.'}}}]);
    expect(JSON.stringify(normalized)).not.toContain('private');
    expect(JSON.stringify(normalized)).not.toContain('secret-token');
  });

  it('normalizes native tool states without exposing inputs, outputs, metadata, or errors', async () => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-1', tool: 'bash', state: { status: 'pending', input: { token: 'secret' }, raw: 'secret' } } } },
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-1', tool: 'bash', state: { status: 'running', title: 'Run /srv/private/script.sh', input: { token: 'secret' }, metadata: { token: 'secret' }, time: { start: 1 } } } } },
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-1', tool: 'bash', state: { status: 'completed', title: 'Command finished', input: { token: 'secret' }, output: 'secret output', metadata: { token: 'secret' }, time: { start: 1, end: 2 } } } } },
      { type: 'message.part.updated', properties: { sessionID: 'session-1', part: { type: 'tool', callID: 'call-2', tool: 'edit', state: { status: 'error', input: { token: 'secret' }, error: 'secret failure', time: { start: 1, end: 2 } } } } },
      ...completedTurn(),
      { type: 'session.idle', properties: { sessionID: 'session-1' } },
    ]));
    const adapter = new OpenCodeConnectorAdapter({ baseUrl: 'http://localhost:4096', client });
    const execution = await adapter.start(startRequest());

    const normalized = await collect(adapter.events(execution));
    expect(normalized).toEqual([
      { type: 'tool.started', payload: { toolId: 'call-1', name: 'bash', safeSummary: 'Preparing bash' } },
      { type: 'tool.updated', payload: { toolId: 'call-1', name: 'bash', safeSummary: 'Run [ABSOLUTE_PATH]' } },
      { type: 'tool.completed', payload: { toolId: 'call-1', name: 'bash', safeSummary: 'Command finished' } },
      { type: 'tool.failed', payload: { toolId: 'call-2', name: 'edit', safeSummary: 'edit failed' } },
      completion(),
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
      ...completedTurn(),
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
    await expect(iterator.next()).resolves.toEqual({ done: false, value: completion() });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it.each([
    ['permission.asked', 'legacy'],
    ['permission.v2.asked', 'v2'],
  ] as const)('rejects malformed %s external-directory access without opening a user approval and fails an unrecovered turn', async (eventType, version) => {
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
      { type: 'execution.failed', payload: { error: { code: 'external_directory_denied', message: expect.stringContaining('external-directory allowlist') } } },
    ]);
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'session-1', requestID: 'native-request-1', directory: '/srv/workspaces/room-1/subdir', reply: 'reject', version,
    });
  });

  it.each(['standard','auto-approve'] as const)('asks to add a valid outside directory in %s and persists it before replying once',async permissionProfileId=>{
    const client=fixtureClient(),grantExternalDirectoryRoot=vi.fn().mockResolvedValue(undefined);
    client.subscribe=vi.fn().mockResolvedValue(events([
      externalPermission('C:\\work\\joke.txt','C:\\work'),
      ...completedTurn(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:[],grantExternalDirectoryRoot});
    const executionProfile={...startRequest().executionProfile,permissionProfileId};
    const execution=await adapter.start({...startRequest(),executionProfile}),iterator=adapter.events(execution)[Symbol.asyncIterator](),opened=await iterator.next();

    expect(opened.value).toEqual({type:'request.opened',payload:{request:{
      id:expect.stringMatching(/^req-/),
      kind:'approval',
      prompt:'Add this directory to allowed external directories and allow this request?',
      directory:'C:\\work',
      choices:['allow_directory','deny'],
    }}});
    expect(client.replyPermission).not.toHaveBeenCalled();
    if(!opened.value||opened.value.type!=='request.opened')throw new Error('Expected approval request');
    await expect(adapter.resolveRequest(execution,opened.value.payload.request,'allow_directory')).resolves.toEqual({outcome:'answered'});
    expect(grantExternalDirectoryRoot).toHaveBeenCalledWith('C:\\work');
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({requestID:'native-external',reply:'once'}));
    await expect(iterator.next()).resolves.toMatchObject({value:{type:'execution.completed'}});
  });

  it('auto-approves the selected Plan project for this run without persisting a global root',async()=>{
    const client=fixtureClient(),grantExternalDirectoryRoot=vi.fn().mockResolvedValue(undefined);
    client.agents=vi.fn().mockResolvedValue([{name:'build',mode:'primary'},{name:'plan',mode:'primary'}]);
    client.subscribe=vi.fn().mockResolvedValue(events([
      externalPermission('/srv/projects/main/src/app.ts','/srv/projects/main'),
      ...completedTurn(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:[],grantExternalDirectoryRoot});
    const request={...startRequest(),executionProfile:{...startRequest().executionProfile,workflowMode:'plan' as const,agentVariantId:'plan',planEnforcement:'native' as const},workspace:{...startRequest().workspace,roomAbsolutePath:'/srv/workspaces/room-1/subdir',project:{absolutePath:'/srv/projects/main',access:'read' as const}}};

    await expect(collect(adapter.events(await adapter.start(request)))).resolves.toEqual([completion()]);
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({requestID:'native-external',reply:'once'}));
    expect(grantExternalDirectoryRoot).not.toHaveBeenCalled();
  });

  it('auto-approves the room artifact directory when Work runs directly in the project',async()=>{
    const client=fixtureClient(),grantExternalDirectoryRoot=vi.fn().mockResolvedValue(undefined);
    client.subscribe=vi.fn().mockResolvedValue(events([
      externalPermission('/srv/workspaces/room-1/result.png','/srv/workspaces/room-1'),
      ...completedTurn(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:[],grantExternalDirectoryRoot});
    const request={...startRequest(),workspace:{...startRequest().workspace,absolutePath:'/srv/projects/main',roomAbsolutePath:'/srv/workspaces/room-1',project:{absolutePath:'/srv/projects/main',access:'read_write' as const}}};

    await expect(collect(adapter.events(await adapter.start(request)))).resolves.toEqual([completion()]);
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({requestID:'native-external',reply:'once'}));
    expect(grantExternalDirectoryRoot).not.toHaveBeenCalled();
  });

  it.each(['standard','auto-approve'] as const)('rejects a near-miss managed run workspace in %s without offering or persisting it',async permissionProfileId=>{
    const client=fixtureClient(),grantExternalDirectoryRoot=vi.fn().mockResolvedValue(undefined);
    const active='C:\\Users\\Alice\\AppData\\Local\\Agenvyl\\workspaces\\room-1\\.agenvyl\\runs\\e3268baa-ecc3-4863-a760-528382e0bd6f\\workspace';
    const escaped='C:\\Users\\Alice\\AppData\\Local\\Agenvyl\\workspaces\\room-1\\.agenvyl\\runs\\e3268baa-ecc3-4863-a760-528382ebd6f\\workspace';
    client.subscribe=vi.fn().mockResolvedValue(events([
      externalPermission(`${escaped}\\dashboard.html`,escaped),
      ...completedTurn('I kept the result inside the active workspace.'),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:[escaped],grantExternalDirectoryRoot});
    const request={...startRequest(),workspace:{...startRequest().workspace,absolutePath:active},executionProfile:{...startRequest().executionProfile,permissionProfileId}};

    await expect(collect(adapter.events(await adapter.start(request)))).resolves.toEqual([completion()]);
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({requestID:'native-external',reply:'reject'}));
    expect(grantExternalDirectoryRoot).not.toHaveBeenCalled();
  });

  it('offers only once or deny for an allowlisted external directory without exposing the host path',async()=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([
      externalPermission('/srv/shared/assets/image.png','/srv/shared/assets'),
      ...completedTurn(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:['/srv/shared']});
    const execution=await adapter.start(startRequest()),iterator=adapter.events(execution)[Symbol.asyncIterator](),opened=await iterator.next();

    expect(opened.value).toEqual({type:'request.opened',payload:{request:{id:expect.stringMatching(/^req-/),kind:'approval',prompt:'Allow OpenCode to access a configured external directory?',choices:['once','deny']}}});
    expect(JSON.stringify(opened.value)).not.toContain('/srv/shared');
    if(!opened.value||opened.value.type!=='request.opened')throw new Error('Expected approval request');
    await expect(adapter.resolveRequest(execution,opened.value.payload.request,'always')).rejects.toThrow('not an offered choice');
    await expect(adapter.resolveRequest(execution,opened.value.payload.request,'once')).resolves.toEqual({outcome:'answered'});
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({requestID:'native-external',reply:'once'}));
    await expect(iterator.next()).resolves.toMatchObject({value:{type:'execution.completed'}});
  });

  it('auto-approves ordinary and allowlisted external permissions once during Work',async()=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'permission.v2.asked',properties:{id:'native-bash',sessionID:'session-1',action:'bash',resources:['git status'],metadata:{}}},
      externalPermission('/srv/shared/file.txt','/srv/shared'),
      ...completedTurn(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:['/srv/shared']});
    const executionProfile={...startRequest().executionProfile,permissionProfileId:'auto-approve'};

    await expect(collect(adapter.events(await adapter.start({...startRequest(),executionProfile})))).resolves.toEqual([completion()]);
    expect(client.replyPermission).toHaveBeenNthCalledWith(1,expect.objectContaining({requestID:'native-bash',reply:'once'}));
    expect(client.replyPermission).toHaveBeenNthCalledWith(2,expect.objectContaining({requestID:'native-external',reply:'once'}));
  });

  it('auto-approves an allowlisted resource-only external permission from Bash',async()=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'permission.asked',properties:{id:'native-external-bash',sessionID:'session-1',permission:'external_directory',patterns:['C:\\work\\tmp\\beautiful-landscape\\*'],metadata:{},always:[]}},
      ...completedTurn(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:['C:\\work']});
    const executionProfile={...startRequest().executionProfile,permissionProfileId:'auto-approve'};

    await expect(collect(adapter.events(await adapter.start({...startRequest(),executionProfile})))).resolves.toEqual([completion()]);
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({requestID:'native-external-bash',reply:'once'}));
  });

  it('forces Standard approvals in Plan even when the persona selects Auto-approve',async()=>{
    const client=fixtureClient();
    client.agents=vi.fn().mockResolvedValue([{name:'build',mode:'primary'},{name:'plan',mode:'primary'}]);
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'permission.v2.asked',properties:{id:'native-bash',sessionID:'session-1',action:'bash',resources:['git status'],metadata:{}}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});
    const executionProfile={...startRequest().executionProfile,workflowMode:'plan' as const,permissionProfileId:'auto-approve',agentVariantId:null,planEnforcement:'native' as const};
    const execution=await adapter.start({...startRequest(),executionProfile});
    const iterator=adapter.events(execution)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({value:{type:'request.opened',payload:{request:{kind:'approval'}}}});
    expect(client.replyPermission).not.toHaveBeenCalled();
    await iterator.return?.();
  });

  it('does not auto-answer clarifications in Auto-approve',async()=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'question.v2.asked',properties:{id:'native-question',sessionID:'session-1',questions:[{question:'Which format?',options:[{label:'PNG'}]}]}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});
    const executionProfile={...startRequest().executionProfile,permissionProfileId:'auto-approve'};
    const iterator=adapter.events(await adapter.start({...startRequest(),executionProfile}))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({value:{type:'request.opened',payload:{request:{kind:'clarification'}}}});
    expect(client.replyQuestion).not.toHaveBeenCalled();
    await iterator.return?.();
  });

  it('completes after an external denial only when a new finished assistant answer follows it',async()=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([
      externalPermission('/outside/secrets.txt','/outside'),
      ...completedTurn('I could not access that path, so here is a safe alternative.'),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,externalDirectoryRoots:[]});
    const execution=await adapter.start(startRequest()),iterator=adapter.events(execution)[Symbol.asyncIterator](),opened=await iterator.next();
    if(!opened.value||opened.value.type!=='request.opened')throw new Error('Expected approval request');
    await adapter.resolveRequest(execution,opened.value.payload.request,'deny');

    await expect(collectIterator(iterator)).resolves.toEqual([completion()]);
    expect(client.replyPermission).toHaveBeenCalledWith(expect.objectContaining({reply:'reject'}));
  });

  it('does not mistake a repeated preamble part after denial for a new final answer',async()=>{
    const client=fixtureClient();
    const preamble={type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'text-preamble',type:'text',text:'Checking external file. '}}};
    client.subscribe=vi.fn().mockResolvedValue(events([
      preamble,
      externalPermission('/outside/secrets.txt','/outside'),
      preamble,
      ...assistantFinished(),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});
    const execution=await adapter.start(startRequest()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    const opened=await iterator.next();
    if(!opened.value||opened.value.type!=='request.opened')throw new Error('Expected approval request');
    await adapter.resolveRequest(execution,opened.value.payload.request,'deny');

    expect((await collectIterator(iterator)).at(-1)).toMatchObject({type:'execution.failed',payload:{error:{code:'external_directory_denied'}}});
  });

  it.each([
    ['a completed tool without later text',[
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{type:'tool',callID:'call-1',tool:'read',state:{status:'completed'}}}},
    ]],
    ['a still-running tool',[
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{type:'tool',callID:'call-1',tool:'read',state:{status:'running'}}}},
    ]],
    ['a tool-calls finish',[
      ...completedTurn(),
      ...assistantFinished('tool-calls'),
    ]],
  ] as const)('classifies idle after %s as an incomplete turn',async(_label,turnEvents)=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([...turnEvents,{type:'session.idle',properties:{sessionID:'session-1'}}]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});
    const normalized=await collect(adapter.events(await adapter.start(startRequest())));

    expect(normalized.at(-1)).toEqual({type:'execution.failed',payload:{error:{code:'opencode_incomplete_turn',message:'OpenCode became idle before producing a complete final response'}}});
  });

  it('classifies a length finish as truncated output',async()=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([
      {type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'text-final',type:'text',text:'Partial answer'}}},
      ...assistantFinished('length'),
      {type:'session.idle',properties:{sessionID:'session-1'}},
    ]));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});

    expect((await collect(adapter.events(await adapter.start(startRequest())))).at(-1)).toEqual({type:'execution.failed',payload:{error:{code:'opencode_output_truncated',message:'OpenCode stopped because the model output was truncated'}}});
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
    expect(client.deleteSession).toHaveBeenCalledWith('session-1', '/srv/workspaces/room-1/subdir');
    expect(client.disposeInstance).toHaveBeenCalledWith('/srv/workspaces/room-1/subdir');
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
    expect(client.deleteSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(client.disposeInstance).toHaveBeenCalledWith('/srv/workspaces/room-1/subdir');
    await expect(adapter.resolveRequest(execution, opened.value.payload.request, 'once')).rejects.toThrow('not pending');
    await iterator.return?.();
  });

  it('aborts and deletes active sessions when the adapter closes',async()=>{
    const client=fixtureClient(),adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});
    await adapter.start(startRequest());

    await adapter.close();

    expect(client.abortSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(client.deleteSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(client.disposeInstance).toHaveBeenCalledWith('/srv/workspaces/room-1/subdir');
  });

  it('keeps a shared directory instance alive until its last active session ends',async()=>{
    const client=fixtureClient();
    client.createSession=vi.fn().mockResolvedValueOnce({id:'session-1'}).mockResolvedValueOnce({id:'session-2'});
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client});
    const first=await adapter.start(startRequest()),second=await adapter.start({...startRequest(),executionId:'execution-2'});

    await adapter.stop(first);
    expect(client.deleteSession).toHaveBeenCalledWith('session-1','/srv/workspaces/room-1/subdir');
    expect(client.disposeInstance).not.toHaveBeenCalled();

    await adapter.stop(second);
    expect(client.deleteSession).toHaveBeenCalledWith('session-2','/srv/workspaces/room-1/subdir');
    expect(client.disposeInstance).toHaveBeenCalledTimes(1);
  });

  it('does not turn a successful execution into a failure when upstream cleanup times out',async()=>{
    const client=fixtureClient();
    client.subscribe=vi.fn().mockResolvedValue(events([...completedTurn(),{type:'session.idle',properties:{sessionID:'session-1'}}]));
    client.disposeInstance=vi.fn(()=>new Promise<void>(()=>undefined));
    const adapter=new OpenCodeConnectorAdapter({baseUrl:'http://localhost:4096',client,cleanupTimeoutMs:5});

    await expect(collect(adapter.events(await adapter.start(startRequest())))).resolves.toEqual([completion()]);
    expect(client.disposeInstance).toHaveBeenCalledWith('/srv/workspaces/room-1/subdir');
  });

  it.each([
    ['question.asked', 'legacy'],
    ['question.v2.asked', 'v2'],
  ] as const)('opens a stable clarification for %s and replies through the matching SDK endpoint', async (eventType, version) => {
    const client = fixtureClient();
    client.subscribe = vi.fn().mockResolvedValue(events([
      { type: eventType, properties: { id: 'native-question-1', sessionID: 'session-1', questions: [{ question: 'Which format?', header: 'Format', options: [{ label: 'PNG', description: 'Raster' }, { label: 'SVG', description: 'Vector' }], custom: true }] } },
      ...completedTurn(),
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
      ...completedTurn(),
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
    sessionMessages:vi.fn().mockResolvedValue([{info:{role:'user',system:'Be useful.'}}]),
    prompt: vi.fn(async () => { calls.push('prompt'); }),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    replyQuestion: vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(true),
    disposeInstance: vi.fn().mockResolvedValue(undefined),
  };
}

async function* events(values: unknown[]) { yield* values; }
async function collect<T>(source: AsyncIterable<T>) { const values: T[] = []; for await (const value of source) values.push(value); return values; }
async function collectIterator<T>(iterator:AsyncIterator<T>){const values:T[]=[];while(true){const next=await iterator.next();if(next.done)return values;values.push(next.value);}}
function completion(){return{type:'execution.completed',payload:{continuation:{handle:expect.any(String)}}};}
function assistantFinished(reason='stop'){return[{type:'message.updated',properties:{info:{id:'assistant-final',sessionID:'session-1',role:'assistant',finish:reason}}}];}
function completedTurn(text='Done'){return[
  {type:'message.part.updated',properties:{sessionID:'session-1',part:{id:'text-final',type:'text',text}}},
  ...assistantFinished(),
];}
function externalPermission(filepath:string,parentDir:string){return{
  type:'permission.v2.asked',
  properties:{id:'native-external',sessionID:'session-1',action:'external_directory',resources:[`${filepath}${filepath.includes('\\')?'\\':'/'}**`],metadata:{filepath,parentDir}},
};}
