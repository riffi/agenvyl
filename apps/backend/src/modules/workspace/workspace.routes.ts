import type {FastifyInstance,FastifyReply} from 'fastify';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import type {RoomWorkspaceService} from './RoomWorkspaceService.js';
import type {ResolveWorkspaceConflictsRequest} from '@agenvyl/contracts';
import {resolveWorkspaceConflictsBodySchema,runPreviewAssetParamsSchema,runWorkspaceResultSchema,workspaceConflictParamsSchema} from '../../shared/validation/routeSchemas.js';

export async function registerWorkspaceRoutes(app:FastifyInstance,workspace:RoomWorkspaceService){
  app.addContentTypeParser('*',{parseAs:'buffer',bodyLimit:workspace.maxFileBytes},(_request,body,done)=>done(null,body));
  app.get<{Params:{roomId:string};Querystring:{deleted?:string}}>('/api/v1/rooms/:roomId/workspace',request=>workspace.list(request.params.roomId,request.query.deleted==='true'));
  app.post<{Params:{roomId:string};Body:Buffer;Headers:{'x-file-path'?:string;'x-file-name'?:string;'x-conflict-strategy'?:string}}>('/api/v1/rooms/:roomId/workspace/files',async(request,reply)=>{const strategy=request.headers['x-conflict-strategy'];const conflict=strategy==='replace'||strategy==='rename'?strategy:'fail';return reply.code(201).send(await workspace.upload(request.params.roomId,request.headers['x-file-path']??request.headers['x-file-name'],request.headers['content-type'],request.body,conflict));});
  app.post<{Params:{roomId:string};Body:{path?:string}}>('/api/v1/rooms/:roomId/workspace/directories',async(request,reply)=>reply.code(201).send(await workspace.createDirectory(request.params.roomId,request.body.path??'')));
  app.patch<{Params:{roomId:string;entryId:string};Body:{path?:string}}>('/api/v1/rooms/:roomId/workspace/entries/:entryId',request=>workspace.move(request.params.roomId,request.params.entryId,request.body.path??''));
  app.delete<{Params:{roomId:string;entryId:string}}>('/api/v1/rooms/:roomId/workspace/entries/:entryId',async(request,reply)=>{await workspace.remove(request.params.roomId,request.params.entryId);return reply.code(204).send();});
  app.post<{Params:{roomId:string;entryId:string}}>('/api/v1/rooms/:roomId/workspace/entries/:entryId/restore',request=>workspace.restoreEntry(request.params.roomId,request.params.entryId));
  app.get<{Params:{roomId:string;entryId:string}}>('/api/v1/rooms/:roomId/workspace/entries/:entryId/versions',request=>workspace.versions(request.params.roomId,request.params.entryId));
  app.get<{Params:{roomId:string;versionId:string}}>('/api/v1/rooms/:roomId/workspace/versions/:versionId/metadata',request=>workspace.version(request.params.roomId,request.params.versionId));
  app.post<{Params:{roomId:string;versionId:string}}>('/api/v1/rooms/:roomId/workspace/versions/:versionId/restore',request=>workspace.restoreVersion(request.params.roomId,request.params.versionId));
  app.get<{Params:{roomId:string;runId:string}}>('/api/v1/rooms/:roomId/runs/:runId/workspace/conflicts',{schema:{params:workspaceConflictParamsSchema}},request=>workspace.conflicts(request.params.roomId,request.params.runId));
  app.post<{Params:{roomId:string;runId:string};Body:ResolveWorkspaceConflictsRequest}>('/api/v1/rooms/:roomId/runs/:runId/workspace/conflicts/resolve',{schema:{params:workspaceConflictParamsSchema,body:resolveWorkspaceConflictsBodySchema}},request=>workspace.resolveConflicts(request.params.roomId,request.params.runId,request.body));
  app.post<{Params:{roomId:string;runId:string}}>('/api/v1/rooms/:roomId/runs/:runId/workspace/apply',{schema:{params:workspaceConflictParamsSchema,response:{200:runWorkspaceResultSchema}}},request=>workspace.applyRunChanges(request.params.roomId,request.params.runId));
  app.get<{Params:{roomId:string;versionId:string}}>('/api/v1/rooms/:roomId/workspace/versions/:versionId',async(request,reply)=>{const file=await workspace.streamVersion(request.params.roomId,request.params.versionId);return reply.type(file.contentType).header('x-content-type-options','nosniff').header('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.version.path.split('/').pop()??'file')}`).send(file.stream);});
  app.get<{Params:{roomId:string;snapshotId:string;'*':string}}>('/api/v1/rooms/:roomId/workspace/snapshots/:snapshotId/preview/*',async(request,reply)=>{
    const file=await workspace.resolveSnapshotFile(request.params.roomId,request.params.snapshotId,request.params['*']),etag=`"${file.version.sha256}"`,response=reply.type(file.contentType).header('x-content-type-options','nosniff').header('content-security-policy',file.contentType==='text/html'?htmlCsp:documentCsp).header('content-disposition','inline').header('cache-control','public, max-age=31536000, immutable').header('etag',etag);
    if(request.headers['if-none-match']===etag)return response.code(304).send();
    if(file.contentType!=='text/html')return response.send(createReadStream(file.path));
    const source=await readFile(file.path,'utf8'),segments=file.version.path.split('/'),directory=segments.slice(0,-1).map(encodeURIComponent).join('/'),base=`/api/v1/rooms/${encodeURIComponent(request.params.roomId)}/workspace/snapshots/${encodeURIComponent(request.params.snapshotId)}/preview/${directory?`${directory}/`:''}`,tag=`<base href="${base}">`;
    return response.send(/<head[\s>]/i.test(source)?source.replace(/<head([^>]*)>/i,`<head$1>${tag}`):`${tag}${source}`);
  });
  const runPreview=async(request:{params:{roomId:string;runId:string;'*'?:string};headers:{'if-none-match'?:string}},reply:FastifyReply)=>{
    const file=await workspace.resolveRunPreview(request.params.roomId,request.params.runId,request.params['*']??''),base=`/api/v1/rooms/${encodeURIComponent(request.params.roomId)}/runs/${encodeURIComponent(request.params.runId)}/preview/`;
    return sendImmutablePreview(reply,file,base,request.headers['if-none-match']);
  };
  app.get<{Params:{roomId:string;runId:string}}>('/api/v1/rooms/:roomId/runs/:runId/preview',{schema:{params:workspaceConflictParamsSchema}},runPreview);
  app.get<{Params:{roomId:string;runId:string}}>('/api/v1/rooms/:roomId/runs/:runId/preview/',{schema:{params:workspaceConflictParamsSchema}},runPreview);
  app.get<{Params:{roomId:string;runId:string;'*':string}}>('/api/v1/rooms/:roomId/runs/:runId/preview/*',{schema:{params:runPreviewAssetParamsSchema}},runPreview);
  app.get<{Params:{roomId:string;versionId:string}}>('/api/v1/rooms/:roomId/workspace/versions/:versionId/preview',async(request,reply)=>{const file=await workspace.resolveVersion(request.params.roomId,request.params.versionId),html=file.contentType==='text/html';const response=reply.type(file.contentType).header('x-content-type-options','nosniff').header('content-security-policy',html?htmlCsp:documentCsp).header('content-disposition','inline');if(!html)return response.send(createReadStream(file.path));const source=await readFile(file.path,'utf8'),base=`/api/v1/rooms/${encodeURIComponent(request.params.roomId)}/workspace/versions/${encodeURIComponent(request.params.versionId)}/preview/`,tag=`<base href="${base}">`;return response.send(/<head[\s>]/i.test(source)?source.replace(/<head([^>]*)>/i,`<head$1>${tag}`):`${tag}${source}`);});
  app.get<{Params:{roomId:string;versionId:string;'*':string}}>('/api/v1/rooms/:roomId/workspace/versions/:versionId/preview/*',async(request,reply)=>{const file=await workspace.resolvePreviewAsset(request.params.roomId,request.params.versionId,request.params['*']);return reply.type(file.contentType).header('x-content-type-options','nosniff').header('content-security-policy',htmlCsp).send(createReadStream(file.path));});
}

const htmlCsp="default-src 'self' http: https: data: blob:; img-src 'self' http: https: data: blob:; style-src 'self' http: https: 'unsafe-inline'; script-src 'self' http: https: 'unsafe-inline' blob:; connect-src 'self' http: https: ws: wss:; font-src 'self' http: https: data:; media-src 'self' http: https: data: blob:; frame-src http: https:; worker-src 'self' http: https: blob:; object-src 'none'";
const documentCsp="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:";

const sendImmutablePreview=async(reply:FastifyReply,file:Awaited<ReturnType<RoomWorkspaceService['resolveRunPreview']>>,base:string,ifNoneMatch?:string)=>{
  const etag=`"${file.version.sha256}"`,response=reply.type(file.contentType).header('x-content-type-options','nosniff').header('content-security-policy',file.contentType==='text/html'?htmlCsp:documentCsp).header('content-disposition','inline').header('cache-control','public, max-age=31536000, immutable').header('etag',etag);
  if(ifNoneMatch===etag)return response.code(304).send();
  if(file.contentType!=='text/html')return response.send(file.data!==undefined?file.data:createReadStream(file.path));
  const source=file.data!==undefined?file.data.toString('utf8'):await readFile(file.path,'utf8'),tag=`<base href="${base}">`;
  return response.send(/<head[\s>]/i.test(source)?source.replace(/<head([^>]*)>/i,`<head$1>${tag}`):`${tag}${source}`);
};
