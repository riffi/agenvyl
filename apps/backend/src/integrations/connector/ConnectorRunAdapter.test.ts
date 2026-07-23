import type { ConnectorExecutionClient } from '../../modules/connector/connector.ports.js';
import { connectorContractFixtures, type ConnectorExecutionEvent, type ExecutionSnapshot } from '@agenvyl/connector-contract';
import { describe,expect,it,vi } from 'vitest';
import {ConnectorRunAdapter} from './ConnectorRunAdapter.js';

describe('ConnectorRunAdapter',()=>{
  it('maps Core start input and replays the typed stream after the accepted checkpoint',async()=>{
    const execution={...connectorContractFixtures.execution,cursor:2,pendingRequests:[]};
    const streamed=[event(3,'execution.upstream_status',{state:'retrying',reason:'rate_limited',retryable:true,attempt:2}),event(4,'execution.upstream_status',{state:'recovered',reason:'rate_limited',retryable:false,attempt:2}),event(5,'output.reasoning.delta',{text:'Thinking'}),event(6,'output.text.delta',{text:'Hello'}),event(7,'tool.started',{toolId:'tool-1',name:'read_file',safeSummary:'Reading',safeInput:'{"path":"src/app.ts"}'}),event(8,'usage.updated',{usage:{inputTokens:20,outputTokens:5,totalTokens:25}}),event(9,'execution.completed',{})];
    const client=clientFixture(execution,streamed),adapter=new ConnectorRunAdapter(client);
    const handle=await adapter.createRun(input());
    expect(handle).toEqual({id:'run-1',checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:2}});
    expect(client.start).toHaveBeenCalledWith({executionId:'run-1',harnessInstanceId:'local-hermes',modelId:'sol',executionProfile:{workflowMode:'work',reasoningEffort:null,permissionProfileId:null,agentVariantId:null,planEnforcement:null},workspace:{roomId:'room-1',relativePath:'.'},input:{systemPrompt:'Be useful.',history:[{role:'user',content:'Earlier'}],message:'Continue'}});

    const mappings=[];for await(const mapping of adapter.stream('run-1','local-run',new AbortController().signal))mappings.push(mapping);
    expect(client.events).toHaveBeenCalledWith('run-1',expect.objectContaining({after:2,connectorEpoch:'epoch-1'}));
    expect(mappings).toEqual([
      {events:[{type:'run.upstream_status',payload:{runId:'local-run',state:'retrying',reason:'rate_limited',retryable:true,attempt:2}}],checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:3}},
      {events:[{type:'run.upstream_status',payload:{runId:'local-run',state:'recovered',reason:'rate_limited',retryable:false,attempt:2}}],checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:4}},
      {events:[{type:'run.reasoning.delta',payload:{runId:'local-run',text:'Thinking'}}],checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:5}},
      {events:[{type:'run.delta',payload:{runId:'local-run',text:'Hello'}}],checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:6}},
      {events:[{type:'tool.updated',payload:{runId:'local-run',tool:{id:'tool-1',name:'read_file',detail:'Reading',input:'{"path":"src/app.ts"}',status:'started'}}}],checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:7}},
      {events:[{type:'run.usage',payload:{runId:'local-run',usage:{inputTokens:20,outputTokens:5,totalTokens:25}}}],checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:8}},
      {events:[],terminal:{status:'completed'},checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:9}},
    ]);
  });

  it('resolves the active approval and returns checkpoints for resolve and stop',async()=>{
    const pending={id:'request-1',kind:'approval' as const,prompt:'Allow?',choices:['once','deny']},execution={...connectorContractFixtures.execution,cursor:3,pendingRequests:[pending]};
    const client=clientFixture(execution,[]),resolved={...execution,cursor:4,pendingRequests:[]},stopped={...resolved,cursor:5,status:'cancelled' as const};
    vi.mocked(client.resolve).mockResolvedValue({execution:resolved,request:{...pending,resolution:{outcome:'answered',value:'once'}}});
    vi.mocked(client.stop).mockResolvedValue(stopped);
    const adapter=new ConnectorRunAdapter(client);await adapter.createRun(input());

    await expect(adapter.approve('run-1','approved')).resolves.toEqual({executionId:'run-1',connectorEpoch:'epoch-1',cursor:3});
    expect(client.resolve).toHaveBeenCalledWith('run-1','request-1','once');
    await expect(adapter.stop('run-1')).resolves.toEqual({executionId:'run-1',connectorEpoch:'epoch-1',cursor:3});
  });

  it('resolves an active clarification without approval normalization',async()=>{
    const pending={id:'question-1',kind:'clarification' as const,prompt:'Which format?',choices:['PNG','SVG']},execution={...connectorContractFixtures.execution,cursor:3,pendingRequests:[pending]};
    const client=clientFixture(execution,[]),resolved={...execution,cursor:4,pendingRequests:[]};
    vi.mocked(client.resolve).mockResolvedValue({execution:resolved,request:{...pending,resolution:{outcome:'answered',value:'SVG'}}});
    const adapter=new ConnectorRunAdapter(client);await adapter.createRun(input());

    await expect(adapter.clarify('run-1','SVG')).resolves.toEqual({executionId:'run-1',connectorEpoch:'epoch-1',cursor:3});
    expect(client.resolve).toHaveBeenCalledWith('run-1','question-1','SVG');
  });

  it('reattaches from the persisted cursor while restoring pending requests',async()=>{
    const pending={id:'request-recovered',kind:'approval' as const,prompt:'Allow?',choices:['once','deny']},execution={...connectorContractFixtures.execution,cursor:9,pendingRequests:[pending]},client=clientFixture(execution,[]),adapter=new ConnectorRunAdapter(client);vi.mocked(client.resolve).mockResolvedValue({execution,request:pending});adapter.reattach({checkpoint:{executionId:'run-1',connectorEpoch:'epoch-1',cursor:7},pendingRequests:[pending]});for await(const _ of adapter.stream('run-1','local-run',new AbortController().signal))void _;expect(client.events).toHaveBeenCalledWith('run-1',expect.objectContaining({after:7,connectorEpoch:'epoch-1'}));await adapter.approve('run-1','once');expect(client.resolve).toHaveBeenCalledWith('run-1','request-recovered','once');
  });

  it('does not advance a control checkpoint past an SSE mapping still being accepted',async()=>{
    const pending={id:'request-race',kind:'approval' as const,prompt:'Allow?',choices:['once','deny']},execution={...connectorContractFixtures.execution,cursor:2,pendingRequests:[]};
    const client=clientFixture(execution,[]),adapter=new ConnectorRunAdapter(client);
    vi.mocked(client.events).mockImplementation(async function*(){yield event(3,'request.opened',{request:pending});});
    vi.mocked(client.resolve).mockResolvedValue({execution:{...execution,cursor:5,pendingRequests:[]},request:{...pending,resolution:{outcome:'answered',value:'once'}}});
    await adapter.createRun(input());
    const stream=adapter.stream('run-1','local-run',new AbortController().signal)[Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({value:{checkpoint:{cursor:3}}});
    await expect(adapter.approve('run-1','once')).resolves.toMatchObject({cursor:2});
    await stream.return?.();
  });
});

