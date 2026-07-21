import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import type {SupervisorConfig} from './config.js';
import {startSupervisor} from './runtime.js';

export type SetupCandidate={type:'hermes'|'opencode'|'antigravity';label:string;cli:{found:boolean;version?:string};endpoint?:{url:string;reachable:boolean};safeToSelect:boolean};
type SetupState={completed:boolean;firstRoomId?:string;candidates:SetupCandidate[]};

export async function runSetup(config:SupervisorConfig,cliPath:string,options:{all?:boolean;openBrowser?:boolean}={}){
  await startSupervisor(config,cliPath);
  const base=`http://127.0.0.1:${config.corePort}`,state=await json<SetupState>(`${base}/api/v1/setup`);
  if(state.completed){const url=`${base}/setup?configure=1`;if(options.openBrowser!==false)openBrowser(config,url);return{completed:true,selected:[],url};}
  const safe=state.candidates.filter(candidate=>candidate.safeToSelect);
  process.stdout.write(`${state.candidates.map(candidate=>`${candidate.safeToSelect?'[x]':'[ ]'} ${candidate.label}: ${candidate.endpoint?.reachable?'endpoint ready':candidate.cli.found?candidate.cli.version??'CLI found':'not detected'}`).join('\n')}\n`);
  let selected=safe;
  if(!options.all&&process.stdin.isTTY){const prompt=createInterface({input:process.stdin,output:process.stdout});try{const answer=await prompt.question('Use all safe detected harnesses? [Y/n] ');if(/^n/i.test(answer.trim()))selected=[];}finally{prompt.close();}}
  const instances=selectSafeInstances(selected);
  await json(`${base}/api/v1/setup/harnesses`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({instances})});
  if(options.openBrowser!==false)openBrowser(config,`${base}/setup`);
  return{completed:false,selected:instances.map(instance=>instance.id),url:`${base}/setup`};
}

export function selectSafeInstances(candidates:SetupCandidate[]){return candidates.filter(candidate=>candidate.safeToSelect&&candidate.type!=='antigravity').map(candidate=>({id:`local-${candidate.type}`,type:candidate.type,enabled:true,...(candidate.endpoint?{endpoint:candidate.endpoint.url}:{}),...(candidate.type==='opencode'&&!candidate.endpoint?.reachable?{managed:true}:{})}));}

async function json<T=unknown>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{...init,signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`Setup API returned HTTP ${response.status}`);return response.json() as Promise<T>;}
function openBrowser(config:SupervisorConfig,url:string){const command=config.platform==='win32'?{file:'cmd.exe',args:['/c','start','',url]}:config.platform==='darwin'?{file:'open',args:[url]}:{file:'xdg-open',args:[url]};const child=spawn(command.file,command.args,{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>undefined);child.unref();}
