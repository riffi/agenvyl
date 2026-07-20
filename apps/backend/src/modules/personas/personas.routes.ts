import type {FastifyInstance} from 'fastify';
import {createPersonaBodySchema,idParamsSchema,personaListResponseSchema,personaResponseSchema,roomQuerySchema,updatePersonaBodySchema} from '../../shared/validation/routeSchemas.js';
import type {CreatePersonaInput,PersonasService} from './personas.service.js';
export async function registerPersonaRoutes(app:FastifyInstance,personas:PersonasService){
  app.get<{Querystring:{include_archived?:string;room_id?:string}}>('/api/v1/personas',{schema:{querystring:roomQuerySchema,response:{200:personaListResponseSchema}}},request=>personas.list(request.query.room_id,request.query.include_archived==='true'));
  app.get<{Params:{id:string}}>('/api/v1/personas/:id',{schema:{params:idParamsSchema,response:{200:personaResponseSchema}}},request=>personas.get(request.params.id));
  app.post<{Body:CreatePersonaInput}>('/api/v1/personas',{schema:{body:createPersonaBodySchema,response:{201:personaResponseSchema}}},async(request,reply)=>reply.code(201).send(await personas.create(request.body)));
  app.put<{Params:{id:string};Body:Record<string,unknown>}>('/api/v1/personas/:id',{schema:{params:idParamsSchema,body:updatePersonaBodySchema,response:{200:personaResponseSchema}}},request=>personas.update(request.params.id,request.body));
  app.post<{Params:{id:string}}>('/api/v1/personas/:id/archive',{schema:{params:idParamsSchema}},request=>personas.archive(request.params.id));
  app.post<{Params:{id:string}}>('/api/v1/personas/:id/restore',{schema:{params:idParamsSchema}},request=>personas.restore(request.params.id));
  app.delete<{Params:{id:string}}>('/api/v1/personas/:id',{schema:{params:idParamsSchema}},async(request,reply)=>{await personas.delete(request.params.id);return reply.code(204).send();});
}
