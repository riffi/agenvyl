import type {FastifyInstance} from 'fastify';
import type {HarnessCatalogService} from './HarnessCatalogService.js';
import {harnessCatalogResponseSchema} from '../../shared/validation/routeSchemas.js';

export async function registerConnectorRoutes(app:FastifyInstance,catalog:HarnessCatalogService){
  app.get('/api/v1/harnesses',{schema:{response:{200:harnessCatalogResponseSchema}}},()=>catalog.catalog());
}
