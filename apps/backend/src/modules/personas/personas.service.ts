import {AppError} from '../../shared/errors/AppError.js';
import type {RoomRepository} from '../rooms/rooms.repository.js';
import type {PersonaRepository} from './personas.repository.js';
import {isValidHandle,normalizeHandle} from '../../shared/identity/handles.js';

type HarnessCatalog={catalog():Promise<{instances:Array<{id:string;type:string;status:string;models:Array<{id:string}>;modes:Array<{id:string}>}>}>};
type HarnessSelectionInput={requested_model?:string|null;harness_instance_id?:string;model_id?:string;mode_id?:string|null};
type HarnessSelection={requested_model:string;harness_instance_id:string;harness_type:string;model_id:string;mode_id:string|null};
export type CreatePersonaInput={handle?:string;name?:string;room_id?:string;role?:string;color?:string;system_prompt?:string;group_id?:string|null}&HarnessSelectionInput;

export class PersonasService{
  constructor(private readonly personas:PersonaRepository,private readonly rooms:RoomRepository,private readonly harnesses:HarnessCatalog){}
  async list(roomId?:string,includeArchived=false){if(roomId&&!await this.rooms.exists(roomId))throw new AppError('room_not_found',404,'Room not found',{room_id:roomId});return this.personas.list(roomId,includeArchived);}
  async get(id:string){const persona=await this.personas.detail(id);if(!persona)throw new AppError('not_found',404,'Persona not found');return persona;}
  async create(input:CreatePersonaInput){const handle=normalizeHandle(input.handle),name=input.name?.trim();if(!handle||!isValidHandle(handle))throw new AppError('invalid_handle',400,'Invalid persona handle');if(!name)throw new AppError('name_required',400,'Persona name is required');if(input.room_id&&!await this.rooms.exists(input.room_id))throw new AppError('room_not_found',404,'Room not found',{room_id:input.room_id});const selection=await this.validateSelection({harness_instance_id:input.harness_instance_id??'local-hermes',model_id:input.model_id??input.requested_model??undefined,mode_id:input.mode_id??null,requested_model:input.requested_model});try{return await this.personas.create({...input,...selection,handle,name});}catch(error){if(isForeignKeyError(error))throw new AppError('unknown_group',400,'Unknown persona group',{group_id:input.group_id});throw new AppError('persona_conflict',409,'Persona conflicts with existing data',{handle});}}
  async update(id:string,input:Record<string,unknown>){const normalized={...input};delete normalized.harness_type;if(typeof normalized.handle==='string'){const handle=normalizeHandle(normalized.handle);if(!handle||!isValidHandle(handle))throw new AppError('invalid_handle',400,'Invalid persona handle');normalized.handle=handle;}if(normalized.requested_model===null)throw new AppError('unknown_model',400,'Unknown model',{model:null});if(hasSelectionInput(normalized)){const current=await this.personas.find(id);if(!current)throw new AppError('not_found',404,'Persona not found');const instanceId=typeof normalized.harness_instance_id==='string'?normalized.harness_instance_id:current.harness_instance_id;const modelId=typeof normalized.model_id==='string'?normalized.model_id:typeof normalized.requested_model==='string'?normalized.requested_model:current.model_id;const modeId=normalized.mode_id===null||typeof normalized.mode_id==='string'?normalized.mode_id:(instanceId===current.harness_instance_id?current.mode_id:null);Object.assign(normalized,await this.validateSelection({harness_instance_id:instanceId,model_id:modelId,mode_id:modeId,requested_model:typeof normalized.requested_model==='string'?normalized.requested_model:undefined}));}try{const updated=await this.personas.update(id,normalized as never);if(!updated)throw new AppError('not_found',404,'Persona not found');return this.get(id);}catch(error){if(error instanceof AppError)throw error;if(isForeignKeyError(error))throw new AppError('unknown_group',400,'Unknown persona group',{group_id:normalized.group_id});throw new AppError('persona_conflict',409,'Persona conflicts with existing data');}}
  async archive(id:string){const result=await this.personas.setArchived(id,true);if(result==='not_found')throw new AppError('not_found',404,'Persona not found');if(result==='conflict')throw new AppError('persona_archived',409,'Persona is already archived');return result;}
  async restore(id:string){const result=await this.personas.setArchived(id,false);if(result==='not_found')throw new AppError('not_found',404,'Persona not found');if(result==='conflict')throw new AppError('persona_conflict',409,'Persona is already active');return result;}
  async delete(id:string){const result=await this.personas.delete(id);if(result.status==='not_found')throw new AppError('not_found',404,'Persona not found');if(result.status==='in_use')throw new AppError('persona_in_use',409,'Персона уже использовалась в runs и не может быть удалена.',{dependencies:result.dependencies});}
  private async validateSelection(input:HarnessSelectionInput):Promise<HarnessSelection>{
    const instanceId=input.harness_instance_id?.trim(),modelId=input.model_id?.trim();
    if(!instanceId)throw new AppError('unknown_harness_instance',400,'Unknown harness instance',{harnessInstanceId:instanceId??null});
    if(!modelId)throw new AppError('unknown_model',400,'Unknown model',{model:modelId??null,harnessInstanceId:instanceId});
    if(typeof input.requested_model==='string'&&input.requested_model.trim()!==modelId)throw new AppError('harness_selection_conflict',400,'requested_model and model_id must identify the same model');
    const catalog=await this.harnesses.catalog(),instance=catalog.instances.find(item=>item.id===instanceId);
    if(!instance)throw new AppError('unknown_harness_instance',400,'Unknown harness instance',{harnessInstanceId:instanceId});
    if(instance.status!=='healthy')throw new AppError('harness_unavailable',409,'Harness instance is unavailable',{harnessInstanceId:instanceId,status:instance.status});
    if(!instance.models.some(model=>model.id===modelId))throw new AppError('unknown_model',400,'Unknown model',{model:modelId,harnessInstanceId:instanceId});
    const modeId=input.mode_id??null;
    if(modeId!==null&&!instance.modes.some(mode=>mode.id===modeId))throw new AppError('unknown_mode',400,'Unknown harness mode',{mode:modeId,harnessInstanceId:instanceId});
    return{requested_model:modelId,harness_instance_id:instance.id,harness_type:instance.type,model_id:modelId,mode_id:modeId};
  }
}
function hasSelectionInput(input:Record<string,unknown>){return['requested_model','harness_instance_id','model_id','mode_id'].some(key=>Object.prototype.hasOwnProperty.call(input,key));}
function isForeignKeyError(error:unknown){return Boolean(error&&typeof error==='object'&&'code'in error&&(error as {code?:string}).code==='23503');}
