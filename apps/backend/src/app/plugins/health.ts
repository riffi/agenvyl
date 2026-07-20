import type { FastifyInstance } from 'fastify';
import type { DependencyHealth } from '../../modules/harness/harness.ports.js';
import type {Database} from '../../infrastructure/database/Database.js';

export async function registerHealthRoutes(app: FastifyInstance, runGateway: DependencyHealth,database:Pick<Database,'ping'>) {
  app.get('/health', async (_request, reply) => reply.type('text/plain').send('ok'));
  app.get('/api/v1/health', async (_request,reply) => {
    let databaseStatus:'ok'|'unavailable'='ok';
    try{await database.ping();}catch{databaseStatus='unavailable';}
    const runGatewayStatus=await runGateway.capabilities(),ready=databaseStatus==='ok'&&runGatewayStatus.ok;
    return reply.code(ready?200:503).send({status:ready?'ready':'not_ready',database:databaseStatus,run_gateway:runGatewayStatus});
  });
}
