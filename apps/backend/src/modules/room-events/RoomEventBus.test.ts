import {describe,expect,it,vi} from 'vitest';
import {RoomEventBus} from './RoomEventBus.js';
import {RoomEventService} from './RoomEventService.js';

const event={id:'event',event_id:'event',sequence:1,type:'message.created',payload:{}};
describe('RoomEventBus',()=>{
  it('isolates rooms and removes subscriptions idempotently',()=>{const bus=new RoomEventBus(),listener=vi.fn(),unsubscribe=bus.subscribe('room-a',listener);bus.publish('room-b',event);expect(listener).not.toHaveBeenCalled();bus.publish('room-a',event);expect(listener).toHaveBeenCalledOnce();unsubscribe();unsubscribe();bus.publish('room-a',event);expect(listener).toHaveBeenCalledOnce();expect(bus.listenerCount('room-a')).toBe(0);});
  it('publishes only after durable append resolves',async()=>{let persist!:()=>void;const repository={append:vi.fn(()=>new Promise(resolve=>{persist=()=>resolve(event);})),replay:vi.fn()} as never,bus=new RoomEventBus(),service=new RoomEventService(repository,bus),listener=vi.fn();service.subscribe('room',listener);const pending=service.emit('room','message.created',{});expect(listener).not.toHaveBeenCalled();persist();await pending;expect(listener).toHaveBeenCalledWith(event);});
});
