import type {HarnessSettingsInstance,SetupHarnessCandidate,SetupHarnessInstance} from '@agenvyl/contracts';

export type HarnessDraft=SetupHarnessInstance&Pick<HarnessSettingsInstance,'status'|'capabilities'|'error'|'personas'>;

export const configurationOf=(instance:HarnessDraft):SetupHarnessInstance=>({
  id:instance.id,
  type:instance.type,
  enabled:instance.enabled,
  ...(instance.endpoint?{endpoint:instance.endpoint}:{}),
  ...(instance.type==='opencode'?{managed:Boolean(instance.managed)}:{}),
  ...(instance.type==='antigravity'?{permissionMode:instance.permissionMode??'plan'}:{}),
});

export const addHarnessDraft=(type:SetupHarnessInstance['type'],current:HarnessDraft[],candidates:SetupHarnessCandidate[]):HarnessDraft=>{
  const base=`local-${type}`;
  let id=base,index=2;
  while(current.some(instance=>instance.id===id))id=`${base}-${index++}`;
  const candidate=candidates.find(item=>item.type===type);
  return{id,type,enabled:true,status:'unavailable',capabilities:[],personas:[],
    ...(candidate?.endpoint?{endpoint:candidate.endpoint.url}:{}),
    ...(type==='opencode'?{managed:Boolean(candidate?.cli.found&&!candidate.endpoint?.reachable)}:{}),
    ...(type==='antigravity'?{permissionMode:'plan' as const}:{})};
};

export const sameConfiguration=(left:HarnessDraft[],right:HarnessSettingsInstance[])=>JSON.stringify(left.map(configurationOf))===JSON.stringify(right.map(configurationOf));

export const validDraft=(instances:HarnessDraft[])=>instances.length===new Set(instances.map(instance=>instance.id)).size&&instances.every(instance=>/^[a-z0-9][a-z0-9_-]*$/.test(instance.id)&&(!instance.endpoint||isEndpoint(instance.endpoint))&&(instance.type!=='antigravity'||!instance.enabled||Boolean(instance.permissionMode)));

const isEndpoint=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}};
