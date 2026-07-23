export type AgentHandle = string;

export type WorkflowMode = 'plan' | 'work';
export type PlanEnforcement = 'native' | 'instruction_only';
export type RuntimeFeatures = { plan_mode: boolean };
export type RoomExecutionProfile = { reasoning_effort: string | null };
export type PlanVersionRef = { entry_id: string; version_id: string };
export type RoomPlanState = { path: 'plan.md'; current: PlanVersionRef | null; approved: PlanVersionRef | null };
export type RoomExecutionState = { profile: RoomExecutionProfile; plan: RoomPlanState };
export type ExecutionIntent = { kind: 'plan' } | { kind: 'implement'; approved_plan_version_id: string };
export type RunExecutionProfileSnapshot = {
  workflowMode: WorkflowMode;
  requestedReasoningEffort: string | null;
  reasoningEffort: string | null;
  reasoningEffortFallback: boolean;
  planEnforcement: PlanEnforcement | null;
  permissionProfileId: string | null;
  agentVariantId: string | null;
  implementationPlanVersionId: string | null;
};

export type RunStatus =
  | 'queued'
  | 'streaming'
  | 'stopping'
  | 'waiting_approval'
  | 'waiting_clarification'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type UpstreamStatusState = 'waiting_upstream' | 'retrying';
export type UpstreamStatusReason = 'awaiting_response' | 'provider_unavailable' | 'rate_limited' | 'provider_timeout' | 'model_unavailable' | 'authentication_failed' | 'harness_unavailable' | 'connector_unreachable';
export type UpstreamStatus = { state: UpstreamStatusState; reason: UpstreamStatusReason; retryable: boolean; attempt?: number; retryAt?: string; message?: string };
export type UpstreamStatusEvent = Omit<UpstreamStatus, 'state'> & { state: UpstreamStatusState | 'recovered' };
export type ConnectorRunState = {
  state: 'active' | 'degraded' | 'terminal' | 'unavailable' | 'lost';
  checkpointed: boolean;
};
export type TokenUsage={inputTokens:number;outputTokens:number;totalTokens?:number;reasoningTokens?:number;cacheReadTokens?:number;cacheWriteTokens?:number};

export type ToolActivity = {
  id: string;
  name: string;
  detail: string;
  input?: string;
  status: 'started' | 'progress' | 'completed';
};

export type Message = {
  id: string;
  text: string;
  createdAt: string;
  targets: AgentHandle[];
  runIds: string[];
  attachments?: WorkspaceAttachment[];
  author: HumanAuthorSnapshot;
  addressedToAll: boolean;
};

export type HumanAuthorSnapshot = { profileId: string; displayName: string; handle: string };
export type LocalUserProfile = { id: string; displayName: string; handle: string; createdAt: string; updatedAt: string };
export type UpdateLocalUserProfileRequest = { display_name: string; handle: string };
export type HarnessType='hermes'|'opencode'|'antigravity'|'codex'|'claude';
export type HarnessAuthentication={authenticated:boolean;kind:'api'|'cloud'|'subscription_oauth'|'none'|'unknown'};
export type SetupHarnessCandidate={type:HarnessType;label:string;cli:{found:boolean;command:string;version?:string;compatible?:boolean};endpoint?:{url:string;reachable:boolean};safeToSelect:boolean;supportsManagedServer:boolean;auth?:HarnessAuthentication;requiresConfirmation?:'claude_oauth';warning?:string};
export type SetupState={completed:boolean;locale:'en'|'ru';workspaceRoot:string;firstRoomId?:string;instances:Array<{id:string;type:string;status:string;managed?:boolean;allowDangerFullAccess?:boolean;allowSubscriptionOAuth?:boolean}>;candidates:SetupHarnessCandidate[]};
export type SetupHarnessInstance={id:string;type:HarnessType;enabled:boolean;endpoint?:string;managed?:boolean;permissionMode?:'plan'|'accept-edits';allowDangerFullAccess?:boolean;allowSubscriptionOAuth?:boolean};
export type ConfigureSetupHarnessesRequest={instances:SetupHarnessInstance[]};
export type HarnessSettingsPersona={id:string;name:string;handle:string;archived:boolean};
export type HarnessSettingsInstance=SetupHarnessInstance&{status:'healthy'|'degraded'|'unavailable'|'disabled';capabilities:string[];error?:{code:string;message:string};personas:HarnessSettingsPersona[]};
export type HarnessSettingsState={connectorEpoch:string;instances:HarnessSettingsInstance[];candidates:SetupHarnessCandidate[]};
export type CompleteSetupRequest={locale:'en'|'ru';workspace_root:string;profile:{display_name:string;handle:string};room_title:string;route:{harness_instance_id:string;harness_type:string;model_id:string;permission_profile_id:string|null;agent_variant_id:string|null}|null};
export type CompleteSetupResult={roomId:string};

