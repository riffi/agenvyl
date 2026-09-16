import type {FastifyInstance} from 'fastify';
import type {ProjectPreviewSettings} from '@agenvyl/contracts';
import type {ProjectFilesService} from './ProjectFilesService.js';
import {AppError} from '../../shared/errors/AppError.js';

const params={type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}};
export function registerProjectFilesRoutes(app:FastifyInstance,files:ProjectFilesService){
  app.get<{Params:{id:string};Querystring:{q?:string}}>('/api/v1/projects/:id/search',{schema:{params,querystring:{type:'object',properties:{q:{type:'string',maxLength:500}}}}},req=>files.search(req.params.id,req.query.q??''));
  app.get<{Params:{id:string};Querystring:{path?:string}}>('/api/v1/projects/:id/files',{schema:{params,querystring:{type:'object',properties:{path:{type:'string',maxLength:4000}}}}},req=>files.list(req.params.id,req.query.path??''));
  app.get<{Params:{id:string}}>('/api/v1/projects/:id/inspection',{schema:{params}},req=>files.inspect(req.params.id));
  app.put<{Params:{id:string};Body:ProjectPreviewSettings}>('/api/v1/projects/:id/preview-settings',{schema:{params,body:{type:'object',additionalProperties:false,required:['entrypoint','build_command'],properties:{entrypoint:{type:['string','null'],maxLength:4000},build_command:{type:['string','null'],maxLength:4000}}}}},req=>files.saveSettings(req.params.id,req.body));
  app.get<{Params:{id:string};Querystring:{path:string;inline?:string}}>('/api/v1/projects/:id/file',{schema:{params,querystring:{type:'object',required:['path'],properties:{path:{type:'string',maxLength:4000},inline:{type:'string'}}}}},async(req,reply)=>{
    const file=await files.file(req.params.id,req.query.path);
    return reply.type(file.mime_type).header('cache-control','no-store').header('x-content-type-options','nosniff').header('content-security-policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'").header('content-disposition',`${req.query.inline==='1'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(req.query.path.split('/').pop()??'file')}`).send(file.data);
  });
  app.post<{Params:{id:string};Body:{roomId:string;path:string}}>('/api/v1/projects/:id/attach',{schema:{params,body:{type:'object',additionalProperties:false,required:['roomId','path'],properties:{roomId:{type:'string',format:'uuid'},path:{type:'string',maxLength:4000}}}}},req=>files.attach(req.params.id,req.body.roomId,req.body.path));
  app.post<{Params:{id:string}}>('/api/v1/projects/:id/build',{schema:{params}},req=>files.build(req.params.id));
  app.get<{Params:{id:string}}>('/api/v1/projects/:id/build',{schema:{params}},req=>files.buildStatus(req.params.id));
  app.post<{Params:{id:string}}>('/api/v1/projects/:id/build/cancel',{schema:{params}},req=>files.cancel(req.params.id));
  app.get<{Params:{id:string;entry:string;'*':string}}>('/api/v1/projects/:id/preview/:entry/*',{schema:{params:{...params,required:['id','entry'],properties:{...params.properties,entry:{type:'string',pattern:'^[A-Za-z0-9_-]+$',maxLength:6000},'*':{type:'string'}}}}},async(req,reply)=>{
    const entry=Buffer.from(req.params.entry,'base64url').toString('utf8');
    if(Buffer.from(entry).toString('base64url')!==req.params.entry)throw new AppError('project_entry_invalid',400,'Invalid preview entry');
    const file=await files.preview(req.params.id,entry,req.params['*']);
    const response=reply.type(file.mime_type).header('cache-control','no-store').header('x-content-type-options','nosniff').header('content-disposition','inline');
    if(file.mime_type!=='text/html')return response.send(file.data);
    const base=`/api/v1/projects/${encodeURIComponent(req.params.id)}/preview/${req.params.entry}/`,tag=`<base href="${base}">`;
    const source=file.data.toString('utf8').replace(/<base\b[^>]*>/gi,'');
    return response.header('content-security-policy',"default-src 'self' http: https: data: blob:; script-src 'self' http: https: 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' http: https: 'unsafe-inline'; connect-src 'self' http: https: ws: wss:; object-src 'none'").send(/<head[\s>]/i.test(source)?source.replace(/<head([^>]*)>/i,`<head$1>${tag}`):tag+source);
  });
}
