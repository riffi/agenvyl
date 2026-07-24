import type {FastifyInstance} from 'fastify';
import type {CompleteSetupRequest,ConfigureSetupHarnessesRequest} from '@agenvyl/contracts';
import type {SetupService} from './SetupService.js';

export async function registerSetupRoutes(app:FastifyInstance,setup:SetupService){
  app.get('/api/v1/setup',()=>setup.state());
  app.get<{Querystring:{refresh?:string}}>('/api/v1/harness-settings',request=>setup.harnessSettings({forceRefresh:request.query.refresh==='true'}));
  app.put<{Body:ConfigureSetupHarnessesRequest}>('/api/v1/harness-settings',request=>setup.configure(request.body));
  app.put<{Body:ConfigureSetupHarnessesRequest}>('/api/v1/setup/harnesses',request=>setup.configure(request.body));
  app.post<{Body:CompleteSetupRequest}>('/api/v1/setup/complete',request=>setup.complete(request.body));
}
