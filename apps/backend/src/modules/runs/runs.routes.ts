import type {FastifyInstance} from 'fastify';
import {runRequestResolutionBodySchema,runParamsSchema} from '../../shared/validation/routeSchemas.js';
import type {RunsService} from './runs.service.js';
import type {ResolveRunRequest} from '@agenvyl/contracts';
export async function registerRunRoutes(app:FastifyInstance,runs:RunsService){
  app.post<{Params:{runId:string}}>('/api/v1/runs/:runId/cancel',{schema:{params:runParamsSchema}},request=>runs.cancel(request.params.runId));
  app.post<{Params:{runId:string}}>('/api/v1/runs/:runId/retry',{schema:{params:runParamsSchema}},async(request,reply)=>reply.code(202).send(await runs.retry(request.params.runId,request.id)));
  app.post<{Params:{runId:string}}>('/api/v1/runs/:runId/select',{schema:{params:runParamsSchema}},request=>runs.select(request.params.runId));
  app.post<{Params:{runId:string};Body:ResolveRunRequest}>('/api/v1/runs/:runId/approval',{schema:{params:runParamsSchema,body:runRequestResolutionBodySchema}},request=>runs.approve(request.params.runId,request.body.resolution));
  app.post<{Params:{runId:string};Body:ResolveRunRequest}>('/api/v1/runs/:runId/request',{schema:{params:runParamsSchema,body:runRequestResolutionBodySchema}},request=>runs.approve(request.params.runId,request.body.resolution));
}
