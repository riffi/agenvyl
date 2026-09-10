import type {FastifyInstance} from 'fastify';
import type {WorkspaceRestoreRequest,WorkspaceRestoreTarget} from '@agenvyl/contracts';
import type {WorkspaceRestoreService} from './WorkspaceRestoreService.js';

const id={type:'string',minLength:1,maxLength:200};
const targetSchema={type:'object',additionalProperties:false,required:['kind','id'],properties:{kind:{type:'string',enum:['run','restore']},id}};
const params={type:'object',required:['roomId'],properties:{roomId:id}};
export const registerWorkspaceRestoreRoutes=async(app:FastifyInstance,restores:WorkspaceRestoreService)=>{
  const base='/api/v1/rooms/:roomId/workspace';
  app.get<{Params:{roomId:string}}>(`${base}/history`,{schema:{params}},request=>restores.history(request.params.roomId));
  app.post<{Params:{roomId:string};Body:{target:WorkspaceRestoreTarget}}>(`${base}/restores/preview`,{schema:{params,body:{type:'object',additionalProperties:false,required:['target'],properties:{target:targetSchema}}}},request=>restores.preview(request.params.roomId,request.body.target));
  app.post<{Params:{roomId:string};Body:WorkspaceRestoreRequest}>(`${base}/restores`,{schema:{params,body:{type:'object',additionalProperties:false,required:['target','fingerprint','requestId'],properties:{target:targetSchema,fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},requestId:{type:'string',format:'uuid'}}}}},request=>restores.execute(request.params.roomId,request.body));
  app.post<{Params:{roomId:string;restoreId:string}}>(`${base}/restores/:restoreId/retry`,{schema:{params:{type:'object',required:['roomId','restoreId'],properties:{roomId:id,restoreId:id}}}},request=>restores.retry(request.params.roomId,request.params.restoreId));
};
