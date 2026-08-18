import type {FastifyInstance} from 'fastify';
import {createMessageBodySchema,messageResponseSchema,roomMessageParamsSchema,roomParamsSchema} from '../../shared/validation/routeSchemas.js';
import type {CreateMessageRequest} from '@agenvyl/contracts';
import type {ConversationRoutingService} from './ConversationRoutingService.js';
export async function registerMessageRoutes(app:FastifyInstance,routing:ConversationRoutingService){
  app.post<{Params:{roomId:string};Body:CreateMessageRequest}>('/api/v1/rooms/:roomId/messages',{schema:{params:roomParamsSchema,body:createMessageBodySchema,response:{200:messageResponseSchema,202:messageResponseSchema}}},async(request,reply)=>{request.log.info({roomId:request.params.roomId,messageId:request.body.message_id,routing:request.body.routing},'Message routing requested');const result=await routing.execute({roomId:request.params.roomId,body:request.body,correlationId:request.id});return reply.code(result.status==='duplicate'?200:202).send(result.message);});
  app.post<{Params:{roomId:string;messageId:string}}>('/api/v1/rooms/:roomId/messages/:messageId/apply-now',{schema:{params:roomMessageParamsSchema,response:{200:messageResponseSchema,202:messageResponseSchema}}},async(request,reply)=>{const result=await routing.applyQueuedNow(request.params);return reply.code(result.status==='duplicate'?200:202).send(result.message)});
}
