import type {
  ConnectorCapability,
  ConnectorError,
  ConnectorRequestSnapshot,
  ConnectorRequestAnswer,
  ConnectorRequestResolution,
  ExecutionStatus,
  StartExecutionRequest,
  TokenUsage,
  UpstreamStatus,
} from '@agenvyl/connector-contract';

export type AdapterExecution = { upstreamId: string };
export type AdapterStartExecutionRequest = Omit<StartExecutionRequest, 'workspace'> & {
  workspace: StartExecutionRequest['workspace'] & { absolutePath: string };
};

export type AdapterExecutionEvent =
  | { type: 'execution.upstream_status'; payload: UpstreamStatus }
  | { type: 'output.text.delta'; payload: { text: string } }
  | { type: 'output.reasoning.delta'; payload: { text: string } }
  | { type: 'usage.updated'; payload: { usage: TokenUsage } }
  | { type: 'tool.started' | 'tool.updated' | 'tool.completed'; payload: { toolId: string; name: string; safeSummary: string } }
  | { type: 'request.opened'; payload: { request: ConnectorRequestSnapshot } }
  | { type: 'request.resolved'; payload: { requestId: string; outcome: 'answered' | 'declined' | 'cancelled' | 'expired' | 'superseded' } }
  | { type: 'execution.completed'; payload: Record<string, never> }
  | { type: 'execution.failed'; payload: { error: ConnectorError } }
  | { type: 'execution.cancelled'; payload: Record<string, never> };

export interface ConnectorAdapter {
  readonly type: string;
  readonly capabilities: ConnectorCapability[];
  catalog?():Promise<{models:Array<{id:string;label?:string;supportedModeIds?:string[]}>;modes:Array<{id:string;label?:string;supportedModeIds?:string[]}>}>;
  start(request: AdapterStartExecutionRequest): Promise<AdapterExecution>;
  inspect(execution: AdapterExecution): Promise<{ status: ExecutionStatus }>;
  events(execution: AdapterExecution): AsyncIterable<AdapterExecutionEvent>;
  resolveRequest?(execution: AdapterExecution, request: ConnectorRequestSnapshot, resolution: ConnectorRequestAnswer|string): Promise<{ outcome: ConnectorRequestResolution }>;
  stop(execution: AdapterExecution): Promise<void>;
  close?(): Promise<void>;
}
