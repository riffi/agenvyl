import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  CONNECTOR_API_VERSION,
  isResolveConnectorRequest,
  isConfigureConnectorInstancesRequest,
  isStartExecutionRequest,
  type ConnectorExecutionEvent,
  type ConnectorHealth,
  type ConnectorInstanceList,
  type ConnectorCatalog,
  type ConnectorDiscovery,
} from '@agenvyl/connector-contract';
import type { ConnectorAdapter } from './adapter.js';
import type { ConnectorConfig } from './config.js';
import { ExecutionRegistry, RegistryError } from './execution-registry.js';
import { WorkspacePolicy, WorkspacePolicyError } from './workspace-policy.js';

export function buildConnectorApp(config: ConnectorConfig, options: {
  connectorEpoch?: string;
  startedAt?: string;
  logger?: boolean;
  adapters?: ReadonlyMap<string, ConnectorAdapter>;
  replayLimit?: number;
  now?: () => string;
  discover?:()=>Promise<ConnectorDiscovery>;
  configureInstances?:(instances:ConnectorConfig['instances'])=>Promise<ReadonlyMap<string,ConnectorAdapter>>;
  persistInstances?:(instances:ConnectorConfig['instances'])=>Promise<void>;
} = {}) {
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.x-api-key'] } : false });
  const connectorEpoch = options.connectorEpoch ?? randomUUID(), startedAt = options.startedAt ?? new Date().toISOString();
  let enabledInstances = config.instances.filter(instance => instance.enabled);
  const adapters = new Map(options.adapters ?? new Map<string, ConnectorAdapter>());
  const instanceTypes=new Map(enabledInstances.map(instance => [instance.id,instance.type]));
  const hasAdapter = (instance: ConnectorConfig['instances'][number]) => adapters.get(instance.id)?.type === instance.type;
  const workspacePolicy = new WorkspacePolicy(config.workspaces.roots);
  const isReady = (instance: ConnectorConfig['instances'][number]) => hasAdapter(instance) && workspacePolicy.configured;
  const registry = new ExecutionRegistry(
    connectorEpoch,
    instanceTypes,
    adapters,
    workspacePolicy,
    options.replayLimit,
    options.now,
  );

  app.addHook('onClose',async()=>{await Promise.allSettled([...new Set(adapters.values())].map(adapter=>adapter.close?.()));});

  app.addHook('onRequest', async (request, reply) => {
    if (authorized(request, config.token)) return;
    return reply.code(401).header('www-authenticate', 'Bearer').send({ apiVersion: CONNECTOR_API_VERSION, error: 'unauthorized', message: 'Valid Connector Bearer token required' });
  });

  app.get('/v1/health', async (): Promise<ConnectorHealth> => ({
    apiVersion: CONNECTOR_API_VERSION,
    connectorEpoch,
    status: enabledInstances.some(instance => !isReady(instance)) ? 'degraded' : 'ready',
    startedAt,
    instances: {
      total: enabledInstances.length,
      healthy: enabledInstances.filter(isReady).length,
      degraded: enabledInstances.filter(instance => !isReady(instance)).length,
    },
  }));

  app.get('/v1/instances', async (): Promise<ConnectorInstanceList> => ({
    apiVersion: CONNECTOR_API_VERSION,
    connectorEpoch,
    instances: enabledInstances.map(instance => {
      const adapter = adapters.get(instance.id);
      const ownership=instance.type==='opencode'&&instance.managed!==undefined?{managed:instance.managed}:{};
      if (adapter?.type !== instance.type) {
        return { id: instance.id, type: instance.type, status: 'unavailable' as const, capabilities: [],...ownership, error: { code: 'adapter_not_loaded', message: 'Adapter module is not loaded in this Connector build' } };
      }
      return workspacePolicy.configured
        ? { id: instance.id, type: instance.type, status: 'healthy' as const, capabilities: adapter.capabilities,...ownership }
        : { id: instance.id, type: instance.type, status: 'degraded' as const, capabilities: adapter.capabilities,...ownership, error: { code: 'workspace_not_configured', message: 'Connector workspace roots are not configured' } };
    }),
  }));

  app.get('/v1/configuration',async()=>({apiVersion:CONNECTOR_API_VERSION,instances:structuredClone(config.instances)}));

  app.get('/v1/discovery',async(_request,reply)=>options.discover?options.discover():reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'discovery_unavailable',message:'Harness discovery is unavailable'}));

  app.put('/v1/instances',async(request,reply)=>{
    if(!isConfigureConnectorInstancesRequest(request.body))return reply.code(400).send({apiVersion:CONNECTOR_API_VERSION,error:'invalid_request',message:'Connector instances do not match the v1 contract'});
    if(!options.configureInstances||!options.persistInstances)return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'configuration_unavailable',message:'Connector configuration is unavailable'});
    const instances=structuredClone(request.body.instances) as ConnectorConfig['instances'];
    const previous=structuredClone(config.instances);
    try{
      const configured=await options.configureInstances(instances);
      await options.persistInstances(instances);
      config.instances=instances;enabledInstances=instances.filter(instance=>instance.enabled);
      const previousAdapters=[...new Set(adapters.values())];adapters.clear();for(const [id,adapter] of configured)adapters.set(id,adapter);
      await Promise.allSettled(previousAdapters.filter(adapter=>![...configured.values()].includes(adapter)).map(adapter=>adapter.close?.()));
      instanceTypes.clear();for(const instance of enabledInstances)instanceTypes.set(instance.id,instance.type);
      return{apiVersion:CONNECTOR_API_VERSION,instances};
    }catch(error){app.log.error({err:error},'Connector configuration failed');await options.configureInstances(previous).catch(()=>undefined);await options.persistInstances(previous).catch(()=>undefined);return reply.code(409).send({apiVersion:CONNECTOR_API_VERSION,error:'configuration_failed',message:'Connector configuration could not be applied'});}
  });

  app.get<{ Params: { id: string } }>('/v1/instances/:id/catalog', async (request, reply) => {
    const instance=enabledInstances.find(candidate=>candidate.id===request.params.id);
    if (!instance) return reply.code(404).send({ apiVersion: CONNECTOR_API_VERSION, error: 'instance_not_found', message: 'Connector instance not found' });
    const adapter=adapters.get(instance.id);
    if(adapter?.type!==instance.type||!adapter.catalog)return reply.code(503).send({ apiVersion: CONNECTOR_API_VERSION, error: 'catalog_unavailable', message: 'Connector instance does not provide catalog discovery' });
    try{const catalog=await adapter.catalog();return{apiVersion:CONNECTOR_API_VERSION,connectorEpoch,instanceId:instance.id,...catalog} satisfies ConnectorCatalog;}
    catch{return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'catalog_unavailable',message:'Connector instance catalog is unavailable'});}
  });

  app.post('/v1/executions', async (request, reply) => {
    if (!isStartExecutionRequest(request.body)) return error(reply, new RegistryError('invalid_request', 'Execution request does not match Connector v1 contract', 400));
    try {
      const result = registry.start(request.body);
      return reply.code(result.created ? 201 : 200).send({ execution: result.execution });
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.get<{ Params: { id: string } }>('/v1/executions/:id', async (request, reply) => {
    try {
      return { execution: registry.inspect(request.params.id) };
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/v1/executions/:id/events', async (request, reply) => {
    const after = request.query.after === undefined ? 0 : Number(request.query.after);
    const controller = new AbortController();
    reply.raw.once('close', () => controller.abort());
    try {
      const events = registry.subscribe(request.params.id, after, controller.signal);
      return reply
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('connection', 'keep-alive')
        .send(Readable.from(asServerSentEvents(events)));
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.post<{ Params: { id: string } }>('/v1/executions/:id/stop', async (request, reply) => {
    try {
      return { execution: await registry.stop(request.params.id) };
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.post<{ Params: { id: string; requestId: string } }>('/v1/executions/:id/requests/:requestId/resolve', async (request, reply) => {
    if (!isResolveConnectorRequest(request.body)) return error(reply, new RegistryError('invalid_request', 'Request resolution does not match Connector v1 contract', 400));
    try {
      return await registry.resolveRequest(request.params.id, request.params.requestId, request.body);
    } catch (caught) {
      return error(reply, caught);
    }
  });

  return app;
}

function error(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, caught: unknown) {
  const issue = caught instanceof RegistryError || caught instanceof WorkspacePolicyError
    ? caught
    : new RegistryError('internal_error', 'Connector execution registry failed', 500);
  return reply.code(issue.statusCode).send({ apiVersion: CONNECTOR_API_VERSION, error: issue.code, message: issue.message });
}

async function* asServerSentEvents(events: AsyncIterable<ConnectorExecutionEvent>) {
  for await (const event of events) yield `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function authorized(request: FastifyRequest, token: string) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7)), expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
