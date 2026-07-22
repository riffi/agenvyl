import type {Persona} from '@agenvyl/contracts';
import type {HarnessCatalog} from './types';

export const personaModelName=(persona:Persona,catalog?:HarnessCatalog)=>{
  const catalogLabel=catalog?.instances
    .find(instance=>instance.id===persona.harness_instance_id)
    ?.models.find(model=>model.id===persona.model_id)?.label;
  const value=catalogLabel??persona.effective_model??persona.model_id??persona.requested_model;
  if(!value)return 'model not set';
  return value.split('/').at(-1)??value;
};
