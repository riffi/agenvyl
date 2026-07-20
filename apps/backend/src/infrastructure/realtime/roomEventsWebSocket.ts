import type {FastifyInstance} from 'fastify';
import type {RoomEventService} from '../../modules/room-events/RoomEventService.js';
import {roomEventsQuerySchema,roomParamsSchema} from '../../shared/validation/routeSchemas.js';

type EventSocket={readyState:number;bufferedAmount?:number;send(data:string):void;close?(code?:number,reason?:string):void;on(event:'close'|'error',listener:()=>void):void};

export async function deliverRoomEvents(socket:EventSocket,events:RoomEventService,roomId:string,after:number,maxBufferedBytes=1_048_576){
  let overloaded=false;
  const send=(event:unknown)=>{if(socket.readyState!==1||overloaded)return false;if((socket.bufferedAmount??0)>maxBufferedBytes){overloaded=true;socket.close?.(1013,'Slow consumer');return false;}socket.send(JSON.stringify(event));return true;};
  for(const event of await events.replay(roomId,after)){if(!send(event))break;}
  if(socket.readyState!==1||overloaded)return;
  let unsubscribe=()=>{};
  unsubscribe=events.subscribe(roomId,event=>{if(!send(event))unsubscribe();});
  let subscribed=true;const cleanup=()=>{if(!subscribed)return;subscribed=false;unsubscribe();};
  socket.on('close',cleanup);socket.on('error',cleanup);
}

export async function registerRoomEventsWebSocket(app:FastifyInstance,events:RoomEventService,maxBufferedBytes?:number){app.get('/api/v1/rooms/:roomId/events',{websocket:true,schema:{params:roomParamsSchema,querystring:roomEventsQuerySchema}},(socket,request)=>deliverRoomEvents(socket,events,(request.params as{roomId:string}).roomId,Number((request.query as{after?:string}).after??0)||0,maxBufferedBytes));}
