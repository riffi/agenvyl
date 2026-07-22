import type {ConnectorCatalogItem} from '@agenvyl/connector-contract';

export type ClaudePermissionMode='plan'|'default'|'acceptEdits';
export type ClaudeMode={permissionMode:ClaudePermissionMode;effort?:string};

export function buildClaudeCatalog(values:unknown[]){
  const modes=new Map<string,ConnectorCatalogItem>();
  const models=values.map(parseModel).filter((value):value is ClaudeModel=>Boolean(value)).map(model=>{
    const efforts=model.supportedEffortLevels?.length?[...new Set(model.supportedEffortLevels)]:['default'];
    const supportedModeIds=['plan','default','accept-edits'].flatMap(permission=>efforts.map(effort=>`${permission}/${effort}`));
    for(const id of supportedModeIds)modes.set(id,{id,label:modeLabel(id)});
    return{id:model.value,label:model.displayName??model.value,supportedModeIds};
  });
  if(!models.length)throw new Error('Claude initialize response did not contain any models');
  return{models,modes:[...modes.values()]};
}

export function parseClaudeMode(value:string|null):ClaudeMode{
  const[permission,effort,...extra]=(value??'').split('/');
  if(extra.length||!['plan','default','accept-edits'].includes(permission)||!effort||!/^[a-z0-9][a-z0-9_-]*$/i.test(effort))throw new Error('Claude mode must be <permission>/<effort>');
  return{permissionMode:permission==='accept-edits'?'acceptEdits':permission as ClaudePermissionMode,...(effort==='default'?{}:{effort})};
}

type ClaudeModel={value:string;displayName?:string;supportedEffortLevels?:string[]};
function parseModel(value:unknown):ClaudeModel|undefined{
  if(!isRecord(value)||typeof value.value!=='string'||!value.value||value.value.length>256)return;
  if(value.displayName!==undefined&&(typeof value.displayName!=='string'||value.displayName.length>256))return;
  const efforts=value.supportedEffortLevels;
  if(efforts!==undefined&&(!Array.isArray(efforts)||efforts.length>20||efforts.some(effort=>typeof effort!=='string'||!/^[a-z0-9][a-z0-9_-]*$/i.test(effort))))return;
  return{value:value.value,...(typeof value.displayName==='string'?{displayName:value.displayName}:{}),...(Array.isArray(efforts)?{supportedEffortLevels:efforts as string[]}:{})};
}
function modeLabel(id:string){const[permission,effort]=id.split('/');const label=permission==='plan'?'Plan':permission==='accept-edits'?'Accept edits':'Default';return`${label} · ${effort==='default'?'Default':effort}`;}
function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==='object'&&!Array.isArray(value));}