function input(){return{executionId:'run-1',harnessInstanceId:'local-hermes',modelId:'sol',executionProfile:{workflowMode:'work' as const,requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,planEnforcement:null,permissionProfileId:null,agentVariantId:null,implementationPlanVersionId:null},workspace:{roomId:'room-1',relativePath:'.',absolutePath:'/host/private/room-1'},input:'Continue',sessionId:'session-1',instructions:'Be useful.',conversationHistory:[{role:'user' as const,content:'Earlier'}],model:'sol'};}
function event<T extends ConnectorExecutionEvent['type']>(cursor:number,type:T,payload:Extract<ConnectorExecutionEvent,{type:T}>['payload']){return{apiVersion:'v2',connectorEpoch:'epoch-1',executionId:'run-1',cursor,occurredAt:'2026-07-17T00:00:00.000Z',type,payload} as Extract<ConnectorExecutionEvent,{type:T}>;}
function clientFixture(execution:ExecutionSnapshot,streamed:ConnectorExecutionEvent[]):ConnectorExecutionClient{return{health:vi.fn().mockResolvedValue(connectorContractFixtures.health),inspect:vi.fn().mockResolvedValue(execution),instances:vi.fn().mockResolvedValue(connectorContractFixtures.instances),catalog:vi.fn().mockResolvedValue(connectorContractFixtures.catalog),start:vi.fn().mockResolvedValue(execution),stop:vi.fn().mockResolvedValue(execution),resolve:vi.fn(),events:vi.fn(async function*(){yield*streamed;})};}
