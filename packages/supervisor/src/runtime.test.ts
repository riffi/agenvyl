import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer,type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {resolveSupervisorConfig} from './config.js';
import {getSupervisorStatus,startSupervisor,stopSupervisor} from './runtime.js';
import type {RuntimeState} from './types.js';

const roots:string[]=[];
const servers:Server[]=[];

afterEach(async()=>{
  await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
  await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));
});

describe('getSupervisorStatus',()=>{
  it('authenticates the protected Connector health check with the stored token',async()=>{
    const token='connector-token-that-is-at-least-32-characters';
    let receivedAuthorization:string|undefined;
    const connector=await listen((request,response)=>{
      receivedAuthorization=request.headers.authorization;
      response.writeHead(receivedAuthorization===`Bearer ${token}`?200:401).end();
    });
    const core=await listen((_request,response)=>response.writeHead(200).end());
    const root=await mkdtemp(join(tmpdir(),'agenvyl-supervisor-status-'));roots.push(root);
    const platform=process.platform==='win32'?'win32':process.platform==='darwin'?'darwin':'linux';
    const config=resolveSupervisorConfig({AGENVYL_HOME:root,AGENVYL_DATABASE_URL:'postgres://external/agenvyl'},{platform,home:root,cwd:root});
    await Promise.all([mkdir(config.paths.config,{recursive:true}),mkdir(config.paths.state,{recursive:true})]);
    await writeFile(config.secretsFile,JSON.stringify({connectorToken:token,postgresPassword:'postgres-password-that-is-at-least-32-characters'}));
    const state:RuntimeState={
      schemaVersion:1,
      daemonPid:process.pid,
      phase:'running',
      startedAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      managedPostgres:false,
      ports:{postgresql:1,connector:port(connector),core:port(core)},
      components:{},
    };
    await writeFile(config.stateFile,JSON.stringify(state));

    await expect(getSupervisorStatus(config)).resolves.toMatchObject({
      running:true,
      health:{connector:'ready',core:'ready'},
    });
    expect(receivedAuthorization).toBe(`Bearer ${token}`);
  });

  it('reports stale runtime metadata when state is missing but the supervisor lock remains',async()=>{
    const config=await temporaryConfig();
    await writeFile(config.lockFile,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));

    await expect(getSupervisorStatus(config)).resolves.toMatchObject({running:false,stale:true,health:{}});
  });
});

describe('supervisor lifecycle races',()=>{
  it('waits for a live locked supervisor to finish starting instead of deleting its files',async()=>{
    const config=await temporaryConfig();
    const state=runtimeState('running');
    await writeFile(config.lockFile,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));

    const starting=startSupervisor(config,'missing-cli.js');
    await new Promise(resolve=>setTimeout(resolve,50));
    await writeFile(config.stateFile,JSON.stringify(state));

    await expect(starting).resolves.toMatchObject({daemonPid:process.pid,phase:'running'});
    await expect(readFile(config.lockFile,'utf8')).resolves.toContain(String(process.pid));
    await expect(readFile(config.stateFile,'utf8')).resolves.toContain('"phase":"running"');
  });

  it('stops a live supervisor through its lock when the state JSON has disappeared',async()=>{
    const config=await temporaryConfig();
    await writeFile(config.lockFile,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));

    const stopping=stopSupervisor(config);
    await waitForFile(config.stopRequestFile);
    await rm(config.stopRequestFile,{force:true});
    await rm(config.lockFile,{force:true});

    await expect(stopping).resolves.toEqual({stopped:true,message:'Agenvyl stopped'});
  });
});

const temporaryConfig=async()=>{
  const root=await mkdtemp(join(tmpdir(),'agenvyl-supervisor-runtime-'));roots.push(root);
  const platform=process.platform==='win32'?'win32':process.platform==='darwin'?'darwin':'linux';
  const config=resolveSupervisorConfig({
    AGENVYL_HOME:root,
    AGENVYL_DATABASE_URL:'postgres://external/agenvyl',
    AGENVYL_READINESS_TIMEOUT_MS:'1000',
    AGENVYL_SHUTDOWN_TIMEOUT_MS:'1000',
  },{platform,home:root,cwd:root});
  await mkdir(config.paths.state,{recursive:true});
  return config;
};

const runtimeState=(phase:RuntimeState['phase']):RuntimeState=>({
  schemaVersion:1,
  daemonPid:process.pid,
  phase,
  startedAt:new Date().toISOString(),
  updatedAt:new Date().toISOString(),
  managedPostgres:false,
  ports:{postgresql:1,connector:2,core:3},
  components:{},
});

const waitForFile=async(path:string)=>{
  const deadline=Date.now()+1000;
  while(Date.now()<deadline){
    try{await readFile(path);return}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error(`Timed out waiting for ${path}`);
};

const listen=(handler:Parameters<typeof createServer>[0])=>new Promise<Server>((resolve,reject)=>{
  const server=createServer(handler);
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{servers.push(server);resolve(server)});
});

const port=(server:Server)=>{
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('Test server did not bind to a TCP port');
  return address.port;
};
