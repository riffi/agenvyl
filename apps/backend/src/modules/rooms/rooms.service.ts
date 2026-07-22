import {AppError} from '../../shared/errors/AppError.js';
import type {RoomRepository} from './rooms.repository.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import type {UpdateRoomExecutionProfileRequest} from '@agenvyl/contracts';

export class RoomsService{
  constructor(private readonly rooms:RoomRepository,private readonly workspace?:{purgeCandidates:(roomId:string)=>Promise<string[]>;purgeFiles:(roomId:string,hashes:string[])=>Promise<void>},private readonly events?:RoomEventService){}
  list(includeDeleted=false){return this.rooms.list(includeDeleted);}
  async timeline(roomId:string,before?:string,limit=30){const page=await this.rooms.timeline(roomId,before,limit);if(!page)throw new AppError('room_not_found',404,'Room or cursor not found');return page;}
  async create(input:{title?:string;personaIds?:string[]}){const title=input.title?.trim();if(!title)throw new AppError('title_required',400,'Room title is required');try{return await this.rooms.create(title,input.personaIds??[]);}catch(error){throw new AppError(error instanceof Error?error.message:'room_conflict',409,'Room could not be created');}}
  async rename(roomId:string,titleInput?:string){const title=titleInput?.trim();if(!title)throw new AppError('title_required',400,'Room title is required');const room=await this.rooms.rename(roomId,title);if(!room)throw new AppError('room_not_found',404,'Room not found');return room;}
  async delete(roomId:string){const result=await this.rooms.delete(roomId);if(result==='not_found')throw new AppError('room_not_found',404,'Room not found');if(result==='busy')throw new AppError('room_busy',409,'Wait for active responses to finish or cancel them first');}
  async restore(roomId:string){if(!await this.rooms.restore(roomId))throw new AppError('room_not_found',404,'Deleted room not found');return(await this.rooms.list()).find(room=>room.id===roomId);}
  async purge(roomId:string){const hashes=await this.workspace?.purgeCandidates(roomId)??[],result=await this.rooms.purge(roomId);if(result==='not_found')throw new AppError('room_not_found',404,'Room not found in trash');await this.workspace?.purgeFiles(roomId,hashes);}
  async setParticipant(roomId:string,personaId:string,present:boolean){const result=await this.rooms.setParticipant(roomId,personaId,present);if(result==='room_not_found'||result==='persona_not_found')throw new AppError(result,404,result);if(result==='persona_archived')throw new AppError(result,409,result);return{status:'ok'};}
  async executionState(roomId:string){const state=await this.rooms.executionState(roomId);if(!state)throw new AppError('room_not_found',404,'Room not found');return state;}
  async updateExecutionProfile(roomId:string,input:UpdateRoomExecutionProfileRequest){const current=await this.executionState(roomId),workflow_mode=input.workflow_mode??current.profile.workflow_mode,reasoning_effort=input.reasoning_effort===undefined?current.profile.reasoning_effort:normalizeEffort(input.reasoning_effort);const state=await this.rooms.updateExecutionProfile(roomId,{workflow_mode,reasoning_effort});if(!state)throw new AppError('room_not_found',404,'Room not found');await this.events?.emit(roomId,'room.execution_profile.updated',state.profile);return state;}
  async approvePlan(roomId:string,runId:string){const state=await this.rooms.approvePlan(roomId,runId);if(!state)throw new AppError('invalid_approved_plan',409,'Approved plan must be a completed Plan run from this room');await this.events?.emit(roomId,'room.approved_plan.updated',{approvedPlan:state.approved_plan});return state;}
  async clearApprovedPlan(roomId:string){const state=await this.rooms.clearApprovedPlan(roomId);if(!state)throw new AppError('room_not_found',404,'Room not found');await this.events?.emit(roomId,'room.approved_plan.updated',{approvedPlan:null});return state;}
}

function normalizeEffort(value:string|null){if(value===null)return null;const effort=value.trim();if(!effort||effort.length>40)throw new AppError('invalid_reasoning_effort',400,'Reasoning effort must be Auto or a catalog value');return effort;}
