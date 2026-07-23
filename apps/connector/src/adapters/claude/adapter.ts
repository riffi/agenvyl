import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,rmdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ConnectorRequestAnswer,ConnectorRequestSnapshot,ExecutionStatus,TokenUsage} from '@agenvyl/connector-contract';
import type {AdapterExecution,AdapterExecutionEvent,AdapterStartExecutionRequest,ConnectorAdapter} from '../../adapter.js';
import {redactConnectorText} from '../../safety.js';
import {runClaudeAuthStatus} from '../../discovery.js';
import {buildClaudeCatalog,parseClaudePermission} from './mode-catalog.js';
import {ClaudePermissionMcpBridge,type ClaudePermissionBridgePort,type ClaudePermissionDecision,type ClaudePermissionRequest,type ClaudePermissionRun} from './permission-bridge.js';
import {ClaudeCliProcess,type ClaudeProcessPort} from './process.js';
import {controlResponse,record,userFrame,type ClaudeMessage} from './protocol.js';

type Pending={requestId?:string;respond?:(decision:ClaudePermissionDecision)=>void;kind:'approval'|'clarification';toolName:string;input:Record<string,unknown>;questions?:Map<string,string>;suggestions?:unknown[]};
type State={id:string;sessionId:string;status:ExecutionStatus;queue:EventQueue;process:ClaudeProcessPort;pending:Map<string,Pending>;tools:Map<string,string>;textChars:number;reasoningChars:number;cleanup:()=>Promise<void>;terminal:boolean};
export type ClaudeAdapterOptions={command?:string;env?:NodeJS.ProcessEnv;allowSubscriptionOAuth?:boolean;permissionBridge?:ClaudePermissionBridgePort;processFactory?:(options:{cwd:string;args:string[]})=>ClaudeProcessPort;authStatus?:()=>Promise<{authenticated:boolean;kind:'api'|'cloud'|'subscription_oauth'|'none'|'unknown'}>};

export class ClaudeConnectorAdapter implements ConnectorAdapter{
  readonly type='claude';
  readonly capabilities:ConnectorAdapter['capabilities']=['model_catalog','execution_profiles','text_streaming','reasoning','tools','approvals','clarifications','usage'];
  private readonly states=new Map<string,State>();
  private supportedEfforts=new Map<string,Set<string>>();
  private ownedPermissionBridge?:ClaudePermissionMcpBridge;
  constructor(private readonly options:ClaudeAdapterOptions={}){}

  async catalog(){
    await this.checkAuth();
    const processPort=this.createProcess(globalThis.process.cwd(),probeArgs());
    try{const initialized=await processPort.initialize();this.assertAuth(initialized.account);const catalog=buildClaudeCatalog(initialized.models);this.supportedEfforts=new Map(catalog.models.map(model=>[model.id,new Set(model.reasoningEfforts)]));return catalog;}finally{await processPort.close();}
  }

  async start(request:AdapterStartExecutionRequest):Promise<AdapterExecution>{
    if(this.states.has(request.executionId))throw new Error('Claude execution already exists');
    if(!this.supportedEfforts.size)await this.catalog();else await this.checkAuth();
    const efforts=this.supportedEfforts.get(request.modelId);if(!efforts)throw new Error('Claude model is not supported');
    const profile=request.executionProfile;if(profile.reasoningEffort&&!efforts.has(profile.reasoningEffort))throw new Error('Claude reasoning effort is not supported');
    const permission=profile.workflowMode==='plan'?'plan':parseClaudePermission(profile.permissionProfileId),prompt=await createPromptFile(request);
    let state:State|undefined,permissionRun:ClaudePermissionRun|undefined;
    try{permissionRun=await this.permissionBridge()?.openRun(request.executionId,incoming=>state?this.onBridgeRequest(state,incoming):Promise.resolve({behavior:'deny',message:'Claude execution is not ready'}));}
    catch(error){await prompt.cleanup();throw error;}
    const args=executionArgs(request.modelId,permission,profile.reasoningEffort??undefined,prompt.path,permissionRun);
    const process=this.createProcess(request.workspace.absolutePath,args);
    state={id:request.executionId,sessionId:randomUUID(),status:'running',queue:new EventQueue(),process,pending:new Map(),tools:new Map(),textChars:0,reasoningChars:0,cleanup:async()=>{await permissionRun?.close();await prompt.cleanup();},terminal:false};
    this.states.set(state.id,state);process.onMessage(message=>this.onMessage(state,message));process.onExit(error=>{if(error)this.fail(state,'claude_process_exited',error.message);else if(!state.terminal)this.fail(state,'claude_process_exited','Claude exited without a terminal result');});
    try{const initialized=await process.initialize();this.assertAuth(initialized.account);process.send(userFrame(state.sessionId,request.input.message));return{upstreamId:state.id};}catch(error){await this.finish(state,'failed',{code:'claude_start_failed',message:safeError(error)});throw error;}
  }
  async inspect(execution:AdapterExecution){return{status:this.require(execution.upstreamId).status};}
  events(execution:AdapterExecution){return this.require(execution.upstreamId).queue;}

