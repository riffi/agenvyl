import type {FastifyInstance} from 'fastify';
import type {UpdateLocalUserProfileRequest} from '@agenvyl/contracts';
import {userProfileBodySchema,userProfileResponseSchema} from '../../shared/validation/routeSchemas.js';
import type {UserProfileService} from './userProfile.service.js';

export async function registerUserProfileRoutes(app:FastifyInstance,profiles:UserProfileService){
  app.get('/api/v1/user-profile',{schema:{response:{200:userProfileResponseSchema}}},()=>profiles.get());
  app.put<{Body:UpdateLocalUserProfileRequest}>('/api/v1/user-profile',{schema:{body:userProfileBodySchema,response:{200:userProfileResponseSchema}}},request=>profiles.update(request.body));
}
