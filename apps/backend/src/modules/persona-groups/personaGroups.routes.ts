import type {FastifyInstance} from 'fastify';
import {groupBodySchema,idParamsSchema,moveGroupBodySchema,personaGroupListResponseSchema,personaGroupResponseSchema,reorderGroupBodySchema} from '../../shared/validation/routeSchemas.js';
import type {PersonaGroupsService} from './personaGroups.service.js';
export async function registerPersonaGroupRoutes(app:FastifyInstance,groups:PersonaGroupsService){
  app.get('/api/v1/persona-groups',{schema:{response:{200:personaGroupListResponseSchema}}},()=>groups.list());
  app.post<{Body:{name?:string}}>('/api/v1/persona-groups',{schema:{body:groupBodySchema,response:{201:personaGroupResponseSchema}}},async(request,reply)=>reply.code(201).send(await groups.create(request.body)));
  app.put<{Params:{id:string};Body:{name?:string}}>('/api/v1/persona-groups/:id',{schema:{params:idParamsSchema,body:groupBodySchema,response:{200:personaGroupResponseSchema}}},request=>groups.rename(request.params.id,request.body));
  app.post<{Params:{id:string};Body:{direction?:string}}>('/api/v1/persona-groups/:id/move',{schema:{params:idParamsSchema,body:moveGroupBodySchema,response:{200:personaGroupResponseSchema}}},request=>groups.move(request.params.id,request.body));
  app.post<{Params:{id:string};Body:{position?:number}}>('/api/v1/persona-groups/:id/reorder',{schema:{params:idParamsSchema,body:reorderGroupBodySchema,response:{200:personaGroupResponseSchema}}},request=>groups.reorder(request.params.id,request.body));
  app.delete<{Params:{id:string}}>('/api/v1/persona-groups/:id',{schema:{params:idParamsSchema}},async(request,reply)=>{await groups.delete(request.params.id);return reply.code(204).send();});
}
