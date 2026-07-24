import type {FastifyInstance} from 'fastify';
import type {HarnessCatalogService} from './HarnessCatalogService.js';
import {harnessCatalogResponseSchema} from '../../shared/validation/routeSchemas.js';

export async function registerConnectorRoutes(app:FastifyInstance,catalog:HarnessCatalogService){
  app.get<{Querystring:{refresh?:string}}>('/api/v1/harnesses',{schema:{response:{200:harnessCatalogResponseSchema}}},request=>catalog.catalog({forceRefresh:request.query.refresh==='true'}));
}
