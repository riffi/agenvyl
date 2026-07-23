import {createHash} from 'node:crypto';
import type {ConnectorRequestAnswer,ConnectorRequestSnapshot,ExecutionStatus,TokenUsage} from '@agenvyl/connector-contract';
import type {AdapterExecution,AdapterExecutionEvent,AdapterStartExecutionRequest,ConnectorAdapter} from '../../adapter.js';
import {redactConnectorText} from '../../safety.js';
import {CodexAppServerClient,type AppServerMessage,type CodexAppServerPort} from './app-server-client.js';
import {buildCodexCatalog,parseCodexPermission} from './mode-catalog.js';

type RpcId=string|number;
type PendingRequest={rpcId:RpcId;method:string};
type ExecutionState={
  id:string;threadId:string;turnId?:string;status:ExecutionStatus;queue:EventQueue;pending:Map<string,PendingRequest>;itemText:Map<string,number>;reasoningIndexes:Map<string,number>;forceStopTimer?:ReturnType<typeof setTimeout>;
};

export type CodexAdapterOptions={command?:string;env?:NodeJS.ProcessEnv;allowDangerFullAccess?:boolean;client?:CodexAppServerPort;stopGraceMs?:number};

export class CodexConnectorAdapter implements ConnectorAdapter{
  readonly type='codex';
  readonly capabilities:ConnectorAdapter['capabilities']=['model_catalog','execution_profiles','text_streaming','reasoning','tools','approvals','clarifications','usage'];
  private readonly client:CodexAppServerPort;
  private readonly allowDangerFullAccess:boolean;
  private readonly stopGraceMs:number;
  private readonly executions=new Map<string,ExecutionState>();
  private readonly byThread=new Map<string,ExecutionState>();
  private supportedModels=new Map<string,Set<string>>();

  constructor(options:CodexAdapterOptions={}){
    this.client=options.client??new CodexAppServerClient(options.command?.trim()||'codex',options.env);
    this.allowDangerFullAccess=Boolean(options.allowDangerFullAccess);
    this.stopGraceMs=Math.max(0,options.stopGraceMs??3_000);
    this.client.onMessage(message=>this.onMessage(message));
    this.client.onExit(error=>this.onExit(error));
  }

  async catalog(){
    const values:unknown[]=[];let cursor:string|undefined;
    for(let page=0;page<20;page++){const response=record(await this.client.request('model/list',{includeHidden:false,...(cursor?{cursor}:{})}));if(!response||!Array.isArray(response.data))throw new Error('Codex model catalog response is invalid');values.push(...response.data);if(values.length>1_000)throw new Error('Codex model catalog is too large');if(response.nextCursor===null||response.nextCursor===undefined)break;if(typeof response.nextCursor!=='string'||!response.nextCursor||response.nextCursor===cursor)throw new Error('Codex model catalog cursor is invalid');cursor=response.nextCursor;if(page===19)throw new Error('Codex model catalog pagination limit exceeded');}
    const catalog=buildCodexCatalog(values,this.allowDangerFullAccess);this.supportedModels=new Map(catalog.models.map(model=>[model.id,new Set(model.reasoningEfforts)]));return catalog;
  }

