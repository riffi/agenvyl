import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  CONNECTOR_API_VERSION,
  isCreateExecutionInterventionRequest,
  isResolveConnectorRequest,
  isConfigureConnectorInstancesRequest,
  isTestConnectorInstanceRequest,
  isStartExecutionRequest,
  type ConnectorExecutionEvent,
  type ConnectorHealth,
  type ConnectorInstanceList,
  type ConnectorCatalog,
  type ConnectorDiscovery,
  type TestConnectorInstanceResult,
  type CreateExecutionInterventionRequest,
} from '@agenvyl/connector-contract';
import type { ConnectorAdapter } from './adapter.js';
import { AdapterGenerationManager, type PreparedAdapterRuntime } from './adapter-generations.js';
import { normalizeConnectorInstances, type ConnectorConfig } from './config.js';
import { ExecutionRegistry, RegistryError } from './execution-registry.js';
import { WorkspacePolicy, WorkspacePolicyError } from './workspace-policy.js';
import {pickLocalDirectory,validateLocalDirectory} from './directory-access.js';
import {ManagedServerError} from './managed-servers.js';

export function buildConnectorApp(config: ConnectorConfig, options: {
  connectorEpoch?: string;
  startedAt?: string;
  logger?: boolean;
  adapters?: ReadonlyMap<string, ConnectorAdapter>;
  releaseInitialRuntime?:()=>Promise<void>|void;
  initialRuntimeErrors?:ReadonlyMap<string,{code:string;message:string}>;
  replayLimit?: number;
  now?: () => string;
  discover?:()=>Promise<ConnectorDiscovery>;
  configureInstances?:(instances:ConnectorConfig['instances'])=>Promise<ReadonlyMap<string,ConnectorAdapter>|PreparedAdapterRuntime>;
  restartInstance?:(instance:ConnectorConfig['instances'][number])=>Promise<PreparedAdapterRuntime>;
  persistInstances?:(instances:ConnectorConfig['instances'])=>Promise<void>;
  persistWorkspaces?:(roots:string[])=>Promise<void>;
  sseHeartbeatMs?:number;
} = {}) {
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.x-api-key'] } : false });
  const connectorEpoch = options.connectorEpoch ?? randomUUID(), startedAt = options.startedAt ?? new Date().toISOString();
  const sseHeartbeatMs=Number.isSafeInteger(options.sseHeartbeatMs)&&Number(options.sseHeartbeatMs)>0?Number(options.sseHeartbeatMs):15_000;
  config.instances = normalizeConnectorInstances(config.instances);
  let enabledInstances = config.instances.filter(instance => instance.enabled);
  const generations = new AdapterGenerationManager(config.instances, {
    adapters: options.adapters ?? new Map<string, ConnectorAdapter>(),
    release: options.releaseInitialRuntime,
  }, app.log);
  let configurationQueue = Promise.resolve();
  const runtimeErrors=new Map(options.initialRuntimeErrors);
  const restartingInstances=new Set<string>();
  const hasAdapter = (instance: ConnectorConfig['instances'][number]) => generations.current.adapters.get(instance.id)?.type === instance.type;
  const workspacePolicy = new WorkspacePolicy(config.workspaces.roots);
  const isReady = (instance: ConnectorConfig['instances'][number]) => !runtimeErrors.has(instance.id)&&hasAdapter(instance) && workspacePolicy.configured;
  const registry = new ExecutionRegistry(
    connectorEpoch,
    instanceId => generations.acquire(instanceId),
    workspacePolicy,
    options.replayLimit,
    options.now,
    app.log,
  );
  const instanceSnapshot=(instance:ConnectorConfig['instances'][number])=>{
    const adapter=generations.current.adapters.get(instance.id),ownership=instance.type==='opencode'&&instance.managed!==undefined?{managed:instance.managed}:{},intervention=adapter?.interventionMode?{interventionMode:adapter.interventionMode}:{},activeExecutions=registry.activeCount(instance.id),runtimeError=runtimeErrors.get(instance.id);
    if(runtimeError)return{id:instance.id,type:instance.type,status:'unavailable' as const,capabilities:[],...ownership,activeExecutions,error:runtimeError};
    if(adapter?.type!==instance.type)return{id:instance.id,type:instance.type,status:'unavailable' as const,capabilities:[],...ownership,activeExecutions,error:{code:'adapter_not_loaded',message:'Adapter module is not loaded in this Connector build'}};
    return workspacePolicy.configured
      ?{id:instance.id,type:instance.type,status:'healthy' as const,capabilities:adapter.capabilities,...intervention,...ownership,activeExecutions}
      :{id:instance.id,type:instance.type,status:'degraded' as const,capabilities:adapter.capabilities,...intervention,...ownership,activeExecutions,error:{code:'workspace_not_configured',message:'Connector workspace roots are not configured'}};
  };

  app.addHook('onClose',async()=>{await configurationQueue;await generations.close();});

  app.addHook('onRequest', async (request, reply) => {
    if (authorized(request, config.token)) return;
    return reply.code(401).header('www-authenticate', 'Bearer').send({ apiVersion: CONNECTOR_API_VERSION, error: 'unauthorized', message: 'Valid Connector Bearer token required' });
  });

  app.get('/v2/health', async (): Promise<ConnectorHealth> => ({
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

  app.get('/v2/instances', async (): Promise<ConnectorInstanceList> => ({
    apiVersion: CONNECTOR_API_VERSION,
    connectorEpoch,
    instances: enabledInstances.map(instanceSnapshot),
  }));

  app.get('/v2/configuration',async()=>({apiVersion:CONNECTOR_API_VERSION,instances:structuredClone(config.instances)}));

  app.put('/v2/workspaces',async(request,reply)=>{
    const roots=isWorkspaceRoots(request.body)?request.body.roots:undefined;
    if(!roots)return reply.code(400).send({apiVersion:CONNECTOR_API_VERSION,error:'invalid_request',message:'Workspace roots must contain one absolute directory'});
    if(!options.persistWorkspaces)return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'configuration_unavailable',message:'Workspace configuration is unavailable'});
    try{
      new WorkspacePolicy(roots);
      await options.persistWorkspaces(roots);
      workspacePolicy.configure(roots);
      config.workspaces.roots=[...roots];
      return{apiVersion:CONNECTOR_API_VERSION,roots:[...roots]};
    }catch(error){
      app.log.warn({err:error},'Workspace configuration failed');
      return reply.code(400).send({apiVersion:CONNECTOR_API_VERSION,error:'invalid_workspace_root',message:'Workspace root must be an existing absolute directory'});
    }
  });

  app.get('/v2/discovery',async(_request,reply)=>options.discover?options.discover():reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'discovery_unavailable',message:'Harness discovery is unavailable'}));

  app.post('/v2/directories/validate',async(request,reply)=>{
    const path=isRecord(request.body)&&typeof request.body.path==='string'?request.body.path:'';
    const result=await validateLocalDirectory(path);
    return reply.send({apiVersion:CONNECTOR_API_VERSION,...result});
  });

  app.post('/v2/directories/pick',async()=>({apiVersion:CONNECTOR_API_VERSION,...await pickLocalDirectory()}));

  app.put('/v2/instances',async(request,reply)=>{
    if(!isConfigureConnectorInstancesRequest(request.body))return reply.code(400).send({apiVersion:CONNECTOR_API_VERSION,error:'invalid_request',message:'Connector instances do not match the v2 contract'});
    if(!options.configureInstances||!options.persistInstances)return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'configuration_unavailable',message:'Connector configuration is unavailable'});
    const instances=normalizeConnectorInstances(request.body.instances);
    const operation=configurationQueue.then(async()=>{
      if(generations.matchesCurrent(instances))return{ok:true as const};
      let candidate:ReturnType<typeof generations.candidate>|undefined;
      try{
        const configured=await options.configureInstances!(instances);
        const runtime=isPreparedRuntime(configured)?configured:{adapters:configured};
        candidate=generations.candidate(instances,runtime);
        await options.persistInstances!(instances);
        generations.activate(candidate);
        runtimeErrors.clear();
        config.instances=structuredClone(instances);
        enabledInstances=instances.filter(instance=>instance.enabled);
        return{ok:true as const};
      }catch(error){
        if(candidate)await generations.discard(candidate);
        app.log.error({err:error},'Connector configuration failed');
        return{ok:false as const,error};
      }
    });
    configurationQueue=operation.then(()=>undefined,()=>undefined);
    const result=await operation;
    if(!result.ok){const issue=configurationIssue(result.error);return reply.code(issue.statusCode).send({apiVersion:CONNECTOR_API_VERSION,error:issue.code,message:issue.message});}
    return{apiVersion:CONNECTOR_API_VERSION,instances};
  });

  app.post('/v2/instances/test',async(request,reply)=>{
    if(!isTestConnectorInstanceRequest(request.body))return reply.code(400).send({apiVersion:CONNECTOR_API_VERSION,error:'invalid_request',message:'Connector instance does not match the v2 contract'});
    if(!options.configureInstances)return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'configuration_unavailable',message:'Connector connection testing is unavailable'});
    const instance=normalizeConnectorInstances([{...request.body.instance,enabled:true}])[0]!;
    let runtime:PreparedAdapterRuntime|undefined;
    try{
      const configured=await options.configureInstances([instance]);
      runtime=isPreparedRuntime(configured)?configured:{adapters:configured};
      const adapter=runtime.adapters.get(instance.id);
      if(adapter?.type!==instance.type||!adapter.catalog)throw new Error('Adapter catalog is unavailable');
      await adapter.catalog();
      return{apiVersion:CONNECTOR_API_VERSION,instanceId:instance.id,status:'healthy',capabilities:[...adapter.capabilities]} satisfies TestConnectorInstanceResult;
    }catch{
      app.log.warn({instanceId:instance.id,harnessType:instance.type},'Harness connection test failed');
      return{apiVersion:CONNECTOR_API_VERSION,instanceId:instance.id,status:'unavailable',capabilities:[],error:{code:'connection_test_failed',message:'Harness connection test failed'}} satisfies TestConnectorInstanceResult;
    }finally{
      if(runtime)await closePreparedRuntime(runtime,app.log);
    }
  });

  app.get<{ Params: { id: string } }>('/v2/instances/:id/catalog', async (request, reply) => {
    const instance=enabledInstances.find(candidate=>candidate.id===request.params.id);
    if (!instance) return reply.code(404).send({ apiVersion: CONNECTOR_API_VERSION, error: 'instance_not_found', message: 'Connector instance not found' });
    if(runtimeErrors.has(instance.id))return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'catalog_unavailable',message:'Connector instance is unavailable'});
    const adapter=generations.current.adapters.get(instance.id);
    if(adapter?.type!==instance.type||!adapter.catalog)return reply.code(503).send({ apiVersion: CONNECTOR_API_VERSION, error: 'catalog_unavailable', message: 'Connector instance does not provide catalog discovery' });
    try{const catalog=await adapter.catalog();return{apiVersion:CONNECTOR_API_VERSION,connectorEpoch,instanceId:instance.id,...catalog} satisfies ConnectorCatalog;}
    catch{return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'catalog_unavailable',message:'Connector instance catalog is unavailable'});}
  });

  app.post('/v2/executions', async (request, reply) => {
    if (!isStartExecutionRequest(request.body)) return error(reply, new RegistryError('invalid_request', 'Execution request does not match Connector v2 contract', 400));
    if(restartingInstances.has(request.body.harnessInstanceId)||runtimeErrors.has(request.body.harnessInstanceId))return error(reply,new RegistryError('instance_unavailable','Connector instance is restarting or unavailable',503));
    try {
      const result = registry.start(request.body);
      return reply.code(result.created ? 201 : 200).send({ execution: result.execution });
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.get<{ Params: { id: string } }>('/v2/executions/:id', async (request, reply) => {
    try {
      return { execution: registry.inspect(request.params.id) };
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/v2/executions/:id/events', async (request, reply) => {
    const after = request.query.after === undefined ? 0 : Number(request.query.after);
    const controller = new AbortController();
    reply.raw.once('close', () => controller.abort());
    try {
      const events = registry.subscribe(request.params.id, after, controller.signal);
      return reply
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('connection', 'keep-alive')
        .send(Readable.from(asServerSentEvents(events,sseHeartbeatMs)));
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.post<{ Params: { id: string } }>('/v2/executions/:id/stop', async (request, reply) => {
    try {
      return { execution: await registry.stop(request.params.id) };
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.post<{ Params: { id: string; requestId: string } }>('/v2/executions/:id/requests/:requestId/resolve', async (request, reply) => {
    if (!isResolveConnectorRequest(request.body)) return error(reply, new RegistryError('invalid_request', 'Request resolution does not match Connector v2 contract', 400));
    try {
      return await registry.resolveRequest(request.params.id, request.params.requestId, request.body);
    } catch (caught) {
      return error(reply, caught);
    }
  });

  app.post<{Params:{id:string};Body:CreateExecutionInterventionRequest}>('/v2/executions/:id/interventions',{
    schema:{body:{type:'object',additionalProperties:false,required:['interventionId','text'],properties:{interventionId:{type:'string',format:'uuid'},text:{type:'string',minLength:1,maxLength:2_000,pattern:'\\S'}}}},
  },async(request,reply)=>{
    if(!isCreateExecutionInterventionRequest(request.body))return error(reply,new RegistryError('invalid_request','Intervention does not match Connector v2 contract',400));
    try{return reply.code(202).send(registry.intervene(request.params.id,request.body));}
    catch(caught){return error(reply,caught);}
  });

  app.post<{Params:{id:string}}>('/v2/instances/:id/restart',async(request,reply)=>{
    const instance=enabledInstances.find(candidate=>candidate.id===request.params.id);
    if(!instance)return reply.code(404).send({apiVersion:CONNECTOR_API_VERSION,error:'instance_not_found',message:'Connector instance not found'});
    if(instance.type!=='opencode'||!instance.managed)return reply.code(409).send({apiVersion:CONNECTOR_API_VERSION,error:'instance_not_managed',message:'Only managed OpenCode instances can be restarted by Agenvyl'});
    if(registry.activeCount(instance.id)>0)return reply.code(409).send({apiVersion:CONNECTOR_API_VERSION,error:'instance_busy',message:'Wait for active executions to finish before restarting OpenCode'});
    if(restartingInstances.has(instance.id))return reply.code(409).send({apiVersion:CONNECTOR_API_VERSION,error:'instance_busy',message:'Managed OpenCode restart is already in progress'});
    if(!options.restartInstance)return reply.code(503).send({apiVersion:CONNECTOR_API_VERSION,error:'restart_unavailable',message:'Managed OpenCode restart is unavailable'});
    restartingInstances.add(instance.id);
    const operation=configurationQueue.then(async()=>{
      let candidate:ReturnType<typeof generations.candidate>|undefined;
      try{
        if(registry.activeCount(instance.id)>0)throw new RegistryError('instance_busy','Wait for active executions to finish before restarting OpenCode',409);
        const runtime=await options.restartInstance!(instance);
        candidate=generations.candidate(config.instances,runtime);
        const adapter=candidate.adapters.get(instance.id);
        if(adapter?.type!=='opencode'||!adapter.catalog)throw new ManagedServerError('managed_server_unavailable','Restarted OpenCode catalog is unavailable');
        const catalog=await adapter.catalog();
        generations.activate(candidate);
        runtimeErrors.delete(instance.id);
        return{ok:true as const,catalog};
      }catch(error){
        if(candidate)await generations.discard(candidate);
        const issue=error instanceof RegistryError?error:restartIssue(error);
        if(!(issue instanceof RegistryError&&issue.code==='instance_busy'))runtimeErrors.set(instance.id,{code:issue.code,message:issue.message});
        app.log.error({err:error,instanceId:instance.id},'Managed OpenCode restart failed');
        return{ok:false as const,issue};
      }
    });
    configurationQueue=operation.then(()=>undefined,()=>undefined);
    const result=await operation.finally(()=>restartingInstances.delete(instance.id));
    if(!result.ok)return reply.code(result.issue.statusCode).send({apiVersion:CONNECTOR_API_VERSION,error:result.issue.code,message:result.issue.message});
    return{apiVersion:CONNECTOR_API_VERSION,connectorEpoch,instance:instanceSnapshot(instance),catalog:result.catalog};
  });

  return app;
}

function error(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, caught: unknown) {
  const issue = caught instanceof RegistryError || caught instanceof WorkspacePolicyError
    ? caught
    : new RegistryError('internal_error', 'Connector execution registry failed', 500);
  return reply.code(issue.statusCode).send({ apiVersion: CONNECTOR_API_VERSION, error: issue.code, message: issue.message });
}

async function* asServerSentEvents(events:AsyncIterable<ConnectorExecutionEvent>,heartbeatMs:number){
  const iterator=events[Symbol.asyncIterator]();
  let pending=iterator.next();
  try{
    while(true){
      const result=await nextBeforeHeartbeat(pending,heartbeatMs);
      if(!result){yield`: heartbeat\n\n`;continue;}
      if(result.done)return;
      pending=iterator.next();
      const event=result.value;
      yield`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    }
  }finally{await iterator.return?.();}
}

function nextBeforeHeartbeat<T>(pending:Promise<IteratorResult<T>>,heartbeatMs:number):Promise<IteratorResult<T>|undefined>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(undefined),heartbeatMs);
    pending.then(result=>{clearTimeout(timer);resolve(result);},error=>{clearTimeout(timer);reject(error);});
  });

}

const configurationIssue=(error:unknown)=>error instanceof ManagedServerError?error:{code:'configuration_failed',message:'Connector configuration could not be applied',statusCode:409};
const restartIssue=(error:unknown)=>error instanceof ManagedServerError?error:new ManagedServerError('managed_server_unavailable','Managed OpenCode restart failed');

function isPreparedRuntime(value:ReadonlyMap<string,ConnectorAdapter>|PreparedAdapterRuntime):value is PreparedAdapterRuntime{
  return typeof value==='object'&&value!==null&&'adapters' in value;
}

async function closePreparedRuntime(runtime:PreparedAdapterRuntime,logger:{warn(data:Record<string,unknown>,message:string):void}){
  const adapters=[...new Set(runtime.adapters.values())];
  const operations=[...adapters.filter(adapter=>adapter.close).map(adapter=>()=>adapter.close!()),...(runtime.release?[()=>runtime.release!()]:[])];
  const results=await Promise.allSettled(operations.map(operation=>Promise.resolve().then(operation)));
  const failures=results.filter(result=>result.status==='rejected');
  if(failures.length)logger.warn({failures:failures.length},'Temporary harness test runtime cleanup failed');
}

function authorized(request: FastifyRequest, token: string) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7)), expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isWorkspaceRoots(value:unknown):value is{roots:string[]}{
  return Boolean(value&&typeof value==='object'&&Array.isArray((value as {roots?:unknown}).roots)&&(value as {roots:unknown[]}).roots.length===1&&typeof (value as {roots:string[]}).roots[0]==='string');
}

function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==='object'&&!Array.isArray(value));}
