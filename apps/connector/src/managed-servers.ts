import {randomUUID} from 'node:crypto';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {resolveAgenvylPaths} from '@agenvyl/runtime-config';
import type {ConnectorInstanceConfig} from './config.js';
import {commandInvocation,resolveCommand} from './discovery.js';
import {inspectManagedProcess,ManagedServerOwnershipStore,sameManagedProcess,type ManagedProcessIdentity,type ManagedServerOwnership} from './managed-server-ownership.js';
import {spawnInWindowsJob} from './windows-job-object.js';

type ManagedResource={child:ChildProcess;references:number;ownership:ManagedServerOwnership};
type ManagedServerOptions={
  platform?:NodeJS.Platform;
  stateDirectory?:string;
  inspectProcess?:(pid:number)=>Promise<ManagedProcessIdentity|undefined>;
  stopProcess?:(record:ManagedServerOwnership)=>Promise<void>;
};

export class ManagedServerError extends Error{
  constructor(readonly code:'managed_endpoint_conflict'|'managed_server_unavailable',message:string,readonly statusCode=code==='managed_endpoint_conflict'?409:503){super(message);this.name='ManagedServerError';}
}

export class ManagedHarnessServers{
  private readonly resources=new Map<string,ManagedResource>();
  private readonly platform:NodeJS.Platform;
  private readonly ownership:ManagedServerOwnershipStore;
  private readonly inspectProcess:(pid:number)=>Promise<ManagedProcessIdentity|undefined>;
  private readonly stopProcess:(record:ManagedServerOwnership)=>Promise<void>;
  private closed=false;

  constructor(
    private readonly env:NodeJS.ProcessEnv=process.env,
    private readonly request:typeof fetch=fetch,
    private readonly spawnProcess:typeof spawn=spawn,
    options:ManagedServerOptions={},
  ){
    this.platform=options.platform??process.platform;
    this.ownership=new ManagedServerOwnershipStore(options.stateDirectory??path.join(resolveAgenvylPaths(env).state,'managed-opencode'));
    this.inspectProcess=options.inspectProcess??(pid=>inspectManagedProcess(pid,this.platform));
    this.stopProcess=options.stopProcess??(record=>stopProcessTree(record,this.platform,this.inspectProcess));
  }

  async acquire(instances:ConnectorInstanceConfig[]){
    if(this.closed)throw new Error('Managed harness servers are closed');
    const managed=instances.filter(instance=>instance.enabled&&instance.type==='opencode'&&instance.managed);
    assertUniqueEndpoints(managed);
    const acquired:string[]=[];
    try{
      for(const instance of managed){await this.acquireInstance(instance);acquired.push(instance.id);}
    }catch(error){await this.releaseInstances(acquired);throw error;}
    let released=false;
    return{release:async()=>{if(released)return;released=true;await this.releaseInstances(acquired);}};
  }

  async acquireAvailable(instances:ConnectorInstanceConfig[]){
    if(this.closed)throw new Error('Managed harness servers are closed');
    const managed=instances.filter(instance=>instance.enabled&&instance.type==='opencode'&&instance.managed),acquired:string[]=[];
    const errors=new Map<string,{code:string;message:string}>();
    try{
      for(const instance of managed){
        try{await this.acquireInstance(instance);acquired.push(instance.id);}
        catch(error){
          if(!(error instanceof ManagedServerError))throw error;
          errors.set(instance.id,{code:error.code,message:error.message});
        }
      }
    }catch(error){await this.releaseInstances(acquired);throw error;}
    let released=false;
    return{errors,release:async()=>{if(released)return;released=true;await this.releaseInstances(acquired);}};
  }

  async restart(instance:ConnectorInstanceConfig){
    if(this.closed)throw new Error('Managed harness servers are closed');
    if(!instance.enabled||instance.type!=='opencode'||!instance.managed)throw new ManagedServerError('managed_server_unavailable','Only an enabled managed OpenCode instance can be restarted');
    const resource=this.resources.get(instance.id),references=resource?.references??0;
    this.resources.delete(instance.id);
    if(resource)await this.stopOwned(resource.ownership);
    else await this.reconcileEndpoint(instance);
    const replacement=await this.start(instance,references);
    this.resources.set(instance.id,replacement);
  }

