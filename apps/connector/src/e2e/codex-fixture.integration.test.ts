import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildConnectorApp} from '../app.js';
import {CodexConnectorAdapter} from '../adapters/codex/adapter.js';
import type {AppServerMessage,CodexAppServerPort} from '../adapters/codex/app-server-client.js';
import {HttpConnectorClient} from '../../../backend/src/integrations/connector/HttpConnectorClient.js';
import {ConnectorRunAdapter} from '../../../backend/src/integrations/connector/ConnectorRunAdapter.js';

class FixtureServer implements CodexAppServerPort{
  listeners=new Set<(message:AppServerMessage)=>void>();responses:Array<{id:string|number;result:unknown}>=[];threads=0;turns=0;
  start=vi.fn(async()=>undefined);notify=vi.fn();respondError=vi.fn();close=vi.fn(async()=>undefined);onExit(){return()=>undefined;}
  onMessage(listener:(message:AppServerMessage)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  respond(id:string|number,result:unknown){this.responses.push({id,result});}
  emit(message:AppServerMessage){for(const listener of this.listeners)listener(message);}
  async request(method:string){if(method==='model/list')return{data:[{model:'fixture-model',displayName:'Fixture Model',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};if(method==='thread/start')return{thread:{id:`thread-${++this.threads}`}};if(method==='turn/start')return{turn:{id:`turn-${++this.turns}`}};if(method==='turn/interrupt')return{};throw new Error(`Unexpected ${method}`);}
}

const cleanups:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});

describe('Codex Connector/Core fixture',()=>{
  it('maps a complete run with approval, multi-question clarification, tools, usage, replay, cancel and concurrency',async()=>{
    const root=await mkdtemp(join(tmpdir(),'agenvyl-codex-fixture-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));
    for(const runId of ['run-main','parallel-1','parallel-2'])await mkdir(join(root,'room','.agenvyl','runs',runId,'workspace'),{recursive:true});
    const server=new FixtureServer(),adapter=new CodexConnectorAdapter({client:server}),token='fixture-token-that-is-at-least-32-characters';
    const app=buildConnectorApp({version:1,listen:{host:'127.0.0.1',port:0},workspaces:{roots:[root]},instances:[{id:'local-codex',type:'codex',enabled:true,allowDangerFullAccess:false}],token},{logger:false,adapters:new Map([['local-codex',adapter]])});
    await app.listen({host:'127.0.0.1',port:0});cleanups.push(()=>app.close());const address=app.server.address();if(!address||typeof address==='string')throw new Error('Fixture address unavailable');
    const client=new HttpConnectorClient(`http://127.0.0.1:${address.port}`,token),core=new ConnectorRunAdapter(client);expect((await client.catalog('local-codex')).models[0]).toMatchObject({id:'fixture-model',reasoningEfforts:expect.arrayContaining(['high'])});
    const handle=await core.createRun({executionId:'run-main',harnessInstanceId:'local-codex',modelId:'fixture-model',executionProfile:{workflowMode:'work',requestedReasoningEffort:'high',reasoningEffort:'high',reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:'workspace-write',agentVariantId:null,implementationPlanVersionId:null},workspace:{roomId:'room',relativePath:'.agenvyl/runs/run-main/workspace'},input:'Do it',sessionId:'session',instructions:'Be useful',conversationHistory:[],model:'fixture-model'}),iterator=core.stream(handle.id,'local-main',new AbortController().signal)[Symbol.asyncIterator]();
    server.emit({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'answer',delta:'done'}});server.emit({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'tool',type:'commandExecution',command:'echo ok'}}});server.emit({id:10,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',command:'echo ok'}});
    await until(iterator,mapping=>mapping.events.some(event=>event.type==='request.created'));await core.approve(handle.id,'once');expect(server.responses).toContainEqual({id:10,result:{decision:'accept'}});
    server.emit({id:11,method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',questions:[{id:'one',header:'One',question:'First?',isOther:false,isSecret:false,options:[{label:'A'}]},{id:'secret',header:'Secret',question:'Token?',isOther:false,isSecret:true,options:null}],autoResolutionMs:60000}});const clarification=await until(iterator,mapping=>mapping.events.some(event=>event.type==='request.created'));expect(clarification.events[0]?.payload).toMatchObject({questions:[{id:'one'},{id:'secret',isSecret:true}],autoResolutionMs:60000});await core.clarify(handle.id,{answers:{one:['A'],secret:['hidden']}});expect(server.responses).toContainEqual({id:11,result:{answers:{one:{answers:['A']},secret:{answers:['hidden']}}}});
    server.emit({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'mcp',type:'mcpToolCall',server:'nodexium',tool:'search',arguments:{query:'Codex'}}}});const tool=await until(iterator,mapping=>mapping.events.some(event=>event.type==='tool.updated'));expect(tool.events[0]?.payload).toMatchObject({tool:{id:'mcp',name:'mcpToolCall',input:'{"query":"Codex"}',status:'started'}});
    server.emit({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',tokenUsage:{last:{inputTokens:3,outputTokens:2,totalTokens:5,reasoningOutputTokens:1,cachedInputTokens:0,cacheWriteInputTokens:0}}}});server.emit({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'tool',type:'commandExecution',command:'echo ok'}}});server.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});const terminal=await until(iterator,mapping=>Boolean(mapping.terminal));expect(terminal.terminal).toEqual({status:'completed'});
    const replay=[];for await(const event of client.events(handle.id,{after:0,connectorEpoch:handle.checkpoint!.connectorEpoch,signal:new AbortController().signal}))replay.push(event.type);expect(replay).toEqual(expect.arrayContaining(['output.text.delta','tool.started','request.opened','usage.updated','execution.completed']));
    const first=await core.createRun({executionId:'parallel-1',harnessInstanceId:'local-codex',modelId:'fixture-model',executionProfile:{workflowMode:'work',requestedReasoningEffort:'high',reasoningEffort:'high',reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:'workspace-write',agentVariantId:null,implementationPlanVersionId:null},workspace:{roomId:'room',relativePath:'.agenvyl/runs/parallel-1/workspace'},input:'one',sessionId:'one',instructions:'',model:'fixture-model'}),second=await core.createRun({executionId:'parallel-2',harnessInstanceId:'local-codex',modelId:'fixture-model',executionProfile:{workflowMode:'work',requestedReasoningEffort:'high',reasoningEffort:'high',reasoningEffortFallback:false,reasoningEffortSource:'auto',planEnforcement:null,permissionProfileId:'workspace-write',agentVariantId:null,implementationPlanVersionId:null},workspace:{roomId:'room',relativePath:'.agenvyl/runs/parallel-2/workspace'},input:'two',sessionId:'two',instructions:'',model:'fixture-model'});expect(first.id).not.toBe(second.id);await core.stop(second.id);expect((await client.inspect(second.id)).status).toBe('cancelled');
  });
});

async function until(iterator:AsyncIterator<import('../../../backend/src/modules/harness/harness.ports.js').RunEventMapping>,predicate:(mapping:import('../../../backend/src/modules/harness/harness.ports.js').RunEventMapping)=>boolean){for(let index=0;index<30;index++){const next=await iterator.next();if(next.done)throw new Error('Stream ended before expected mapping');if(predicate(next.value))return next.value;}throw new Error('Expected mapping was not observed');}
