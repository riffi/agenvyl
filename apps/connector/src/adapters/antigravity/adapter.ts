import { Buffer } from 'node:buffer';
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ExecutionStatus } from '@agenvyl/connector-contract';
import {AdapterContinuationError,type AdapterExecution,type AdapterExecutionEvent,type AdapterStartExecutionRequest,type ConnectorAdapter} from '../../adapter.js';
import {experimentalTailV2ConversationHistory} from '../../conversation-history.js';
import { commandInvocation, resolveCommand } from '../../discovery.js';
import { redactConnectorText } from '../../safety.js';
import {antigravityContinuationConfiguration,antigravityStorageScopeHash,encodeAntigravityContinuationHandle,parseAntigravityContinuationHandle} from './native-continuation.js';
import {AntigravityCommunicationParser,AntigravityNdjsonDecoder,AntigravityProtocolError,antigravityResult,antigravityText,antigravityTool,type AntigravityMessage,type AntigravityOutputSegment,type AntigravityResult} from './protocol.js';

const minimumVersion = [1, 1, 8] as const;

export type AntigravityAdapterOptions = {
  command?: string;
  commandArgsPrefix?: string[];
  env?: NodeJS.ProcessEnv;
  printTimeoutMs?: number;
  catalogTimeoutMs?: number;
  stopGraceMs?: number;
  maxPromptBytes?: number;
  maxCommandChars?: number;
  maxOutputBytes?: number;
};

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
  outputTooLarge: boolean;
};

type ActiveExecution = {
  child: RunningChild;
  completion: Promise<ProcessResult>;
  queue:EventQueue;
  status: ExecutionStatus;
  stopRequested: boolean;
  terminal:boolean;
  sawMessage:boolean;
  rawStreamedText:string;
  communicationParser:AntigravityCommunicationParser;
  tools:Map<string,string>;
  result?:AntigravityResult;
  continuation:{instanceId:string;directory:string;configurationHash:string;expectedConversationId?:string};
};

type AntigravityCatalog = { models: Array<{ id: string; label: string }>; controls:{nativeWorkflowModes:Array<'plan'|'work'>;permissionProfiles:Array<{id:string;label:string}>;agentVariants:[]} };
const parseAntigravityModel = (value:string) => {
  const [id,label] = value.trim().split(/\t+/,2);
  if(!id)return null;
  return {id,label:label?.trim()||id};
};

export class AntigravityConnectorAdapter implements ConnectorAdapter {
  readonly type = 'antigravity';
  readonly capabilities: ConnectorAdapter['capabilities'] = ['model_catalog', 'execution_profiles','text_streaming','reasoning','tools','usage'];
  readonly postTurnContinuation={mode:'native_session',durability:'connector_restart',retention:'provider_managed'} as const;
  private readonly command: string;
  private readonly commandArgsPrefix: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly storageScopeHash:string;
  private readonly printTimeoutMs: number;
  private readonly catalogTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly maxPromptBytes: number;
  private readonly maxCommandChars: number;
  private readonly maxOutputBytes: number;
  private readonly executions = new Map<string, ActiveExecution>();
  private versionCheck?: Promise<void>;
  private resolvedCommand?: Promise<string>;
  private catalogRequest?: Promise<AntigravityCatalog>;
  private catalogValue?: AntigravityCatalog;

