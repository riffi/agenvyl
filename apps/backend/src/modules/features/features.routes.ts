import type {FastifyInstance} from 'fastify';
import type {RuntimeFeatures} from '@agenvyl/contracts';

export const registerFeatureRoutes=async(app:FastifyInstance,features:{previewOrigin:string})=>{
  app.get<{Reply:RuntimeFeatures}>('/api/v1/features',{
    schema:{response:{200:{type:'object',additionalProperties:false,required:['preview_origin'],properties:{preview_origin:{type:'string'}}}}},
  },()=>({preview_origin:features.previewOrigin}));
};
