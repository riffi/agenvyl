import type {FastifyInstance} from 'fastify';
import {createRoomBodySchema,participantParamsSchema,renameRoomBodySchema,roomListResponseSchema,roomParamsSchema,roomResponseSchema,roomTimelineQuerySchema,roomTimelineResponseSchema} from '../../shared/validation/routeSchemas.js';
import type {RoomsService} from './rooms.service.js';
import type {CreateRoomRequest,RenameRoomRequest} from '@agenvyl/contracts';
export async function registerRoomRoutes(app:FastifyInstance,rooms:RoomsService){
  app.get<{Querystring:{deleted?:string}}>('/api/v1/rooms',{schema:{response:{200:roomListResponseSchema}}},request=>rooms.list(request.query.deleted==='true'));
  app.get<{Params:{roomId:string};Querystring:{before?:string;limit?:string}}>('/api/v1/rooms/:roomId/timeline',{schema:{params:roomParamsSchema,querystring:roomTimelineQuerySchema,response:{200:roomTimelineResponseSchema}}},request=>rooms.timeline(request.params.roomId,request.query.before,Number(request.query.limit??30)));
  app.post<{Body:CreateRoomRequest}>('/api/v1/rooms',{schema:{body:createRoomBodySchema,response:{201:roomResponseSchema}}},async(request,reply)=>reply.code(201).send(await rooms.create({title:request.body.title,personaIds:request.body.persona_ids})));
  app.patch<{Params:{roomId:string};Body:RenameRoomRequest}>('/api/v1/rooms/:roomId',{schema:{params:roomParamsSchema,body:renameRoomBodySchema,response:{200:roomResponseSchema}}},request=>rooms.rename(request.params.roomId,request.body.title));
  app.delete<{Params:{roomId:string};Querystring:{permanent?:string}}>('/api/v1/rooms/:roomId',{schema:{params:roomParamsSchema}},async(request,reply)=>{if(request.query.permanent==='true')await rooms.purge(request.params.roomId);else await rooms.delete(request.params.roomId);return reply.code(204).send();});
  app.post<{Params:{roomId:string}}>('/api/v1/rooms/:roomId/restore',{schema:{params:roomParamsSchema}},request=>rooms.restore(request.params.roomId));
  app.put<{Params:{roomId:string;personaId:string}}>('/api/v1/rooms/:roomId/participants/:personaId',{schema:{params:participantParamsSchema}},request=>rooms.setParticipant(request.params.roomId,request.params.personaId,true));
  app.delete<{Params:{roomId:string;personaId:string}}>('/api/v1/rooms/:roomId/participants/:personaId',{schema:{params:participantParamsSchema}},request=>rooms.setParticipant(request.params.roomId,request.params.personaId,false));
}
