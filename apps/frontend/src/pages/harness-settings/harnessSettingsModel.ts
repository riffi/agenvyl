import type {HarnessSettingsInstance,SetupHarnessCandidate,SetupHarnessInstance} from '@agenvyl/contracts';

export type HarnessDraft=SetupHarnessInstance&Omit<Pick<HarnessSettingsInstance,'status'|'capabilities'|'error'|'personas'>,'status'>&{
  status:HarnessSettingsInstance['status']|'draft';
};
export type HarnessCandidateState='connected'|'ready'|'setup'|'missing';

export const harnessCandidateState=(candidate:SetupHarnessCandidate,connected:boolean):HarnessCandidateState=>{
  if(connected)return'connected';
  if(candidate.safeToSelect)return'ready';
  if(candidate.cli.found||candidate.endpoint?.reachable)return'setup';
  return'missing';
};

export const harnessCandidateDetail=(candidate:SetupHarnessCandidate,state:HarnessCandidateState)=>{
  if(candidate.warning)return candidate.warning;
  if(state==='connected')return'Configured on this machine.';
  if(candidate.endpoint?.reachable)return`Service is responding at ${candidate.endpoint.url}.`;
  if(candidate.cli.found)return`${candidate.cli.version??'CLI'} detected.`;
  return`${candidate.cli.command} was not found in the Connector environment.`;
};

export const configurationOf=(instance:HarnessDraft):SetupHarnessInstance=>({
  id:instance.id,
  type:instance.type,
  enabled:instance.enabled,
  ...(instance.endpoint&&instance.type!=='codex'?{endpoint:instance.endpoint}:{}),
  ...(instance.type==='opencode'?{managed:Boolean(instance.managed)}:{}),
  ...(instance.type==='antigravity'?{permissionMode:instance.permissionMode??'plan'}:{}),
  ...(instance.type==='codex'?{allowDangerFullAccess:Boolean(instance.allowDangerFullAccess)}:{}),
});

export const addHarnessDraft=(type:SetupHarnessInstance['type'],current:HarnessDraft[],candidates:SetupHarnessCandidate[]):HarnessDraft=>{
  const base=`local-${type}`;
  let id=base,index=2;
  while(current.some(instance=>instance.id===id))id=`${base}-${index++}`;
  const candidate=candidates.find(item=>item.type===type);
  return{id,type,enabled:true,status:'draft',capabilities:[],personas:[],
    ...(candidate?.endpoint&&type!=='codex'?{endpoint:candidate.endpoint.url}:{}),
    ...(type==='opencode'?{managed:Boolean(candidate?.cli.found&&!candidate.endpoint?.reachable)}:{}),
    ...(type==='antigravity'?{permissionMode:'plan' as const}:{}),
    ...(type==='codex'?{allowDangerFullAccess:false}:{})};
};

export const sameConfiguration=(left:HarnessDraft[],right:HarnessSettingsInstance[])=>JSON.stringify(left.map(configurationOf))===JSON.stringify(right.map(configurationOf));

export const validDraft=(instances:HarnessDraft[])=>instances.length===new Set(instances.map(instance=>instance.id)).size&&instances.every(instance=>/^[a-z0-9][a-z0-9_-]*$/.test(instance.id)&&(instance.type!=='codex'||!instance.endpoint)&&(!instance.endpoint||isEndpoint(instance.endpoint))&&(instance.type!=='antigravity'||!instance.enabled||Boolean(instance.permissionMode)));

const isEndpoint=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}};
