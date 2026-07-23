import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import type {ConnectorInstanceConfig} from './config.js';
import {commandInvocation,resolveCommand} from './discovery.js';

export class ManagedHarnessServers{
  private readonly children=new Map<string,ChildProcess>();
  constructor(private readonly env:NodeJS.ProcessEnv=process.env,private readonly request:typeof fetch=fetch,private readonly spawnProcess:typeof spawn=spawn){}
  async apply(instances:ConnectorInstanceConfig[]){
    const wanted=new Set(instances.filter(instance=>instance.enabled&&instance.type==='opencode'&&instance.managed).map(instance=>instance.id));
    for(const [id,child] of this.children)if(!wanted.has(id)){stopChild(child);this.children.delete(id);}
    for(const instance of instances)if(instance.enabled&&instance.type==='opencode'&&instance.managed&&!this.children.has(instance.id))await this.startOpenCode(instance);
  }
  close(){for(const child of this.children.values())stopChild(child);this.children.clear();}
  private async startOpenCode(instance:ConnectorInstanceConfig){
    const endpoint=new URL(instance.endpoint??'http://127.0.0.1:4096');
    if(!['127.0.0.1','localhost','::1'].includes(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new Error('Managed OpenCode endpoint must be a loopback origin');
    if(await endpointReady(endpoint.toString(),this.request))return;
    const port=endpoint.port||'4096',command=this.env.AGENVYL_CONNECTOR_OPENCODE_COMMAND??'opencode',executable=await resolveCommand(command,{env:this.env}),invocation=commandInvocation(executable,['serve','--hostname',endpoint.hostname==='localhost'?'127.0.0.1':endpoint.hostname,'--port',port],process.platform,this.env);
    const child=this.spawnProcess(invocation.file,invocation.args,{env:this.env,stdio:'ignore',windowsHide:true,windowsVerbatimArguments:invocation.windowsVerbatimArguments});
    this.children.set(instance.id,child);child.once('exit',()=>this.children.delete(instance.id));
    try{await waitForEndpoint(endpoint.toString(),this.request,child);}catch(error){stopChild(child);this.children.delete(instance.id);throw error;}
  }
}

function stopChild(child:ChildProcess){if(process.platform==='win32'&&child.pid){spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});return;}child.kill();}

export async function endpointReady(url:string,request:typeof fetch){try{const response=await request(url,{signal:AbortSignal.timeout(500)});return response.status<500;}catch{return false;}}

async function waitForEndpoint(url:string,request:typeof fetch,child:ChildProcess){const deadline=Date.now()+10_000;while(Date.now()<deadline){if(await endpointReady(url,request))return;if(child.exitCode!==null)throw new Error('Managed OpenCode exited before becoming ready');await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Managed OpenCode did not become ready');}