  async close(){
    if(this.closed)return;
    this.closed=true;
    const resources=[...this.resources.values()];
    this.resources.clear();
    await Promise.allSettled(resources.map(resource=>this.stopOwned(resource.ownership)));
  }

  private async acquireInstance(instance:ConnectorInstanceConfig){
    const existing=this.resources.get(instance.id);
    if(existing){existing.references+=1;return;}
    await this.reconcileEndpoint(instance);
    this.resources.set(instance.id,await this.start(instance,1));
  }

  private async reconcileEndpoint(instance:ConnectorInstanceConfig){
    const endpoint=managedEndpoint(instance).toString(),record=await this.ownership.read(instance.id);
    if(record){
      const current=await this.inspectProcess(record.pid);
      if(sameManagedProcess(record,current))await this.stopOwned(record);
      else if(current)throw endpointConflict(instance.id,endpoint);
      else await this.ownership.remove(instance.id);
    }
    if(await endpointReady(endpoint,this.request))throw endpointConflict(instance.id,endpoint);
  }

  private async start(instance:ConnectorInstanceConfig,references:number):Promise<ManagedResource>{
    const endpoint=managedEndpoint(instance),endpointUrl=endpoint.toString(),port=endpoint.port||'4096';
    const expectedArguments=['serve','--hostname',endpoint.hostname==='localhost'?'127.0.0.1':endpoint.hostname,'--port',port];
    const command=this.env.AGENVYL_CONNECTOR_OPENCODE_COMMAND??'opencode',resolvedExecutable=await resolveCommand(command,{platform:this.platform,env:this.env});
    const canonicalExecutable=await resolveManagedOpenCodeExecutable(resolvedExecutable,this.platform);
    const invocation=commandInvocation(canonicalExecutable,expectedArguments,this.platform,this.env);
    const launched=this.platform==='win32'
      ?spawnInWindowsJob(invocation,this.env,this.spawnProcess)
      :(()=>{const child=this.spawnProcess(invocation.file,invocation.args,{env:this.env,stdio:'ignore',windowsHide:true,windowsVerbatimArguments:invocation.windowsVerbatimArguments,detached:true});return{child,pid:Promise.resolve(child.pid)}})();
    const child=launched.child,serverPid=await launched.pid;
    if(!serverPid)throw new ManagedServerError('managed_server_unavailable','Managed OpenCode did not expose a process ID');
    try{
      const identity=await waitForIdentity(serverPid,this.inspectProcess,child);
      const ownership:ManagedServerOwnership={version:1,instanceId:instance.id,pid:identity.pid,startTime:identity.startTime,endpoint:endpointUrl,canonicalExecutable:identity.executable,expectedArguments,ownerToken:randomUUID(),executable:identity.executable,arguments:identity.arguments};
      await this.ownership.write(ownership);
      await waitForEndpoint(endpointUrl,this.request,child);
      const resource={child,references,ownership};
      child.once('exit',()=>{if(this.resources.get(instance.id)===resource)this.resources.delete(instance.id);});
      return resource;
    }catch(error){
      await stopSpawnedChild(child,this.platform);
      await this.ownership.remove(instance.id);
      if(error instanceof ManagedServerError)throw error;
      throw new ManagedServerError('managed_server_unavailable','Managed OpenCode failed to start');
    }
  }

  private async stopOwned(record:ManagedServerOwnership){
    const current=await this.inspectProcess(record.pid);
    if(!sameManagedProcess(record,current))throw endpointConflict(record.instanceId,record.endpoint);
    await this.stopProcess(record);
    if(await this.inspectProcess(record.pid))throw new ManagedServerError('managed_server_unavailable','Managed OpenCode did not stop');
    await this.ownership.remove(record.instanceId);
  }

