import {Readable} from 'node:stream';
import Fastify from 'fastify';
import {registerErrorHandler} from './plugins/errorHandler.js';

export type PreviewAppOptions={
  upstreamOrigin:string;
  fetch?:typeof fetch;
  logger?:boolean;
};

export async function buildPreviewApp(options:PreviewAppOptions){
  const app=Fastify({logger:options.logger===false?false:{redact:['req.headers.authorization','req.headers.x-api-key']}});
  const request=options.fetch??fetch;
  await registerErrorHandler(app);

  app.get('/health',()=>({status:'ok'}));
  app.get<{Params:{roomId:string;versionId:string}}>('/api/v1/rooms/:roomId/workspace/versions/:versionId/preview',async(req,reply)=>
    relay(request,options.upstreamOrigin,req.raw.url??req.url,reply));
  app.get<{Params:{roomId:string;versionId:string;'*':string}}>('/api/v1/rooms/:roomId/workspace/versions/:versionId/preview/*',async(req,reply)=>
    relay(request,options.upstreamOrigin,req.raw.url??req.url,reply));
  return app;
}

async function relay(request:typeof fetch,upstreamOrigin:string,requestUrl:string,reply:import('fastify').FastifyReply){
  const upstream=new URL(requestUrl,upstreamOrigin);
  const response=await request(upstream,{redirect:'manual'});
  reply.code(response.status);
  for(const name of ['content-type','content-length','content-security-policy','content-disposition','x-content-type-options']){
    const value=response.headers.get(name);
    if(value)reply.header(name,value);
  }
  if(!response.body)return reply.send();
  return reply.send(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream));
}