export type Run = {
  id: string;
  messageId: string;
  agent: AgentHandle;
  requestedModel?: string;
  harnessInstanceId: string;
  harnessType: string;
  modelId: string;
  executionProfile: RunExecutionProfileSnapshot;
  status: RunStatus;
  upstreamStatus?: UpstreamStatus;
  connector?: ConnectorRunState;
  text: string;
  reasoning?: string;
  usage?:TokenUsage;
  tools: ToolActivity[];
  retryOfRunId?: string;
  responseSlotId?: string;
  attemptNumber?: number;
  request?: { kind: 'approval' | 'clarification'; prompt: string; choices?: string[]; questions?: StructuredQuestion[]; autoResolutionMs?:number; resolved?: string };
  error?: string;
  errorCode?: string;
  artifacts?: RunArtifact[];
  embeds?: RunEmbed[];
};

export type Room = {
  id: string;
  title: string;
  created_at: string;
  participant_count: number;
  last_message_at: string | null;
  last_message_text: string | null;
  deleted_at?: string | null;
};

export type WorkspaceSource='user'|'agent'|'external';
export type WorkspaceEntry={
  id:string;path:string;name:string;kind:'file'|'directory';size:number;mime_type:string;
  updated_at:string;current_version_id?:string;deleted_at?:string|null;status?:'tracked'|'oversize';
};
export type WorkspaceVersion={
  id:string;entry_id:string;path:string;size:number;mime_type:string;sha256:string;created_at:string;
  source:WorkspaceSource;run_ids:string[];url:string;preview_url:string;
};
export type WorkspaceAttachment={
  version_id:string;entry_id:string;name:string;path:string;size:number;mime_type:string;url:string;preview_url:string;
};
export type RunArtifact=WorkspaceAttachment&{change:'created'|'updated'|'deleted';attribution:'exact'|'shared'|'external'};
export type RunEmbedError='invalid_path'|'not_found'|'unsupported_type'|'invalid_content'|'limit_exceeded';
export type RunEmbed={kind:'image';path:string;status:'resolved'|'error';attachment?:WorkspaceAttachment;error?:RunEmbedError};
export type RoomWorkspace={path:string;entries:WorkspaceEntry[]};

export type Persona = {
  id: string;
  handle: string;
  name: string;
  role: string;
  color: string;
  requested_model: string | null;
  effective_model?: string | null;
  harness_instance_id: string;
  harness_type: string;
  model_id: string;
  permission_profile_id: string | null;
  agent_variant_id: string | null;
  current_version_id?: string;
  system_prompt?: string;
  group_id: string | null;
  created_at?: string;
  updated_at?: string;
  archived_at: string | null;
};

export type PersonaGroup = {
  id: string;
  name: string;
  position: number;
  created_at?: string;
  updated_at?: string;
};

export type TimelinePage = {
  messages: Message[];
  runs: Run[];
  selectedRuns: Record<string, string>;
  executionState: RoomExecutionState;
  lastSequence: number;
  hasMore: boolean;
  nextCursor?: string;
};

export type UpdateRoomExecutionProfileRequest = Partial<RoomExecutionProfile>;
export type ApprovePlanRequest = { version_id: string };
export type UpdatePlanRequest = { content: string; expected_version_id: string };
export type UpdatePlanResponse = { entry: WorkspaceEntry; version: WorkspaceVersion };

export type ErrorEnvelope = {
  error: string;
  message: string;
  details?: unknown;
};

export type CreateRoomRequest = { title?: string; persona_ids?: string[] };
export type RenameRoomRequest = { title?: string };
export type CreateMessageRequest = { text?: string; targets?: AgentHandle[]; message_id?: string; attachment_version_ids?:string[]; execution_intent?:ExecutionIntent };
export type StructuredQuestion={id:string;header:string;question:string;options?:Array<{label:string;description?:string}>;isOther:boolean;isSecret:boolean;multiSelect?:boolean};
export type RunRequestResolution={resolution:string}|{answers:Record<string,string[]>};
export type ResolveRunRequest = RunRequestResolution;
export type ApprovalRequest = ResolveRunRequest;
export type PersonaInput = Pick<Persona, 'handle' | 'name' | 'role' | 'color' | 'group_id'> & {
  requested_model?: string | null;
  harness_instance_id?: string;
  model_id?: string;
  permission_profile_id?: string | null;
  agent_variant_id?: string | null;
  system_prompt: string;
  room_id?: string;
};
export type UpdatePersonaRequest = Partial<PersonaInput>;

