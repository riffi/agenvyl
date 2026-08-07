import type { ConnectorCatalog, ConnectorExecutionEvent, ConnectorHealth, ConnectorInstanceList, ConnectorInterventionCommandResult, ConnectorRequestAnswer, ConnectorRequestCommandResult, CreateExecutionInterventionRequest, ExecutionSnapshot, StartExecutionRequest } from '@agenvyl/connector-contract';

export interface ConnectorLifecycle {
  health(): Promise<ConnectorHealth>;
  inspect(executionId: string): Promise<ExecutionSnapshot>;
}

export interface ConnectorDiscovery extends ConnectorLifecycle {
  instances():Promise<ConnectorInstanceList>;
  catalog(instanceId:string):Promise<ConnectorCatalog>;
}

export interface ConnectorExecutionClient extends ConnectorDiscovery {
  start(request:StartExecutionRequest):Promise<ExecutionSnapshot>;
  stop(executionId:string):Promise<ExecutionSnapshot>;
  resolve(executionId:string,requestId:string,answer:ConnectorRequestAnswer|string):Promise<ConnectorRequestCommandResult>;
  intervene(executionId:string,input:CreateExecutionInterventionRequest):Promise<ConnectorInterventionCommandResult>;
  events(executionId:string,options:{after:number;connectorEpoch:string;signal:AbortSignal}):AsyncIterable<ConnectorExecutionEvent>;
}

export type ConnectorLifecycleErrorCode = 'connector_unavailable' | 'connector_execution_lost' | 'connector_invalid_response'|'connector_replay_unavailable'|'connector_command_rejected';

export function connectorLifecycleErrorCode(error:unknown):ConnectorLifecycleErrorCode {
  if(error&&typeof error==='object'&&'code' in error&&['connector_unavailable','connector_execution_lost','connector_invalid_response','connector_replay_unavailable','connector_command_rejected'].includes(String(error.code)))return error.code as ConnectorLifecycleErrorCode;
  return 'connector_unavailable';
}
