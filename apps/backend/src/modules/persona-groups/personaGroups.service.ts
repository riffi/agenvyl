import {AppError} from '../../shared/errors/AppError.js';
import type {PersonaGroupRepository} from './personaGroups.repository.js';

export class PersonaGroupsService{
  constructor(private readonly groups:PersonaGroupRepository){}
  list(){return this.groups.list();}
  async create(input:{name?:string}){const name=normalizeName(input.name);if(!name)throw new AppError('group_name_required',400,'Group name is required');try{return await this.groups.create(name);}catch{throw new AppError('group_conflict',409,'A group with this name already exists');}}
  async rename(id:string,input:{name?:string}){const name=normalizeName(input.name);if(!name)throw new AppError('group_name_required',400,'Group name is required');try{const group=await this.groups.rename(id,name);if(!group)throw new AppError('not_found',404,'Persona group not found');return group;}catch(error){if(error instanceof AppError)throw error;throw new AppError('group_conflict',409,'A group with this name already exists');}}
  async move(id:string,input:{direction?:string}){if(input.direction!=='up'&&input.direction!=='down')throw new AppError('invalid_direction',400,'Direction must be up or down');const result=await this.groups.move(id,input.direction);if(result==='not_found')throw new AppError('not_found',404,'Persona group not found');if(result==='boundary')throw new AppError('group_boundary',409,'Persona group is already at the boundary');return result;}
  async reorder(id:string,input:{position?:number}){if(!Number.isInteger(input.position)||input.position===undefined||input.position<0)throw new AppError('invalid_position',400,'Position must be a non-negative integer');const result=await this.groups.reorder(id,input.position);if(result==='not_found')throw new AppError('not_found',404,'Persona group not found');if(result==='out_of_range')throw new AppError('invalid_position',400,'Position is outside the group list');return result;}
  async delete(id:string){if(!await this.groups.delete(id))throw new AppError('not_found',404,'Persona group not found');}
}
function normalizeName(value:string|undefined){const name=value?.trim();return name&&name.length<=80?name:undefined;}
