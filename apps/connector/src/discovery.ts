import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConnectorDiscovery, HarnessDiscoveryCandidate, HarnessType } from '@agenvyl/connector-contract';
import { CONNECTOR_API_VERSION } from '@agenvyl/connector-contract';

const execute=promisify(execFile);

export async function discoverHarnesses(options:{env?:NodeJS.ProcessEnv;request?:typeof fetch;run?:typeof runVersion}={}):Promise<ConnectorDiscovery>{
  const env=options.env??process.env,request=options.request??fetch,run=options.run??runVersion;
  const definitions:Array<{type:HarnessType;label:string;command:string;endpoint?:string;managed:boolean}>=[
    {type:'hermes',label:'Hermes',command:env.AGENVYL_CONNECTOR_HERMES_COMMAND??'hermes',endpoint:env.AGENVYL_CONNECTOR_HERMES_URL??'http://127.0.0.1:8642',managed:false},
    {type:'opencode',label:'OpenCode',command:env.AGENVYL_CONNECTOR_OPENCODE_COMMAND??'opencode',endpoint:env.AGENVYL_CONNECTOR_OPENCODE_URL??'http://127.0.0.1:4096',managed:true},
    {type:'antigravity',label:'Antigravity (AGY)',command:env.AGENVYL_CONNECTOR_AGY_COMMAND??'agy',managed:false},
  ];
  const candidates=await Promise.all(definitions.map(async definition=>{
    const cli=await run(definition.command);
    const endpoint=definition.endpoint?{url:definition.endpoint,reachable:await reachable(definition.endpoint,request)}:undefined;
    const compatible=definition.type==='antigravity'&&cli.found?versionAtLeast(cli.version,'1.1.3'):cli.found;
    const safeToSelect=definition.type!=='antigravity'&&(Boolean(endpoint?.reachable)||definition.type==='opencode'&&cli.found);
    return {type:definition.type,label:definition.label,cli:{...cli,compatible},...(endpoint?{endpoint}:{}),safeToSelect,supportsManagedServer:definition.managed,...(definition.type==='antigravity'?{warning:'AGY runs a subprocess per attempt and requires separate permission confirmation.'}:{})} satisfies HarnessDiscoveryCandidate;
  }));
  return {apiVersion:CONNECTOR_API_VERSION,candidates};
}

export async function runVersion(command:string){
  try{const {stdout,stderr}=await execute(command,['--version'],{timeout:3_000,windowsHide:true});return{found:true,command,version:firstVersion(`${stdout}\n${stderr}`)};}
  catch{return{found:false,command};}
}

async function reachable(url:string,request:typeof fetch){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1_000);
  try{const response=await request(url,{method:'GET',signal:controller.signal});return response.status<500;}catch{return false;}finally{clearTimeout(timer);}
}

function firstVersion(value:string){return value.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];}
function versionAtLeast(value:string|undefined,minimum:string){if(!value)return false;const left=value.split(/[.-]/).slice(0,3).map(Number),right=minimum.split('.').map(Number);return left.some((part,index)=>part>right[index]&&left.slice(0,index).every((prior,i)=>prior===right[i]))||left.every((part,index)=>part===right[index]);}
