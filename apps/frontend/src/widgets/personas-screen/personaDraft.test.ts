import {describe,expect,it} from 'vitest';
import type {Persona} from '../../entities/persona';
import type {HarnessCatalog} from '../../entities/harness';
import {isPersonaDraftDirty,newPersonaDraft,personaHandleAfterNameChange,personaHandleFromName,personaInputFromDraft,personaSaveAvailable,selectHarnessInstance,selectHarnessModel} from './personaDraft';

const persona:Persona={id:'persona-1',handle:'architect',name:'Architect',role:'Архитектура',color:'#64748b',requested_model:'sol',harness_instance_id:'local-hermes',harness_type:'hermes',model_id:'sol',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,system_prompt:'Проектируй',group_id:null,archived_at:null};
const controls=(permissions:string[]=[],variants:string[]=[])=>({nativeWorkflowModes:[] as Array<'plan'|'work'>,permissionProfiles:permissions.map(id=>({id})),agentVariants:variants.map(id=>({id}))});
const cache={state:'fresh' as const,refreshedAt:'2026-07-24T00:00:00.000Z',expiresAt:'2026-07-24T00:05:00.000Z'};
const catalog:HarnessCatalog={connectorEpoch:'epoch-1',cache,instances:[
  {id:'local-hermes',type:'hermes',status:'healthy',capabilities:['model_catalog'],models:[{id:'sol',label:'Sonnet'}],controls:controls(),catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}},
  {id:'local-opencode',type:'opencode',status:'healthy',capabilities:['model_catalog'],models:[{id:'default'},{id:'gpt-5'}],controls:controls([],['build','plan']),catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}},
]};

describe('persona draft',()=>{
  it('transliterates persona names into stable English snake_case handles',()=>{expect(personaHandleFromName('Щука Ёж — QA 2')).toBe('shchuka_yozh_qa_2');expect(personaHandleFromName('Élodie Smith')).toBe('elodie_smith')});
  it('keeps following automatic names while preserving manual handles',()=>{expect(personaHandleAfterNameChange('Иван','Иван Петров','ivan')).toBe('ivan_petrov');expect(personaHandleAfterNameChange('Иван','Иван Петров','lead_agent')).toBe('lead_agent')});
  it('tracks editable route fields but ignores lifecycle metadata',()=>{expect(isPersonaDraftDirty(persona,{...persona})).toBe(false);expect(isPersonaDraftDirty(persona,{...persona,permission_profile_id:'workspace-write'})).toBe(true);expect(isPersonaDraftDirty(persona,{...persona,archived_at:'2026-07-15'})).toBe(false)});
  it('allows creating and disables unchanged saves',()=>{expect(personaSaveAvailable({creating:true,dirty:false,real:true,saving:false})).toBe(true);expect(personaSaveAvailable({creating:false,dirty:false,real:true,saving:false})).toBe(false)});
  it('creates a draft with route permissions and agent variant, never workflow state',()=>{const draft=newPersonaDraft({connectorEpoch:'codex',cache,instances:[{id:'local-codex',type:'codex',status:'healthy',capabilities:[],models:[{id:'gpt-5'}],controls:controls(['workspace-write'],['reviewer']),catalogCache:{state:'fresh',refreshedAt:cache.refreshedAt}}]});expect(draft).toMatchObject({model_id:'gpt-5',permission_profile_id:'workspace-write',agent_variant_id:'reviewer'});expect(draft).not.toHaveProperty('mode_id')});
  it('switches instance and resets provider controls without stale values',()=>{const selected=selectHarnessModel(selectHarnessInstance({...persona,permission_profile_id:'old',agent_variant_id:'old'},catalog.instances[1]),'gpt-5');expect(selected).toMatchObject({harness_type:'opencode',model_id:'gpt-5',requested_model:'gpt-5',permission_profile_id:null,agent_variant_id:'build'})});
  it('sends canonical route fields and model alias',()=>expect(personaInputFromDraft({...persona,harness_instance_id:'local-opencode',harness_type:'opencode',model_id:'gpt-5',requested_model:'stale',agent_variant_id:'build'})).toMatchObject({handle:'architect',harness_instance_id:'local-opencode',model_id:'gpt-5',requested_model:'gpt-5',permission_profile_id:null,agent_variant_id:'build'}));
});
