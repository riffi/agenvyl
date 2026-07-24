import type { Persona, PersonaInput } from '../../entities/persona';
import type { HarnessCatalog, HarnessInstance } from '../../entities/harness';

const cyrillicToLatin:Record<string,string>={
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  і:'i',ї:'yi',є:'ye',ґ:'g',ў:'u',
};

export const personaHandleFromName=(name:string)=>[...name.toLowerCase()]
  .map(character=>cyrillicToLatin[character]??character)
  .join('')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'_')
  .replace(/^_+|_+$/g,'')
  .replace(/_+/g,'_');

export const personaHandleAfterNameChange=(previousName:string,nextName:string,currentHandle:string)=>
  !currentHandle||currentHandle===personaHandleFromName(previousName)?personaHandleFromName(nextName):currentHandle;

export const personaDraftValue = (persona?: Persona) => persona ? JSON.stringify({
  handle: persona.handle,
  name: persona.name,
  color: persona.color,
  requested_model: persona.requested_model ?? '',
  harness_instance_id: persona.harness_instance_id,
  harness_type: persona.harness_type,
  model_id: persona.model_id,
  permission_profile_id: persona.permission_profile_id ?? null,
  agent_variant_id: persona.agent_variant_id ?? null,
  default_reasoning_effort: persona.default_reasoning_effort ?? null,
  system_prompt: persona.system_prompt ?? '',
  group_id: persona.group_id ?? null,
}) : '';

export const isPersonaDraftDirty = (snapshot?: Persona, draft?: Persona) =>
  Boolean(snapshot && draft && personaDraftValue(snapshot) !== personaDraftValue(draft));

export const personaSaveAvailable = (state:{creating:boolean;dirty:boolean;real:boolean;saving:boolean}) =>
  state.real&&!state.saving&&(state.creating||state.dirty);

export const firstRunnableHarness = (catalog?: HarnessCatalog) =>
  catalog?.instances.find(instance => instance.status !== 'unavailable' && instance.models.length > 0);

export const newPersonaDraft = (catalog?: HarnessCatalog): Persona => {
  const instance=firstRunnableHarness(catalog),model=instance?.models[0];
  return {id:'',handle:'',name:'',color:'#64748b',requested_model:model?.id??null,harness_instance_id:instance?.id??'',harness_type:instance?.type??'',model_id:model?.id??'',permission_profile_id:instance?.controls.permissionProfiles[0]?.id??null,agent_variant_id:instance?.controls.agentVariants[0]?.id??null,default_reasoning_effort:null,system_prompt:'',group_id:null,archived_at:null};
};

export const selectHarnessInstance = (draft: Persona, instance: HarnessInstance): Persona => {
  const model=instance.models[0];
  return {...draft,harness_instance_id:instance.id,harness_type:instance.type,model_id:model?.id??'',requested_model:model?.id??null,permission_profile_id:instance.controls.permissionProfiles[0]?.id??null,agent_variant_id:instance.controls.agentVariants[0]?.id??null};
};

export const selectHarnessModel = (draft: Persona, modelId: string, _instance?:HarnessInstance): Persona =>({...draft,model_id:modelId,requested_model:modelId});

export const personaInputFromDraft = (draft: Persona): PersonaInput => ({
  handle: draft.handle.trim().replace(/^@/,'').toLowerCase(),
  name: draft.name,
  color: draft.color,
  requested_model: draft.model_id,
  harness_instance_id: draft.harness_instance_id,
  model_id: draft.model_id,
  permission_profile_id: draft.permission_profile_id,
  agent_variant_id: draft.agent_variant_id,
  default_reasoning_effort: draft.default_reasoning_effort,
  system_prompt: draft.system_prompt??'',
  group_id: draft.group_id||null,
});
