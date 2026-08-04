import {spawn,spawnSync,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {commandInvocation,resolveCommand} from '../../command.js';
import {redactConnectorText} from '../../safety.js';
import {CursorNdjsonDecoder,type CursorMessage} from './protocol.js';

export type CursorProcessOptions={command:string;env:NodeJS.ProcessEnv;cwd?:string;args:string[];input:string;maxOutputBytes?:number;stopGraceMs?:number};

export class CursorCliProcess{
  private child?:ChildProcessWithoutNullStreams;
  private readonly messages=new Set<(message:CursorMessage)=>void>();
  private readonly exits=new Set<(error?:Error)=>void>();
  private stderr='';private closed=false;
  constructor(private readonly options:CursorProcessOptions){}
  onMessage(listener:(message:CursorMessage)=>void){this.messages.add(listener);}
  onExit(listener:(error?:Error)=>void){this.exits.add(listener);}

  async start(){
    if(this.child)throw new Error('Cursor process already started');
    const executable=await resolveCommand(this.options.command,{env:this.options.env});
    const invocation=commandInvocation(executable,this.options.args,process.platform,this.options.env);
    const child=spawn(invocation.file,invocation.args,{...(this.options.cwd?{cwd:this.options.cwd}:{}),env:this.options.env,stdio:['pipe','pipe','pipe'],windowsHide:true,windowsVerbatimArguments:invocation.windowsVerbatimArguments,detached:process.platform!=='win32'});
    this.child=child;const decoder=new CursorNdjsonDecoder(undefined,this.options.maxOutputBytes);
    child.stdout.on('data',(chunk:Buffer)=>{try{for(const value of decoder.push(chunk))this.emit(value);}catch(error){this.finish(asError(error));this.signal('SIGKILL');}});
    child.stderr.on('data',(chunk:Buffer)=>{this.stderr=redactConnectorText(`${this.stderr}${chunk.toString('utf8')}`.slice(-8_000),8_000);});
    child.once('error',error=>this.finish(error));
    child.once('close',code=>{try{for(const value of decoder.finish())this.emit(value);}catch(error){this.finish(asError(error));return;}this.finish(code===0?undefined:new Error(this.stderr||`Cursor CLI exited with code ${code??'unknown'}`));});
    child.stdin.end(this.options.input,'utf8');
  }

  async interrupt(){
    if(!this.child||this.closed)return;this.signal('SIGINT');
    await wait(this.options.stopGraceMs??2_000);if(!this.closed)this.signal('SIGKILL');
  }
  private emit(value:CursorMessage){for(const listener of this.messages)listener(value);}
  private finish(error?:Error){if(this.closed)return;this.closed=true;for(const listener of this.exits)listener(error);}
  private signal(signal:NodeJS.Signals){
    const child=this.child;if(!child?.pid)return;
    if(process.platform==='win32'){spawnSync('taskkill.exe',['/PID',String(child.pid),'/T',...(signal==='SIGKILL'?['/F']:[])],{stdio:'ignore',windowsHide:true});return;}
    try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}
  }
}

const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const asError=(error:unknown)=>error instanceof Error?error:new Error(String(error));
