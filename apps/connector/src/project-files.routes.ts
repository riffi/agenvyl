import type {FastifyInstance} from 'fastify';
import path from 'node:path';
import type {WorkspacePolicy} from './workspace-policy.js';
import {inspectProject,listProject,projectError,projectRelative,projectTarget,readProject} from './project-files.js';
import {ProjectBuilds} from './project-builds.js';
import {searchProject} from './project-search.js';

export function registerProjectFileRoutes(app:FastifyInstance,policy:WorkspacePolicy){
  const builds=new ProjectBuilds();
  app.addHook('onClose',async()=>builds.close());
  type Input={root:string;path?:string;entrypoint?:string;command?:string};
  const schema={body:{type:'object',required:['root'],additionalProperties:false,properties:{root:{type:'string',minLength:1},path:{type:'string',maxLength:4000},entrypoint:{type:'string',maxLength:4000},command:{type:'string',maxLength:4000}}}};
  app.post<{Body:Input}>('/v2/project-files/list',{schema},req=>listProject(policy.resolveProject(req.body.root),req.body.path??''));
  app.post<{Body:Input}>('/v2/project-files/search',{schema},req=>searchProject(policy.resolveProject(req.body.root),req.body.path??''));
  app.post<{Body:Input}>('/v2/project-files/inspect',{schema},async req=>{
    const root=policy.resolveProject(req.body.root);
    return{...await inspectProject(root),build:builds.get(root)};
  });
  app.post<{Body:Input}>('/v2/project-files/read',{schema},async req=>{
    const root=policy.resolveProject(req.body.root),file=await readProject(root,req.body.path??'');
    return{data:file.data.toString('base64'),mime_type:file.mime_type};
  });
  app.post<{Body:Input}>('/v2/project-files/preview',{schema},async req=>{
    const root=policy.resolveProject(req.body.root),entry=projectRelative(req.body.entrypoint??'');
    if(!/\.html?$/i.test(entry))throw projectError('project_html_required','Select an HTML file');
    await projectTarget(root,entry);
    const directory=path.posix.dirname(entry),asset=projectRelative(req.body.path||path.posix.basename(entry));
    if(asset.split('/').some(part=>part.startsWith('.')||part==='node_modules'))throw projectError('project_asset_forbidden','This file is not a preview asset',403);
    const file=await readProject(root,directory==='.'?asset:`${directory}/${asset}`);
    return{data:file.data.toString('base64'),mime_type:file.mime_type};
  });
  app.post<{Body:Input}>('/v2/project-files/build',{schema},req=>builds.start(policy.resolveProject(req.body.root),req.body.command??''));
  app.post<{Body:Input}>('/v2/project-files/build-status',{schema},req=>builds.get(policy.resolveProject(req.body.root)));
  app.post<{Body:Input}>('/v2/project-files/cancel',{schema},req=>builds.cancel(policy.resolveProject(req.body.root)));
}
