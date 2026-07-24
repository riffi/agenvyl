import {describe,expect,it,vi} from 'vitest';
import type {AppServerMessage,CodexAppServerPort} from './app-server-client.js';
import {CodexConnectorAdapter} from './adapter.js';

class FakeAppServer implements CodexAppServerPort{
  messages=new Set<(message:AppServerMessage)=>void>();exits=new Set<(error:Error)=>void>();responses:Array<{id:string|number;result:unknown}>=[];requests:Array<{method:string;params:unknown}>=[];
  start=vi.fn(async()=>undefined);notify=vi.fn();close=vi.fn(async()=>undefined);
  async request(method:string,params:unknown){this.requests.push({method,params});if(method==='model/list')return{data:[{model:'codex-model',displayName:'Codex Model',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};if(method==='thread/start')return{thread:{id:`thread-${this.requests.filter(request=>request.method==='thread/start').length}`}};if(method==='turn/start')return{turn:{id:`turn-${this.requests.filter(request=>request.method==='turn/start').length}`}};if(method==='turn/interrupt')return{};throw new Error(`Unexpected ${method}`);}
  respond(id:string|number,result:unknown){this.responses.push({id,result});}respondError=vi.fn();
  onMessage(listener:(message:AppServerMessage)=>void){this.messages.add(listener);return()=>this.messages.delete(listener);}onExit(listener:(error:Error)=>void){this.exits.add(listener);return()=>this.exits.delete(listener);}
  emit(message:AppServerMessage){for(const listener of this.messages)listener(message);}
}

const input=(id='run-1')=>({executionId:id,harnessInstanceId:'local-codex',modelId:'codex-model',executionProfile:{workflowMode:'work' as const,reasoningEffort:'high',permissionProfileId:'workspace-write',agentVariantId:null,planEnforcement:null},workspace:{roomId:'room',relativePath:'.',absolutePath:'C:/workspace/room'},input:{systemPrompt:'Be precise',history:[{role:'user' as const,content:'Earlier'}],message:'Now'}});

describe('Codex connector adapter',()=>{
  it('streams text, reasoning, tools, usage, approvals and structured clarification',async()=>{const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client});const execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();expect(client.requests.find(request=>request.method==='thread/start')).toMatchObject({method:'thread/start',params:{cwd:'C:/workspace/room',sandbox:'workspace-write',approvalPolicy:'on-request',ephemeral:true}});expect(client.requests.find(request=>request.method==='turn/start')).toMatchObject({method:'turn/start',params:{summary:'auto',collaborationMode:{mode:'default',settings:{reasoning_effort:'high'}}}});
    client.emit({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'answer',delta:'Hello'}});expect(await iterator.next()).toMatchObject({value:{type:'output.text.delta',payload:{text:'Hello'}}});
    client.emit({method:'item/reasoning/summaryTextDelta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'reasoning-1',summaryIndex:0,delta:'**Thinking**'}});expect(await iterator.next()).toMatchObject({value:{type:'output.reasoning.delta',payload:{text:'**Thinking**'}}});
    client.emit({method:'item/reasoning/summaryTextDelta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'reasoning-1',summaryIndex:1,delta:'**Planning**'}});expect(await iterator.next()).toMatchObject({value:{type:'output.reasoning.delta',payload:{text:'\n\n**Planning**'}}});
    client.emit({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'tool-1',type:'commandExecution',command:'npm test'}}});expect(await iterator.next()).toMatchObject({value:{type:'tool.started',payload:{toolId:'tool-1'}}});
    client.emit({method:'item/commandExecution/outputDelta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'tool-1',delta:'passing'}});expect(await iterator.next()).toMatchObject({value:{type:'tool.updated'}});
    client.emit({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',tokenUsage:{last:{inputTokens:10,outputTokens:4,totalTokens:14,reasoningOutputTokens:2}}}});expect(await iterator.next()).toMatchObject({value:{type:'usage.updated',payload:{usage:{inputTokens:10,outputTokens:4,totalTokens:14,reasoningTokens:2}}}});
    client.emit({id:7,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',command:'npm test'}});const approval=await iterator.next();expect(approval).toMatchObject({value:{type:'request.opened',payload:{request:{kind:'approval',choices:['once','session','deny']}}}});await adapter.resolveRequest(execution,(approval.value as Extract<typeof approval.value,{type:'request.opened'}>).payload.request,{resolution:'session'});expect(client.responses.at(-1)).toEqual({id:7,result:{decision:'acceptForSession'}});
    client.emit({id:'q1',method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',questions:[{id:'format',header:'Format',question:'Which format?',isOther:true,isSecret:false,options:[{label:'SVG',description:'Vector'}]},{id:'token',header:'Token',question:'Secret?',isOther:false,isSecret:true,options:null}]}});const clarification=await iterator.next();expect(clarification).toMatchObject({value:{type:'request.opened',payload:{request:{kind:'clarification',questions:[{id:'format',isOther:true},{id:'token',isSecret:true}]}}}});await adapter.resolveRequest(execution,(clarification.value as Extract<typeof clarification.value,{type:'request.opened'}>).payload.request,{answers:{format:['SVG'],token:['secret']}});expect(client.responses.at(-1)).toEqual({id:'q1',result:{answers:{format:{answers:['SVG']},token:{answers:['secret']}}}});
    client.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});expect(await iterator.next()).toMatchObject({value:{type:'execution.completed'}});expect(await iterator.next()).toEqual({value:undefined,done:true});});
  it('supports concurrent threads and interrupts only the selected turn',async()=>{const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client});const first=await adapter.start(input('one')),second=await adapter.start(input('two'));await adapter.stop(second);expect(client.requests.at(-1)).toEqual({method:'turn/interrupt',params:{threadId:'thread-2',turnId:'turn-2'}});expect(await adapter.inspect(first)).toEqual({status:'running'});});
  it('force closes a lone app-server when an interrupted turn never settles',async()=>{
    vi.useFakeTimers();
    try{
      const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client,stopGraceMs:25}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
      await adapter.stop(execution);await vi.advanceTimersByTimeAsync(25);
      expect(client.close).toHaveBeenCalledTimes(2);
      expect(await iterator.next()).toMatchObject({value:{type:'execution.cancelled'}});
    }finally{vi.useRealTimers();}
  });
  it('isolates concurrent executions and emits terminal only after its process tree closes',async()=>{
    const catalog=new FakeAppServer(),firstClient=new FakeAppServer(),secondClient=new FakeAppServer(),clients=[catalog,firstClient,secondClient];
    let releaseSecond:()=>void=()=>{};
    secondClient.close.mockImplementation(()=>new Promise<void>(resolve=>{releaseSecond=resolve;}));
    const adapter=new CodexConnectorAdapter({clientFactory:()=>clients.shift()!});
    const first=await adapter.start(input('one')),second=await adapter.start(input('two')),firstIterator=adapter.events(first)[Symbol.asyncIterator](),secondIterator=adapter.events(second)[Symbol.asyncIterator]();
    const secondTerminal=secondIterator.next();let delivered=false;void secondTerminal.then(()=>{delivered=true;});
    secondClient.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
    await vi.waitFor(()=>expect(secondClient.close).toHaveBeenCalledTimes(1));
    expect(delivered).toBe(false);
    expect(firstClient.close).not.toHaveBeenCalled();
    expect(await adapter.inspect(first)).toEqual({status:'running'});
    releaseSecond();
    expect(await secondTerminal).toMatchObject({value:{type:'execution.completed'}});
    firstClient.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
    expect(await firstIterator.next()).toMatchObject({value:{type:'execution.completed'}});
    expect(firstClient.close).toHaveBeenCalledTimes(1);
  });
  it('closes an execution app-server when turn startup fails',async()=>{
    const catalog=new FakeAppServer(),executionClient=new FakeAppServer(),adapter=new CodexConnectorAdapter({clientFactory:()=>catalog.close.mock.calls.length?executionClient:catalog});
    const request=executionClient.request.bind(executionClient);
    executionClient.request=vi.fn(async(method:string,params:unknown)=>method==='turn/start'?Promise.reject(new Error('turn failed')):request(method,params));
    await expect(adapter.start(input())).rejects.toThrow('turn failed');
    expect(executionClient.close).toHaveBeenCalledTimes(1);
  });
  it('closes the execution app-server before reporting a failed turn',async()=>{
    const catalog=new FakeAppServer(),executionClient=new FakeAppServer(),clients=[catalog,executionClient],adapter=new CodexConnectorAdapter({clientFactory:()=>clients.shift()!});
    const execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    executionClient.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:'broken'}}}});
    expect(await iterator.next()).toMatchObject({value:{type:'execution.failed',payload:{error:{code:'codex_turn_failed',message:'broken'}}}});
    expect(executionClient.close).toHaveBeenCalledTimes(1);
  });
  it('exposes bounded redacted parameters for Codex tool items',async()=>{const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client});const execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    client.emit({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'command',type:'commandExecution',command:'npm test',cwd:'C:/workspace/room'}}});
    expect(await iterator.next()).toMatchObject({value:{type:'tool.started',payload:{safeInput:'{"command":"npm test","cwd":"[ABSOLUTE_PATH]"}'}}});
    client.emit({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'mcp',type:'mcpToolCall',server:'nodexium',tool:'search',arguments:{query:'Codex',apiKey:'do-not-store'}}}});
    const mcp=await iterator.next();expect(mcp).toMatchObject({value:{type:'tool.started',payload:{toolId:'mcp',safeInput:expect.any(String)}}});
    if(!mcp.value||mcp.value.type!=='tool.started')throw new Error('Expected MCP tool event');
    expect(JSON.parse(mcp.value.payload.safeInput??'')).toEqual({query:'Codex',apiKey:'[REDACTED]'});
    client.emit({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'search',type:'webSearch',query:'Codex app server',action:{type:'search',queries:['Codex app server']}}}});
    expect(await iterator.next()).toMatchObject({value:{type:'tool.started',payload:{safeInput:'{"query":"Codex app server","action":{"type":"search","queries":["Codex app server"]}}'}}});
  });
});