  async start(request:AdapterStartExecutionRequest):Promise<AdapterExecution>{
    if(this.executions.has(request.executionId))throw new Error('Codex execution already exists');
    if(!this.supportedModels.size)await this.catalog();
    const efforts=this.supportedModels.get(request.modelId);if(!efforts)throw new Error('Codex model is not supported');
    const profile=request.executionProfile;if(profile.reasoningEffort&&!efforts.has(profile.reasoningEffort))throw new Error('Codex reasoning effort is not supported');
    const configuredSandbox=parseCodexPermission(profile.permissionProfileId,this.allowDangerFullAccess),sandbox=profile.workflowMode==='plan'?'read-only':configuredSandbox;
    const threadResponse=record(await this.client.request('thread/start',{
      model:request.modelId,cwd:request.workspace.absolutePath,
      sandbox,approvalPolicy:sandbox==='danger-full-access'?'never':'on-request',ephemeral:true,
      developerInstructions:codexContext(request),
    }));
    const thread=record(threadResponse?.thread),threadId=typeof thread?.id==='string'?thread.id:undefined;
    if(!threadId)throw new Error('Codex thread/start response is invalid');
    const state:ExecutionState={id:request.executionId,threadId,status:'running',queue:new EventQueue(),pending:new Map(),itemText:new Map(),reasoningIndexes:new Map()};
    this.executions.set(request.executionId,state);this.byThread.set(threadId,state);
    try{
      const collaborationMode={mode:profile.workflowMode==='plan'?'plan':'default',settings:{model:request.modelId,reasoning_effort:profile.reasoningEffort,developer_instructions:null}};
      const turnResponse=record(await this.client.request('turn/start',{threadId,input:[{type:'text',text:request.input.message,text_elements:[]}],summary:'auto',collaborationMode}));
      const turn=record(turnResponse?.turn),turnId=typeof turn?.id==='string'?turn.id:undefined;
      if(!turnId)throw new Error('Codex turn/start response is invalid');
      state.turnId=turnId;
      return{upstreamId:request.executionId};
    }catch(error){this.remove(state);throw error;}
  }

  async inspect(execution:AdapterExecution){return{status:this.require(execution.upstreamId).status};}
  events(execution:AdapterExecution){return this.require(execution.upstreamId).queue;}

  async resolveRequest(execution:AdapterExecution,request:ConnectorRequestSnapshot,answer:ConnectorRequestAnswer|string){
    const state=this.require(execution.upstreamId),pending=state.pending.get(request.id);
    if(!pending)throw new Error('Codex request is no longer pending');
    if(pending.method==='item/tool/requestUserInput'){
      if(typeof answer==='string'||!('answers'in answer))throw new Error('Codex clarification requires structured answers');
      this.client.respond(pending.rpcId,{answers:Object.fromEntries(Object.entries(answer.answers).map(([id,answers])=>[id,{answers}]))});
    }else{
      const resolution=typeof answer==='string'?answer:'resolution'in answer?answer.resolution:undefined;if(!resolution)throw new Error('Codex approval requires a resolution');
      this.client.respond(pending.rpcId,{decision:approvalDecision(resolution)});
    }
    state.pending.delete(request.id);
    return{outcome:'answered' as const};
  }

  async stop(execution:AdapterExecution){
    const state=this.require(execution.upstreamId);
    if(!state.turnId||isTerminal(state.status))return;
    state.status='stopping';
    await this.client.request('turn/interrupt',{threadId:state.threadId,turnId:state.turnId});
    this.armForcedStop(state);
  }

  close(){return this.client.close();}

  private onMessage(message:AppServerMessage){
    const params=record(message.params),threadId=typeof params?.threadId==='string'?params.threadId:undefined;
    if(!threadId||!params)return;
    const state=this.byThread.get(threadId);if(!state)return;
    if(message.id!==undefined&&message.method){this.onServerRequest(state,message.id,message.method,params);return;}
    if(!message.method)return;
    this.onNotification(state,message.method,params);
  }

  private onServerRequest(state:ExecutionState,rpcId:RpcId,method:string,params:Record<string,unknown>){
    if(method==='item/commandExecution/requestApproval'||method==='item/fileChange/requestApproval'){
      const requestId=requestIdentity(state,rpcId),prompt=approvalPrompt(method,params);
      state.pending.set(requestId,{rpcId,method});
      state.queue.push({type:'request.opened',payload:{request:{id:requestId,kind:'approval',prompt,choices:['once','session','deny']}}});return;
    }
    if(method==='item/tool/requestUserInput'){
      const questions=normalizeQuestions(params.questions);if(!questions){this.rejectServerRequest(state,rpcId,'Codex clarification request is invalid');return;}
      const requestId=requestIdentity(state,rpcId);state.pending.set(requestId,{rpcId,method});
      state.queue.push({type:'request.opened',payload:{request:{id:requestId,kind:'clarification',prompt:'Codex needs additional input',questions,...(safeInteger(params.autoResolutionMs)?{autoResolutionMs:Number(params.autoResolutionMs)}:{})}}});return;
    }
    this.rejectServerRequest(state,rpcId,`Unsupported Codex server request: ${method}`);
  }

