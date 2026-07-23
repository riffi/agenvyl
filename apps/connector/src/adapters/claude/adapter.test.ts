import {describe,expect,it,vi} from 'vitest';
import type {AdapterExecutionEvent,AdapterStartExecutionRequest} from '../../adapter.js';
import {claudeContext,ClaudeConnectorAdapter} from './adapter.js';
import type {ClaudeMessage} from './protocol.js';
import type {ClaudeProcessPort} from './process.js';
import type {ClaudePermissionBridgePort,ClaudePermissionDecision,ClaudePermissionRequest} from './permission-bridge.js';

class FakeProcess implements ClaudeProcessPort{
  sent:Record<string,unknown>[]=[];messages:Array<(message:ClaudeMessage)=>void>=[];exits:Array<(error?:Error)=>void>=[];
  constructor(readonly initialized={models:[{value:'sonnet',displayName:'Sonnet',supportedEffortLevels:['high']}],account:{authMethod:'api_key'}}){}
  initialize(){return Promise.resolve(this.initialized);}
  send(value:Record<string,unknown>){this.sent.push(value);}
  onMessage(listener:(message:ClaudeMessage)=>void){this.messages.push(listener);}
  onExit(listener:(error?:Error)=>void){this.exits.push(listener);}
  interrupt(){return Promise.resolve();}close(){return Promise.resolve();}
  emit(value:ClaudeMessage){for(const listener of this.messages)listener(value);}
}

class FakePermissionBridge implements ClaudePermissionBridgePort{
  handler?:((request:ClaudePermissionRequest)=>Promise<ClaudePermissionDecision>);
  closed=0;
  openRun(_executionId:string,handler:(request:ClaudePermissionRequest)=>Promise<ClaudePermissionDecision>){this.handler=handler;return Promise.resolve({configPath:'C:\\temp\\agenvyl-mcp.json',permissionTool:'mcp__agenvyl_permissions__permission_prompt',close:async()=>{this.closed++;}});}
  close(){return Promise.resolve();}
  request(toolName:string,input:Record<string,unknown>,suggestions?:unknown[],signal:AbortSignal=new AbortController().signal){if(!this.handler)throw new Error('Permission bridge is not open');return this.handler({id:`permission-${toolName}`,toolName,input,...(suggestions?{suggestions}:{}),signal});}
}
const request:AdapterStartExecutionRequest={executionId:'run-1',harnessInstanceId:'local-claude',modelId:'sonnet',executionProfile:{workflowMode:'work',reasoningEffort:'high',permissionProfileId:'default',agentVariantId:null,planEnforcement:null},workspace:{roomId:'room-1',relativePath:'.',absolutePath:process.cwd()},input:{systemPrompt:'Persona',history:[],message:'Hello'}};

