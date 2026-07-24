import type {
  Database,
  QueryContext,
} from "../../infrastructure/database/Database.js";
import type { PersonaRepository } from "../personas/personas.repository.js";
import type { Room } from "../../types.js";
import type {
  PlanVersionRef,
  Persona,
  RoomExecutionState,
  RoomPersona,
  Run,
  StructuredQuestion,
  ToolActivity,
} from "@agenvyl/contracts";
import {
  number,
  text,
  toMessage,
  toPersona,
  toRoom,
  toTimelineRun,
} from "../../infrastructure/database/rowMappers.js";
import type { WorkspaceRepository } from "../workspace/workspace.repository.js";
import type { RoomEventRepository } from "../room-events/roomEvents.repository.js";

export class RoomRepository {
  constructor(
    private readonly database: Database,
    private readonly personas: PersonaRepository,
    private readonly workspace: WorkspaceRepository,
    private readonly events: RoomEventRepository,
  ) {}
  async exists(id: string) {
    return Boolean(
      (
        await this.database
          .sql`SELECT 1 FROM rooms WHERE id=${id} AND deleted_at IS NULL`
      )[0],
    );
  }
  async hasActivePlanRun(id: string) {
    return Boolean(
      (
        await this.database
          .sql`SELECT 1 FROM agent_runs WHERE room_id=${id} AND execution_profile->>'workflowMode'='plan' AND status=ANY(${["queued", "streaming", "finalizing", "stopping", "waiting_approval", "waiting_clarification"]}) LIMIT 1`
      )[0],
    );
  }
  async list(includeDeleted = false): Promise<Room[]> {
    const rows = includeDeleted
      ? await this.database
          .sql`SELECT r.id,r.title,r.created_at,r.deleted_at,COUNT(DISTINCT rp.persona_id)::int participant_count,(SELECT created_at FROM room_messages m WHERE m.room_id=r.id ORDER BY created_at DESC LIMIT 1) last_message_at,(SELECT text FROM room_messages m WHERE m.room_id=r.id ORDER BY created_at DESC LIMIT 1) last_message_text FROM rooms r LEFT JOIN room_participants rp ON rp.room_id=r.id GROUP BY r.id ORDER BY r.deleted_at NULLS FIRST,COALESCE((SELECT MAX(created_at) FROM room_messages m WHERE m.room_id=r.id),r.created_at) DESC`
      : await this.database
          .sql`SELECT r.id,r.title,r.created_at,r.deleted_at,COUNT(DISTINCT rp.persona_id)::int participant_count,(SELECT created_at FROM room_messages m WHERE m.room_id=r.id ORDER BY created_at DESC LIMIT 1) last_message_at,(SELECT text FROM room_messages m WHERE m.room_id=r.id ORDER BY created_at DESC LIMIT 1) last_message_text FROM rooms r LEFT JOIN room_participants rp ON rp.room_id=r.id WHERE r.deleted_at IS NULL GROUP BY r.id ORDER BY COALESCE((SELECT MAX(created_at) FROM room_messages m WHERE m.room_id=r.id),r.created_at) DESC`;
    return rows.map(toRoom);
  }
  async timeline(
    roomId: string,
    before: string | undefined,
    requestedLimit: number,
  ) {
    const limit = Math.max(1, Math.min(requestedLimit, 100));
    return this.database.sql.begin(
      "read only isolation level repeatable read",
      async (tx) => {
        const room = (
          await tx`SELECT event_sequence,approved_plan_version_id FROM rooms WHERE id=${roomId}`
        )[0];
        if (!room) return undefined;
        const cursor = before
          ? (
              await tx`SELECT created_at,id FROM room_messages WHERE room_id=${roomId} AND id=${before}`
            )[0]
          : undefined;
        if (before && !cursor) return undefined;
        const rows = cursor
          ? await tx`SELECT id,text,created_at,targets,run_ids,author_profile_id,author_display_name,author_handle,addressed_to_all FROM room_messages WHERE room_id=${roomId} AND (created_at,id)<(${cursor.created_at as Date},${cursor.id as string}) ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`
          : await tx`SELECT id,text,created_at,targets,run_ids,author_profile_id,author_display_name,author_handle,addressed_to_all FROM room_messages WHERE room_id=${roomId} ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`;
        const hasMore = rows.length > limit,
          messageRows = rows.slice(0, limit).reverse(),
          messageIds = messageRows.map((row) => text(row.id)),
          attachmentMap = await this.workspace.messageAttachments(
            messageIds,
            tx,
          ),
          messages = messageRows.map((row) =>
            toMessage(row, attachmentMap.get(text(row.id)) ?? []),
          );
        const runRows = messageIds.length
          ? await tx`SELECT r.id,r.message_id,r.persona_handle,r.requested_model,r.harness_instance_id,r.harness_type,r.model_id,r.execution_profile,r.status,r.upstream_status,r.usage,r.text,r.reasoning,r.error,r.error_code,r.retry_of_run_id,r.response_slot_id,r.connector_execution_id,r.connector_epoch,r.connector_cursor,(ROW_NUMBER() OVER(PARTITION BY r.response_slot_id ORDER BY r.created_at,r.id))::int attempt_number,r.created_at,w.base_snapshot_id,w.result_snapshot_id,w.published_snapshot_id,w.capture_status workspace_capture_status,w.publish_status workspace_publish_status,w.conflict_count workspace_conflict_count,w.errors workspace_errors FROM agent_runs r LEFT JOIN run_workspace_results w ON w.run_id=r.id WHERE r.message_id=ANY(${messageIds}) ORDER BY r.created_at,r.id`
          : [];
        const runIds = runRows.map((row) => text(row.id));
        const eventRows = runIds.length
          ? await tx`SELECT type,payload FROM room_events WHERE room_id=${roomId} AND sequence<=${Number(room.event_sequence)} AND type=ANY(${["tool.updated", "request.created", "request.resolved"]}) AND payload->>'runId'=ANY(${runIds}) ORDER BY sequence`
          : [];
        const extras = new Map<
          string,
          { tools: ToolActivity[]; request?: Run["request"] }
        >();
        for (const event of eventRows) {
          if (!event.payload || typeof event.payload !== "object") continue;
          const payload = event.payload as Record<string, unknown>,
            runId =
              typeof payload.runId === "string" ? payload.runId : undefined;
          if (!runId) continue;
          const extra = extras.get(runId) ?? { tools: [] },
            tool = payload.tool;
          if (event.type === "tool.updated" && isTool(tool)) {
            const prior = extra.tools.find((item) => item.id === tool.id),
              merged = {
                ...prior,
                ...tool,
                detail: tool.detail || prior?.detail || "",
                ...(tool.input
                  ? { input: tool.input }
                  : prior?.input
                    ? { input: prior.input }
                    : {}),
              };
            extra.tools = [
              ...extra.tools.filter((item) => item.id !== tool.id),
              merged,
            ];
          }
          if (
            event.type === "request.created" &&
            (payload.kind === "approval" || payload.kind === "clarification")
          ) {
            const choices = Array.isArray(payload.choices)
                ? payload.choices.filter(
                    (choice): choice is string => typeof choice === "string",
                  )
                : [],
              questions = Array.isArray(payload.questions)
                ? payload.questions.filter(isStructuredQuestion)
                : [],
              autoResolutionMs = Number.isSafeInteger(payload.autoResolutionMs)
                ? Number(payload.autoResolutionMs)
                : undefined;
            extra.request = {
              kind: payload.kind,
              prompt: typeof payload.prompt === "string" ? payload.prompt : "",
              ...(typeof payload.directory==="string"?{directory:payload.directory}:{}),
              ...(choices.length ? { choices } : {}),
              ...(questions.length ? { questions } : {}),
              ...(autoResolutionMs !== undefined ? { autoResolutionMs } : {}),
            };
          }
          if (
            event.type === "request.resolved" &&
            extra.request &&
            typeof payload.resolution === "string"
          )
            extra.request.resolved = payload.resolution;
          extras.set(runId, extra);
        }
        const selectedRows = messageIds.length
          ? await tx`SELECT id,selected_run_id FROM response_slots WHERE message_id=ANY(${messageIds}) AND selected_run_id IS NOT NULL`
          : [];
        const artifactMap = await this.workspace.artifacts(runIds, tx),
          embedMap = await this.workspace.runEmbeds(runIds, tx);
        const plan = await planState(
          tx,
          this.workspace,
          roomId,
          room.approved_plan_version_id,
        );
        return {
          messages,
          runs: runRows.map((row) => {
            const id = text(row.id),
              extra = extras.get(id);
            return toTimelineRun(
              row,
              extra?.tools ?? [],
              extra?.request,
              artifactMap.get(id) ?? [],
              embedMap.get(id) ?? [],
            );
          }),
          selectedRuns: Object.fromEntries(
            selectedRows.map((row) => [
              text(row.id),
              text(row.selected_run_id),
            ]),
          ),
          executionState: executionState(plan),
          lastSequence: number(room.event_sequence),
          hasMore,
          nextCursor: hasMore ? messages[0]?.id : undefined,
        };
      },
    );
  }
  async create(title: string, personaIds: string[]) {
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await this.database.transaction(async (tx) => {
      await tx`INSERT INTO rooms(id,title,created_at) VALUES(${id},${title},${now})`;
      for (const pid of new Set(personaIds)) {
        const p = await this.personas.find(pid, tx);
        if (!p || p.archived_at) throw new Error("persona_unavailable");
        await tx`INSERT INTO room_participants(room_id,persona_id) VALUES(${id},${pid})`;
      }
    });
    return (await this.list()).find((r) => r.id === id)!;
  }
  async rename(id: string, title: string) {
    const rows = await this.database
      .sql`UPDATE rooms SET title=${title} WHERE id=${id} RETURNING id`;
    return rows.length
      ? (await this.list()).find((r) => r.id === id)
      : undefined;
  }
  async delete(id: string) {
    return this.database.transaction(async (tx) => {
      if (
        !(
          await tx`SELECT 1 FROM rooms WHERE id=${id} AND deleted_at IS NULL FOR UPDATE`
        ).length
      )
        return "not_found" as const;
      if (
        (
          await tx`SELECT 1 FROM agent_runs WHERE room_id=${id} AND status=ANY(${["queued", "streaming", "finalizing", "stopping", "waiting_approval", "waiting_clarification"]}) LIMIT 1`
        ).length
      )
        return "busy" as const;
      await tx`UPDATE rooms SET deleted_at=now() WHERE id=${id}`;
      return "deleted" as const;
    });
  }
  async restore(id: string) {
    const row = (
      await this.database
        .sql`UPDATE rooms SET deleted_at=NULL WHERE id=${id} AND deleted_at IS NOT NULL RETURNING id`
    )[0];
    return Boolean(row);
  }
  async purge(id: string) {
    return this.database.transaction(async (tx) => {
      if (
        !(
          await tx`SELECT 1 FROM rooms WHERE id=${id} AND deleted_at IS NOT NULL FOR UPDATE`
        ).length
      )
        return "not_found" as const;
      await tx`UPDATE rooms SET approved_plan_version_id=NULL WHERE id=${id}`;
      await tx`DELETE FROM room_events WHERE room_id=${id}`;
      await tx`UPDATE response_slots SET selected_run_id=NULL WHERE message_id IN(SELECT id FROM room_messages WHERE room_id=${id})`;
      await tx`UPDATE agent_runs SET response_slot_id=NULL,implementation_plan_version_id=NULL WHERE room_id=${id}`;
      await tx`DELETE FROM agent_runs WHERE room_id=${id}`;
      await tx`DELETE FROM response_slots WHERE message_id IN(SELECT id FROM room_messages WHERE room_id=${id})`;
      await tx`DELETE FROM room_messages WHERE room_id=${id}`;
      await tx`DELETE FROM room_participants WHERE room_id=${id}`;
      await tx`UPDATE rooms SET current_workspace_snapshot_id=NULL WHERE id=${id}`;
      await tx`DELETE FROM workspace_snapshots WHERE room_id=${id}`;
      await tx`DELETE FROM rooms WHERE id=${id}`;
      return "purged" as const;
    });
  }
  async setParticipant(roomId: string, personaId: string, present: boolean) {
    if (!(await this.exists(roomId))) return "room_not_found" as const;
    const p = await this.personas.find(personaId);
    if (!p) return "persona_not_found" as const;
    if (p.archived_at) return "persona_archived" as const;
    if (present)
      await this.database
        .sql`INSERT INTO room_participants(room_id,persona_id) VALUES(${roomId},${personaId}) ON CONFLICT DO NOTHING`;
    else
      await this.database
        .sql`DELETE FROM room_participants WHERE room_id=${roomId} AND persona_id=${personaId}`;
    return "ok" as const;
  }
  async participants(roomId: string): Promise<RoomPersona[] | undefined> {
    if (!(await this.exists(roomId))) return undefined;
    const rows = await this.database
      .sql`SELECT p.*,rp.reasoning_effort_override FROM room_participants rp JOIN personas p ON p.id=rp.persona_id WHERE rp.room_id=${roomId} ORDER BY p.created_at`;
    return rows.map((row) => ({
      persona: toPersona(row),
      reasoning_effort_override:
        typeof row.reasoning_effort_override === "string"
          ? row.reasoning_effort_override
          : null,
    }));
  }
  async updateParticipantReasoning(
    roomId: string,
    personaId: string,
    reasoningEffortOverride: string | null,
    validatePersona?: (persona: Persona) => void,
  ) {
    return this.database.transaction(async (tx) => {
      if (
        !(
          await tx`SELECT id FROM rooms WHERE id=${roomId} AND deleted_at IS NULL FOR UPDATE`
        ).length
      )
        return { status: "room_not_found" as const };
      const personaRow = (
        await tx`SELECT * FROM personas WHERE id=${personaId} FOR UPDATE`
      )[0];
      if (!personaRow) return { status: "participant_not_found" as const };
      const persona = toPersona(personaRow);
      validatePersona?.(persona);
      const participantRow = (
        await tx`SELECT persona_id FROM room_participants WHERE room_id=${roomId} AND persona_id=${personaId} FOR UPDATE`
      )[0];
      if (!participantRow) return { status: "participant_not_found" as const };
      await tx`UPDATE room_participants SET reasoning_effort_override=${reasoningEffortOverride} WHERE room_id=${roomId} AND persona_id=${personaId}`;
      const participant: RoomPersona = {
        persona,
        reasoning_effort_override: reasoningEffortOverride,
      };
      const event = await this.events.appendInTransaction(
        tx,
        roomId,
        "room.participant.updated",
        participant,
        new Date().toISOString(),
      );
      return { status: "updated" as const, participant, event };
    });
  }
  async executionState(
    roomId: string,
  ): Promise<RoomExecutionState | undefined> {
    const row = (
      await this.database
        .sql`SELECT approved_plan_version_id FROM rooms WHERE id=${roomId} AND deleted_at IS NULL`
    )[0];
    if (!row) return undefined;
    return executionState(
      await planState(
        this.database.sql,
        this.workspace,
        roomId,
        row.approved_plan_version_id,
      ),
    );
  }
  async approvePlan(roomId: string, versionId: string) {
    return this.database.transaction(async (tx) => {
      if (
        !(
          await tx`SELECT id FROM rooms WHERE id=${roomId} AND deleted_at IS NULL FOR UPDATE`
        ).length
      )
        return undefined;
      const current = await this.workspace.currentVersion(
        roomId,
        "plan.md",
        tx,
      );
      if (!current || current.id !== versionId) return undefined;
      const row = (
        await tx`UPDATE rooms SET approved_plan_version_id=${versionId} WHERE id=${roomId} RETURNING approved_plan_version_id`
      )[0];
      return executionState(
        await planState(
          tx,
          this.workspace,
          roomId,
          row.approved_plan_version_id,
        ),
      );
    });
  }
  async clearApprovedPlan(roomId: string) {
    const row = (
      await this.database
        .sql`UPDATE rooms SET approved_plan_version_id=NULL WHERE id=${roomId} AND deleted_at IS NULL RETURNING approved_plan_version_id`
    )[0];
    return row
      ? executionState(
          await planState(this.database.sql, this.workspace, roomId, null),
        )
      : undefined;
  }
}

