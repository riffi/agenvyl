import type {RoomEvent} from '../../types.js';
import type {RoomEventBus,RoomEventListener} from './RoomEventBus.js';
import type {RoomEventRepository} from './roomEvents.repository.js';
export class RoomEventService{
  constructor(private readonly repository:RoomEventRepository,private readonly bus:RoomEventBus){}
  async emit(roomId:string,type:string,payload:unknown){const event=await this.repository.append(roomId,type,payload);this.bus.publish(roomId,event);return event;}
  publishPersisted(roomId:string,event:RoomEvent){this.bus.publish(roomId,event);}
  replay(roomId:string,after:number){return this.repository.replay(roomId,after);}
  subscribe(roomId:string,listener:RoomEventListener){return this.bus.subscribe(roomId,listener);}
}
