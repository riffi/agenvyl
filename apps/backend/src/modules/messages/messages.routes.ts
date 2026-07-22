import type {FastifyInstance} from 'fastify';
import {createMessageBodySchema,messageResponseSchema,roomParamsSchema} from '../../shared/validation/routeSchemas.js';
import type {CreateMessageRound} from './createMessageRound.js';
import type {CreateMessageRequest} from '@agenvyl/contracts';
export async function registerMessageRoutes(app:FastifyInstance,createRound:CreateMessageRound){app.post<{Params:{roomId:string};Body:CreateMessageRequest}>('/api/v1/rooms/:roomId/messages',{schema:{params:roomParamsSchema,body:createMessageBodySchema,response:{200:messageResponseSchema,202:messageResponseSchema}}},async(request,reply)=>{const result=await createRound.execute({roomId:request.params.roomId,text:request.body.text,targets:request.body.targets,messageId:request.body.message_id,attachmentVersionIds:request.body.attachment_version_ids,executionIntent:request.body.execution_intent,correlationId:request.id});return reply.code(result.status==='duplicate'?200:202).send(result.message);});}
