import {AppError} from '../../shared/errors/AppError.js';
import type {RoomRepository} from './rooms.repository.js';

export class RoomsService{
  constructor(private readonly rooms:RoomRepository,private readonly workspace?:{purgeCandidates:(roomId:string)=>Promise<string[]>;purgeFiles:(roomId:string,hashes:string[])=>Promise<void>}){}
  list(includeDeleted=false){return this.rooms.list(includeDeleted);}
  async timeline(roomId:string,before?:string,limit=30){const page=await this.rooms.timeline(roomId,before,limit);if(!page)throw new AppError('room_not_found',404,'Room or cursor not found');return page;}
  async create(input:{title?:string;personaIds?:string[]}){const title=input.title?.trim();if(!title)throw new AppError('title_required',400,'Room title is required');try{return await this.rooms.create(title,input.personaIds??[]);}catch(error){throw new AppError(error instanceof Error?error.message:'room_conflict',409,'Room could not be created');}}
  async rename(roomId:string,titleInput?:string){const title=titleInput?.trim();if(!title)throw new AppError('title_required',400,'Room title is required');const room=await this.rooms.rename(roomId,title);if(!room)throw new AppError('room_not_found',404,'Room not found');return room;}
  async delete(roomId:string){const result=await this.rooms.delete(roomId);if(result==='not_found')throw new AppError('room_not_found',404,'Room not found');if(result==='busy')throw new AppError('room_busy',409,'Wait for active responses to finish or cancel them first');}
  async restore(roomId:string){if(!await this.rooms.restore(roomId))throw new AppError('room_not_found',404,'Deleted room not found');return(await this.rooms.list()).find(room=>room.id===roomId);}
  async purge(roomId:string){const hashes=await this.workspace?.purgeCandidates(roomId)??[],result=await this.rooms.purge(roomId);if(result==='not_found')throw new AppError('room_not_found',404,'Room not found in trash');await this.workspace?.purgeFiles(roomId,hashes);}
  async setParticipant(roomId:string,personaId:string,present:boolean){const result=await this.rooms.setParticipant(roomId,personaId,present);if(result==='room_not_found'||result==='persona_not_found')throw new AppError(result,404,result);if(result==='persona_archived')throw new AppError(result,409,result);return{status:'ok'};}
}