  private rejectServerRequest(state:ExecutionState,rpcId:RpcId,message:string){
    this.client.respondError(rpcId,-32601,message);this.fail(state,'codex_unsupported_request',message);
  }

  private onNotification(state:ExecutionState,method:string,params:Record<string,unknown>){
    if(state.turnId&&typeof params.turnId==='string'&&params.turnId!==state.turnId)return;
    if(method==='item/agentMessage/delta'&&typeof params.delta==='string'){this.trackText(state,params);state.queue.push({type:'output.text.delta',payload:{text:params.delta}});return;}
    if(method==='item/reasoning/summaryTextDelta'&&typeof params.delta==='string'){this.pushReasoningDelta(state,params,'summaryIndex','summary');return;}
    if(method==='item/reasoning/textDelta'&&typeof params.delta==='string'){this.pushReasoningDelta(state,params,'contentIndex','content');return;}
    if(method==='item/started'){const tool=toolEvent(params.item,'started');if(tool)state.queue.push(tool);return;}
    if((method==='item/commandExecution/outputDelta'||method==='item/fileChange/outputDelta'||method==='item/fileChange/patchUpdated')&&typeof params.itemId==='string'){state.queue.push({type:'tool.updated',payload:{toolId:params.itemId,name:method.includes('fileChange')?'fileChange':'commandExecution',safeSummary:redactConnectorText(typeof params.delta==='string'?params.delta:'File patch updated',500)}});return;}
    if(method==='item/mcpToolCall/progress'&&typeof params.itemId==='string'){state.queue.push({type:'tool.updated',payload:{toolId:params.itemId,name:'mcpToolCall',safeSummary:redactConnectorText(typeof params.message==='string'?params.message:'MCP tool in progress',500)}});return;}
    if(method==='item/completed'){this.completeItem(state,params.item);return;}
    if(method==='thread/tokenUsage/updated'){const usage=tokenUsage(params.tokenUsage);if(usage)state.queue.push({type:'usage.updated',payload:{usage}});return;}
    if(method==='serverRequest/resolved'){this.resolveExternally(state,params.requestId);return;}
    if(method==='error'){const error=record(params.error);if(params.willRetry!==true)this.fail(state,'codex_turn_error',redactConnectorText(String(error?.message??'Codex turn failed'),500));return;}
    if(method==='turn/completed')this.completeTurn(state,params.turn);
  }

  private trackText(state:ExecutionState,params:Record<string,unknown>){if(typeof params.itemId==='string'&&typeof params.delta==='string')state.itemText.set(params.itemId,(state.itemText.get(params.itemId)??0)+params.delta.length);}
  private pushReasoningDelta(state:ExecutionState,params:Record<string,unknown>,indexField:'summaryIndex'|'contentIndex',channel:'summary'|'content'){
    let text=String(params.delta??'');const index=params[indexField],itemId=params.itemId;
    if(typeof itemId==='string'&&safeInteger(index)){
      const key=`${channel}:${itemId}`,current=Number(index),previous=state.reasoningIndexes.get(key);
      if(previous!==undefined&&previous!==current)text=`\n\n${text}`;
      state.reasoningIndexes.set(key,current);
    }
    if(text)state.queue.push({type:'output.reasoning.delta',payload:{text}});
  }
  private completeItem(state:ExecutionState,value:unknown){
    const item=record(value);if(!item)return;
    if((item.type==='agentMessage'||item.type==='plan')&&typeof item.id==='string'&&typeof item.text==='string'){
      const sent=state.itemText.get(item.id)??0;if(item.text.length>sent)state.queue.push({type:'output.text.delta',payload:{text:item.text.slice(sent)}});return;
    }
    const tool=toolEvent(item,'completed');if(tool)state.queue.push(tool);
  }
  private resolveExternally(state:ExecutionState,rpcId:unknown){
    const entry=[...state.pending.entries()].find(([,pending])=>pending.rpcId===rpcId);if(!entry)return;
    state.pending.delete(entry[0]);state.queue.push({type:'request.resolved',payload:{requestId:entry[0],outcome:'expired'}});
  }
  private completeTurn(state:ExecutionState,value:unknown){
    const turn=record(value),status=turn?.status;
    if(status==='completed'){state.status='completed';state.queue.push({type:'execution.completed',payload:{}});}
    else if(status==='interrupted'){state.status='cancelled';state.queue.push({type:'execution.cancelled',payload:{}});}
    else{this.fail(state,'codex_turn_failed',redactConnectorText(String(record(turn?.error)?.message??'Codex turn failed'),500));return;}
    state.queue.end();this.remove(state,false);
  }
  private fail(state:ExecutionState,code:string,message:string){if(isTerminal(state.status))return;state.status='failed';state.queue.push({type:'execution.failed',payload:{error:{code,message}}});state.queue.end();this.remove(state,false);}
  private onExit(error:Error){for(const state of [...this.executions.values()])this.fail(state,'codex_app_server_exited',redactConnectorText(error.message,500));}
  private armForcedStop(state:ExecutionState){
    if(state.forceStopTimer)clearTimeout(state.forceStopTimer);
    state.forceStopTimer=setTimeout(()=>void this.forceStop(state),this.stopGraceMs);
  }
  private async forceStop(state:ExecutionState){
    state.forceStopTimer=undefined;
    if(this.executions.get(state.id)!==state||state.status!=='stopping')return;
    if(this.executions.size>1){this.armForcedStop(state);return;}
    state.status='cancelled';state.queue.push({type:'execution.cancelled',payload:{}});state.queue.end();this.remove(state,false);
    await this.client.close();
  }
  private remove(state:ExecutionState,end=true){if(state.forceStopTimer)clearTimeout(state.forceStopTimer);state.forceStopTimer=undefined;this.executions.delete(state.id);this.byThread.delete(state.threadId);if(end)state.queue.end();}
  private require(id:string){const state=this.executions.get(id);if(!state)throw new Error('Codex execution is not active');return state;}
}

