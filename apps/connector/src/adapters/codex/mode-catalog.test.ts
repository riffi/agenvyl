import {describe,expect,it} from 'vitest';
import {buildCodexCatalog,parseCodexMode} from './mode-catalog.js';

describe('Codex model and mode catalog',()=>{
  const models=[{model:'gpt-codex',displayName:'GPT Codex',hidden:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{model:'hidden',displayName:'Hidden',hidden:true,supportedReasoningEfforts:[]}];
  it('publishes model-compatible safe modes and excludes hidden models',()=>{const catalog=buildCodexCatalog(models,false);expect(catalog.models).toEqual([{id:'gpt-codex',label:'GPT Codex',supportedModeIds:['read-only/default','read-only/low','read-only/high','workspace-write/default','workspace-write/low','workspace-write/high']}]);expect(catalog.modes.map(mode=>mode.id)).not.toContain('danger-full-access/default');});
  it('publishes full access only after instance opt-in',()=>expect(buildCodexCatalog(models,true).models[0].supportedModeIds).toContain('danger-full-access/high'));
  it('validates mode syntax and full-access boundary',()=>{expect(parseCodexMode('workspace-write/default',false)).toEqual({sandbox:'workspace-write'});expect(()=>parseCodexMode('danger-full-access/xhigh',false)).toThrow('not enabled');expect(parseCodexMode('danger-full-access/xhigh',true)).toEqual({sandbox:'danger-full-access',effort:'xhigh'});});
});
