import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import type {ConnectorInstanceConfig} from './config.js';
import {commandInvocation,resolveCommand} from './discovery.js';

export class ManagedHarnessServers{
  private readonly resources=new Map<string,{child?:ChildProcess;references:number}>();
  private closed=false;
  constructor(private readonly env:NodeJS.ProcessEnv=process.env,private readonly request:typeof fetch=fetch,private readonly spawnProcess:typeof spawn=spawn){}
  async acquire(instances:ConnectorInstanceConfig[]){
    if(this.closed)throw new Error('Managed harness servers are closed');
    const endpoints=[...new Set(instances.filter(instance=>instance.enabled&&instance.type==='opencode'&&instance.managed).map(instance=>managedEndpoint(instance).toString()))];
    const acquired:string[]=[];
    try{
      for(const endpoint of endpoints){await this.acquireEndpoint(endpoint);acquired.push(endpoint);}
    }catch(error){this.releaseEndpoints(acquired);throw error;}
    let released=false;
    return{release:()=>{if(released)return;released=true;this.releaseEndpoints(acquired);}};
  }
  close(){if(this.closed)return;this.closed=true;for(const resource of this.resources.values())if(resource.child)stopChild(resource.child);this.resources.clear();}
  private async acquireEndpoint(endpointUrl:string){
    const existing=this.resources.get(endpointUrl);
    if(existing){existing.references+=1;return;}
    const endpoint=new URL(endpointUrl);
    if(await endpointReady(endpointUrl,this.request)){this.resources.set(endpointUrl,{references:1});return;}
    const port=endpoint.port||'4096',command=this.env.AGENVYL_CONNECTOR_OPENCODE_COMMAND??'opencode',executable=await resolveCommand(command,{env:this.env}),invocation=commandInvocation(executable,['serve','--hostname',endpoint.hostname==='localhost'?'127.0.0.1':endpoint.hostname,'--port',port],process.platform,this.env);
    const child=this.spawnProcess(invocation.file,invocation.args,{env:this.env,stdio:'ignore',windowsHide:true,windowsVerbatimArguments:invocation.windowsVerbatimArguments});
    const resource={child,references:1};this.resources.set(endpointUrl,resource);child.once('exit',()=>{if(this.resources.get(endpointUrl)===resource)this.resources.delete(endpointUrl);});
    try{await waitForEndpoint(endpointUrl,this.request,child);}catch(error){stopChild(child);this.resources.delete(endpointUrl);throw error;}
  }
  private releaseEndpoints(endpoints:string[]){
    for(const endpoint of endpoints){const resource=this.resources.get(endpoint);if(!resource)continue;resource.references-=1;if(resource.references>0)continue;if(resource.child)stopChild(resource.child);this.resources.delete(endpoint);}
  }
}

function managedEndpoint(instance:ConnectorInstanceConfig){const endpoint=new URL(instance.endpoint??'http://127.0.0.1:4096');if(!['127.0.0.1','localhost','::1'].includes(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new Error('Managed OpenCode endpoint must be a loopback origin');return endpoint;}

function stopChild(child:ChildProcess){if(process.platform==='win32'&&child.pid){spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});return;}child.kill();}

export async function endpointReady(url:string,request:typeof fetch){try{const response=await request(url,{signal:AbortSignal.timeout(500)});return response.status<500;}catch{return false;}}

async function waitForEndpoint(url:string,request:typeof fetch,child:ChildProcess){const deadline=Date.now()+10_000;while(Date.now()<deadline){if(await endpointReady(url,request))return;if(child.exitCode!==null)throw new Error('Managed OpenCode exited before becoming ready');await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Managed OpenCode did not become ready');}