  async resolveRequest(execution:AdapterExecution,request:ConnectorRequestSnapshot,answer:ConnectorRequestAnswer|string){
    const state=this.require(execution.upstreamId),pending=state.pending.get(request.id);if(!pending)return{outcome:'expired' as const};
    let decision:ClaudePermissionDecision;
    if(pending.kind==='clarification'){
      if(typeof answer==='string'||!('answers'in answer))throw new Error('Claude clarification requires structured answers');
      const answers:Record<string,string>={};for(const[id,values]of Object.entries(answer.answers)){const original=pending.questions?.get(id);if(original)answers[original]=values.join(', ');}
      if(Object.keys(answers).length!==pending.questions?.size)throw new Error('Claude clarification answers are incomplete');
      decision={behavior:'allow',updatedInput:{...pending.input,answers}};
    }else{
      const resolution=typeof answer==='string'?answer:'resolution'in answer?answer.resolution:undefined;if(!resolution)throw new Error('Claude approval requires a resolution');
      if(resolution==='deny'||resolution==='denied')decision={behavior:'deny',message:'Denied by user'};
      else if(resolution==='once'||resolution==='approved')decision={behavior:'allow',updatedInput:pending.input};
      else if(resolution==='session'||resolution==='always')decision={behavior:'allow',updatedInput:pending.input,updatedPermissions:sessionPermissions(pending.suggestions)};
      else throw new Error('Claude approval resolution is invalid');
    }
    this.respond(state,pending,decision);state.pending.delete(request.id);return{outcome:'answered' as const};
  }

  async stop(execution:AdapterExecution){const state=this.require(execution.upstreamId);if(state.terminal)return;state.status='stopping';for(const pending of state.pending.values())this.respond(state,pending,{behavior:'deny',message:'Execution cancelled'});state.pending.clear();await state.process.interrupt();if(!state.terminal)await this.finish(state,'cancelled');}
  async close(){await Promise.all([...this.states.values()].map(state=>this.stop({upstreamId:state.id}).catch(()=>undefined)));await this.ownedPermissionBridge?.close();}

