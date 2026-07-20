import type { Persona, PersonaInput } from '../../entities/persona';
import type { HarnessCatalog, HarnessInstance } from '../../entities/harness';

export const personaDraftValue = (persona?: Persona) => persona ? JSON.stringify({
  handle: persona.handle,
  name: persona.name,
  role: persona.role,
  color: persona.color,
  requested_model: persona.requested_model ?? '',
  harness_instance_id: persona.harness_instance_id,
  harness_type: persona.harness_type,
  model_id: persona.model_id,
  mode_id: persona.mode_id ?? null,
  system_prompt: persona.system_prompt ?? '',
  group_id: persona.group_id ?? null,
}) : '';

export const isPersonaDraftDirty = (snapshot?: Persona, draft?: Persona) =>
  Boolean(snapshot && draft && personaDraftValue(snapshot) !== personaDraftValue(draft));

export const firstRunnableHarness = (catalog?: HarnessCatalog) =>
  catalog?.instances.find(instance => instance.status !== 'unavailable' && instance.models.length > 0);

export const newPersonaDraft = (catalog?: HarnessCatalog): Persona => {
  const instance=firstRunnableHarness(catalog),model=instance?.models[0];
  return {id:'',handle:'',name:'',role:'',color:'#64748b',requested_model:model?.id??null,harness_instance_id:instance?.id??'',harness_type:instance?.type??'',model_id:model?.id??'',mode_id:null,system_prompt:'',group_id:null,archived_at:null};
};

export const selectHarnessInstance = (draft: Persona, instance: HarnessInstance): Persona => {
  const model=instance.models[0];
  return {...draft,harness_instance_id:instance.id,harness_type:instance.type,model_id:model?.id??'',requested_model:model?.id??null,mode_id:null};
};

export const selectHarnessModel = (draft: Persona, modelId: string): Persona =>
  ({...draft,model_id:modelId,requested_model:modelId});

export const personaInputFromDraft = (draft: Persona): PersonaInput => ({
  handle: draft.handle.trim().replace(/^@/,'').toLowerCase(),
  name: draft.name,
  role: draft.role,
  color: draft.color,
  requested_model: draft.model_id,
  harness_instance_id: draft.harness_instance_id,
  model_id: draft.model_id,
  mode_id: draft.mode_id,
  system_prompt: draft.system_prompt??'',
  group_id: draft.group_id,
});
