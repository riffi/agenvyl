import type {FastifyInstance} from 'fastify';
import type {CreateProjectRequest,UpdateProjectRequest} from '@agenvyl/contracts';
import type {ProjectsService} from './projects.service.js';

const projectBody={type:'object',additionalProperties:false,required:['name','path'],properties:{name:{type:'string',minLength:1,maxLength:80},path:{type:'string',minLength:1}}} as const;
const updateBody={type:'object',additionalProperties:false,minProperties:1,properties:projectBody.properties} as const;

export const registerProjectRoutes=async(app:FastifyInstance,projects:ProjectsService)=>{
  app.get<{Querystring:{path?:string}}>('/api/v1/projects/directories',{schema:{querystring:{type:'object',additionalProperties:false,properties:{path:{type:'string',maxLength:32768}}}}},request=>projects.browse(request.query.path));
  app.get('/api/v1/projects',()=>projects.list());
  app.post<{Body:CreateProjectRequest}>('/api/v1/projects',{schema:{body:projectBody}},async(request,reply)=>reply.code(201).send(await projects.create(request.body)));
  app.patch<{Params:{id:string};Body:UpdateProjectRequest}>('/api/v1/projects/:id',{schema:{body:updateBody}},request=>projects.update(request.params.id,request.body));
  app.delete<{Params:{id:string}}>('/api/v1/projects/:id',async(request,reply)=>{await projects.delete(request.params.id);return reply.code(204).send();});
  app.post('/api/v1/projects/pick-directory',()=>projects.pick());
};
