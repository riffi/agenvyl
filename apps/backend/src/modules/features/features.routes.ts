import type {FastifyInstance} from 'fastify';
import type {RuntimeFeatures} from '@agenvyl/contracts';
import type {FeatureFlags} from './planMode.js';

export const registerFeatureRoutes=async(app:FastifyInstance,features:FeatureFlags)=>{
  app.get<{Reply:RuntimeFeatures}>('/api/v1/features',{
    schema:{response:{200:{type:'object',additionalProperties:false,required:['plan_mode'],properties:{plan_mode:{type:'boolean'}}}}},
  },()=>({plan_mode:features.planMode}));
};
