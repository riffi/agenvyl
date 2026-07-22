export const CONNECTOR_API_VERSION = 'v1' as const;

export type ConnectorApiVersion = typeof CONNECTOR_API_VERSION;
export type ConnectorStatus = 'ready' | 'degraded';
export type ConnectorInstanceStatus = 'healthy' | 'degraded' | 'unavailable';
export type ConnectorCapability =
  | 'model_catalog'
  | 'mode_catalog'
  | 'text_streaming'
  | 'reasoning'
  | 'tools'
  | 'approvals'
  | 'clarifications'
  | 'usage';

export type ConnectorError = { code: string; message: string };
export type ConnectorErrorEnvelope = { apiVersion: ConnectorApiVersion; error: string; message: string };
export type UpstreamStatusState = 'waiting_upstream' | 'retrying' | 'recovered';
export type UpstreamStatusReason =
  | 'awaiting_response'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'provider_timeout'
  | 'model_unavailable'
  | 'authentication_failed'
  | 'harness_unavailable'
  | 'connector_unreachable';
export type UpstreamStatus = {
  state: UpstreamStatusState;
  reason: UpstreamStatusReason;
  retryable: boolean;
  attempt?: number;
  retryAt?: string;
  message?: string;
};

export type ConnectorHealth = {
  apiVersion: ConnectorApiVersion;
  connectorEpoch: string;
  status: ConnectorStatus;
  startedAt: string;
  instances: { total: number; healthy: number; degraded: number };
};

export type ConnectorInstance = {
  id: string;
  type: string;
  status: ConnectorInstanceStatus;
  capabilities: ConnectorCapability[];
  managed?: boolean;
  error?: ConnectorError;
};

export type ConnectorInstanceList = {
  apiVersion: ConnectorApiVersion;
  connectorEpoch: string;
  instances: ConnectorInstance[];
};

export type ConnectorCatalog = {
  apiVersion: ConnectorApiVersion;
  connectorEpoch: string;
  instanceId: string;
  models: ConnectorCatalogItem[];
  modes: ConnectorCatalogItem[];
};

export type ConnectorCatalogItem = { id: string; label?: string; supportedModeIds?: string[] };
export type HarnessType = 'hermes' | 'opencode' | 'antigravity' | 'codex';
export type ConnectorInstanceConfiguration = {
  id: string;
  type: HarnessType;
  enabled: boolean;
  endpoint?: string;
  managed?: boolean;
  permissionMode?: 'plan' | 'accept-edits';
  allowDangerFullAccess?: boolean;
};
export type HarnessDiscoveryCandidate = {
  type: HarnessType;
  label: string;
  cli: { found: boolean; command: string; version?: string; compatible?: boolean };
  endpoint?: { url: string; reachable: boolean };
  safeToSelect: boolean;
  supportsManagedServer: boolean;
  warning?: string;
};
export type ConnectorDiscovery = {
  apiVersion: ConnectorApiVersion;
  candidates: HarnessDiscoveryCandidate[];
};
export type ConfigureConnectorInstancesRequest = { instances: ConnectorInstanceConfiguration[] };
export type ConnectorConfigurationResult = {
  apiVersion: ConnectorApiVersion;
  instances: ConnectorInstanceConfiguration[];
};

