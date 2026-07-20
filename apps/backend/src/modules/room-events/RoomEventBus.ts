import type {RoomEvent} from '../../types.js';
export type RoomEventListener=(event:RoomEvent)=>void;
export class RoomEventBus{
  private readonly listeners=new Map<string,Set<RoomEventListener>>();
  publish(roomId:string,event:RoomEvent){for(const listener of this.listeners.get(roomId)??[])listener(event);}
  subscribe(roomId:string,listener:RoomEventListener){let listeners=this.listeners.get(roomId);if(!listeners){listeners=new Set();this.listeners.set(roomId,listeners);}listeners.add(listener);return()=>{listeners?.delete(listener);if(listeners?.size===0)this.listeners.delete(roomId);};}
  listenerCount(roomId:string){return this.listeners.get(roomId)?.size??0;}
}
