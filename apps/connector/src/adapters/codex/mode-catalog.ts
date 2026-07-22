import type {ConnectorCatalogItem} from '@agenvyl/connector-contract';

export type CodexSandbox='read-only'|'workspace-write'|'danger-full-access';
export type CodexMode={sandbox:CodexSandbox;effort?:string};
type AppServerModel={model:string;displayName:string;hidden:boolean;supportedReasoningEfforts:Array<{reasoningEffort?:string}|string>};

export const buildCodexCatalog=(values:unknown[],allowDangerFullAccess:boolean)=>{
  const sandboxes:CodexSandbox[]=allowDangerFullAccess?['read-only','workspace-write','danger-full-access']:['read-only','workspace-write'];
  const parsed=values.map(parseModel).filter((model):model is AppServerModel=>model!==undefined&&!model.hidden);
  const modes=new Map<string,ConnectorCatalogItem>();
  const models=parsed.map(model=>{
    const efforts=['default',...new Set(model.supportedReasoningEfforts.map(value=>typeof value==='string'?value:value.reasoningEffort).filter((value):value is string=>Boolean(value)))];
    const supportedModeIds=sandboxes.flatMap(sandbox=>efforts.map(effort=>modeId(sandbox,effort)));
    for(const id of supportedModeIds)modes.set(id,{id,label:modeLabel(id)});
    return{id:model.model,label:model.displayName,supportedModeIds};
  });
  return{models,modes:[...modes.values()]};
};

export const parseCodexMode=(value:string|null,allowDangerFullAccess:boolean):CodexMode=>{
  const [sandbox,effort,...extra]=(value??'').split('/');
  if(extra.length||!['read-only','workspace-write','danger-full-access'].includes(sandbox)||!effort)throw new Error('Codex mode must be <sandbox>/<effort>');
  if(sandbox==='danger-full-access'&&!allowDangerFullAccess)throw new Error('Codex danger-full-access is not enabled for this instance');
  if(!/^[a-z0-9][a-z0-9_-]*$/i.test(effort))throw new Error('Codex reasoning effort is invalid');
  return{sandbox:sandbox as CodexSandbox,...(effort==='default'?{}:{effort})};
};

const modeId=(sandbox:CodexSandbox,effort:string)=>`${sandbox}/${effort}`;
const modeLabel=(id:string)=>{const[sandbox,effort]=id.split('/');return`${sandbox==='read-only'?'Read only':sandbox==='workspace-write'?'Workspace write':'Full access'} · ${effort==='default'?'Default':effort}`;};
const parseModel=(value:unknown):AppServerModel|undefined=>{
  if(!isRecord(value)||typeof value.model!=='string'||typeof value.displayName!=='string'||typeof value.hidden!=='boolean'||!Array.isArray(value.supportedReasoningEfforts))return;
  return value as unknown as AppServerModel;
};
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
