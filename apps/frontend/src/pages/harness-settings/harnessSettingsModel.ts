import type {HarnessSettingsInstance,SetupHarnessCandidate,SetupHarnessInstance} from '@agenvyl/contracts';

export type HarnessDraft=SetupHarnessInstance&Omit<Pick<HarnessSettingsInstance,'status'|'capabilities'|'error'|'personas'>,'status'>&{
  status:HarnessSettingsInstance['status']|'draft';
};
export type HarnessHealth='healthy'|'degraded'|'unavailable'|null;
export type HarnessInstanceGroup={type:SetupHarnessInstance['type'];grouped:boolean;instances:HarnessSettingsInstance[]};

const healthPriority:Record<Exclude<HarnessHealth,null>|'disabled',number>={unavailable:0,degraded:1,healthy:2,disabled:3};

export const configurationStatus=(instance:Pick<SetupHarnessInstance,'enabled'>)=>instance.enabled?'enabled' as const:'disabled' as const;
export const healthStatus=(instance:Pick<HarnessSettingsInstance,'enabled'|'status'>):HarnessHealth=>!instance.enabled||instance.status==='disabled'?null:instance.status;

export const harnessSettingsSummary=(instances:HarnessSettingsInstance[])=>({
  configured:instances.length,
  healthy:instances.filter(instance=>healthStatus(instance)==='healthy').length,
  issues:instances.filter(instance=>['degraded','unavailable'].includes(healthStatus(instance)??'')).length,
  disabled:instances.filter(instance=>!instance.enabled).length,
});

export const groupHarnessInstances=(instances:HarnessSettingsInstance[]):HarnessInstanceGroup[]=>{
  const groups=new Map<SetupHarnessInstance['type'],HarnessSettingsInstance[]>();
  for(const instance of instances)groups.set(instance.type,[...(groups.get(instance.type)??[]),instance]);
  return[...groups.entries()].map(([type,items])=>({type,grouped:items.length>1,instances:items.map((instance,index)=>({instance,index})).sort((left,right)=>{
    const leftHealth=healthStatus(left.instance)??'disabled',rightHealth=healthStatus(right.instance)??'disabled';
    return healthPriority[leftHealth]-healthPriority[rightHealth]||left.index-right.index;
  }).map(item=>item.instance)}));
};

export const configurationOf=(instance:HarnessDraft):SetupHarnessInstance=>({
  id:instance.id,
  type:instance.type,
  enabled:instance.enabled,
  ...(instance.endpoint&&instance.type!=='codex'&&instance.type!=='claude'?{endpoint:instance.endpoint}:{}),
  ...(instance.type==='opencode'?{managed:Boolean(instance.managed),externalDirectoryRoots:instance.externalDirectoryRoots??[]}:{}),
  ...(instance.type==='claude'?{allowSubscriptionOAuth:Boolean(instance.allowSubscriptionOAuth)}:{}),
});

export const addHarnessDraft=(type:SetupHarnessInstance['type'],current:HarnessDraft[],candidates:SetupHarnessCandidate[]):HarnessDraft=>{
  const base=`local-${type}`;
  let id=base,index=2;
  while(current.some(instance=>instance.id===id))id=`${base}-${index++}`;
  const candidate=candidates.find(item=>item.type===type);
  return{id,type,enabled:true,status:'draft',capabilities:[],personas:[],
    ...(candidate?.endpoint&&type!=='codex'&&type!=='claude'?{endpoint:candidate.endpoint.url}:{}),
    ...(type==='opencode'?{managed:true,externalDirectoryRoots:[]}:{}),
    ...(type==='claude'?{allowSubscriptionOAuth:false}:{})};
};

export const sameConfiguration=(left:HarnessDraft[],right:HarnessSettingsInstance[])=>JSON.stringify(left.map(configurationOf))===JSON.stringify(right.map(configurationOf));
export const sameInstanceConfiguration=(left:HarnessDraft,right:HarnessSettingsInstance)=>JSON.stringify(configurationOf(left))===JSON.stringify(configurationOf(right));

export const validDraft=(instances:HarnessDraft[])=>instances.length===new Set(instances.map(instance=>instance.id)).size&&instances.every(instance=>/^[a-z0-9][a-z0-9_-]*$/.test(instance.id)&&(!['codex','claude'].includes(instance.type)||!instance.endpoint)&&(!instance.endpoint||isEndpoint(instance.endpoint))&&(instance.type!=='opencode'||validExternalRoots(instance.externalDirectoryRoots??[])));

const isEndpoint=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}};
const validExternalRoots=(roots:string[])=>roots.every(root=>(root.startsWith('/')||/^[A-Za-z]:[\\/]/.test(root)||/^\\\\[^\\]+\\[^\\]+/.test(root))&&!/[*?\[\]{}\0-\x1f\x7f]/.test(root)&&!root.split(/[\\/]/).includes('..')&&!(root.includes('/')&&root.includes('\\')))&&roots.length===new Set(roots.map(root=>/^[A-Za-z]:[\\/]|^\\\\/.test(root)?root.replaceAll('/','\\').replace(/[\\]+$/,'').toLowerCase():root.replace(/\/+$/,''))).size;