function isTool(value: unknown): value is ToolActivity {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { detail?: unknown }).detail === "string" &&
    ((value as { input?: unknown }).input === undefined ||
      typeof (value as { input?: unknown }).input === "string") &&
    ["started", "progress", "completed"].includes(
      String((value as { status?: unknown }).status),
    ),
  );
}
function isStructuredQuestion(value: unknown): value is StructuredQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Record<string, unknown>;
  if (
    typeof question.id !== "string" ||
    typeof question.header !== "string" ||
    typeof question.question !== "string" ||
    typeof question.isOther !== "boolean" ||
    typeof question.isSecret !== "boolean"
  )
    return false;
  if (
    question.multiSelect !== undefined &&
    typeof question.multiSelect !== "boolean"
  )
    return false;
  if (question.options === undefined) return true;
  return (
    Array.isArray(question.options) &&
    question.options.every((option) =>
      Boolean(
        option &&
        typeof option === "object" &&
        typeof (option as Record<string, unknown>).label === "string" &&
        ((option as Record<string, unknown>).description === undefined ||
          typeof (option as Record<string, unknown>).description === "string"),
      ),
    )
  );
}
function executionState(plan: RoomExecutionState["plan"]): RoomExecutionState {
  return { plan };
}
async function planState(
  sql: QueryContext,
  workspace: WorkspaceRepository,
  roomId: string,
  approvedId: unknown,
): Promise<RoomExecutionState["plan"]> {
  const current = await workspace.currentVersion(roomId, "plan.md", sql),
    approved =
      typeof approvedId === "string"
        ? await workspace.version(roomId, approvedId, sql)
        : undefined;
  return {
    path: "plan.md",
    current: current ? planRef(current) : null,
    approved: approved ? planRef(approved) : null,
  };
}
function planRef(version: { id: string; entry_id?: string }): PlanVersionRef {
  if(!version.entry_id)throw new Error('Published plan version is not attached to a workspace entry');
  return { entry_id: version.entry_id, version_id: version.id };
}
