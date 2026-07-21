import { isConnectorCatalog, isConnectorCommandResult, isConnectorDiscovery, isConnectorExecutionEvent, isConnectorHealth, isConnectorInstanceList, isConnectorRequestCommandResult, isExecutionSnapshot, type ConfigureConnectorInstancesRequest, type ConnectorCatalog, type ConnectorConfigurationResult, type ConnectorDiscovery, type ConnectorExecutionEvent, type ConnectorHealth, type ConnectorInstanceList, type ConnectorRequestCommandResult, type ExecutionSnapshot, type StartExecutionRequest } from '@agenvyl/connector-contract';
import type { ConnectorExecutionClient, ConnectorLifecycleErrorCode } from '../../modules/connector/connector.ports.js';
import {parseSse} from '../../infrastructure/http/parseSse.js';

export class ConnectorClientError extends Error {
  constructor(readonly code: ConnectorLifecycleErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'ConnectorClientError';
  }
}

export class HttpConnectorClient implements ConnectorExecutionClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly token: string, private readonly request: typeof fetch = fetch) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Connector URL must be an HTTP(S) origin without credentials, query, or fragment');
    }
    if (token.length < 32) throw new Error('Connector token must contain at least 32 characters');
    this.baseUrl = parsed.toString().replace(/\/$/, '');
  }

  async health(): Promise<ConnectorHealth> {
    const value = await this.get('/v1/health', 'health');
    if (!isConnectorHealth(value)) throw new ConnectorClientError('connector_invalid_response', 'Connector returned an invalid health response');
    return value;
  }

  async inspect(executionId: string): Promise<ExecutionSnapshot> {
    const value = await this.get(`/v1/executions/${encodeURIComponent(executionId)}`, 'execution');
    const execution = isRecord(value) ? value.execution : undefined;
    if (!isExecutionSnapshot(execution)||execution.executionId!==executionId) throw new ConnectorClientError('connector_invalid_response', 'Connector returned an invalid execution response');
    return execution;
  }

  async instances():Promise<ConnectorInstanceList>{
    const value=await this.get('/v1/instances','discovery');
    if(!isConnectorInstanceList(value))throw new ConnectorClientError('connector_invalid_response','Connector returned an invalid instance list');
    return value;
  }

  async catalog(instanceId:string):Promise<ConnectorCatalog>{
    const value=await this.get(`/v1/instances/${encodeURIComponent(instanceId)}/catalog`,'discovery');
    if(!isConnectorCatalog(value))throw new ConnectorClientError('connector_invalid_response','Connector returned an invalid catalog response');
    return value;
  }

  async discover():Promise<ConnectorDiscovery>{const value=await this.get('/v1/discovery','discovery');if(!isConnectorDiscovery(value))throw invalidResponse('Connector returned invalid discovery');return value;}
  async configureInstances(input:ConfigureConnectorInstancesRequest):Promise<ConnectorConfigurationResult>{const value=await this.json('/v1/instances','PUT',input,'discovery',15_000);if(!isRecord(value)||value.apiVersion!=='v1'||!Array.isArray(value.instances))throw invalidResponse('Connector returned invalid configuration');return value as ConnectorConfigurationResult;}

  async start(request:StartExecutionRequest):Promise<ExecutionSnapshot>{
    const value=await this.json('/v1/executions','POST',request,'execution');
    if(!isConnectorCommandResult(value)||value.execution.executionId!==request.executionId)throw invalidResponse('Connector returned an invalid start response');
    return value.execution;
  }

  async stop(executionId:string):Promise<ExecutionSnapshot>{
    const value=await this.json(`/v1/executions/${encodeURIComponent(executionId)}/stop`,'POST',undefined,'execution');
    if(!isConnectorCommandResult(value)||value.execution.executionId!==executionId)throw invalidResponse('Connector returned an invalid stop response');
    return value.execution;
  }

  async resolve(executionId:string,requestId:string,resolution:string):Promise<ConnectorRequestCommandResult>{
    const value=await this.json(`/v1/executions/${encodeURIComponent(executionId)}/requests/${encodeURIComponent(requestId)}/resolve`,'POST',{resolution},'execution');
    if(!isConnectorRequestCommandResult(value)||value.execution.executionId!==executionId||value.request.id!==requestId)throw invalidResponse('Connector returned an invalid request resolution response');
    return value;
  }

  async *events(executionId:string,options:{after:number;connectorEpoch:string;signal:AbortSignal}):AsyncIterable<ConnectorExecutionEvent>{
    if(!Number.isSafeInteger(options.after)||options.after<0)throw new ConnectorClientError('connector_invalid_response','Connector event cursor must be a non-negative safe integer');
    let response:Response;
    try{response=await this.request(`${this.baseUrl}/v1/executions/${encodeURIComponent(executionId)}/events?after=${options.after}`,{headers:this.headers(),signal:options.signal});}
    catch(error){if(options.signal.aborted)throw error;throw new ConnectorClientError('connector_unavailable','Connector is unavailable');}
    if(!response.ok){throw await this.failure(response,'execution');}
    if(!response.body||!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))throw invalidResponse('Connector returned an invalid event stream');
    let cursor=options.after;
    try{
      for await(const item of parseSse(response.body)){
        let value:unknown;try{value=JSON.parse(item.data) as unknown;}catch{throw invalidResponse('Connector returned an invalid event payload');}
        if(!isConnectorExecutionEvent(value)||value.executionId!==executionId||value.connectorEpoch!==options.connectorEpoch||item.id!==String(value.cursor)||item.event!==value.type||value.cursor!==cursor+1)throw invalidResponse('Connector event stream violated cursor, epoch, or identity invariants');
        cursor=value.cursor;yield value;
      }
    }catch(error){if(options.signal.aborted)throw error;if(error instanceof ConnectorClientError)throw error;throw new ConnectorClientError('connector_unavailable','Connector event stream failed');}
  }

  private async get(path: string, resource: 'health' | 'execution'|'discovery') {
    return this.json(path,'GET',undefined,resource);
  }

  private async json(path:string,method:'GET'|'POST'|'PUT',body:unknown,resource:'health'|'execution'|'discovery',timeoutMs=3_000){
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}${path}`, {
        method,headers:this.headers(body!==undefined),...(body===undefined?{}:{body:JSON.stringify(body)}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ConnectorClientError('connector_unavailable', 'Connector is unavailable');
    }
    if (!response.ok) throw await this.failure(response,resource);
    try {
      return await response.json() as unknown;
    } catch {
      throw new ConnectorClientError('connector_invalid_response', 'Connector returned invalid JSON');
    }
  }

  private headers(json=false){return{authorization:`Bearer ${this.token}`,accept:'application/json',...(json?{'content-type':'application/json'}:{})};}
  private async failure(response:Response,resource:'health'|'execution'|'discovery'){
    const body=await safeJson(response),serverCode=isRecord(body)&&typeof body.error==='string'?body.error:undefined;
    if(resource==='execution'&&response.status===404&&serverCode==='execution_not_found')return new ConnectorClientError('connector_execution_lost','Connector execution is no longer available',404);
    if(response.status===409&&serverCode==='replay_unavailable')return new ConnectorClientError('connector_replay_unavailable','Connector events are no longer replayable',409);
    if(response.status===400||response.status===404||response.status===409)return new ConnectorClientError('connector_command_rejected','Connector command was rejected',response.status);
    return new ConnectorClientError('connector_unavailable','Connector request failed',response.status);
  }
}

function invalidResponse(message:string){return new ConnectorClientError('connector_invalid_response',message);}
async function safeJson(response:Response){try{return await response.json() as unknown;}catch{return undefined;}}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