type Envelope<T extends string, P> = {
  id: string;
  event_id?: string;
  sequence: number;
  type: T;
  payload: P;
};

export type ServerRoomEvent =
  | Envelope<'message.created', Message>
  | Envelope<'run.created', Run>
  | Envelope<'run.delta', { runId: string; text: string }>
  | Envelope<'run.reasoning.delta', { runId: string; text: string }>
  | Envelope<'run.status', { runId: string; status: RunStatus; error?: string; errorCode?: string }>
  | Envelope<'run.upstream_status', { runId: string } & UpstreamStatusEvent>
  | Envelope<'run.usage', {runId:string;usage:TokenUsage}>
  | Envelope<'tool.updated', { runId: string; tool: ToolActivity }>
  | Envelope<'request.created', { runId: string; kind: 'approval' | 'clarification'; prompt: string; choices?: string[];questions?:StructuredQuestion[];autoResolutionMs?:number }>
  | Envelope<'request.resolved', { runId: string; resolution: string }>
  | Envelope<'run.selected', { responseSlotId: string; runId: string }>
  | Envelope<'room.execution_profile.updated', RoomExecutionProfile>
  | Envelope<'room.plan.approval.updated', { approved: PlanVersionRef | null }>
  | Envelope<'workspace.changed', { entry:WorkspaceEntry;change:'created'|'updated'|'deleted'|'restored'|'moved' }>
  | Envelope<'artifact.created', { runId:string;artifact:RunArtifact }>
  | Envelope<'run.embeds', { runId:string;embeds:RunEmbed[] }>;

const eventTypes = new Set<ServerRoomEvent['type']>([
  'message.created',
  'run.created',
  'run.delta',
  'run.reasoning.delta',
  'run.status',
  'run.upstream_status',
  'run.usage',
  'tool.updated',
  'request.created',
  'request.resolved',
  'run.selected',
  'room.execution_profile.updated',
  'room.plan.approval.updated',
  'workspace.changed',
  'artifact.created',
  'run.embeds',
]);
const runStatuses = new Set<RunStatus>(['queued', 'streaming', 'stopping', 'waiting_approval', 'waiting_clarification', 'completed', 'failed', 'cancelled']);
const toolStatuses = new Set<ToolActivity['status']>(['started', 'progress', 'completed']);

