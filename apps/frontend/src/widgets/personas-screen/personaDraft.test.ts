import { describe, expect, it } from 'vitest';
import type { Persona } from '../../entities/persona';
import type {HarnessCatalog} from '../../entities/harness';
import { defaultPersonaMode, isPersonaDraftDirty, newPersonaDraft, personaHandleAfterNameChange, personaHandleFromName, personaInputFromDraft, personaSaveAvailable, selectHarnessInstance, selectHarnessModel } from './personaDraft';

const persona: Persona = { id:'persona-1', handle:'architect', name:'Architect', role:'Архитектура', color:'#64748b', requested_model:'sol', harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',mode_id:null,system_prompt:'Проектируй', group_id:null, archived_at:null };

describe('persona draft',()=>{
  it('transliterates persona names into stable English snake_case handles',()=>{
    expect(personaHandleFromName('Щука Ёж — QA 2')).toBe('shchuka_yozh_qa_2');
    expect(personaHandleFromName('Élodie Smith')).toBe('elodie_smith');
  });
  it('keeps following the name while the handle is automatic and preserves manual edits',()=>{
    expect(personaHandleAfterNameChange('Иван','Иван Петров','ivan')).toBe('ivan_petrov');
    expect(personaHandleAfterNameChange('Иван','Иван Петров','lead_agent')).toBe('lead_agent');
    expect(personaHandleAfterNameChange('Иван','Иван Петров','')).toBe('ivan_petrov');
  });
  it('is clean when editable values match',()=>expect(isPersonaDraftDirty(persona,{...persona})).toBe(false));
  it('becomes dirty when an editable value changes',()=>expect(isPersonaDraftDirty(persona,{...persona,role:'Review'})).toBe(true));
  it('ignores lifecycle metadata',()=>expect(isPersonaDraftDirty(persona,{...persona,archived_at:'2026-07-15'})).toBe(false));
  it('becomes clean when a value is restored',()=>{const draft={...persona,name:'Changed'};expect(isPersonaDraftDirty(persona,draft)).toBe(true);draft.name=persona.name;expect(isPersonaDraftDirty(persona,draft)).toBe(false)});
  it('tracks harness routing changes',()=>expect(isPersonaDraftDirty(persona,{...persona,mode_id:'plan'})).toBe(true));
  it('treats switching an existing persona to the default model mode as a saveable change',()=>{
    const saved={...persona,harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',requested_model:'gpt-5',mode_id:'build'};
    const draft={...saved,mode_id:null};
    expect(isPersonaDraftDirty(saved,draft)).toBe(true);
    expect(personaSaveAvailable({creating:false,dirty:true,real:true,saving:false})).toBe(true);
    expect(personaInputFromDraft(draft).mode_id).toBeNull();
  });
  it('allows creating an ungrouped persona without requiring a group change to make the draft dirty',()=>{
    expect(personaSaveAvailable({creating:true,dirty:false,real:true,saving:false})).toBe(true);
    expect(personaInputFromDraft({...persona,id:'',group_id:null}).group_id).toBeNull();
  });
  it('still disables save for an unchanged existing persona',()=>expect(personaSaveAvailable({creating:false,dirty:false,real:true,saving:false})).toBe(false));
  it('creates a Hermes draft from the first runnable catalog entry',()=>expect(newPersonaDraft(catalog)).toMatchObject({harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',requested_model:'sol',mode_id:null}));
  it('defaults Codex to workspace-write and resets an incompatible model mode safely',()=>{const codex={id:'local-codex',type:'codex',status:'healthy' as const,capabilities:[],models:[{id:'one',supportedModeIds:['workspace-write/default','read-only/high']},{id:'two',supportedModeIds:['read-only/default']}],modes:[{id:'workspace-write/default'},{id:'read-only/high'},{id:'read-only/default'}]};expect(newPersonaDraft({connectorEpoch:'codex',instances:[codex]})).toMatchObject({mode_id:'workspace-write/default'});expect(selectHarnessModel({...persona,harness_instance_id:'local-codex',harness_type:'codex',model_id:'one',mode_id:'read-only/high'},'two',codex)).toMatchObject({model_id:'two',mode_id:'read-only/default'});});
  it('defaults Claude to a model-supported default permission mode',()=>{const claude:HarnessCatalog['instances'][number]={id:'local-claude',type:'claude',status:'healthy',capabilities:[],models:[{id:'sonnet',supportedModeIds:['plan/high','default/high','accept-edits/high']}],modes:[{id:'plan/high'},{id:'default/high'},{id:'accept-edits/high'}]};expect(defaultPersonaMode(claude)).toBe('default/high');expect(newPersonaDraft({connectorEpoch:'claude',instances:[claude]})).toMatchObject({harness_type:'claude',mode_id:'default/high'});});
  it('switches instance, model, and optional OpenCode mode without stale values',()=>{
    const openCode=catalog.instances[1];
    const selected=selectHarnessModel(selectHarnessInstance(persona,openCode),'gpt-5');
    expect(selected).toMatchObject({harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',requested_model:'gpt-5',mode_id:null});
  });
  it('selects explicit plan mode when creating or switching to AGY',()=>{
    const agy:HarnessCatalog['instances'][number]={id:'local-antigravity',type:'antigravity',status:'healthy',capabilities:['model_catalog','mode_catalog'],models:[{id:'gemini'}],modes:[{id:'plan'},{id:'accept-edits'}]};
    expect(defaultPersonaMode(agy)).toBe('plan');
    expect(newPersonaDraft({connectorEpoch:'agy',instances:[agy]})).toMatchObject({harness_type:'antigravity',mode_id:'plan'});
    expect(selectHarnessInstance(persona,agy)).toMatchObject({harness_type:'antigravity',mode_id:'plan'});
  });
  it('sends canonical harness fields and keeps requested_model as a compatible alias',()=>expect(personaInputFromDraft({...persona,harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',requested_model:'stale',mode_id:'build'})).toMatchObject({handle:'architect',harness_instance_id:'local-opencode',model_id:'gpt-5',requested_model:'gpt-5',mode_id:'build'}));
});

const catalog:HarnessCatalog={connectorEpoch:'epoch-1',instances:[
  {id:'local-hermes',type:'hermes',status:'healthy',capabilities:['model_catalog'],models:[{id:'sol',label:'Sonnet'}],modes:[]},
  {id:'local-opencode',type:'opencode',status:'healthy',capabilities:['model_catalog','mode_catalog'],models:[{id:'default'},{id:'gpt-5'}],modes:[{id:'build'},{id:'plan'}]},
]};
