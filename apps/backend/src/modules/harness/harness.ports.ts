export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny' | 'approved' | 'denied';

export type StartRunInput = {
  executionId: string;
  harnessInstanceId: string;
  modelId: string;
  modeId: string | null;
  workspace: { roomId: string; relativePath: string; absolutePath?: string };
  input: string;
  sessionId: string;
  instructions: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
};

export type RunCheckpoint = { executionId: string; connectorEpoch: string; cursor: number };
export type RunHandle = { id: string; checkpoint?: RunCheckpoint };
export type ReattachRunInput={checkpoint:RunCheckpoint;pendingRequests:Array<{id:string;kind:'approval'|'clarification';prompt:string;choices?:string[]}>};

export type MappedRunEvent = {
  type: 'run.status' | 'run.upstream_status' | 'run.delta' | 'run.reasoning.delta' | 'run.usage' | 'tool.updated' | 'request.created' | 'request.resolved';
  payload: Record<string, unknown>;
};

export type RunEventMapping = {
  events: MappedRunEvent[];
  terminal?: { status: 'completed' | 'failed' | 'cancelled'; error?: string };
  status?: 'streaming' | 'waiting_approval'|'waiting_clarification';
  checkpoint?: RunCheckpoint;
};

export interface RunGateway {
  createRun(input: StartRunInput): Promise<RunHandle>;
  stop(runId: string): Promise<RunCheckpoint | undefined>;
  approve(runId: string, choice: ApprovalChoice): Promise<RunCheckpoint | undefined>;
  clarify?(runId: string, resolution: string): Promise<RunCheckpoint | undefined>;
}

export interface RunEventStream {
  stream(upstreamRunId: string, localRunId: string, signal: AbortSignal): AsyncIterable<RunEventMapping>;
}

export interface RunRecovery {
  reattach(input:ReattachRunInput):void;
}

export interface DependencyHealth {
  capabilities(): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;
}