export function isServerRoomEvent(value: unknown): value is ServerRoomEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || !Number.isSafeInteger(value.sequence)) return false;
  if (typeof value.type !== 'string' || !eventTypes.has(value.type as ServerRoomEvent['type']) || !isRecord(value.payload)) return false;
  const payload = value.payload;
  switch (value.type) {
    case 'message.created': return typeof payload.id === 'string' && typeof payload.text === 'string' && Array.isArray(payload.targets) && Array.isArray(payload.runIds) && (payload.attachments===undefined||Array.isArray(payload.attachments)) && isRecord(payload.author) && strings(payload.author,'profileId','displayName','handle') && typeof payload.addressedToAll==='boolean';
    case 'run.created': return typeof payload.id === 'string' && typeof payload.messageId === 'string' && typeof payload.agent === 'string' && (payload.requestedModel === undefined || typeof payload.requestedModel === 'string') && strings(payload,'harnessInstanceId','harnessType','modelId') && isRunExecutionProfile(payload.executionProfile) && typeof payload.status === 'string' && runStatuses.has(payload.status as RunStatus) && (payload.upstreamStatus===undefined||(isRecord(payload.upstreamStatus)&&payload.upstreamStatus.state!=='recovered'&&isUpstreamStatusEvent(payload.upstreamStatus))) && (payload.usage===undefined||isTokenUsage(payload.usage)) && typeof payload.text === 'string' && (payload.reasoning===undefined||typeof payload.reasoning==='string') && Array.isArray(payload.tools) && (payload.artifacts===undefined||Array.isArray(payload.artifacts)) && (payload.embeds===undefined||Array.isArray(payload.embeds));
    case 'run.delta': case 'run.reasoning.delta': return strings(payload, 'runId', 'text');
    case 'run.status': return strings(payload, 'runId', 'status') && runStatuses.has(payload.status as RunStatus) && (payload.error===undefined||typeof payload.error==='string') && (payload.errorCode===undefined||typeof payload.errorCode==='string');
    case 'run.upstream_status': return typeof payload.runId === 'string' && isUpstreamStatusEvent(payload);
    case 'run.usage': return typeof payload.runId==='string'&&isTokenUsage(payload.usage);
    case 'tool.updated': return typeof payload.runId === 'string' && isRecord(payload.tool) && strings(payload.tool, 'id', 'name', 'detail', 'status') && (payload.tool.input === undefined || typeof payload.tool.input === 'string') && toolStatuses.has(payload.tool.status as ToolActivity['status']);
    case 'request.created': return strings(payload, 'runId', 'kind', 'prompt') && (payload.kind === 'approval' || payload.kind === 'clarification') && (payload.choices===undefined||(Array.isArray(payload.choices)&&payload.choices.every(choice=>typeof choice==='string'))) && (payload.questions===undefined||isStructuredQuestions(payload.questions)) && (payload.autoResolutionMs===undefined||Number.isSafeInteger(payload.autoResolutionMs));
    case 'request.resolved': return strings(payload, 'runId', 'resolution');
    case 'run.selected': return strings(payload, 'responseSlotId', 'runId');
    case 'room.execution_profile.updated': return payload.reasoning_effort===null||typeof payload.reasoning_effort==='string';
    case 'room.plan.approval.updated': return payload.approved===null||isPlanVersionRef(payload.approved);
    case 'workspace.changed': return isRecord(payload.entry) && typeof payload.entry.id==='string' && typeof payload.change==='string';
    case 'artifact.created': return typeof payload.runId==='string' && isRecord(payload.artifact) && typeof payload.artifact.version_id==='string';
    case 'run.embeds': return typeof payload.runId==='string'&&Array.isArray(payload.embeds);
    default: return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isTokenUsage(value:unknown):value is TokenUsage{if(!isRecord(value)||!tokenCount(value.inputTokens)||!tokenCount(value.outputTokens))return false;return['totalTokens','reasoningTokens','cacheReadTokens','cacheWriteTokens'].every(key=>value[key]===undefined||tokenCount(value[key]));}
function isPlanVersionRef(value:unknown):value is PlanVersionRef{return isRecord(value)&&strings(value,'entry_id','version_id');}
function isRunExecutionProfile(value:unknown):value is RunExecutionProfileSnapshot{return isRecord(value)&&(value.workflowMode==='plan'||value.workflowMode==='work')&&(value.requestedReasoningEffort===null||typeof value.requestedReasoningEffort==='string')&&(value.reasoningEffort===null||typeof value.reasoningEffort==='string')&&typeof value.reasoningEffortFallback==='boolean'&&(value.planEnforcement===null||value.planEnforcement==='native'||value.planEnforcement==='instruction_only')&&(value.permissionProfileId===null||typeof value.permissionProfileId==='string')&&(value.agentVariantId===null||typeof value.agentVariantId==='string')&&(value.implementationPlanVersionId===null||typeof value.implementationPlanVersionId==='string');}
function tokenCount(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=0;}
function isStructuredQuestions(value:unknown):value is StructuredQuestion[]{return Array.isArray(value)&&value.length>0&&value.length<=4&&value.every(question=>isRecord(question)&&strings(question,'id','header','question')&&typeof question.isOther==='boolean'&&typeof question.isSecret==='boolean'&&(question.multiSelect===undefined||typeof question.multiSelect==='boolean')&&(question.options===undefined||(Array.isArray(question.options)&&question.options.every(option=>isRecord(option)&&typeof option.label==='string'&&(option.description===undefined||typeof option.description==='string')))));}

function strings(value: Record<string, unknown>, ...keys: string[]) {
  return keys.every(key => typeof value[key] === 'string');
}

const upstreamStates = new Set(['waiting_upstream', 'retrying', 'recovered']);
const upstreamReasons = new Set(['awaiting_response', 'provider_unavailable', 'rate_limited', 'provider_timeout', 'model_unavailable', 'authentication_failed', 'harness_unavailable', 'connector_unreachable']);
function isUpstreamStatusEvent(value: Record<string, unknown>) {
  return typeof value.state === 'string' && upstreamStates.has(value.state) && typeof value.reason === 'string' && upstreamReasons.has(value.reason)
    && typeof value.retryable === 'boolean' && (value.attempt === undefined || (Number.isSafeInteger(value.attempt) && Number(value.attempt) >= 0))
    && (value.retryAt === undefined || (typeof value.retryAt === 'string' && Number.isFinite(Date.parse(value.retryAt))))
    && (value.message === undefined || typeof value.message === 'string');
}