export type CanonicalConversationItem = { role: 'user' | 'assistant'; content: string };
export type StartExecutionRequest = {
  executionId: string;
  harnessInstanceId: string;
  modelId: string;
  modeId: string | null;
  workspace: { roomId: string; relativePath: string };
  input: { systemPrompt: string; history: CanonicalConversationItem[]; message: string };
};

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ConnectorRequestKind = 'approval' | 'clarification';
export type ConnectorRequestResolution = 'answered' | 'declined' | 'cancelled' | 'expired' | 'superseded';
export type ConnectorQuestion = {
  id: string;
  header: string;
  question: string;
  options?: Array<{ label: string; description?: string }>;
  isOther: boolean;
  isSecret: boolean;
};
export type ConnectorRequestSnapshot = {
  id: string;
  kind: ConnectorRequestKind;
  prompt: string;
  choices?: string[];
  questions?: ConnectorQuestion[];
  autoResolutionMs?: number;
  resolution?: { outcome: ConnectorRequestResolution; value?: string };
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type ExecutionSnapshot = {
  apiVersion: ConnectorApiVersion;
  executionId: string;
  connectorEpoch: string;
  harnessInstanceId: string;
  harnessType: string;
  modelId: string;
  modeId: string | null;
  status: ExecutionStatus;
  cursor: number;
  earliestReplayableCursor: number;
  pendingRequests: ConnectorRequestSnapshot[];
  usage?: TokenUsage;
  upstreamStatus?: UpstreamStatus;
  error?: ConnectorError;
};

type EventEnvelope<T extends string, P> = {
  apiVersion: ConnectorApiVersion;
  connectorEpoch: string;
  executionId: string;
  cursor: number;
  occurredAt: string;
  type: T;
  payload: P;
};

export type ConnectorExecutionEvent =
  | EventEnvelope<'execution.accepted', Record<string, never>>
  | EventEnvelope<'execution.started', Record<string, never>>
  | EventEnvelope<'execution.status', { status: ExecutionStatus }>
  | EventEnvelope<'execution.upstream_status', UpstreamStatus>
  | EventEnvelope<'output.text.delta', { text: string }>
  | EventEnvelope<'output.reasoning.delta', { text: string }>
  | EventEnvelope<'usage.updated', { usage: TokenUsage }>
  | EventEnvelope<'tool.started' | 'tool.updated' | 'tool.completed', { toolId: string; name: string; safeSummary: string; safeInput?: string }>
  | EventEnvelope<'request.opened', { request: ConnectorRequestSnapshot }>
  | EventEnvelope<'request.resolved', { requestId: string; outcome: ConnectorRequestResolution }>
  | EventEnvelope<'execution.completed' | 'execution.cancelled', Record<string, never>>
  | EventEnvelope<'execution.failed', { error: ConnectorError }>;

export type ConnectorRequestAnswer = { resolution: string } | { answers: Record<string, string[]> };
export type ResolveConnectorRequest = ConnectorRequestAnswer;
export type ConnectorCommandResult = { execution: ExecutionSnapshot };
export type ConnectorRequestCommandResult = ConnectorCommandResult & { request: ConnectorRequestSnapshot };

export const connectorContractFixtures = {
  health: {
    apiVersion: 'v1', connectorEpoch: 'epoch-1', status: 'ready', startedAt: '2026-07-17T00:00:00.000Z',
    instances: { total: 1, healthy: 1, degraded: 0 },
  },
  instances: {
    apiVersion: 'v1', connectorEpoch: 'epoch-1',
    instances: [{ id: 'local-hermes', type: 'hermes', status: 'healthy', capabilities: ['model_catalog', 'text_streaming', 'tools', 'approvals'] }],
  },
  catalog: {
    apiVersion: 'v1', connectorEpoch: 'epoch-1', instanceId: 'local-hermes',
    models: [{ id: 'sol', label: 'Sonnet' }], modes: [],
  },
  startExecution: {
    executionId: 'run-1', harnessInstanceId: 'local-hermes', modelId: 'sol', modeId: null,
    workspace: { roomId: 'room-1', relativePath: '.' },
    input: { systemPrompt: 'Be useful.', history: [{ role: 'user', content: 'Earlier' }], message: 'Continue' },
  },
  execution: {
    apiVersion: 'v1', executionId: 'run-1', connectorEpoch: 'epoch-1', harnessInstanceId: 'local-hermes', harnessType: 'hermes',
    modelId: 'sol', modeId: null, status: 'running', cursor: 3, earliestReplayableCursor: 1, pendingRequests: [],
  },
  textEvent: {
    apiVersion: 'v1', connectorEpoch: 'epoch-1', executionId: 'run-1', cursor: 3, occurredAt: '2026-07-17T00:00:01.000Z',
    type: 'output.text.delta', payload: { text: 'Hello' },
  },
} as const satisfies {
  health: ConnectorHealth;
  instances: ConnectorInstanceList;
  catalog: ConnectorCatalog;
  startExecution: StartExecutionRequest;
  execution: ExecutionSnapshot;
  textEvent: ConnectorExecutionEvent;
};

export function isConnectorHealth(value: unknown): value is ConnectorHealth {
  if (!isRecord(value) || value.apiVersion !== CONNECTOR_API_VERSION || typeof value.connectorEpoch !== 'string' || !isIsoDate(value.startedAt)) return false;
  if (value.status !== 'ready' && value.status !== 'degraded') return false;
  return isRecord(value.instances) && integers(value.instances, 'total', 'healthy', 'degraded');
}

export function isConnectorInstanceList(value: unknown): value is ConnectorInstanceList {
  return isRecord(value) && value.apiVersion === CONNECTOR_API_VERSION && typeof value.connectorEpoch === 'string' && Array.isArray(value.instances)
    && value.instances.every(instance => isRecord(instance) && strings(instance, 'id', 'type', 'status') && ['healthy', 'degraded', 'unavailable'].includes(String(instance.status))
      && Array.isArray(instance.capabilities) && instance.capabilities.every(capability => typeof capability === 'string' && capabilities.has(capability))
      && (instance.managed === undefined || typeof instance.managed === 'boolean')
      && (instance.type === 'opencode' || instance.managed === undefined)
      && (instance.error === undefined || isError(instance.error)));
}

export function isConnectorCatalog(value: unknown): value is ConnectorCatalog {
  return isRecord(value) && value.apiVersion === CONNECTOR_API_VERSION && strings(value, 'connectorEpoch', 'instanceId')
    && Array.isArray(value.models) && value.models.every(isCatalogItem)
    && Array.isArray(value.modes) && value.modes.every(isCatalogItem);
}

export function isConnectorDiscovery(value: unknown): value is ConnectorDiscovery {
  return isRecord(value) && value.apiVersion === CONNECTOR_API_VERSION && Array.isArray(value.candidates)
    && value.candidates.every(candidate => isRecord(candidate) && harnessTypes.has(String(candidate.type)) && strings(candidate, 'label')
      && isRecord(candidate.cli) && typeof candidate.cli.found === 'boolean' && typeof candidate.cli.command === 'string'
      && (candidate.cli.version === undefined || typeof candidate.cli.version === 'string')
      && (candidate.cli.compatible === undefined || typeof candidate.cli.compatible === 'boolean')
      && (candidate.endpoint === undefined || (isRecord(candidate.endpoint) && typeof candidate.endpoint.url === 'string' && typeof candidate.endpoint.reachable === 'boolean'))
      && typeof candidate.safeToSelect === 'boolean' && typeof candidate.supportsManagedServer === 'boolean'
      && (candidate.warning === undefined || typeof candidate.warning === 'string'));
}

export function isConfigureConnectorInstancesRequest(value: unknown): value is ConfigureConnectorInstancesRequest {
  if (!isRecord(value) || !Array.isArray(value.instances)) return false;
  const ids = new Set<string>();
  return value.instances.every(instance => {
    if (!isRecord(instance) || typeof instance.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(instance.id) || ids.has(instance.id)) return false;
    ids.add(instance.id);
    return harnessTypes.has(String(instance.type)) && typeof instance.enabled === 'boolean'
      && (instance.endpoint === undefined || safeEndpoint(instance.endpoint))
      && (instance.managed === undefined || typeof instance.managed === 'boolean')
      && (instance.permissionMode === undefined || instance.permissionMode === 'plan' || instance.permissionMode === 'accept-edits')
      && (instance.allowDangerFullAccess === undefined || typeof instance.allowDangerFullAccess === 'boolean')
      && (instance.type === 'antigravity' || instance.permissionMode === undefined)
      && (instance.type === 'opencode' || instance.managed === undefined)
      && (instance.type !== 'codex' || instance.endpoint === undefined)
      && (instance.type === 'codex' || instance.allowDangerFullAccess === undefined);
  });
}

export function isConnectorConfigurationResult(value:unknown):value is ConnectorConfigurationResult {
  return isRecord(value)&&value.apiVersion===CONNECTOR_API_VERSION&&isConfigureConnectorInstancesRequest({instances:value.instances});
}

export function isConnectorCommandResult(value:unknown):value is ConnectorCommandResult {
  return isRecord(value)&&isExecutionSnapshot(value.execution);
}

export function isConnectorRequestCommandResult(value:unknown):value is ConnectorRequestCommandResult {
  if(!isRecord(value)||!isRequest(value.request))return false;
  return isConnectorCommandResult(value);
}

export function isExecutionSnapshot(value: unknown): value is ExecutionSnapshot {
  if (!isRecord(value) || value.apiVersion !== CONNECTOR_API_VERSION || !strings(value, 'executionId', 'connectorEpoch', 'harnessInstanceId', 'harnessType', 'modelId', 'status')) return false;
  return executionStatuses.has(String(value.status)) && (value.modeId === null || typeof value.modeId === 'string') && integers(value, 'cursor', 'earliestReplayableCursor')
    && Number(value.earliestReplayableCursor) <= Number(value.cursor) + 1 && Array.isArray(value.pendingRequests) && value.pendingRequests.every(isRequest)
    && (value.usage === undefined || isTokenUsage(value.usage))
    && (value.upstreamStatus === undefined || isUpstreamStatus(value.upstreamStatus))
    && (value.error === undefined || isError(value.error));
}

export function isStartExecutionRequest(value: unknown): value is StartExecutionRequest {
  if (!isRecord(value) || !strings(value, 'executionId', 'harnessInstanceId', 'modelId') || (value.modeId !== null && typeof value.modeId !== 'string')) return false;
  if (!isRecord(value.workspace) || !strings(value.workspace, 'roomId', 'relativePath')) return false;
  if (!isRecord(value.input) || !strings(value.input, 'systemPrompt', 'message') || !Array.isArray(value.input.history)) return false;
  return value.input.history.every(item => isRecord(item) && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string');
}

export function isResolveConnectorRequest(value: unknown): value is ResolveConnectorRequest {
  if (!isRecord(value)) return false;
  if (typeof value.resolution === 'string') return value.resolution.trim().length > 0 && value.resolution.length <= 2_000;
  if (!isRecord(value.answers)) return false;
  const entries=Object.entries(value.answers);
  return entries.length>0&&entries.length<=3&&entries.every(([id,answers])=>id.length>0&&id.length<=128&&Array.isArray(answers)&&answers.length>0&&answers.length<=10&&answers.every(answer=>typeof answer==='string'&&answer.trim().length>0&&answer.length<=2_000));
}

export function isConnectorExecutionEvent(value: unknown): value is ConnectorExecutionEvent {
  if (!isRecord(value) || value.apiVersion !== CONNECTOR_API_VERSION || !strings(value, 'connectorEpoch', 'executionId', 'occurredAt', 'type') || !Number.isSafeInteger(value.cursor) || Number(value.cursor) < 1 || !isRecord(value.payload)) return false;
  if (!isIsoDate(value.occurredAt)) return false;
  switch (value.type) {
    case 'execution.accepted': case 'execution.started': case 'execution.completed': case 'execution.cancelled': return Object.keys(value.payload).length === 0;
    case 'execution.status': return typeof value.payload.status === 'string' && executionStatuses.has(value.payload.status);
    case 'execution.upstream_status': return isUpstreamStatus(value.payload);
    case 'output.text.delta': case 'output.reasoning.delta': return typeof value.payload.text === 'string';
    case 'usage.updated': return isTokenUsage(value.payload.usage);
    case 'tool.started': case 'tool.updated': case 'tool.completed': return strings(value.payload, 'toolId', 'name', 'safeSummary')
      && (value.payload.safeInput === undefined || (typeof value.payload.safeInput === 'string' && value.payload.safeInput.length <= 8_000));
    case 'request.opened': return isRequest(value.payload.request);
    case 'request.resolved': return strings(value.payload, 'requestId', 'outcome') && requestResolutions.has(String(value.payload.outcome));
    case 'execution.failed': return isError(value.payload.error);
    default: return false;
  }
}

const capabilities = new Set<string>(['model_catalog', 'mode_catalog', 'text_streaming', 'reasoning', 'tools', 'approvals', 'clarifications', 'usage']);
const harnessTypes = new Set<string>(['hermes', 'opencode', 'antigravity', 'codex']);
const executionStatuses = new Set<string>(['queued', 'running', 'waiting_for_user', 'stopping', 'completed', 'failed', 'cancelled']);
const requestResolutions = new Set<string>(['answered', 'declined', 'cancelled', 'expired', 'superseded']);
const upstreamStatusStates = new Set<string>(['waiting_upstream', 'retrying', 'recovered']);
const upstreamStatusReasons = new Set<string>(['awaiting_response', 'provider_unavailable', 'rate_limited', 'provider_timeout', 'model_unavailable', 'authentication_failed', 'harness_unavailable', 'connector_unreachable']);
function isError(value: unknown): value is ConnectorError { return isRecord(value) && strings(value, 'code', 'message'); }
function isUpstreamStatus(value: unknown): value is UpstreamStatus {
  return isRecord(value) && typeof value.state === 'string' && upstreamStatusStates.has(value.state)
    && typeof value.reason === 'string' && upstreamStatusReasons.has(value.reason) && typeof value.retryable === 'boolean'
    && (value.attempt === undefined || (Number.isSafeInteger(value.attempt) && Number(value.attempt) >= 0))
    && (value.retryAt === undefined || isIsoDate(value.retryAt))
    && (value.message === undefined || typeof value.message === 'string');
}
function isCatalogItem(value:unknown){return isRecord(value)&&typeof value.id==='string'&&value.id.length>0&&(value.label===undefined||typeof value.label==='string')&&(value.supportedModeIds===undefined||(Array.isArray(value.supportedModeIds)&&value.supportedModeIds.every(id=>typeof id==='string'&&id.length>0)));}
function isTokenUsage(value:unknown):value is TokenUsage{
  if(!isRecord(value)||!nonNegativeInteger(value.inputTokens)||!nonNegativeInteger(value.outputTokens))return false;
  return ['totalTokens','reasoningTokens','cacheReadTokens','cacheWriteTokens'].every(key=>value[key]===undefined||nonNegativeInteger(value[key]));
}
function isRequest(value: unknown): value is ConnectorRequestSnapshot {
  if (!isRecord(value) || !strings(value, 'id', 'kind', 'prompt') || (value.kind !== 'approval' && value.kind !== 'clarification')) return false;
  if (value.choices !== undefined && (!Array.isArray(value.choices) || value.choices.some(choice => typeof choice !== 'string'))) return false;
  if(value.questions!==undefined&&(!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>3||!value.questions.every(isQuestion)))return false;
  if(value.autoResolutionMs!==undefined&&(!Number.isSafeInteger(value.autoResolutionMs)||Number(value.autoResolutionMs)<0))return false;
  return value.resolution === undefined || (isRecord(value.resolution) && typeof value.resolution.outcome === 'string' && requestResolutions.has(value.resolution.outcome) && (value.resolution.value === undefined || typeof value.resolution.value === 'string'));
}
function isQuestion(value:unknown){return isRecord(value)&&strings(value,'id','header','question')&&typeof value.isOther==='boolean'&&typeof value.isSecret==='boolean'&&(value.options===undefined||(Array.isArray(value.options)&&value.options.every(option=>isRecord(option)&&typeof option.label==='string'&&(option.description===undefined||typeof option.description==='string'))));}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function strings(value: Record<string, unknown>, ...keys: string[]) { return keys.every(key => typeof value[key] === 'string'); }
function integers(value: Record<string, unknown>, ...keys: string[]) { return keys.every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0); }
function nonNegativeInteger(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=0;}
function isIsoDate(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function safeEndpoint(value: unknown) { try { const url = new URL(String(value)); return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }
