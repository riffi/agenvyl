import {describe,expect,it,vi} from 'vitest';
import {RoomEventBus} from '../../modules/room-events/RoomEventBus.js';
import {RoomEventService} from '../../modules/room-events/RoomEventService.js';
import {deliverRoomEvents} from './roomEventsWebSocket.js';

function socket(state=1,bufferedAmount=0){const handlers=new Map<string,()=>void>();return{readyState:state,bufferedAmount,send:vi.fn(),close:vi.fn(),on:vi.fn((name:string,handler:()=>void)=>handlers.set(name,handler)),trigger:(name:string)=>handlers.get(name)?.()};}
describe('room event WebSocket delivery',()=>{
  it('replays then subscribes and unsubscribes on close',async()=>{const bus=new RoomEventBus(),repository={replay:vi.fn().mockResolvedValue([{id:'old',event_id:'old',sequence:2,type:'old',payload:{}}])} as never,events=new RoomEventService(repository,bus),ws=socket();await deliverRoomEvents(ws,events,'room',1);expect(ws.send).toHaveBeenCalledOnce();expect(bus.listenerCount('room')).toBe(1);bus.publish('room',{id:'new',event_id:'new',sequence:3,type:'new',payload:{}});expect(ws.send).toHaveBeenCalledTimes(2);ws.trigger('close');expect(bus.listenerCount('room')).toBe(0);});
  it('does not subscribe a socket closed during replay',async()=>{const bus=new RoomEventBus(),repository={replay:vi.fn().mockResolvedValue([{id:'old',event_id:'old',sequence:2,type:'old',payload:{}}])} as never,events=new RoomEventService(repository,bus),ws=socket(3);await deliverRoomEvents(ws,events,'room',0);expect(ws.send).not.toHaveBeenCalled();expect(bus.listenerCount('room')).toBe(0);});
  it('unsubscribes on socket error',async()=>{const bus=new RoomEventBus(),events=new RoomEventService({replay:vi.fn().mockResolvedValue([])} as never,bus),ws=socket();await deliverRoomEvents(ws,events,'room',0);ws.trigger('error');expect(bus.listenerCount('room')).toBe(0);});
  it('disconnects a slow consumer instead of growing its buffer',async()=>{const bus=new RoomEventBus(),events=new RoomEventService({replay:vi.fn().mockResolvedValue([{id:'old'}])} as never,bus),ws=socket(1,101);await deliverRoomEvents(ws,events,'room',0,100);expect(ws.send).not.toHaveBeenCalled();expect(ws.close).toHaveBeenCalledWith(1013,'Slow consumer');expect(bus.listenerCount('room')).toBe(0);});
});