  constructor(options: AntigravityAdapterOptions = {}) {
    this.command = options.command?.trim() || 'agy';
    this.commandArgsPrefix = [...(options.commandArgsPrefix ?? [])];
    this.env = { ...(options.env ?? process.env), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
    this.storageScopeHash=antigravityStorageScopeHash({command:this.command,commandArgsPrefix:this.commandArgsPrefix,platform:process.platform,env:this.env});
    this.printTimeoutMs = positiveInteger(options.printTimeoutMs, 30 * 60_000, 'printTimeoutMs');
    this.catalogTimeoutMs = positiveInteger(options.catalogTimeoutMs, 10_000, 'catalogTimeoutMs');
    this.stopGraceMs = positiveInteger(options.stopGraceMs, 2_000, 'stopGraceMs');
    this.maxPromptBytes = positiveInteger(options.maxPromptBytes, 120 * 1_024, 'maxPromptBytes');
    this.maxCommandChars = positiveInteger(options.maxCommandChars, process.platform === 'win32' ? 30_000 : Number.MAX_SAFE_INTEGER, 'maxCommandChars');
    this.maxOutputBytes = positiveInteger(options.maxOutputBytes, 1_024 * 1_024, 'maxOutputBytes');
  }

  async catalog() {
    if(this.catalogValue)return this.catalogValue;
    const request=this.catalogRequest??=this.loadCatalog();
    try{const catalog=await request;this.catalogValue=catalog;return catalog;}
    finally{if(this.catalogRequest===request)this.catalogRequest=undefined;}
  }

  private async loadCatalog():Promise<AntigravityCatalog>{
    await this.ensureSupportedVersion();
    const result = await this.runProbe(['models']);
    const seen = new Set<string>();
    const models = result.stdout.split(/\r?\n/).map(parseAntigravityModel).filter((model):model is {id:string;label:string}=>{
      if(!model||seen.has(model.id))return false;
      seen.add(model.id);
      return true;
    });
    if (!models.length) throw new Error('Antigravity model catalog returned no models');
    return { models, controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'plan',label:'Plan only'},{id:'accept-edits',label:'Accept edits'}],agentVariants:[]} };
  }

  start(request:AdapterStartExecutionRequest):Promise<AdapterExecution>{return this.startNative(request);}
  startContinuation(request:AdapterStartExecutionRequest,handle:string):Promise<AdapterExecution>{return this.startNative(request,handle);}

  async releaseContinuation(handle:string,scope:{instanceId:string}){
    const continuation=parseAntigravityContinuationHandle(handle);
    if(!continuation)throw new AdapterContinuationError('continuation_unavailable','Antigravity continuation handle is invalid');
    if(continuation.instanceId!==scope.instanceId)throw new AdapterContinuationError('continuation_incompatible','Antigravity continuation belongs to another Connector instance');
    if(continuation.storageScopeHash!==this.storageScopeHash)throw new AdapterContinuationError('continuation_incompatible','Antigravity continuation storage scope changed');
    return'provider_retained' as const;
  }

  private async startNative(request:AdapterStartExecutionRequest,handle?:string):Promise<AdapterExecution>{
    if (this.executions.has(request.executionId)) throw new Error('Antigravity execution already exists');
    await this.ensureSupportedVersion();
    const directory=request.workspace.absolutePath,configurationHash=antigravityContinuationConfiguration(request),continuation=handle?parseAntigravityContinuationHandle(handle):undefined;
    if(handle&&!continuation)throw new AdapterContinuationError('continuation_unavailable','Antigravity continuation handle is invalid');
    if(continuation&&(!request.continuation||request.input.history.length||continuation.instanceId!==request.harnessInstanceId||continuation.directory!==directory||continuation.storageScopeHash!==this.storageScopeHash||continuation.configurationHash!==configurationHash))throw new AdapterContinuationError('continuation_incompatible','Antigravity continuation is incompatible with the requested execution snapshot');
    const configuredMode=parseAntigravityPermission(request.executionProfile.permissionProfileId);
    const mode=request.executionProfile.workflowMode==='plan'?'plan':configuredMode;
    const executable = await this.resolveAgyCommand();
    const fixedArgs = [
      '--dangerously-skip-permissions',
      '--mode', mode,
      '--model', request.modelId,
      '--print-timeout', `${this.printTimeoutMs}ms`,
      '--output-format', 'stream-json',
      ...(continuation?['--conversation',continuation.conversationId]:[]),
    ];
    const fits = (prompt:string) => Buffer.byteLength(prompt, 'utf8') <= this.maxPromptBytes
      && windowsCommandLineLength(executable, [...this.commandArgsPrefix, ...fixedArgs, '--print', prompt]) <= this.maxCommandChars;
    const prompt=continuation?request.input.message:boundedAntigravityPrompt(request,fits);
    if(continuation&&!fits(prompt))throw new Error('Antigravity current request exceeds the configured CLI argv boundary');
    const child = await this.spawnAgy([...fixedArgs, '--print', prompt], directory, executable);
    const queue=new EventQueue();
    const active: ActiveExecution = {
      child,
      completion:Promise.resolve(emptyProcessResult),
      queue,
      status: 'running',
      stopRequested: false,
      terminal:false,
      sawMessage:false,
      rawStreamedText:'',
      communicationParser:new AntigravityCommunicationParser(),
      tools:new Map(),
      continuation:{instanceId:request.harnessInstanceId,directory,configurationHash,...(continuation?{expectedConversationId:continuation.conversationId}:{})},
    };
    active.completion=collectStreamProcess(child,this.maxOutputBytes,message=>this.message(active,message));
    this.executions.set(request.executionId, active);
    void active.completion.then(result=>this.exit(active,result));
    return { upstreamId: request.executionId };
  }

  async inspect(execution: AdapterExecution): Promise<{ status: ExecutionStatus }> {
    const active = this.require(execution.upstreamId);
    return { status: active.status };
  }

  async *events(execution: AdapterExecution): AsyncIterable<AdapterExecutionEvent> {
    const active = this.require(execution.upstreamId);
    try{yield*active.queue;}
    finally{if(active.terminal&&this.executions.get(execution.upstreamId)===active)this.executions.delete(execution.upstreamId);}
  }

  async stop(execution: AdapterExecution): Promise<void> {
    const active = this.require(execution.upstreamId);
    if (active.status === 'completed' || active.status === 'failed' || active.status === 'cancelled') return;
    active.stopRequested = true;
    active.status = 'stopping';
    signalProcessGroup(active.child, 'SIGTERM');
    const finished = await settlesWithin(active.completion, this.stopGraceMs);
    if (!finished) {
      signalProcessGroup(active.child, 'SIGKILL');
      await active.completion;
    }
  }

  private message(active:ActiveExecution,message:AntigravityMessage){
    if(active.terminal)return;
    active.sawMessage=true;
    const text=antigravityText(message);
    if(text){active.rawStreamedText+=text;this.publishSegments(active,active.communicationParser.push(text));}
    const tool=antigravityTool(message);
    if(tool){
      const seen=active.tools.has(tool.id),name=tool.name??active.tools.get(tool.id)??'Antigravity tool';active.tools.set(tool.id,name);
      const type=tool.state==='failed'?'tool.failed':tool.state==='completed'?'tool.completed':seen?'tool.updated':'tool.started';
      active.queue.push({type,payload:{toolId:tool.id,name,safeSummary:`${name} ${tool.state==='failed'?'failed':tool.state==='completed'?'completed':'running'}`,...(tool.parameters===undefined?{}:{safeInput:safeJson(tool.parameters)})}});
    }
    const result=antigravityResult(message);if(result)active.result=result;
  }

  private exit(active:ActiveExecution,result:ProcessResult){
    if(active.terminal)return;
    if(active.stopRequested){this.flushCommunicationParser(active);this.finish(active,{type:'execution.cancelled',payload:{}});return;}
    if(result.error instanceof AntigravityProtocolError){this.flushCommunicationParser(active);this.finish(active,failure(result.error.code,result.error.message));return;}
    if(result.outputTooLarge){this.flushCommunicationParser(active);this.finish(active,failure('agy_output_too_large','Antigravity output exceeded the Connector limit'));return;}
    if(result.error){this.flushCommunicationParser(active);this.finish(active,failure('agy_spawn_failed',result.error.message||'Unable to start Antigravity CLI'));return;}
    const parsed=active.result;
    const recoveredWarning=recoveredArtifactWriteWarning(active,result,parsed);
    if(result.code!==0&&!recoveredWarning){const detail=redactConnectorText(result.stderr,500);this.flushCommunicationParser(active);this.finish(active,failure('agy_execution_failed',detail||`Antigravity CLI exited with code ${result.code??'unknown'}`));return;}
    if(!parsed){this.flushCommunicationParser(active);this.finish(active,failure(active.sawMessage?'agy_invalid_output':'agy_empty_output',active.sawMessage?'Antigravity CLI exited without a terminal result event':'Antigravity CLI completed without a response'));return;}
    if(parsed.status!=='SUCCESS'&&!recoveredWarning){this.flushCommunicationParser(active);this.finish(active,failure('agy_execution_failed',redactConnectorText(parsed.error||parsed.response,500)||`Antigravity CLI returned ${parsed.status}`));return;}
    if(active.continuation.expectedConversationId&&parsed.conversationId!==active.continuation.expectedConversationId){this.flushCommunicationParser(active);this.finish(active,failure('continuation_incompatible','Antigravity resumed a different conversation'));return;}
    const response=parsed.response.trim();
    if(!active.rawStreamedText&&!response){this.flushCommunicationParser(active);this.finish(active,failure('agy_empty_output','Antigravity CLI completed without a response'));return;}
    if(!active.rawStreamedText&&response)this.publishSegments(active,active.communicationParser.push(response));
    else if(parsed.response.startsWith(active.rawStreamedText))this.publishSegments(active,active.communicationParser.push(parsed.response.slice(active.rawStreamedText.length)));
    this.flushCommunicationParser(active);
    if(parsed.usage)active.queue.push({type:'usage.updated',payload:{usage:parsed.usage}});
    const handle=encodeAntigravityContinuationHandle({v:1,harness:'antigravity',instanceId:active.continuation.instanceId,conversationId:parsed.conversationId,directory:active.continuation.directory,storageScopeHash:this.storageScopeHash,configurationHash:active.continuation.configurationHash});
    this.finish(active,{type:'execution.completed',payload:{continuation:{handle},...(recoveredWarning?{warning:recoveredWarning}:{})}});
  }

  private publishSegments(active:ActiveExecution,segments:AntigravityOutputSegment[]){
    for(const segment of segments)active.queue.push({type:segment.type==='reasoning'?'output.reasoning.delta':'output.text.delta',payload:{text:segment.text}});
  }

  private flushCommunicationParser(active:ActiveExecution){this.publishSegments(active,active.communicationParser.finish());}

  private finish(active:ActiveExecution,event:AdapterExecutionEvent){
    if(active.terminal)return;active.terminal=true;active.status=event.type==='execution.completed'?'completed':event.type==='execution.cancelled'?'cancelled':'failed';active.queue.push(event);active.queue.end();
  }

  private async runProbe(args: string[]) {
    const child = await this.spawnAgy(args);
    const completion = collectProcess(child, 256 * 1_024);
    const timeout = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), this.catalogTimeoutMs);
    const result = await completion.finally(() => clearTimeout(timeout));
    if (result.outputTooLarge) throw new Error('Antigravity command output exceeded the catalog limit');
    if (result.error) throw new Error(`Unable to start Antigravity CLI: ${result.error.message}`);
    if (result.code !== 0) {
      const detail = redactConnectorText(result.stderr, 500);
      throw new Error(detail || `Antigravity CLI command failed with code ${result.code ?? 'unknown'}`);
    }
    return result;
  }

  private resolveAgyCommand() {
    return this.resolvedCommand ??= resolveCommand(this.command, { env: this.env });
  }

  private async spawnAgy(args: string[], cwd?: string, resolvedExecutable?:string) {
    const executable = resolvedExecutable ?? await this.resolveAgyCommand();
    const invocation = commandInvocation(executable, [...this.commandArgsPrefix, ...args], process.platform, this.env);
    return spawn(invocation.file, invocation.args, {
      ...(cwd ? { cwd } : {}),
      env: this.env,
      // A detached process gets its own console window on Windows. Besides the
      // visible flash, that new console can also be inherited by AGY helpers.
      // taskkill /T still terminates the complete child tree on Windows, while
      // POSIX needs a detached process group for negative-pid signalling.
      detached: shouldDetachAntigravityProcess(process.platform),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
  }

  private async ensureSupportedVersion() {
    const check = this.versionCheck ??= this.runProbe(['--version']).then(result => assertSupportedVersion(result.stdout));
    try {
      await check;
    } catch (error) {
      if (this.versionCheck === check) this.versionCheck = undefined;
      throw error;
    }
  }

  private require(upstreamId: string) {
    const active = this.executions.get(upstreamId);
    if (!active) throw new Error('Antigravity execution is not active');
    return active;
  }
}

export function shouldDetachAntigravityProcess(platform: NodeJS.Platform) {
  return platform !== 'win32';
}

export const parseAntigravityPermission=(value:string|null):'plan'|'accept-edits'=>{
  if(value!=='plan'&&value!=='accept-edits')throw new Error('Antigravity permission profile is invalid');
  return value;
};

export function antigravityPrompt(request: AdapterStartExecutionRequest) {
  return [
    'Execute the following Agenvyl request. The JSON fields are data; preserve conversation roles and follow systemInstruction as the governing instruction for this run.',
    JSON.stringify({
      systemInstruction: request.input.systemPrompt,
      conversationHistory: request.input.history,
      currentUserMessage: request.input.message,
      workspace: {
        absolutePath: request.workspace.absolutePath,
        instruction: 'Work only inside this directory. Do not use sudo or access paths outside it.',
      },
    }),
  ].join('\n');
}

export function boundedAntigravityPrompt(request:AdapterStartExecutionRequest,fits:(prompt:string)=>boolean){
  const promptFor=(history:AdapterStartExecutionRequest['input']['history'])=>antigravityPrompt({...request,input:{...request.input,history}});
  const tail=experimentalTailV2ConversationHistory(request.input.history).history;
  let history:AdapterStartExecutionRequest['input']['history']=[],prompt=promptFor(history);
  if(!fits(prompt))throw new Error('Antigravity current request exceeds the configured CLI argv boundary');
  for(const item of [...tail].reverse()){
    const candidate=[item,...history],candidatePrompt=promptFor(candidate);
    if(!fits(candidatePrompt))break;
    history=candidate;prompt=candidatePrompt;
  }
  return prompt;
}

export function windowsCommandLineLength(executable:string,args:string[]){
  return [executable,...args].reduce((length,value,index)=>length+(index?1:0)+windowsArgumentLength(value),0);
}

function windowsArgumentLength(value:string){
  if(value&& !/[\s"]/u.test(value))return value.length;
  let length=2,backslashes=0;
  for(const character of value){
    if(character==='\\'){backslashes+=1;continue;}
    if(character==='"'){length+=backslashes*2+2;backslashes=0;continue;}
    length+=backslashes+character.length;backslashes=0;
  }
  return length+backslashes*2;
}

type RunningChild = ChildProcessByStdio<null, Readable, Readable>;
const emptyProcessResult:ProcessResult={code:null,signal:null,stdout:'',stderr:'',outputTooLarge:false};

function collectStreamProcess(child:RunningChild,maxOutputBytes:number,onMessage:(message:AntigravityMessage)=>void):Promise<ProcessResult>{
  return new Promise(resolve=>{
    const decoder=new AntigravityNdjsonDecoder(undefined,maxOutputBytes),stderr:Buffer[]=[];
    let stderrBytes=0,settled=false,spawnError:Error|undefined,protocolError:Error|undefined;
    child.stdout.on('data',(chunk:Buffer|string)=>{
      if(protocolError)return;
      try{for(const message of decoder.push(chunk))onMessage(message);}
      catch(error){protocolError=asError(error);signalProcessGroup(child,'SIGKILL');}
    });
    child.stderr.on('data',(chunk:Buffer|string)=>{
      if(stderrBytes>=64*1_024)return;
      const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk),remaining=64*1_024-stderrBytes;
      stderr.push(value.subarray(0,remaining));stderrBytes+=Math.min(value.length,remaining);
    });
    child.once('error',error=>{spawnError=error;});
    child.once('close',(code,signal)=>{
      if(settled)return;settled=true;
      if(!protocolError){try{for(const message of decoder.finish())onMessage(message);}catch(error){protocolError=asError(error);}}
      const error=protocolError??spawnError;
      resolve({code,signal,stdout:'',stderr:Buffer.concat(stderr).toString('utf8'),...(error?{error}:{}),outputTooLarge:protocolError instanceof AntigravityProtocolError&&protocolError.code==='agy_output_too_large'});
    });
  });
}

function collectProcess(child: RunningChild, maxOutputBytes: number): Promise<ProcessResult> {
  return new Promise(resolve => {
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let stdoutBytes = 0, stderrBytes = 0, outputTooLarge = false, settled = false, spawnError: Error | undefined;
    child.stdout.on('data', (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += value.length;
      if (stdoutBytes > maxOutputBytes) {
        outputTooLarge = true;
        signalProcessGroup(child, 'SIGKILL');
        return;
      }
      stdout.push(value);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderrBytes >= 64 * 1_024) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = 64 * 1_024 - stderrBytes;
      stderr.push(value.subarray(0, remaining));
      stderrBytes += Math.min(value.length, remaining);
    });
    child.once('error', error => { spawnError = error; });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), ...(spawnError ? { error: spawnError } : {}), outputTooLarge });
    });
  });
}