  private async releaseInstances(instanceIds:string[]){
    for(const instanceId of instanceIds){
      const resource=this.resources.get(instanceId);
      if(!resource)continue;
      resource.references-=1;
      if(resource.references>0)continue;
      this.resources.delete(instanceId);
      await this.stopOwned(resource.ownership);
    }
  }
}

const managedEndpoint=(instance:ConnectorInstanceConfig)=>{const endpoint=new URL(instance.endpoint??'http://127.0.0.1:4096');if(!['127.0.0.1','localhost','::1'].includes(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new Error('Managed OpenCode endpoint must be a loopback origin');return endpoint;};
const endpointConflict=(instanceId:string,endpoint:string)=>new ManagedServerError('managed_endpoint_conflict',`Managed OpenCode ${instanceId} cannot use ${endpoint}: stop the external server, switch to managed: false, or choose another endpoint`);

const assertUniqueEndpoints=(instances:ConnectorInstanceConfig[])=>{const endpoints=new Set<string>();for(const instance of instances){const endpoint=managedEndpoint(instance).toString();if(endpoints.has(endpoint))throw endpointConflict(instance.id,endpoint);endpoints.add(endpoint);}};

const stopSpawnedChild=async(child:ChildProcess,platform:NodeJS.Platform)=>{if(!child.pid)return;if(platform==='win32'){spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});return;}try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};

const stopProcessTree=async(record:ManagedServerOwnership,platform:NodeJS.Platform,inspect:(pid:number)=>Promise<ManagedProcessIdentity|undefined>)=>{
  if(platform==='win32')spawnSync('taskkill.exe',['/PID',String(record.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
  else{try{process.kill(-record.pid,'SIGTERM');}catch{try{process.kill(record.pid,'SIGTERM');}catch{}}}
  const deadline=Date.now()+3_000;
  while(Date.now()<deadline){if(!await inspect(record.pid))return;await delay(50);}
  if(platform!=='win32'){try{process.kill(-record.pid,'SIGKILL');}catch{try{process.kill(record.pid,'SIGKILL');}catch{}}}
  const forcedDeadline=Date.now()+2_000;
  while(Date.now()<forcedDeadline){if(!await inspect(record.pid))return;await delay(50);}
};

const waitForIdentity=async(pid:number,inspect:(pid:number)=>Promise<ManagedProcessIdentity|undefined>,child:ChildProcess)=>{const deadline=Date.now()+3_000;while(Date.now()<deadline){const identity=await inspect(pid);if(identity)return identity;if(child.exitCode!==null)break;await delay(25);}throw new ManagedServerError('managed_server_unavailable','Managed OpenCode process identity could not be verified');};
export const endpointReady=async(url:string,request:typeof fetch)=>{try{const response=await request(url,{signal:AbortSignal.timeout(500)});return response.status<500;}catch{return false;}};
const waitForEndpoint=async(url:string,request:typeof fetch,child:ChildProcess)=>{const deadline=Date.now()+10_000;while(Date.now()<deadline){if(await endpointReady(url,request))return;if(child.exitCode!==null)throw new ManagedServerError('managed_server_unavailable','Managed OpenCode exited before becoming ready');await delay(150);}throw new ManagedServerError('managed_server_unavailable','Managed OpenCode did not become ready');};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export const resolveManagedOpenCodeExecutable=async(resolvedExecutable:string,platform:NodeJS.Platform,fileExists:(file:string)=>Promise<boolean>=async file=>access(file).then(()=>true,()=>false))=>{
  if(platform!=='win32'||!['.cmd','.bat'].includes(path.win32.extname(resolvedExecutable).toLowerCase()))return resolvedExecutable;
  const nativeExecutable=path.win32.join(path.win32.dirname(resolvedExecutable),'node_modules','opencode-ai','bin','opencode.exe');
  return await fileExists(nativeExecutable)?nativeExecutable:resolvedExecutable;
};
