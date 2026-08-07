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
  it('separates distinct agent-authored items without splitting deltas from one item',async()=>{
    const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    client.emit({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'commentary-1',delta:'First'}});
    client.emit({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'commentary-1',delta:' block.'}});
    client.emit({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'commentary-2',delta:'Second block.'}});
    expect((await iterator.next()).value).toMatchObject({payload:{text:'First'}});
    expect((await iterator.next()).value).toMatchObject({payload:{text:' block.'}});
    expect((await iterator.next()).value).toMatchObject({payload:{text:'\n\nSecond block.'}});
  });
  it('separates completed text items recovered without streaming deltas',async()=>{
    const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    client.emit({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'commentary',type:'agentMessage',text:'Commentary.'}}});
    client.emit({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:'Answer.'}}});
    expect((await iterator.next()).value).toMatchObject({payload:{text:'Commentary.'}});
    expect((await iterator.next()).value).toMatchObject({payload:{text:'\n\nAnswer.'}});
  });
  it('runs full access without approvals in Work and forces read-only in Plan',async()=>{
    const workClient=new FakeAppServer(),workAdapter=new CodexConnectorAdapter({client:workClient});
    await workAdapter.start({...input('full-work'),executionProfile:{...input().executionProfile,permissionProfileId:'danger-full-access'}});
    expect(workClient.requests.find(request=>request.method==='thread/start')).toMatchObject({params:{sandbox:'danger-full-access',approvalPolicy:'never'}});
    const planClient=new FakeAppServer(),planAdapter=new CodexConnectorAdapter({client:planClient});
    await planAdapter.start({...input('full-plan'),executionProfile:{...input().executionProfile,workflowMode:'plan' as const,permissionProfileId:'danger-full-access'}});
    expect(planClient.requests.find(request=>request.method==='thread/start')).toMatchObject({params:{sandbox:'read-only',approvalPolicy:'on-request'}});
  });
  it('round-trips MCP form and URL elicitations without failing the execution',async()=>{
    const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    client.emit({id:'form-1',method:'mcpServer/elicitation/request',params:{threadId:'thread-1',turnId:'turn-1',serverName:'nodexium',mode:'form',message:'Confirm workspace',requestedSchema:{type:'object',properties:{workspace:{type:'string'}},required:['workspace']}}});
    const form=await iterator.next();expect(form).toMatchObject({value:{type:'request.opened',payload:{request:{kind:'elicitation',prompt:'Confirm workspace',elicitation:{mode:'form',serverName:'nodexium'}}}}});
    if(!form.value||form.value.type!=='request.opened')throw new Error('Expected form elicitation');
    await expect(adapter.resolveRequest(execution,form.value.payload.request,{elicitation:{action:'accept',content:{workspace:'main'}}})).resolves.toEqual({outcome:'answered'});
    expect(client.responses.at(-1)).toEqual({id:'form-1',result:{action:'accept',content:{workspace:'main'},_meta:null}});

    client.emit({id:'url-1',method:'mcpServer/elicitation/request',params:{threadId:'thread-1',turnId:'turn-1',serverName:'nodexium',mode:'url',message:'Connect account',url:'https://nodexium.example/connect?id=1',elicitationId:'flow-1'}});
    const url=await iterator.next();expect(url).toMatchObject({value:{type:'request.opened',payload:{request:{kind:'elicitation',elicitation:{mode:'url',url:'https://nodexium.example/connect?id=1'}}}}});
    if(!url.value||url.value.type!=='request.opened')throw new Error('Expected URL elicitation');
    await expect(adapter.resolveRequest(execution,url.value.payload.request,{elicitation:{action:'cancel',content:null}})).resolves.toEqual({outcome:'cancelled'});
    expect(client.responses.at(-1)).toEqual({id:'url-1',result:{action:'cancel',content:null,_meta:null}});
  });
  it('safely declines malformed MCP elicitations and keeps the turn active',async()=>{
    const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input());
    client.emit({id:'bad-1',method:'mcpServer/elicitation/request',params:{threadId:'thread-1',turnId:'turn-1',serverName:'nodexium',mode:'url',message:'Open',url:'javascript:alert(1)',elicitationId:'flow-1'}});
    expect(client.responses.at(-1)).toEqual({id:'bad-1',result:{action:'decline',content:null,_meta:null}});
    await expect(adapter.inspect(execution)).resolves.toEqual({status:'running'});
  });
  it('supports concurrent threads and interrupts only the selected turn',async()=>{const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client});const first=await adapter.start(input('one')),second=await adapter.start(input('two'));await adapter.stop(second);expect(client.requests.at(-1)).toEqual({method:'turn/interrupt',params:{threadId:'thread-2',turnId:'turn-2'}});expect(await adapter.inspect(first)).toEqual({status:'running'});});
  it('interrupts and starts a redirected turn in the same thread before releasing new output',async()=>{
    const client=new FakeAppServer(),baseRequest=client.request.bind(client);let turnStarts=0;
    client.request=vi.fn(async(method:string,params:unknown)=>{const result=await baseRequest(method,params);if(method==='turn/start'&&++turnStarts===2)client.emit({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-2',itemId:'redirected',delta:'New answer'}});return result;});
    const adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    client.emit({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'old',delta:'Old partial'}});
    expect(await iterator.next()).toMatchObject({value:{type:'output.text.delta',payload:{text:'Old partial'}}});
    const redirect=adapter.intervene(execution,{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f',text:'Focus on the API'});
    await vi.waitFor(()=>expect(client.requests.at(-1)).toMatchObject({method:'turn/interrupt',params:{threadId:'thread-1',turnId:'turn-1'}}));
    client.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted'}}});
    await redirect;
    expect(client.requests.filter(request=>request.method==='turn/start').at(-1)).toMatchObject({params:{threadId:'thread-1',input:[{text:'Focus on the API'}],collaborationMode:{mode:'default'}}});
    expect(await iterator.next()).toMatchObject({value:{type:'execution.intervention.applied',payload:{interventionId:'c226f522-d864-4f1c-a53f-25d22dc9109f'}}});
    expect(await iterator.next()).toMatchObject({value:{type:'output.text.delta',payload:{text:'New answer'}}});
    client.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-2',status:'completed'}}});
    expect(await iterator.next()).toMatchObject({value:{type:'execution.completed'}});
  });
  it('continues after the old turn wins the completion race',async()=>{
    const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    const redirect=adapter.intervene(execution,{interventionId:'777f7444-e6a9-4e85-818f-20d536876ff7',text:'Now summarize'});
    client.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
    await redirect;
    expect(client.requests.filter(request=>request.method==='turn/start')).toHaveLength(2);
    expect(await iterator.next()).toMatchObject({value:{type:'execution.intervention.applied'}});
  });
  it('fails a redirect and the execution when the replacement turn cannot start',async()=>{
    const client=new FakeAppServer(),baseRequest=client.request.bind(client);let turnStarts=0;
    client.request=vi.fn(async(method:string,params:unknown)=>{if(method==='turn/start'&&++turnStarts===2)throw new Error('replacement failed');return baseRequest(method,params);});
    const adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    const redirect=adapter.intervene(execution,{interventionId:'f09539ab-ee9c-4555-9cf9-e9b2831fbc26',text:'Try a different path'});
    client.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted'}}});
    await expect(redirect).rejects.toThrow('replacement failed');
    expect(await iterator.next()).toMatchObject({value:{type:'execution.intervention.failed',payload:{error:{code:'codex_turn_start_failed'}}}});
    expect(await iterator.next()).toMatchObject({value:{type:'execution.failed',payload:{error:{code:'codex_turn_start_failed'}}}});
  });
  it('lets Stop win before a redirected turn starts',async()=>{
    const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
    const redirect=adapter.intervene(execution,{interventionId:'45725d43-5fd7-4cc4-94a8-56b66362c52f',text:'Change direction'});
    const rejected=expect(redirect).rejects.toThrow('stopped');await adapter.stop(execution);await rejected;
    expect(client.requests.filter(request=>request.method==='turn/start')).toHaveLength(1);
    expect(await iterator.next()).toMatchObject({value:{type:'execution.intervention.failed',payload:{error:{code:'execution_stopped'}}}});
    client.emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted'}}});
    expect(await iterator.next()).toMatchObject({value:{type:'execution.cancelled'}});
  });
  it('force closes a lone app-server when an interrupted turn never settles',async()=>{
    vi.useFakeTimers();
    try{
      const client=new FakeAppServer(),adapter=new CodexConnectorAdapter({client,stopGraceMs:25}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
      await adapter.stop(execution);await vi.advanceTimersByTimeAsync(25);
      expect(client.close).toHaveBeenCalledTimes(2);
      expect(await iterator.next()).toMatchObject({value:{type:'execution.cancelled'}});
    }finally{vi.useRealTimers();}
  });
  it('keeps Stop authoritative during the app-server turn activation race',async()=>{
    vi.useFakeTimers();
    try{
      const client=new FakeAppServer(),baseRequest=client.request.bind(client);client.request=vi.fn(async(method:string,params:unknown)=>{if(method==='turn/interrupt')throw new Error('no active turn to interrupt');return baseRequest(method,params);});
      const adapter=new CodexConnectorAdapter({client,stopGraceMs:25}),execution=await adapter.start(input()),iterator=adapter.events(execution)[Symbol.asyncIterator]();
      await expect(adapter.stop(execution)).resolves.toBeUndefined();await vi.advanceTimersByTimeAsync(25);
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