  private createProcess(cwd:string,args:string[]){return this.options.processFactory?.({cwd,args})??new ClaudeCliProcess({command:this.options.command,env:this.options.env,cwd,args});}
  private permissionBridge(){if(this.options.permissionBridge)return this.options.permissionBridge;if(this.options.processFactory)return;return this.ownedPermissionBridge??=new ClaudePermissionMcpBridge();}
  private async checkAuth(){const auth=this.options.authStatus?await this.options.authStatus():this.options.processFactory?undefined:await runClaudeAuthStatus(this.options.command?.trim()||'claude',{env:this.options.env});if(!auth)return;if(!auth.authenticated)throw new Error('Claude CLI is not authenticated');if(auth.kind==='subscription_oauth'&&!this.options.allowSubscriptionOAuth)throw new Error('Claude subscription OAuth requires explicit CLAUDE OAUTH confirmation');}
  private assertAuth(account?:Record<string,unknown>){if(subscriptionOAuth(account)&&!this.options.allowSubscriptionOAuth)throw new Error('Claude subscription OAuth requires explicit CLAUDE OAUTH confirmation');}
  private onMessage(state:State,message:ClaudeMessage){
    if(state.terminal)return;
    if(message.type==='control_request'){this.onControlRequest(state,message);return;}
    if(message.type==='control_cancel_request'){this.cancelControlRequest(state,message.request_id);return;}
    if(message.type==='stream_event'){this.onStreamEvent(state,record(message.event));return;}
    if(message.type==='assistant'){this.onAssistant(state,message);return;}
    if(message.type==='user'){this.onToolResults(state,message);return;}
    if(message.type==='tool_progress'&&typeof message.tool_use_id==='string'){state.queue.push({type:'tool.updated',payload:{toolId:message.tool_use_id,name:state.tools.get(message.tool_use_id)??redactConnectorText(String(message.tool_name??'tool'),128),safeSummary:redactConnectorText(String(message.message??'Tool in progress'),500)}});return;}
    if(message.type==='result'){const usage=normalizeUsage(message.usage);if(usage)state.queue.push({type:'usage.updated',payload:{usage}});if(message.subtype==='success')void this.finish(state,'completed');else void this.finish(state,state.status==='stopping'?'cancelled':'failed',{code:'claude_result_error',message:redactConnectorText(String(message.error??message.result??'Claude execution failed'),500)});return;}
    if(message.type==='system'&&(message.subtype==='retry'||message.subtype==='rate_limit'))state.queue.push({type:'execution.upstream_status',payload:{state:'retrying',reason:message.subtype==='rate_limit'?'rate_limited':'provider_unavailable',retryable:true,...(Number.isSafeInteger(message.attempt)?{attempt:Number(message.attempt)}:{}),message:redactConnectorText(String(message.message??'Claude is retrying'),500)}});
  }
  private onStreamEvent(state:State,event?:Record<string,unknown>){const delta=record(event?.delta);if(event?.type==='content_block_delta'&&typeof delta?.text==='string'){const reasoning=delta.type==='thinking_delta';if(reasoning)state.reasoningChars+=delta.text.length;else state.textChars+=delta.text.length;state.queue.push({type:reasoning?'output.reasoning.delta':'output.text.delta',payload:{text:delta.text}});}}
  private onAssistant(state:State,message:ClaudeMessage){const body=record(message.message),content=body?.content,usage=normalizeUsage(body?.usage);if(usage)state.queue.push({type:'usage.updated',payload:{usage}});if(!Array.isArray(content))return;for(const raw of content){const block=record(raw);if(!block)continue;if((block.type==='text'||block.type==='thinking')&&typeof block.text==='string'){const reasoning=block.type==='thinking',sent=reasoning?state.reasoningChars:state.textChars;if(block.text.length>sent)state.queue.push({type:reasoning?'output.reasoning.delta':'output.text.delta',payload:{text:block.text.slice(sent)}});if(reasoning)state.reasoningChars=Math.max(sent,block.text.length);else state.textChars=Math.max(sent,block.text.length);continue;}if(block.type!=='tool_use'||typeof block.id!=='string'||typeof block.name!=='string'||state.tools.has(block.id))continue;const name=redactConnectorText(block.name,128);state.tools.set(block.id,name);state.queue.push({type:'tool.started',payload:{toolId:block.id,name,safeSummary:`Claude started ${name}`,...(block.input===undefined?{}:{safeInput:safeJson(block.input)})}});}}
  private onToolResults(state:State,message:ClaudeMessage){const content=record(message.message)?.content;if(!Array.isArray(content))return;for(const raw of content){const block=record(raw);if(!block||block.type!=='tool_result'||typeof block.tool_use_id!=='string')continue;state.queue.push({type:'tool.completed',payload:{toolId:block.tool_use_id,name:state.tools.get(block.tool_use_id)??'tool',safeSummary:redactConnectorText(String(block.is_error?'Tool failed':'Tool completed'),500)}});}}
  private onControlRequest(state:State,message:ClaudeMessage){
    const request=record(message.request),requestId=typeof message.request_id==='string'?message.request_id:undefined;if(!requestId||request?.subtype!=='can_use_tool'||typeof request.tool_name!=='string'){if(requestId)state.process.send(controlResponse(requestId,{behavior:'deny',message:'Unsupported Claude control request'}));return;}
    const id=requestIdentity(state.id,requestId);if(state.pending.has(id))return;const input=record(request.input)??{};
    if(request.tool_name==='AskUserQuestion'){const normalized=questions(input.questions);if(!normalized){state.process.send(controlResponse(requestId,{behavior:'deny',message:'Invalid clarification request'}));return;}const pending:Pending={requestId,kind:'clarification',toolName:request.tool_name,input,questions:new Map(normalized.map(item=>[item.id,item.question]))};state.pending.set(id,pending);state.queue.push({type:'request.opened',payload:{request:{id,kind:'clarification',prompt:'Claude needs additional input',questions:normalized}}});return;}
    const pending:Pending={requestId,kind:'approval',toolName:request.tool_name,input,...(Array.isArray(request.permission_suggestions)?{suggestions:request.permission_suggestions}:{})};state.pending.set(id,pending);state.queue.push({type:'request.opened',payload:{request:{id,kind:'approval',prompt:redactConnectorText(String(request.description??request.title??`Allow Claude tool ${request.tool_name}?`),2_000),choices:['once','session','deny']}}});
  }
  private onBridgeRequest(state:State,request:ClaudePermissionRequest):Promise<ClaudePermissionDecision>{
    if(state.terminal)return Promise.resolve({behavior:'deny',message:'Claude execution already finished'});
    const id=requestIdentity(state.id,request.id),input=request.input;
    if(request.toolName==='AskUserQuestion'){
      const normalized=questions(input.questions);
      if(!normalized)return Promise.resolve({behavior:'deny',message:'Invalid clarification request'});
      return this.waitForBridgeDecision(state,id,{kind:'clarification',toolName:request.toolName,input,questions:new Map(normalized.map(item=>[item.id,item.question]))},request.signal,{id,kind:'clarification',prompt:'Claude needs additional input',questions:normalized});
    }
    return this.waitForBridgeDecision(state,id,{kind:'approval',toolName:request.toolName,input,...(request.suggestions?{suggestions:request.suggestions}:{})},request.signal,{id,kind:'approval',prompt:permissionPrompt(request.toolName,input),choices:['once','session','deny']});
  }
  private waitForBridgeDecision(state:State,id:string,pending:Pending,signal:AbortSignal,snapshot:ConnectorRequestSnapshot){
    return new Promise<ClaudePermissionDecision>(resolve=>{
      const cancel=()=>{if(!state.pending.delete(id))return;state.queue.push({type:'request.resolved',payload:{requestId:id,outcome:'cancelled'}});resolve({behavior:'deny',message:'Permission request cancelled'});};
      if(signal.aborted){resolve({behavior:'deny',message:'Permission request cancelled'});return;}
      pending.respond=decision=>{signal.removeEventListener('abort',cancel);resolve(decision);};
      state.pending.set(id,pending);signal.addEventListener('abort',cancel,{once:true});
      state.queue.push({type:'request.opened',payload:{request:snapshot}});
    });
  }
  private respond(state:State,pending:Pending,decision:ClaudePermissionDecision){if(pending.respond){pending.respond(decision);return;}if(pending.requestId)state.process.send(controlResponse(pending.requestId,decision));}
  private cancelControlRequest(state:State,value:unknown){if(typeof value!=='string')return;const entry=[...state.pending.entries()].find(([,pending])=>pending.requestId===value);if(!entry)return;state.pending.delete(entry[0]);state.queue.push({type:'request.resolved',payload:{requestId:entry[0],outcome:'cancelled'}});}
  private require(id:string){const state=this.states.get(id);if(!state)throw new Error('Claude execution is not active');return state;}
  private fail(state:State,code:string,message:string){if(!state.terminal)void this.finish(state,state.status==='stopping'?'cancelled':'failed',{code,message:redactConnectorText(message,500)});}
  private async finish(state:State,status:'completed'|'failed'|'cancelled',error?:{code:string;message:string}){if(state.terminal)return;state.terminal=true;state.status=status;for(const[id,pending]of state.pending){this.respond(state,pending,{behavior:'deny',message:'Claude execution finished'});state.queue.push({type:'request.resolved',payload:{requestId:id,outcome:'cancelled'}});}state.pending.clear();state.queue.push(status==='completed'?{type:'execution.completed',payload:{}}:status==='cancelled'?{type:'execution.cancelled',payload:{}}:{type:'execution.failed',payload:{error:error??{code:'claude_failed',message:'Claude execution failed'}}});state.queue.end();this.states.delete(state.id);await state.process.close().catch(()=>undefined);await state.cleanup();}
}