describe('Claude adapter',()=>{
  it('streams output, usage and exactly one terminal event',async()=>{const processes:FakeProcess[]=[];const adapter=new ClaudeConnectorAdapter({processFactory:()=>{const value=new FakeProcess();processes.push(value);return value;}});await adapter.start(request);const execution={upstreamId:'run-1'},events=collect(adapter.events(execution));const active=processes[1]!;expect(active.sent[0]).toMatchObject({type:'user'});active.emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',text:'think'}}});active.emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'answer'}}});active.emit({type:'result',subtype:'success',usage:{input_tokens:3,output_tokens:4}});active.emit({type:'result',subtype:'error',error:'late duplicate'});expect(await events).toEqual(expect.arrayContaining([{type:'output.reasoning.delta',payload:{text:'think'}},{type:'output.text.delta',payload:{text:'answer'}},{type:'usage.updated',payload:{usage:{inputTokens:3,outputTokens:4,totalTokens:7}}},{type:'execution.completed',payload:{}}]));});
  it('round-trips four questions, multi-select answers and session-only approval updates',async()=>{const processes:FakeProcess[]=[];const adapter=new ClaudeConnectorAdapter({processFactory:()=>{const value=new FakeProcess();processes.push(value);return value;}});await adapter.start(request);const execution={upstreamId:'run-1'},iterator=adapter.events(execution)[Symbol.asyncIterator](),active=processes[1]!;active.emit({type:'control_request',request_id:'q1',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:Array.from({length:4},(_,index)=>({header:`H${index}`,question:`Q${index}`,multiSelect:index===0,options:[{label:'A'},{label:'B'}]}))}}});const clarification=(await iterator.next()).value!;expect(clarification.type).toBe('request.opened');if(clarification.type!=='request.opened')throw new Error('missing request');expect(clarification.payload.request.questions).toHaveLength(4);await adapter.resolveRequest(execution,clarification.payload.request,{answers:{'question-1':['A','B'],'question-2':['A'],'question-3':['B'],'question-4':['free']}});expect(active.sent.at(-1)).toMatchObject({type:'control_response',response:{response:{behavior:'allow',updatedInput:{answers:{Q0:'A, B',Q1:'A',Q2:'B',Q3:'free'}}}}});active.emit({type:'control_request',request_id:'a1',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'echo ok'},permission_suggestions:[{type:'addRules',destination:'projectSettings',rules:['Bash(echo:*)']}]}});const approval=(await iterator.next()).value!;if(approval.type!=='request.opened')throw new Error('missing approval');await adapter.resolveRequest(execution,approval.payload.request,'session');expect(active.sent.at(-1)).toMatchObject({response:{response:{behavior:'allow',updatedPermissions:[{type:'addRules',destination:'session'}]}}});});
  it('rejects subscription OAuth without persisted opt-in',async()=>{const adapter=new ClaudeConnectorAdapter({processFactory:()=>new FakeProcess({models:[{value:'sonnet'}],account:{authMethod:'oauth_token'}})});await expect(adapter.catalog()).rejects.toThrow('CLAUDE OAUTH');});
  it('handles duplicate and cancelled request IDs idempotently',async()=>{const processes:FakeProcess[]=[];const adapter=new ClaudeConnectorAdapter({processFactory:()=>{const value=new FakeProcess();processes.push(value);return value;}});await adapter.start(request);const iterator=adapter.events({upstreamId:'run-1'})[Symbol.asyncIterator](),active=processes[1]!,approval={type:'control_request',request_id:'same',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'pwd'}}} as const;active.emit(approval);active.emit(approval);expect((await iterator.next()).value?.type).toBe('request.opened');active.emit({type:'control_cancel_request',request_id:'same'});expect(await iterator.next()).toMatchObject({value:{type:'request.resolved',payload:{outcome:'cancelled'}}});});
  it('injects the external MCP bridge and resolves its permission call through the room request',async()=>{
    const processes:FakeProcess[]=[],args:string[][]=[],bridge=new FakePermissionBridge();
    const adapter=new ClaudeConnectorAdapter({permissionBridge:bridge,processFactory:options=>{args.push(options.args);const value=new FakeProcess();processes.push(value);return value;}});
    const execution=await adapter.start(request),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    expect(args[1]).toEqual(expect.arrayContaining(['--mcp-config','C:\\temp\\agenvyl-mcp.json','--permission-prompt-tool','mcp__agenvyl_permissions__permission_prompt']));
    const decision=bridge.request('Write',{file_path:'result.txt'},[{type:'addRules',destination:'projectSettings',rules:['Write(result.txt)']}]);
    const opened=await iterator.next();
    expect(opened.value).toMatchObject({type:'request.opened',payload:{request:{kind:'approval',prompt:expect.stringContaining('result.txt')}}});
    if(!opened.value||opened.value.type!=='request.opened')throw new Error('missing approval');
    await adapter.resolveRequest(execution,opened.value.payload.request,'session');
    await expect(decision).resolves.toEqual({behavior:'allow',updatedInput:{file_path:'result.txt'},updatedPermissions:[{type:'addRules',rules:['Write(result.txt)'],destination:'session'}]});
    processes[1]!.emit({type:'result',subtype:'success'});
    expect((await iterator.next()).value).toEqual({type:'execution.completed',payload:{}});
    await vi.waitFor(()=>expect(bridge.closed).toBe(1));
  });
  it('cancels a pending MCP permission when its client request is aborted',async()=>{
    const processes:FakeProcess[]=[],bridge=new FakePermissionBridge(),controller=new AbortController();
    const adapter=new ClaudeConnectorAdapter({permissionBridge:bridge,processFactory:()=>{const value=new FakeProcess();processes.push(value);return value;}});
    const execution=await adapter.start(request),iterator=adapter.events(execution)[Symbol.asyncIterator](),decision=bridge.request('Bash',{command:'npm test'},undefined,controller.signal);
    const opened=await iterator.next();
    expect(opened.value?.type).toBe('request.opened');
    controller.abort();
    await expect(decision).resolves.toEqual({behavior:'deny',message:'Permission request cancelled'});
    expect(await iterator.next()).toMatchObject({value:{type:'request.resolved',payload:{outcome:'cancelled'}}});
    processes[1]!.emit({type:'result',subtype:'success'});
    expect((await iterator.next()).value?.type).toBe('execution.completed');
  });
  it('bounds persona and room history independently from the current message',()=>{const context=claudeContext({...request,input:{systemPrompt:'s'.repeat(30_000),history:Array.from({length:20},()=>({role:'user' as const,content:'h'.repeat(10_000)})),message:'current'.repeat(20_000)}});expect(context.length).toBeLessThan(70_000);expect(context).not.toContain('currentcurrent');});
});

async function collect(values:AsyncIterable<AdapterExecutionEvent>){const result=[];for await(const value of values)result.push(value);return result;}
