import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import type { ConnectorDiscovery, HarnessDiscoveryCandidate, HarnessType } from '@agenvyl/connector-contract';
import { CONNECTOR_API_VERSION } from '@agenvyl/connector-contract';

const execute=promisify(execFile);
type VersionExecutor=(file:string,args:string[],options:{timeout:number;windowsHide:boolean;env:NodeJS.ProcessEnv})=>Promise<{stdout:string;stderr:string}>;

export async function discoverHarnesses(options:{env?:NodeJS.ProcessEnv;request?:typeof fetch;run?:typeof runVersion}={}):Promise<ConnectorDiscovery>{
  const env=options.env??process.env,request=options.request??fetch,run=options.run??runVersion;
  const definitions:Array<{type:HarnessType;label:string;command:string;endpoint?:string;managed:boolean}>=[
    {type:'hermes',label:'Hermes',command:env.AGENVYL_CONNECTOR_HERMES_COMMAND??'hermes',endpoint:env.AGENVYL_CONNECTOR_HERMES_URL??'http://127.0.0.1:8642',managed:false},
    {type:'opencode',label:'OpenCode',command:env.AGENVYL_CONNECTOR_OPENCODE_COMMAND??'opencode',endpoint:env.AGENVYL_CONNECTOR_OPENCODE_URL??'http://127.0.0.1:4096',managed:true},
    {type:'antigravity',label:'Antigravity (AGY)',command:env.AGENVYL_CONNECTOR_AGY_COMMAND??'agy',managed:false},
  ];
  const candidates=await Promise.all(definitions.map(async definition=>{
    const cli=await run(definition.command,{env});
    const endpoint=definition.endpoint?{url:definition.endpoint,reachable:await reachable(definition.endpoint,request)}:undefined;
    const compatible=definition.type==='antigravity'&&cli.found?versionAtLeast(cli.version,'1.1.3'):cli.found;
    const safeToSelect=definition.type!=='antigravity'&&(Boolean(endpoint?.reachable)||definition.type==='opencode'&&cli.found);
    return {type:definition.type,label:definition.label,cli:{...cli,compatible},...(endpoint?{endpoint}:{}),safeToSelect,supportsManagedServer:definition.managed,...(definition.type==='antigravity'?{warning:'AGY runs a subprocess per attempt and requires separate permission confirmation.'}:{})} satisfies HarnessDiscoveryCandidate;
  }));
  return {apiVersion:CONNECTOR_API_VERSION,candidates};
}

export async function runVersion(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor}={}){
  const platform=options.platform??process.platform,env=options.env??process.env,run=options.execute??execute as VersionExecutor;
  try{const executable=await resolveCommand(command,{platform,env,execute:run}),invocation=commandInvocation(executable,['--version'],platform,env),{stdout,stderr}=await run(invocation.file,invocation.args,executionOptions(env));return{found:true,command,version:firstVersion(`${stdout}\n${stderr}`)};}
  catch{return{found:false,command};}
}

export async function resolveCommand(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor}={}){
  const platform=options.platform??process.platform,env=options.env??process.env,run=options.execute??execute as VersionExecutor;
  if(platform!=='win32'||['.exe','.com','.cmd','.bat'].includes(extname(command).toLowerCase()))return command;
  const{stdout}=await run('where.exe',[command],executionOptions(env));
  const matches=stdout.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  const resolved=matches.find(value=>['.exe','.com'].includes(extname(value).toLowerCase()))??matches.find(value=>['.cmd','.bat'].includes(extname(value).toLowerCase()));
  if(!resolved)throw new Error('Command is not available on PATH');
  return resolved;
}

export function commandInvocation(executable:string,args:string[],platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env){
  const extension=extname(executable).toLowerCase();
  if(platform!=='win32'||(extension!=='.cmd'&&extension!=='.bat'))return{file:executable,args};
  if(/["\r\n]/.test(executable)||args.some(value=>!/^[-A-Za-z0-9_.:\[\]]+$/.test(value)))throw new Error('Windows command invocation is invalid');
  return{file:env.ComSpec??env.COMSPEC??'cmd.exe',args:['/d','/s','/c',`""${executable}" ${args.join(' ')}"`]};
}

function executionOptions(env:NodeJS.ProcessEnv){return{timeout:3_000,windowsHide:true,env};}

async function reachable(url:string,request:typeof fetch){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1_000);
  try{const response=await request(url,{method:'GET',signal:controller.signal});return response.status<500;}catch{return false;}finally{clearTimeout(timer);}
}

function firstVersion(value:string){return value.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];}
function versionAtLeast(value:string|undefined,minimum:string){if(!value)return false;const left=value.split(/[.-]/).slice(0,3).map(Number),right=minimum.split('.').map(Number);return left.some((part,index)=>part>right[index]&&left.slice(0,index).every((prior,i)=>prior===right[i]))||left.every((part,index)=>part===right[index]);}
