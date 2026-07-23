export type CodexSandbox='read-only'|'workspace-write'|'danger-full-access';
type AppServerModel={model:string;displayName:string;hidden:boolean;defaultReasoningEffort?:string;supportedReasoningEfforts:Array<{reasoningEffort?:string}|string>};

export const buildCodexCatalog=(values:unknown[],allowDangerFullAccess:boolean)=>{
  const sandboxes:CodexSandbox[]=allowDangerFullAccess?['workspace-write','read-only','danger-full-access']:['workspace-write','read-only'];
  const models=values.map(parseModel).filter((model):model is AppServerModel=>model!==undefined&&!model.hidden).map(model=>{
    const reasoningEfforts=[...new Set(model.supportedReasoningEfforts.map(value=>typeof value==='string'?value:value.reasoningEffort).filter((value):value is string=>Boolean(value)))];
    return{id:model.model,label:model.displayName,reasoningEfforts,defaultReasoningEffort:model.defaultReasoningEffort??reasoningEfforts[0]??null};
  });
  return{models,controls:{nativeWorkflowModes:['plan','work'] as Array<'plan'|'work'>,permissionProfiles:sandboxes.map(id=>({id,label:sandboxLabel(id)})),agentVariants:[]}};
};

export const parseCodexPermission=(value:string|null,allowDangerFullAccess:boolean):CodexSandbox=>{
  if(!value||!['read-only','workspace-write','danger-full-access'].includes(value))throw new Error('Codex permission profile is invalid');
  if(value==='danger-full-access'&&!allowDangerFullAccess)throw new Error('Codex danger-full-access is not enabled for this instance');
  return value as CodexSandbox;
};

const sandboxLabel=(value:CodexSandbox)=>value==='read-only'?'Read only':value==='workspace-write'?'Workspace write':'Full access';
const parseModel=(value:unknown):AppServerModel|undefined=>{
  if(!isRecord(value)||typeof value.model!=='string'||typeof value.displayName!=='string'||typeof value.hidden!=='boolean'||!Array.isArray(value.supportedReasoningEfforts))return;
  return value as unknown as AppServerModel;
};
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