class EventQueue implements AsyncIterable<AdapterExecutionEvent>{private values:AdapterExecutionEvent[]=[];private waiters:Array<(value:IteratorResult<AdapterExecutionEvent>)=>void>=[];private ended=false;push(value:AdapterExecutionEvent){const waiter=this.waiters.shift();if(waiter)waiter({value,done:false});else this.values.push(value);}end(){this.ended=true;for(const waiter of this.waiters)waiter({value:undefined,done:true});this.waiters=[];}[Symbol.asyncIterator](){return{next:():Promise<IteratorResult<AdapterExecutionEvent>>=>{const value=this.values.shift();if(value)return Promise.resolve({value,done:false});if(this.ended)return Promise.resolve({value:undefined,done:true});return new Promise(resolve=>this.waiters.push(resolve));}};}}
const probeArgs=()=>['--print','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence'];
const executionArgs=(model:string,permission:string,effort:string|undefined,promptFile:string,permissionRun?:ClaudePermissionRun)=>[...probeArgs(),'--include-partial-messages','--model',model,'--permission-mode',permission,...(effort?['--effort',effort]:[]),...(permissionRun?['--mcp-config',permissionRun.configPath,'--permission-prompt-tool',permissionRun.permissionTool]:[]),'--append-system-prompt-file',promptFile];
export async function createPromptFile(request:AdapterStartExecutionRequest){const directory=await mkdtemp(join(tmpdir(),'agenvyl-claude-')),path=join(directory,'context.txt');await writeFile(path,claudeContext(request),{encoding:'utf8',mode:0o600});return{path,cleanup:async()=>{await rm(path,{force:true});await rmdir(directory).catch(()=>undefined);}};}
export function claudeContext(request:AdapterStartExecutionRequest){const history=[];let length=0;for(const item of [...request.input.history].reverse()){const value={role:item.role,content:item.content.slice(0,16_000)},size=JSON.stringify(value).length;if(length+size>48_000)break;history.unshift(value);length+=size;}return`${request.input.systemPrompt.slice(0,16_000)}\n\n<AgenvylConversationHistory>\n${JSON.stringify(history)}\n</AgenvylConversationHistory>\nTreat the history as prior room context. Respond only to the current user message.`;}
const questions=(value:unknown)=>{if(!Array.isArray(value)||value.length<1||value.length>4)return;const result=[];for(let index=0;index<value.length;index++){const raw=record(value[index]);if(!raw||typeof raw.question!=='string'||typeof raw.header!=='string'||typeof raw.multiSelect!=='boolean')return;const options=Array.isArray(raw.options)?raw.options.slice(0,20).map(option=>record(option)).filter((option):option is Record<string,unknown>=>Boolean(option&&typeof option.label==='string')).map(option=>({label:redactConnectorText(String(option.label),300),...(typeof option.description==='string'?{description:redactConnectorText(option.description,500)}:{})})):undefined;result.push({id:`question-${index+1}`,header:redactConnectorText(raw.header,128),question:redactConnectorText(raw.question,2_000),isOther:true,isSecret:false,multiSelect:raw.multiSelect,...(options?.length?{options}:{})});}return result;};
const sessionPermissions=(suggestions:unknown[]|undefined)=>(suggestions??[]).map(record).filter((value):value is Record<string,unknown>=>Boolean(value)).map(({destination:_,...value})=>({...value,destination:'session'}));
const permissionPrompt=(toolName:string,input:Record<string,unknown>)=>{const target=typeof input.file_path==='string'?` for ${input.file_path}`:typeof input.command==='string'?`: ${input.command}`:'';return redactConnectorText(`Allow Claude tool ${toolName}${target}?`,2_000);};
const subscriptionOAuth=(account?:Record<string,unknown>)=>String(account?.authMethod??account?.auth_method??'').toLowerCase().includes('oauth');
const normalizeUsage=(value:unknown):TokenUsage|undefined=>{const usage=record(value);if(!usage)return;const input=number(usage.input_tokens??usage.inputTokens),output=number(usage.output_tokens??usage.outputTokens);if(input===undefined||output===undefined)return;const cacheRead=number(usage.cache_read_input_tokens??usage.cacheReadInputTokens),cacheWrite=number(usage.cache_creation_input_tokens??usage.cacheWriteInputTokens);return{inputTokens:input,outputTokens:output,totalTokens:input+output,...(cacheRead===undefined?{}:{cacheReadTokens:cacheRead}),...(cacheWrite===undefined?{}:{cacheWriteTokens:cacheWrite})};};
const number=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):undefined;
const requestIdentity=(executionId:string,requestId:string)=>`req-${createHash('sha256').update(`${executionId}:${requestId}`).digest('hex').slice(0,32)}`;
const safeJson=(value:unknown)=>{try{return redactConnectorText(JSON.stringify(value),8_000);}catch{return'[unavailable]';}};
const safeError=(value:unknown)=>redactConnectorText(value instanceof Error?value.message:String(value),500);
