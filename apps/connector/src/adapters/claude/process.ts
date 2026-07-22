import {spawn,spawnSync,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolveCommand} from '../../command.js';
import {redactConnectorText} from '../../safety.js';
import {BoundedNdjsonDecoder,controlRequest,type ClaudeMessage} from './protocol.js';

export type ClaudeProcessOptions={command?:string;env?:NodeJS.ProcessEnv;cwd:string;args:string[];initializeTimeoutMs?:number;stopGraceMs?:number};
export type ClaudeProcessPort={
  initialize():Promise<{models:unknown[];account?:Record<string,unknown>}>;
  send(value:Record<string,unknown>):void;
  onMessage(listener:(message:ClaudeMessage)=>void):void;
  onExit(listener:(error?:Error)=>void):void;
  interrupt():Promise<void>;
  close():Promise<void>;
};

export class ClaudeCliProcess implements ClaudeProcessPort{
  private child?:ChildProcessWithoutNullStreams;
  private readonly listeners=new Set<(message:ClaudeMessage)=>void>();
  private readonly exitListeners=new Set<(error?:Error)=>void>();
  private stderr='';
  private closed=false;
  constructor(private readonly options:ClaudeProcessOptions){}

  async initialize(){
    await this.ensureStarted();
    const requestId=`init-${randomUUID()}`;
    return new Promise<{models:unknown[];account?:Record<string,unknown>}>((resolve,reject)=>{
      const timeout=setTimeout(()=>finish(new Error('Claude initialize probe timed out')),this.options.initializeTimeoutMs??5_000);
      const listener=(message:ClaudeMessage)=>{const root=object(message),response=object(root.response),payload=object(response?.response);if(root.type!=='control_response'||response?.request_id!==requestId)return;if(response.subtype!=='success'||!payload||!Array.isArray(payload.models)){finish(new Error('Claude initialize response is incompatible'));return;}finish(undefined,{models:payload.models,...(object(payload.account)?{account:object(payload.account)}:{})});};
      const exit=(error?:Error)=>finish(error??new Error(`Claude exited during initialize${this.stderr?`: ${this.stderr}`:''}`));
      const finish=(error?:Error,value?:{models:unknown[];account?:Record<string,unknown>})=>{clearTimeout(timeout);this.listeners.delete(listener);this.exitListeners.delete(exit);if(error)reject(error);else resolve(value!);};
      this.listeners.add(listener);this.exitListeners.add(exit);this.send(controlRequest(requestId,{subtype:'initialize',hooks:{}}));
    });
  }
  onMessage(listener:(message:ClaudeMessage)=>void){this.listeners.add(listener);}
  onExit(listener:(error?:Error)=>void){this.exitListeners.add(listener);}
  send(value:Record<string,unknown>){if(!this.child?.stdin.writable)throw new Error('Claude process stdin is unavailable');this.child.stdin.write(`${JSON.stringify(value)}\n`);}
  async interrupt(){if(!this.child||this.closed)return;try{this.send(controlRequest(`interrupt-${randomUUID()}`,{subtype:'interrupt'}));}catch{}await wait(this.options.stopGraceMs??2_000);if(!this.closed)this.signal('SIGINT');await wait(500);if(!this.closed)this.signal('SIGKILL');}
  async close(){if(!this.child||this.closed)return;this.child.stdin.end();await wait(100);if(!this.closed)this.signal('SIGTERM');await wait(500);if(!this.closed)this.signal('SIGKILL');}

  private async ensureStarted(){
    if(this.child)return;
    const env=this.options.env??process.env,command=await resolveCommand(this.options.command?.trim()||'claude',{env});
    const invocation=claudeInvocation(command,this.options.args,process.platform,env);
    const child=spawn(invocation.file,invocation.args,{cwd:this.options.cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,windowsVerbatimArguments:invocation.windowsVerbatimArguments,detached:process.platform!=='win32'});
    this.child=child;
    const decoder=new BoundedNdjsonDecoder();
    child.stdout.on('data',(chunk:Buffer)=>{try{for(const message of decoder.push(chunk))for(const listener of this.listeners)listener(message);}catch(error){this.finish(error instanceof Error?error:new Error(String(error)));this.signal('SIGKILL');}});
    child.stderr.on('data',(chunk:Buffer)=>{this.stderr=redactConnectorText(`${this.stderr}${chunk.toString('utf8')}`.slice(-8_000),8_000);});
    child.on('error',error=>this.finish(error));
    child.on('exit',(code,signal)=>this.finish(code===0||this.closed?undefined:new Error(redactConnectorText(`Claude exited with ${signal??`code ${code}`}${this.stderr?`: ${this.stderr}`:''}`,1_000))));
  }
  private finish(error?:Error){if(this.closed)return;this.closed=true;for(const listener of this.exitListeners)listener(error);}
  private signal(signal:NodeJS.Signals){
    const child=this.child;if(!child?.pid)return;
    if(process.platform==='win32'){spawnSync('taskkill',['/PID',String(child.pid),'/T',...(signal==='SIGKILL'?['/F']:[])],{windowsHide:true,stdio:'ignore'});return;}
    try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}
  }
}

export function claudeInvocation(executable:string,args:string[],platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env){
  const extension=extname(executable).toLowerCase();
  if(platform!=='win32'||(extension!=='.cmd'&&extension!=='.bat'))return{file:executable,args};
  if(/["\r\n%!?^&|<>]/.test(executable)||args.some(value=>/["\r\n%!?^&|<>]/.test(value)))throw new Error('Windows Claude command invocation contains unsupported shell characters');
  const command=[executable,...args].map(value=>`"${value}"`).join(' ');
  return{file:env.ComSpec??env.COMSPEC??'cmd.exe',args:['/d','/s','/c',`"${command}"`],windowsVerbatimArguments:true};
}

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
