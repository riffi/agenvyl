import type { ConnectorRunState, Message, Room, Run, ToolActivity,WorkspaceAttachment,RunArtifact,RunEmbed } from '@agenvyl/contracts';
import type { Persona, PersonaGroup, PersonaVersion, RoomEvent, RunStatus } from '../../types.js';

export type DatabaseRow = Record<string, unknown>;

export function toPersona(row: DatabaseRow): Persona {
  return {
    id: text(row.id), handle: text(row.handle), name: text(row.name), role: text(row.role), color: text(row.color),
    requested_model: nullableText(row.requested_model), effective_model: nullableText(row.effective_model),
    harness_instance_id:text(row.harness_instance_id),harness_type:text(row.harness_type),model_id:text(row.model_id),permission_profile_id:nullableText(row.permission_profile_id),agent_variant_id:nullableText(row.agent_variant_id),default_reasoning_effort:nullableText(row.default_reasoning_effort),
    current_version_id: text(row.current_version_id), group_id: nullableText(row.group_id),
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), archived_at: nullableTimestamp(row.archived_at),
  };
}

export function toPersonaVersion(row: DatabaseRow): PersonaVersion {
  return { id:text(row.id),persona_id:text(row.persona_id),version:number(row.version),requested_model:nullableText(row.requested_model),harness_instance_id:text(row.harness_instance_id),harness_type:text(row.harness_type),model_id:text(row.model_id),permission_profile_id:nullableText(row.permission_profile_id),agent_variant_id:nullableText(row.agent_variant_id),default_reasoning_effort:nullableText(row.default_reasoning_effort),system_prompt:text(row.system_prompt),created_at:timestamp(row.created_at) };
}

export function toPersonaGroup(row: DatabaseRow): PersonaGroup {
  return { id:text(row.id),name:text(row.name),position:number(row.position),created_at:timestamp(row.created_at),updated_at:timestamp(row.updated_at) };
}

export function toRoom(row: DatabaseRow): Room {
  return { id:text(row.id),title:text(row.title),created_at:timestamp(row.created_at),participant_count:number(row.participant_count),last_message_at:nullableTimestamp(row.last_message_at),last_message_text:nullableText(row.last_message_text),deleted_at:nullableTimestamp(row.deleted_at) };
}

export function toMessage(row: DatabaseRow,attachments:WorkspaceAttachment[]=[]): Message {
  return { id:text(row.id),text:text(row.text),createdAt:timestamp(row.created_at),targets:stringArray(row.targets),runIds:stringArray(row.run_ids),attachments,author:{profileId:text(row.author_profile_id),displayName:text(row.author_display_name),handle:text(row.author_handle)},addressedToAll:Boolean(row.addressed_to_all) };
}

export function toRoomEvent(row: DatabaseRow): RoomEvent {
  return { id:text(row.id),event_id:text(row.event_id),sequence:number(row.sequence),type:text(row.type),payload:row.payload };
}

export function toTimelineRun(row: DatabaseRow, tools: ToolActivity[], request?: Run['request'],artifacts:RunArtifact[]=[],embeds:RunEmbed[]=[]): Run {
  const connector=connectorRunState(row);
  return {
    id:text(row.id),messageId:text(row.message_id),agent:text(row.persona_handle),requestedModel:text(row.requested_model),harnessInstanceId:text(row.harness_instance_id),harnessType:text(row.harness_type),modelId:text(row.model_id),executionProfile:runExecutionProfile(row.execution_profile),status:runStatus(row.status),text:text(row.text),reasoning:text(row.reasoning),tools,
    ...(row.upstream_status && typeof row.upstream_status === 'object' ? { upstreamStatus: row.upstream_status as Run['upstreamStatus'] } : {}),
    ...(row.usage&&typeof row.usage==='object'?{usage:row.usage as Run['usage']}:{}),
    ...(connector ? { connector } : {}),
    ...(row.retry_of_run_id == null ? {} : { retryOfRunId:text(row.retry_of_run_id) }),
    ...(row.response_slot_id == null ? {} : { responseSlotId:text(row.response_slot_id) }),
    ...(row.attempt_number == null ? {} : { attemptNumber:number(row.attempt_number) }),
    ...(request ? { request } : {}), ...(row.error == null ? {} : { error:text(row.error) }),...(row.error_code == null ? {} : { errorCode:text(row.error_code) }),artifacts,embeds,
    ...(row.base_snapshot_id?{workspaceResult:{base_snapshot_id:text(row.base_snapshot_id),...(row.result_snapshot_id?{result_snapshot_id:text(row.result_snapshot_id)}:{}),...(row.published_snapshot_id?{published_snapshot_id:text(row.published_snapshot_id)}:{}),capture_status:text(row.workspace_capture_status) as NonNullable<Run['workspaceResult']>['capture_status'],publish_status:text(row.workspace_publish_status) as NonNullable<Run['workspaceResult']>['publish_status'],conflict_count:number(row.workspace_conflict_count),errors:Array.isArray(row.workspace_errors)?row.workspace_errors as NonNullable<Run['workspaceResult']>['errors']:[]}}:{}),
  };
}

function runExecutionProfile(value:unknown):Run['executionProfile']{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Expected run execution profile');return value as Run['executionProfile'];}

function connectorRunState(row:DatabaseRow):ConnectorRunState|undefined{
  const checkpointed=row.connector_execution_id!=null&&row.connector_epoch!=null&&row.connector_cursor!=null;
  const errorCode=nullableText(row.error_code);
  if(!checkpointed&&!errorCode?.startsWith('connector_'))return undefined;
  if(errorCode==='connector_unavailable')return{state:'unavailable',checkpointed};
  if(errorCode?.startsWith('connector_'))return{state:'lost',checkpointed};
  const status=runStatus(row.status);
  if(['completed','failed','cancelled'].includes(status))return{state:'terminal',checkpointed};
  if(row.upstream_status&&typeof row.upstream_status==='object')return{state:'degraded',checkpointed};
  return{state:'active',checkpointed};
}

export function text(value: unknown): string { if (typeof value !== 'string') throw new TypeError('Expected database text'); return value; }
export function nullableText(value: unknown): string|null { return value == null ? null : text(value); }
export function number(value: unknown): number { const result=Number(value);if(!Number.isFinite(result))throw new TypeError('Expected database number');return result; }
export function timestamp(value: unknown): string { if(value instanceof Date)return value.toISOString();return new Date(text(value)).toISOString(); }
export function nullableTimestamp(value: unknown): string|null { return value == null ? null : timestamp(value); }
export function stringArray(value: unknown): string[] { if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw new TypeError('Expected database string array');return value; }
export function runStatus(value: unknown): RunStatus { const status=text(value);if(!['queued','streaming','finalizing','stopping','waiting_approval','waiting_clarification','completed','failed','cancelled'].includes(status))throw new TypeError(`Unknown run status: ${status}`);return status as RunStatus; }
