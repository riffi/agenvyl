import type {
  ConnectorCapability,
  ConnectorError,
  ConnectorRequestSnapshot,
  ConnectorRequestAnswer,
  ConnectorRequestResolution,
  ExecutionStatus,
  InterventionMode,
  PostTurnContinuation,
  ContinuationReleaseOutcome,
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
  | { type: 'tool.started' | 'tool.updated' | 'tool.completed' | 'tool.failed' | 'tool.cancelled'; payload: { toolId: string; name: string; safeSummary: string; safeInput?: string } }
  | { type: 'request.opened'; payload: { request: ConnectorRequestSnapshot } }
  | { type: 'request.resolved'; payload: { requestId: string; outcome: 'answered' | 'declined' | 'cancelled' | 'expired' | 'superseded' } }
  | { type: 'execution.intervention.applied'; payload: { interventionId: string; text: string } }
  | { type: 'execution.intervention.failed'; payload: { interventionId: string; text: string; error: ConnectorError } }
  | { type: 'execution.completed'; payload: { continuation?: { handle: string } } }
  | { type: 'execution.failed'; payload: { error: ConnectorError } }
  | { type: 'execution.cancelled'; payload: Record<string, never> };

export interface ConnectorAdapter {
  readonly type: string;
  readonly capabilities: ConnectorCapability[];
  readonly interventionMode?: InterventionMode;
  readonly postTurnContinuation?: PostTurnContinuation;
  catalog?():Promise<import('@agenvyl/connector-contract').PickCatalog>;
  start(request: AdapterStartExecutionRequest): Promise<AdapterExecution>;
  startContinuation?(request:AdapterStartExecutionRequest,handle:string):Promise<AdapterExecution>;
  inspect(execution: AdapterExecution): Promise<{ status: ExecutionStatus }>;
  events(execution: AdapterExecution): AsyncIterable<AdapterExecutionEvent>;
  resolveRequest?(execution: AdapterExecution, request: ConnectorRequestSnapshot, resolution: ConnectorRequestAnswer|string): Promise<{ outcome: ConnectorRequestResolution }>;
  intervene?(execution: AdapterExecution, intervention: { interventionId:string;text:string }): Promise<void>;
  stop(execution: AdapterExecution): Promise<void>;
  releaseContinuation?(handle:string,scope:{instanceId:string}):Promise<ContinuationReleaseOutcome>;
  close?(): Promise<void>;
}

export class AdapterContinuationError extends Error{
  constructor(readonly code:'continuation_unavailable'|'continuation_incompatible',message:string){super(message);this.name='AdapterContinuationError';}
}
