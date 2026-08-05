import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {buildConnectorApp} from '../app.js';
import {CursorConnectorAdapter,type CursorProcessPort} from '../adapters/cursor/adapter.js';
import type {CursorMessage} from '../adapters/cursor/protocol.js';
import {HttpConnectorClient} from '../../../backend/src/integrations/connector/HttpConnectorClient.js';
import {ConnectorRunAdapter} from '../../../backend/src/integrations/connector/ConnectorRunAdapter.js';

const cleanups:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
describe('Cursor Connector/Core fixture',()=>{
  it('covers catalog, streaming, tools, replay, cancellation, and concurrent processes',async()=>{
    const root=await mkdtemp(join(tmpdir(),'agenvyl-cursor-fixture-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));for(const id of ['main','cancel'])await mkdir(join(root,'room','.agenvyl','runs',id,'workspace'),{recursive:true});
    const processes:FixtureCursor[]=[];const adapter=new CursorConnectorAdapter({catalog:{models:[{id:'fixture-model',label:'Fixture'}],controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'plan'},{id:'accept-edits'}],agentVariants:[]}},processFactory:()=>{const process=new FixtureCursor();processes.push(process);return process;}}),token='cursor-fixture-token-that-is-at-least-32-chars';
    const app=buildConnectorApp({version:1,listen:{host:'127.0.0.1',port:0},workspaces:{roots:[root]},instances:[{id:'local-cursor',type:'cursor',enabled:true}],token},{logger:false,adapters:new Map([['local-cursor',adapter]])});await app.listen({host:'127.0.0.1',port:0});cleanups.push(()=>app.close());const address=app.server.address();if(!address||typeof address==='string')throw new Error('Fixture address unavailable');
    const client=new HttpConnectorClient(`http://127.0.0.1:${address.port}`,token),core=new ConnectorRunAdapter(client);expect(await client.catalog('local-cursor')).toMatchObject({models:[{id:'fixture-model'}]});
    const handle=await core.createRun(run('main')),iterator=core.stream(handle.id,'cursor-stream',new AbortController().signal)[Symbol.asyncIterator](),process=processes[0]!,streamed:string[]=[];process.emit({type:'assistant',message:{content:[{type:'text',text:'done'}]}});process.emit({type:'tool_call',subtype:'started',call_id:'tool',tool_call:{readToolCall:{args:{path:'README.md'}}}});process.emit({type:'result',subtype:'success',is_error:false,result:'done'});const terminal=await until(iterator,value=>{streamed.push(...value.events.map(event=>event.type));return Boolean(value.terminal);});expect(terminal.terminal).toEqual({status:'completed'});expect(streamed).toEqual(expect.arrayContaining(['run.delta','tool.updated']));
    const replay=[];for await(const event of client.events(handle.id,{after:0,connectorEpoch:handle.checkpoint!.connectorEpoch,signal:new AbortController().signal}))replay.push(event.type);expect(replay).toEqual(expect.arrayContaining(['output.text.delta','tool.started','execution.completed']));
    const cancel=await core.createRun(run('cancel'));expect(processes).toHaveLength(2);await core.stop(cancel.id);expect(processes[1]?.interrupted).toBe(true);expect((await client.inspect(cancel.id)).status).toBe('cancelled');
  },30_000);
});
class FixtureCursor implements CursorProcessPort{private listener?:(value:CursorMessage)=>void;private exit?:()=>void;interrupted=false;async start(){}onMessage(listener:(value:CursorMessage)=>void){this.listener=listener;}onExit(listener:()=>void){this.exit=listener;}async interrupt(){this.interrupted=true;}emit(value:CursorMessage){this.listener?.(value);if(value.type==='result')queueMicrotask(()=>this.exit?.());}}
const run=(id:string)=>({executionId:id,harnessInstanceId:'local-cursor',modelId:'fixture-model',executionProfile:{workflowMode:'plan' as const,requestedReasoningEffort:null,reasoningEffort:null,reasoningEffortFallback:false,reasoningEffortSource:'auto' as const,planEnforcement:'native' as const,permissionProfileId:'plan',agentVariantId:null},workspace:{roomId:'room',relativePath:`.agenvyl/runs/${id}/workspace`},input:'Do it',sessionId:id,instructions:'Be useful',conversationHistory:[],model:'fixture-model'});
async function until(iterator:AsyncIterator<import('../../../backend/src/modules/harness/harness.ports.js').RunEventMapping>,predicate:(value:import('../../../backend/src/modules/harness/harness.ports.js').RunEventMapping)=>boolean){for(let index=0;index<20;index++){const next=await Promise.race([iterator.next(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Timed out')),2_000))]);if(next.done)throw new Error('Stream ended');if(predicate(next.value))return next.value;}throw new Error('Expected event not observed');}