function signalProcessGroup(child: RunningChild, signal: NodeJS.Signals) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const force = signal === 'SIGKILL';
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch (error) {
    if (!isMissingProcess(error)) {
      try { child.kill(signal); } catch (fallbackError) { if (!isMissingProcess(fallbackError)) throw fallbackError; }
    }
  }
}

async function settlesWithin(completion: Promise<unknown>, timeoutMs: number) {
  return Promise.race([completion.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), timeoutMs))]);
}

function assertSupportedVersion(value: string) {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error('Antigravity CLI returned an invalid version');
  const version = match.slice(1).map(Number);
  for (let index = 0; index < minimumVersion.length; index += 1) {
    if (version[index]! > minimumVersion[index]) return;
    if (version[index]! < minimumVersion[index]) throw new Error('Antigravity CLI 1.1.8 or newer is required');
  }
}

function failure(code: string, message: string): AdapterExecutionEvent { return { type: 'execution.failed', payload: { error: { code, message } } }; }

function recoveredArtifactWriteWarning(active:ActiveExecution,result:ProcessResult,parsed:AntigravityResult|undefined){
  if(result.code===0||!parsed)return;
  const streamed=active.rawStreamedText.trim(),response=parsed.response.trim();
  if(!streamed||!response||!response.startsWith(streamed))return;
  const error=`${result.stderr}\n${parsed.error??''}`;
  if(!/declaring permissions:\s*cortex tool write_to_file:/iu.test(error)
    ||!/invalid tool call error \(invalid_args\)/iu.test(error)
    ||!/is not a valid artifact path; artifacts must be in/iu.test(error))return;
  return{
    code:'agy_recovered_artifact_write',
    message:'Antigravity rejected an intermediate write_to_file call outside its artifact directory, then continued and produced the final response.',
  };
}
function positiveInteger(value: number | undefined, fallback: number, label: string) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`Antigravity ${label} must be a positive integer`);
  return resolved;
}
function isMissingProcess(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ESRCH'; }
function safeJson(value:unknown){let serialized:string;try{serialized=JSON.stringify(value);}catch{serialized=String(value);}return redactConnectorText(serialized.slice(0,1_000),1_000);}
function asError(error:unknown){return error instanceof Error?error:new Error(String(error));}

class EventQueue implements AsyncIterable<AdapterExecutionEvent>{
  private values:AdapterExecutionEvent[]=[];private waiters:Array<(value:IteratorResult<AdapterExecutionEvent>)=>void>=[];private ended=false;
  push(value:AdapterExecutionEvent){const waiter=this.waiters.shift();if(waiter)waiter({value,done:false});else this.values.push(value);}
  end(){this.ended=true;for(const waiter of this.waiters)waiter({value:undefined,done:true});this.waiters=[];}
  [Symbol.asyncIterator](){return{next:():Promise<IteratorResult<AdapterExecutionEvent>>=>{const value=this.values.shift();if(value)return Promise.resolve({value,done:false});if(this.ended)return Promise.resolve({value:undefined,done:true});return new Promise(resolve=>this.waiters.push(resolve));}};}
}
