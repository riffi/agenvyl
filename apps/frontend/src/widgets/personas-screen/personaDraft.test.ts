import { describe, expect, it } from 'vitest';
import type { Persona } from '../../entities/persona';
import type {HarnessCatalog} from '../../entities/harness';
import { isPersonaDraftDirty, newPersonaDraft, personaInputFromDraft, selectHarnessInstance, selectHarnessModel } from './personaDraft';

const persona: Persona = { id:'persona-1', handle:'architect', name:'Architect', role:'Архитектура', color:'#64748b', requested_model:'sol', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',mode_id:null,system_prompt:'Проектируй', group_id:null, archived_at:null };

describe('persona draft',()=>{
  it('is clean when editable values match',()=>expect(isPersonaDraftDirty(persona,{...persona})).toBe(false));
  it('becomes dirty when an editable value changes',()=>expect(isPersonaDraftDirty(persona,{...persona,role:'Review'})).toBe(true));
  it('ignores lifecycle metadata',()=>expect(isPersonaDraftDirty(persona,{...persona,archived_at:'2026-07-15'})).toBe(false));
  it('becomes clean when a value is restored',()=>{const draft={...persona,name:'Changed'};expect(isPersonaDraftDirty(persona,draft)).toBe(true);draft.name=persona.name;expect(isPersonaDraftDirty(persona,draft)).toBe(false)});
  it('tracks harness routing changes',()=>expect(isPersonaDraftDirty(persona,{...persona,mode_id:'plan'})).toBe(true));
  it('creates a Hermes draft from the first runnable catalog entry',()=>expect(newPersonaDraft(catalog)).toMatchObject({harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',requested_model:'sol',mode_id:null}));
  it('switches instance, model, and optional OpenCode mode without stale values',()=>{
    const openCode=catalog.instances[1];
    const selected=selectHarnessModel(selectHarnessInstance(persona,openCode),'gpt-5');
    expect(selected).toMatchObject({harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',requested_model:'gpt-5',mode_id:null});
  });
  it('sends canonical harness fields and keeps requested_model as a compatible alias',()=>expect(personaInputFromDraft({...persona,harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',requested_model:'stale',mode_id:'build'})).toMatchObject({handle:'architect',harness_instance_id:'local-opencode',model_id:'gpt-5',requested_model:'gpt-5',mode_id:'build'}));
});

const catalog:HarnessCatalog={connectorEpoch:'epoch-1',instances:[
  {id:'local-hermes',type:'hermes',status:'healthy',capabilities:['model_catalog'],models:[{id:'sol',label:'Sonnet'}],modes:[]},
  {id:'local-opencode',type:'opencode',status:'healthy',capabilities:['model_catalog','mode_catalog'],models:[{id:'default'},{id:'gpt-5'}],modes:[{id:'build'},{id:'plan'}]},
]};
