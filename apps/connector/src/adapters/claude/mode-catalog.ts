export type ClaudePermissionMode='plan'|'default'|'acceptEdits';

export const buildClaudeCatalog=(values:unknown[])=>{
  const models=values.map(parseModel).filter((value):value is ClaudeModel=>Boolean(value)).map(model=>{
    const reasoningEfforts=model.supportedEffortLevels?.length?[...new Set(model.supportedEffortLevels)]:[];
    return{id:model.value,label:model.displayName??model.value,reasoningEfforts,defaultReasoningEffort:reasoningEfforts[0]??null};
  });
  if(!models.length)throw new Error('Claude initialize response did not contain any models');
  return{models,controls:{nativeWorkflowModes:['plan','work'] as Array<'plan'|'work'>,permissionProfiles:[{id:'default',label:'Ask before edits'},{id:'accept-edits',label:'Accept edits'}],agentVariants:[]}};
};

export const parseClaudePermission=(value:string|null):Exclude<ClaudePermissionMode,'plan'>=>{
  if(value==='default')return'default';
  if(value==='accept-edits')return'acceptEdits';
  throw new Error('Claude permission profile is invalid');
};

type ClaudeModel={value:string;displayName?:string;supportedEffortLevels?:string[]};
const parseModel=(value:unknown):ClaudeModel|undefined=>{
  if(!isRecord(value)||typeof value.value!=='string'||!value.value||value.value.length>256)return;
  if(value.displayName!==undefined&&(typeof value.displayName!=='string'||value.displayName.length>256))return;
  const efforts=value.supportedEffortLevels;
  if(efforts!==undefined&&(!Array.isArray(efforts)||efforts.length>20||efforts.some(effort=>typeof effort!=='string'||!/^[a-z0-9][a-z0-9_-]*$/i.test(effort))))return;
  return{value:value.value,...(typeof value.displayName==='string'?{displayName:value.displayName}:{}),...(Array.isArray(efforts)?{supportedEffortLevels:efforts as string[]}:{})};
};
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
