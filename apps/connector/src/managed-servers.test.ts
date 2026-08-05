import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ManagedServerOwnershipStore,type ManagedProcessIdentity} from './managed-server-ownership.js';
import {ManagedHarnessServers,endpointReady,resolveManagedOpenCodeExecutable} from './managed-servers.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

describe('managed harness servers',()=>{
  it('rejects a reachable endpoint without verifiable Agenvyl ownership',async()=>{
    const root=await stateRoot(),request=vi.fn<typeof fetch>(async()=>new Response('',{status:200})),spawnProcess=vi.fn() as unknown as typeof spawn;
    const servers=new ManagedHarnessServers({},request,spawnProcess,{stateDirectory:root});

    await expect(servers.acquire([managedInstance()])).rejects.toMatchObject({code:'managed_endpoint_conflict',statusCode:409});
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('isolates startup conflicts so other Connector features can remain available',async()=>{
    const root=await stateRoot(),request=vi.fn<typeof fetch>(async()=>new Response('',{status:200})),spawnProcess=vi.fn() as unknown as typeof spawn;
    const servers=new ManagedHarnessServers({},request,spawnProcess,{stateDirectory:root});

    const runtime=await servers.acquireAvailable([managedInstance(),{id:'external-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4097',managed:false}]);

    expect(runtime.errors.get('local-opencode')).toMatchObject({code:'managed_endpoint_conflict'});
    expect(runtime.errors.has('external-opencode')).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    await runtime.release();
  });

  it('recovers a startup conflict without leaking a managed process reference',async()=>{
    const root=await stateRoot(),instance=managedInstance();let phase:'conflict'|'restart'='conflict',restartProbes=0,alive=true;
    const request=vi.fn<typeof fetch>(async()=>phase==='conflict'||++restartProbes>1?new Response('',{status:200}):new Response('',{status:503}));
    const child={pid:42,exitCode:null,kill:vi.fn(),once:vi.fn()} as unknown as import('node:child_process').ChildProcess;
    const spawnProcess=vi.fn(()=>child) as unknown as typeof spawn;
    const identity:ManagedProcessIdentity={pid:42,startTime:'start-1',executable:process.execPath,arguments:['serve','--hostname','127.0.0.1','--port','4096']};
    const stopProcess=vi.fn(async()=>{alive=false;});
    const servers=new ManagedHarnessServers({AGENVYL_CONNECTOR_OPENCODE_COMMAND:process.execPath},request,spawnProcess,{platform:'linux',stateDirectory:root,inspectProcess:async()=>alive?identity:undefined,stopProcess});
    const initial=await servers.acquireAvailable([instance]);
    expect(initial.errors.has(instance.id)).toBe(true);

    phase='restart';
    await servers.restart(instance);
    const replacement=await servers.acquire([instance]);
    await replacement.release();

    expect(stopProcess).toHaveBeenCalledOnce();
    await initial.release();
  });

  it('keeps an owned process alive until the final generation lease is released',async()=>{
    const root=await stateRoot(),request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValue(new Response('',{status:200}));
    const child={pid:42,exitCode:null,kill:vi.fn(),once:vi.fn()} as unknown as import('node:child_process').ChildProcess;
    const spawnProcess=vi.fn(()=>child) as unknown as typeof spawn;
    let alive=true;
    const identity:ManagedProcessIdentity={pid:42,startTime:'start-1',executable:process.execPath,arguments:['serve','--hostname','127.0.0.1','--port','4096']};
    const stopProcess=vi.fn(async()=>{alive=false;});
    const servers=new ManagedHarnessServers({AGENVYL_CONNECTOR_OPENCODE_COMMAND:process.execPath},request,spawnProcess,{platform:'linux',stateDirectory:root,inspectProcess:async()=>alive?identity:undefined,stopProcess});
    const instances=[managedInstance()],first=await servers.acquire(instances),second=await servers.acquire(instances);

    await first.release();
    expect(stopProcess).not.toHaveBeenCalled();
    await second.release();
    expect(stopProcess).toHaveBeenCalledTimes(1);
  });

  it('never replaces a stale record with mismatched process identity',async()=>{
    const root=await stateRoot(),store=new ManagedServerOwnershipStore(root),instance=managedInstance();
    await store.write({version:1,instanceId:instance.id,pid:41,startTime:'old',endpoint:'http://127.0.0.1:4096/',canonicalExecutable:process.execPath,expectedArguments:['serve'],ownerToken:'token',executable:process.execPath,arguments:['serve']});
    const request=vi.fn<typeof fetch>(async()=>new Response('',{status:200})),stopProcess=vi.fn(async()=>undefined);
    const servers=new ManagedHarnessServers({},request,vi.fn() as unknown as typeof spawn,{stateDirectory:root,inspectProcess:async()=>({pid:41,startTime:'reused',executable:process.execPath,arguments:['serve']}),stopProcess});

    await expect(servers.acquire([instance])).rejects.toMatchObject({code:'managed_endpoint_conflict'});
    expect(stopProcess).not.toHaveBeenCalled();
    expect(await store.read(instance.id)).toBeDefined();
  });

  it('stops a verified stale owned process before starting its replacement',async()=>{
    const root=await stateRoot(),store=new ManagedServerOwnershipStore(root),instance=managedInstance();
    const stale={version:1 as const,instanceId:instance.id,pid:41,startTime:'old',endpoint:'http://127.0.0.1:4096/',canonicalExecutable:process.execPath,expectedArguments:['serve'],ownerToken:'token',executable:process.execPath,arguments:['serve']};
    await store.write(stale);
    const child={pid:42,exitCode:null,kill:vi.fn(),once:vi.fn()} as unknown as import('node:child_process').ChildProcess,spawnProcess=vi.fn(()=>child) as unknown as typeof spawn;
    let oldAlive=true,newAlive=true;
    const inspectProcess=async(pid:number)=>pid===41&&oldAlive?{pid:41,startTime:'old',executable:process.execPath,arguments:['serve']}:pid===42&&newAlive?{pid:42,startTime:'new',executable:process.execPath,arguments:['serve','--hostname','127.0.0.1','--port','4096']}:undefined;
    const stopProcess=vi.fn(async(record:{pid:number})=>{if(record.pid===41)oldAlive=false;else newAlive=false;});
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValue(new Response('',{status:200}));
    const servers=new ManagedHarnessServers({AGENVYL_CONNECTOR_OPENCODE_COMMAND:process.execPath},request,spawnProcess,{platform:'linux',stateDirectory:root,inspectProcess,stopProcess});
    const lease=await servers.acquire([instance]);
    expect(stopProcess).toHaveBeenCalledWith(expect.objectContaining({pid:41}));expect(spawnProcess).toHaveBeenCalledOnce();
    await lease.release();
  });

  it('never starts or stops an externally managed instance',async()=>{
    const root=await stateRoot(),request=vi.fn<typeof fetch>(),spawnProcess=vi.fn() as unknown as typeof spawn,stopProcess=vi.fn();
    const servers=new ManagedHarnessServers({},request,spawnProcess,{stateDirectory:root,stopProcess});
    const lease=await servers.acquire([{...managedInstance(),managed:false}]);
    await lease.release();
    expect(request).not.toHaveBeenCalled();expect(spawnProcess).not.toHaveBeenCalled();expect(stopProcess).not.toHaveBeenCalled();
  });

  it('treats server errors and connection failures as unavailable',async()=>{
    await expect(endpointReady('http://127.0.0.1:4096',vi.fn<typeof fetch>(async()=>new Response('',{status:503})))).resolves.toBe(false);
    await expect(endpointReady('http://127.0.0.1:4096',vi.fn<typeof fetch>(async()=>{throw new Error('offline');}))).resolves.toBe(false);
  });

  it('bypasses the Windows npm command shim for the native OpenCode server',async()=>{
    const resolved=await resolveManagedOpenCodeExecutable('C:\\npm\\opencode.cmd','win32',async file=>file==='C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe');
    expect(resolved).toBe('C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe');
  });
});

const managedInstance=()=>({id:'local-opencode',type:'opencode' as const,enabled:true,endpoint:'http://127.0.0.1:4096',managed:true});
const stateRoot=async()=>{const root=await mkdtemp(path.join(tmpdir(),'managed-opencode-'));roots.push(root);return root;};
