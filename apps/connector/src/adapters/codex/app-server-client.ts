import {spawn,spawnSync,type ChildProcessByStdio} from 'node:child_process';
import type {Readable,Writable} from 'node:stream';
import {commandInvocation,resolveCommand} from '../../discovery.js';

type RpcId=string|number;
export type AppServerMessage={id?:RpcId;method?:string;params?:unknown;result?:unknown;error?:unknown};
type RunningChild=ChildProcessByStdio<Writable,Readable,Readable>;

export interface CodexAppServerPort{
  start():Promise<void>;
  request(method:string,params:unknown):Promise<unknown>;
  notify(method:string,params:unknown):void;
  respond(id:RpcId,result:unknown):void;
  respondError(id:RpcId,code:number,message:string):void;
  onMessage(listener:(message:AppServerMessage)=>void):()=>void;
  onExit(listener:(error:Error)=>void):()=>void;
  close():Promise<void>;
}

export class CodexAppServerClient implements CodexAppServerPort{
  private child?:RunningChild;
  private startPromise?:Promise<void>;
  private nextId=1;
  private readonly pending=new Map<RpcId,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  private readonly messageListeners=new Set<(message:AppServerMessage)=>void>();
  private readonly exitListeners=new Set<(error:Error)=>void>();
  private decoder=new JsonLineDecoder();

  constructor(private readonly command='codex',private readonly env:NodeJS.ProcessEnv=process.env){}

  start(){return this.startPromise??=this.open().catch(error=>{this.startPromise=undefined;throw error;});}

  async request(method:string,params:unknown){
    await this.start();
    const id=this.nextId++;
    const result=new Promise<unknown>((resolve,reject)=>this.pending.set(id,{resolve,reject}));
    this.write({id,method,params});
    return result;
  }

  notify(method:string,params:unknown){this.write({method,params});}
  respond(id:RpcId,result:unknown){this.write({id,result});}
  respondError(id:RpcId,code:number,message:string){this.write({id,error:{code,message}});}
  onMessage(listener:(message:AppServerMessage)=>void){this.messageListeners.add(listener);return()=>this.messageListeners.delete(listener);}
  onExit(listener:(error:Error)=>void){this.exitListeners.add(listener);return()=>this.exitListeners.delete(listener);}

  async close(){
    const child=this.child;
    this.child=undefined;this.startPromise=undefined;
    const error=new Error('Codex app-server closed');
    for(const pending of this.pending.values())pending.reject(error);
    this.pending.clear();
    if(!child||child.exitCode!==null)return;
    const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
    stopProcessTree(child);
    await waitForClose(closed,2_000);
    if(child.exitCode!==null)return;
    killProcessTree(child);
    await waitForClose(closed,2_000);
  }

  private async open(){
    const executable=await resolveCommand(this.command,{env:this.env});
    const invocation=commandInvocation(executable,['app-server','--listen','stdio://'],process.platform,this.env);
    const child=spawn(invocation.file,invocation.args,{env:this.env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true,windowsVerbatimArguments:invocation.windowsVerbatimArguments});
    this.child=child;
    let stderr='';child.stderr.on('data',chunk=>{if(stderr.length<64_000)stderr+=String(chunk).slice(0,64_000-stderr.length);});
    this.decoder=new JsonLineDecoder();child.stdout.on('data',chunk=>this.readChunk(String(chunk)));
    child.once('error',error=>this.terminated(error));
    child.once('close',(code,signal)=>this.terminated(new Error(stderr.trim()||`Codex app-server exited with ${signal??`code ${code??'unknown'}`}`)));
    const initialized=await this.rawRequest('initialize',{clientInfo:{name:'agenvyl_connector',title:'Agenvyl Connector',version:'0.1.0'},capabilities:{experimentalApi:true}});
    if(!isRecord(initialized))throw new Error('Codex app-server returned an invalid initialize response');
    this.notify('initialized',{});
  }

  private rawRequest(method:string,params:unknown){
    const id=this.nextId++;
    const result=new Promise<unknown>((resolve,reject)=>this.pending.set(id,{resolve,reject}));
    this.write({id,method,params});return result;
  }

  private readLine(line:string){
    if(Buffer.byteLength(line,'utf8')>2*1024*1024){this.protocolFailure(new Error('Codex app-server message exceeded 2 MiB'));return;}
    let message:unknown;try{message=JSON.parse(line);}catch{this.protocolFailure(new Error('Codex app-server emitted invalid JSON'));return;}
    if(!isRecord(message))return;
    const typed=message as AppServerMessage;
    if(typed.id!==undefined&&!typed.method){
      const pending=this.pending.get(typed.id);if(!pending)return;this.pending.delete(typed.id);
      if(typed.error!==undefined){pending.reject(new Error(rpcError(typed.error)));return;}
      pending.resolve(typed.result);return;
    }
    for(const listener of this.messageListeners)listener(typed);
  }

  private readChunk(chunk:string){
    let lines:string[];try{lines=this.decoder.push(chunk);}catch(error){this.protocolFailure(error instanceof Error?error:new Error('Codex app-server message exceeded 2 MiB'));return;}
    for(const line of lines){if(line)this.readLine(line);if(!this.child)return;}
  }

  private protocolFailure(error:Error){const child=this.child;if(child)killProcessTree(child);this.terminated(error);}

  private write(message:AppServerMessage){
    if(!this.child||this.child.exitCode!==null||!this.child.stdin.writable)throw new Error('Codex app-server is not running');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private terminated(error:Error){
    if(!this.child&&!this.startPromise)return;
    this.child=undefined;this.startPromise=undefined;
    for(const pending of this.pending.values())pending.reject(error);this.pending.clear();
    for(const listener of this.exitListeners)listener(error);
  }
}

export class JsonLineDecoder{
  private buffer='';
  constructor(private readonly maxBytes=2*1024*1024){}
  push(chunk:string){this.buffer+=chunk;const lines:string[]=[];while(true){const newline=this.buffer.indexOf('\n');if(newline<0)break;const line=this.buffer.slice(0,newline).replace(/\r$/,'');this.buffer=this.buffer.slice(newline+1);if(Buffer.byteLength(line,'utf8')>this.maxBytes)throw new Error('Codex app-server message exceeded 2 MiB');lines.push(line);}if(Buffer.byteLength(this.buffer,'utf8')>this.maxBytes)throw new Error('Codex app-server message exceeded 2 MiB');return lines;}
}

const rpcError=(value:unknown)=>isRecord(value)&&typeof value.message==='string'?value.message:'Codex app-server request failed';
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const stopProcessTree=(child:RunningChild)=>signalProcessTree(child,'SIGTERM');
const killProcessTree=(child:RunningChild)=>signalProcessTree(child,'SIGKILL');
const waitForClose=async(closed:Promise<void>,timeoutMs:number)=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([closed,new Promise<void>(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
};
const signalProcessTree=(child:RunningChild,signal:NodeJS.Signals)=>{
  if(!child.pid)return;
  if(process.platform==='win32'){spawnSync('taskkill.exe',['/PID',String(child.pid),'/T',...(signal==='SIGKILL'?['/F']:[])],{stdio:'ignore',windowsHide:true});return;}
  try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{/* already stopped */}}
};
