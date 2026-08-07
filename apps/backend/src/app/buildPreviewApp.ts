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
  app.get<{Params:{roomId:string;snapshotId:string;'*':string}}>('/api/v1/rooms/:roomId/workspace/snapshots/:snapshotId/preview/*',async(req,reply)=>
    relay(request,options.upstreamOrigin,req.raw.url??req.url,reply));
  app.get<{Params:{roomId:string;runId:string}}>('/api/v1/rooms/:roomId/runs/:runId/preview',async(req,reply)=>
    relay(request,options.upstreamOrigin,req.raw.url??req.url,reply));
  app.get<{Params:{roomId:string;runId:string}}>('/api/v1/rooms/:roomId/runs/:runId/preview/',async(req,reply)=>
    relay(request,options.upstreamOrigin,req.raw.url??req.url,reply));
  app.get<{Params:{roomId:string;runId:string;'*':string}}>('/api/v1/rooms/:roomId/runs/:runId/preview/*',async(req,reply)=>
    relay(request,options.upstreamOrigin,req.raw.url??req.url,reply));
  app.get<{Params:{'*':string}}>('/*',async(req,reply)=>{
    const target=scopedRunAsset(req.headers.referer,req.headers.host,req.params['*'],req.raw.url??req.url);
    if(!target)return reply.code(404).send({error:'Not Found',message:'Preview asset context is unavailable',statusCode:404});
    return reply.code(302).header('location',target).send();
  });
  return app;
}

async function relay(request:typeof fetch,upstreamOrigin:string,requestUrl:string,reply:import('fastify').FastifyReply){
  const upstream=new URL(requestUrl,upstreamOrigin);
  const response=await request(upstream,{redirect:'manual'});
  reply.code(response.status);
  for(const name of ['content-type','content-length','content-security-policy','content-disposition','x-content-type-options','cache-control','etag']){
    const value=response.headers.get(name);
    if(value)reply.header(name,value);
  }
  if(!response.body)return reply.send();
  return reply.send(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream));
}

const scopedRunAsset=(referer:string|undefined,host:string|undefined,assetInput:string,requestUrl:string)=>{
  if(!referer||!host)return undefined;
  let source:URL;
  try{source=new URL(referer);}catch{return undefined;}
  if(source.host!==host)return undefined;
  const match=source.pathname.match(/^\/api\/v1\/rooms\/([^/]+)\/runs\/([^/]+)\/preview(?:\/|$)/);
  if(!match)return undefined;
  let decoded:string,rawDecoded:string;
  try{
    decoded=decodeURIComponent(assetInput);
    rawDecoded=decodeURIComponent(requestUrl.split('?',1)[0]!.replace(/^\/+/,''));
  }catch{return undefined;}
  const segments=decoded.replaceAll('\\','/').split('/');
  const rawSegments=rawDecoded.replaceAll('\\','/').split('/');
  if(!decoded||segments.some(segment=>!segment||segment==='.'||segment==='..')||rawSegments.some(segment=>!segment||segment==='.'||segment==='..'))return undefined;
  const path=segments.map(encodeURIComponent).join('/'),search=new URL(requestUrl,'http://preview.invalid').search;
  return`/api/v1/rooms/${match[1]}/runs/${match[2]}/preview/${path}${search}`;
};