class EventQueue implements AsyncIterable<AdapterExecutionEvent>{
  private values:AdapterExecutionEvent[]=[];private waiters:Array<(value:IteratorResult<AdapterExecutionEvent>)=>void>=[];private ended=false;
  push(value:AdapterExecutionEvent){const waiter=this.waiters.shift();if(waiter)waiter({value,done:false});else this.values.push(value);}
  end(){this.ended=true;for(const waiter of this.waiters)waiter({value:undefined,done:true});this.waiters=[];}
  [Symbol.asyncIterator](){return{next:():Promise<IteratorResult<AdapterExecutionEvent>>=>{const value=this.values.shift();if(value)return Promise.resolve({value,done:false});if(this.ended)return Promise.resolve({value:undefined,done:true});return new Promise(resolve=>this.waiters.push(resolve));}};}
}

const codexContext=(request:AdapterStartExecutionRequest)=>{const history=[];let length=0;for(const item of [...request.input.history].reverse()){const value={role:item.role,content:item.content.slice(0,16_000)},size=JSON.stringify(value).length;if(length+size>48_000)break;history.unshift(value);length+=size;}return`${request.input.systemPrompt.slice(0,16_000)}\n\n<AgenvylConversationHistory>\n${JSON.stringify(history)}\n</AgenvylConversationHistory>\nTreat the history as prior room context. Respond only to the current user message.`;};
const requestIdentity=(state:ExecutionState,id:RpcId)=>`req-${createHash('sha256').update(`${state.threadId}:${String(id)}`).digest('hex').slice(0,32)}`;
const approvalDecision=(value:string)=>value==='once'||value==='approved'?'accept':value==='session'||value==='always'?'acceptForSession':value==='deny'||value==='denied'?'decline':(()=>{throw new Error('Codex approval resolution is invalid');})();
const approvalPrompt=(method:string,params:Record<string,unknown>)=>redactConnectorText(typeof params.reason==='string'?params.reason:method.includes('fileChange')?'Allow Codex to change files?':typeof params.command==='string'?`Allow Codex command: ${params.command}`:'Allow Codex command?',2_000);
const normalizeQuestions=(value:unknown)=>{
  if(!Array.isArray(value)||value.length<1||value.length>4)return;
  const result=[];for(const raw of value){const item=record(raw);if(!item||typeof item.id!=='string'||typeof item.header!=='string'||typeof item.question!=='string'||typeof item.isOther!=='boolean'||typeof item.isSecret!=='boolean')return;const options=Array.isArray(item.options)?item.options.map(option=>record(option)).filter((option):option is Record<string,unknown>=>Boolean(option&&typeof option.label==='string')).map(option=>({label:redactConnectorText(String(option.label),300),...(typeof option.description==='string'?{description:redactConnectorText(option.description,500)}:{})})):undefined;result.push({id:item.id,header:redactConnectorText(item.header,128),question:redactConnectorText(item.question,2_000),isOther:item.isOther,isSecret:item.isSecret,...(typeof item.multiSelect==='boolean'?{multiSelect:item.multiSelect}:{}),...(options?.length?{options}:{})});}return result;
};
const toolEvent=(value:unknown,status:'started'|'completed'):AdapterExecutionEvent|undefined=>{const item=record(value);if(!item||typeof item.id!=='string'||typeof item.type!=='string'||['agentMessage','reasoning','userMessage','plan'].includes(item.type))return;const name=redactConnectorText(item.type,128),summary=toolSummary(item,status),safeInput=toolInput(item);return{type:status==='started'?'tool.started':'tool.completed',payload:{toolId:item.id,name,safeSummary:summary,...(safeInput===undefined?{}:{safeInput})}};};
const toolSummary=(item:Record<string,unknown>,status:string)=>redactConnectorText(typeof item.command==='string'?item.command:typeof item.tool==='string'?`${item.server??'MCP'}: ${item.tool}`:`${item.type} ${status}`,500);
const toolInput=(item:Record<string,unknown>)=>{
  let value:unknown;
  if(item.type==='commandExecution'&&typeof item.command==='string')value={command:item.command,...(typeof item.cwd==='string'?{cwd:item.cwd}:{})};
  else if((item.type==='mcpToolCall'||item.type==='dynamicToolCall')&&item.arguments!==undefined)value=item.arguments;
  else if(item.type==='webSearch')value={...(typeof item.query==='string'?{query:item.query}:{}),...(item.action!==undefined?{action:item.action}:{})};
  else if(item.type==='fileChange'&&Array.isArray(item.changes))value={changes:item.changes};
  else if(item.type==='imageView'&&typeof item.path==='string')value={path:item.path};
  if(value===undefined)return;
  try{return redactConnectorText(JSON.stringify(redactToolInputValue(value)),8_000);}catch{return;}
};
const redactToolInputValue=(value:unknown,depth=0):unknown=>{
  if(depth>8)return'[TRUNCATED]';
  if(typeof value==='string')return redactConnectorText(value,4_000);
  if(value===null||typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,100).map(item=>redactToolInputValue(item,depth+1));
  const object=record(value);if(!object)return String(value);
  return Object.fromEntries(Object.entries(object).slice(0,100).map(([key,item])=>[key,isSensitiveToolInputKey(key)?'[REDACTED]':redactToolInputValue(item,depth+1)]));
};
const isSensitiveToolInputKey=(key:string)=>{const normalized=key.replace(/[-_]/g,'').toLowerCase();return['apikey','accesstoken','auth','authorization','password','passwd','secret','token','cookie','setcookie'].some(suffix=>normalized===suffix||normalized.endsWith(suffix));};
const tokenUsage=(value:unknown):TokenUsage|undefined=>{const usage=record(value),last=record(usage?.last);if(!last||!safeInteger(last.inputTokens)||!safeInteger(last.outputTokens))return;return{inputTokens:Number(last.inputTokens),outputTokens:Number(last.outputTokens),...(safeInteger(last.totalTokens)?{totalTokens:Number(last.totalTokens)}:{}),...(safeInteger(last.reasoningOutputTokens)?{reasoningTokens:Number(last.reasoningOutputTokens)}:{}),...(safeInteger(last.cachedInputTokens)?{cacheReadTokens:Number(last.cachedInputTokens)}:{}),...(safeInteger(last.cacheWriteInputTokens)?{cacheWriteTokens:Number(last.cacheWriteInputTokens)}:{})};};
const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const safeInteger=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const isTerminal=(status:ExecutionStatus)=>status==='completed'||status==='failed'||status==='cancelled';
