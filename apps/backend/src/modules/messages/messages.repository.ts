import type {
  Database,
  QueryContext,
} from "../../infrastructure/database/Database.js";
import type {
  ConversationItem,
  HumanAuthorSnapshot,
  Persona,
  PersonaVersion,
  RoomEvent,
} from "../../types.js";
import type { PersonaRepository } from "../personas/personas.repository.js";
import type { RoomEventRepository } from "../room-events/roomEvents.repository.js";
import { toMessage } from "../../infrastructure/database/rowMappers.js";
import type {
  WorkspaceRepository,
  WorkspaceVersionRow,
} from "../workspace/workspace.repository.js";
import type { UserProfileRepository } from "../user-profile/userProfile.repository.js";
import type {
  ExecutionIntent,
  Message,
  RunExecutionProfileSnapshot,
} from "@agenvyl/contracts";

export class MessageRepository {
  constructor(
    private readonly database: Database,
    private readonly personas: PersonaRepository,
    private readonly userProfile: UserProfileRepository,
    private readonly events: RoomEventRepository,
    private readonly workspace: WorkspaceRepository,
  ) {}
  async find(roomId: string, id: string) {
    const row = (
      await this.database
        .sql`SELECT id,text,created_at,targets,run_ids,author_profile_id,author_display_name,author_handle,addressed_to_all FROM room_messages WHERE room_id=${roomId} AND id=${id}`
    )[0];
    if (!row) return undefined;
    const attachments = await this.workspace.messageAttachments([id]);
    return toMessage(row, attachments.get(id) ?? []);
  }
  async createRound(
    roomId: string,
    text: string,
    targetPersonas: Persona[],
    executionProfiles: ReadonlyMap<string, RunExecutionProfileSnapshot>,
    requestedId?: string,
    attachmentVersionIds: string[] = [],
    addressedToAll = false,
    executionIntent?: ExecutionIntent,
  ) {
    const messageId = requestedId ?? crypto.randomUUID(),
      now = new Date().toISOString();
    return this.database.transaction(async (tx) => {
      const room = (
        await tx`SELECT id,approved_plan_version_id FROM rooms WHERE id=${roomId} AND deleted_at IS NULL FOR UPDATE`
      )[0];
      const existing = (
        await tx`SELECT id,text,created_at,targets,run_ids,author_profile_id,author_display_name,author_handle,addressed_to_all FROM room_messages WHERE room_id=${roomId} AND id=${messageId}`
      )[0];
      if (existing) {
        const attached = await this.workspace.messageAttachments(
          [messageId],
          tx,
        );
        return {
          message: toMessage(existing, attached.get(messageId) ?? []),
          runs: [],
          events: [] as RoomEvent[],
          duplicate: true,
        };
      }
      if (
        executionIntent?.kind === "plan" &&
        (
          await tx`SELECT 1 FROM agent_runs WHERE room_id=${roomId} AND execution_profile->>'workflowMode'='plan' AND status=ANY(${["queued", "streaming", "stopping", "waiting_approval", "waiting_clarification"]}) LIMIT 1`
        ).length
      )
        throw new Error("plan_run_active");
      if (
        executionIntent?.kind === "implement" &&
        room?.approved_plan_version_id !==
          executionIntent.approved_plan_version_id
      )
        throw new Error("approved_plan_changed");
      const attachmentVersions = await this.workspace.validateVersions(
        roomId,
        attachmentVersionIds,
        tx,
      );
      if (attachmentVersions.length !== attachmentVersionIds.length)
        throw new Error("attachment_unavailable");
      const profile = await this.userProfile.get(tx),
        author: HumanAuthorSnapshot = {
          profileId: profile.id,
          displayName: profile.displayName,
          handle: profile.handle,
        };
      const snapshots: Array<{
        persona: Persona;
        version: PersonaVersion;
        id: string;
        history: ConversationItem[];
        executionProfile: RunExecutionProfileSnapshot;
      }> = [];
      for (const p of targetPersonas) {
        const current = await this.personas.find(p.id, tx);
        if (!current || current.archived_at)
          throw new Error("persona_unavailable");
        const version = await this.personas.version(
          current.current_version_id,
          tx,
        );
        if (!version?.requested_model) throw new Error("persona_model_missing");
        const executionProfile = executionProfiles.get(p.id);
        if (!executionProfile) throw new Error("execution_profile_missing");
        snapshots.push({
          persona: current,
          version,
          id: crypto.randomUUID(),
          history: await this.conversationHistory(roomId, current.handle, tx),
          executionProfile,
        });
      }
      const attachments = attachmentVersions.map((version) =>
        attachment(version),
      );
      const message: Message = {
        id: messageId,
        text,
        createdAt: now,
        targets: snapshots.map((x) => x.persona.handle),
        runIds: snapshots.map((x) => x.id),
        attachments,
        author,
        addressedToAll,
      };
      await tx`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at,author_profile_id,author_display_name,author_handle,addressed_to_all) VALUES(${messageId},${roomId},${text},${this.database.sql.json(message.targets)},${this.database.sql.json(message.runIds)},${now},${author.profileId},${author.displayName},${author.handle},${addressedToAll})`;
      await this.workspace.attachMessage(messageId, attachmentVersionIds, tx);
      for (const x of snapshots) {
        await tx`INSERT INTO response_slots(id,message_id,persona_id,created_at) VALUES(${x.id},${messageId},${x.persona.id},${now})`;
        await tx`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,execution_profile,implementation_plan_version_id,status,response_slot_id,context,created_at,updated_at) VALUES(${x.id},${messageId},${roomId},${x.persona.id},${x.version.id},${x.persona.handle},${x.version.requested_model},${x.version.harness_instance_id},${x.version.harness_type},${x.version.model_id},${this.database.sql.json(x.executionProfile)},${x.executionProfile.implementationPlanVersionId},'queued',${x.id},${this.database.sql.json(x.history)},${now},${now})`;
      }
      const persisted = [
        await this.events.appendInTransaction(
          tx,
          roomId,
          "message.created",
          message,
          now,
        ),
      ];
      for (const x of snapshots)
        persisted.push(
          await this.events.appendInTransaction(
            tx,
            roomId,
            "run.created",
            {
              id: x.id,
              messageId,
              agent: x.persona.handle,
              requestedModel: x.version.requested_model,
              harnessInstanceId: x.version.harness_instance_id,
              harnessType: x.version.harness_type,
              modelId: x.version.model_id,
              executionProfile: x.executionProfile,
              status: "queued",
              text: "",
              tools: [],
              artifacts: [],
              responseSlotId: x.id,
              attemptNumber: 1,
            },
            now,
          ),
        );
      return {
        message,
        runs: snapshots,
        events: persisted,
        duplicate: false,
        attachmentVersions,
      };
    });
  }
  async conversationHistory(
    roomId: string,
    personaHandle: string,
    db: QueryContext = this.database.sql,
    beforeMessageId?: string,
  ) {
    return (
      await this.conversationContext(roomId, personaHandle, db, beforeMessageId)
    ).history;
  }
  async conversationContextForRun(
    roomId: string,
    personaHandle: string,
    beforeMessageId: string,
  ) {
    return this.conversationContext(
      roomId,
      personaHandle,
      this.database.sql,
      beforeMessageId,
    );
  }
  async conversationContext(
    roomId: string,
    personaHandle: string,
    db: QueryContext = this.database.sql,
    beforeMessageId?: string,
  ) {
    const messages = beforeMessageId
      ? await db`SELECT id,text,targets,author_profile_id,author_display_name,author_handle,addressed_to_all FROM room_messages WHERE room_id=${roomId} AND (created_at,id)<(SELECT created_at,id FROM room_messages WHERE room_id=${roomId} AND id=${beforeMessageId}) ORDER BY created_at,id`
      : await db`SELECT id,text,targets,author_profile_id,author_display_name,author_handle,addressed_to_all FROM room_messages WHERE room_id=${roomId} ORDER BY created_at,id`;
    const attachmentMap = await this.workspace.messageAttachments(
        messages.map((m) => String(m.id)),
        db,
      ),
      history: ConversationItem[] = [],
      references: Array<{ path: string; versionId: string }> = [];
    for (const m of messages) {
      const answers =
        await db`SELECT r.id,r.persona_handle,r.text FROM response_slots s JOIN agent_runs r ON r.id=s.selected_run_id WHERE s.message_id=${m.id as string} AND r.status='completed' AND r.text<>'' ORDER BY r.persona_handle`;
      if (!answers.length) continue;
      const embedMap = await this.workspace.runEmbeds(
          answers.map((answer) => String(answer.id)),
          db,
        ),
        clean = (answer: Record<string, unknown>) =>
          stripLegacyWorkspaceManifest(String(answer.text ?? ""));
      for (const attachment of attachmentMap.get(String(m.id)) ?? [])
        references.push({
          path: attachment.path,
          versionId: attachment.version_id,
        });
      for (const answer of answers)
        for (const embed of embedMap.get(String(answer.id)) ?? [])
          if (embed.status === "resolved" && embed.attachment)
            references.push({
              path: embed.path,
              versionId: embed.attachment.version_id,
            });
      history.push({ role: "user", content: formatHumanMessageRow(m) });
      const own = answers.find((a) => a.persona_handle === personaHandle);
      if (own) history.push({ role: "assistant", content: clean(own) });
      const peers = answers.filter((a) => a.persona_handle !== personaHandle);
      if (peers.length)
        history.push({
          role: "user",
          content: `[MESSAGES FROM OTHER AGENTS — these are not the human user and not your responses]\nDo not continue their roles or answer on their behalf.\n\n${peers.map((a) => `[Other agent: @${a.persona_handle}]\n${clean(a)}`).join("\n\n")}`,
        });
    }
    return {
      history,
      references: [
        ...new Map(references.map((item) => [item.versionId, item])).values(),
      ],
    };
  }
}

export function formatHumanMessage(
  message: Pick<Message, "text" | "targets" | "author" | "addressedToAll">,
) {
  return formatHuman(
    message.text,
    message.targets,
    message.author,
    message.addressedToAll,
  );
}
function formatHumanMessageRow(row: Record<string, unknown>) {
  return formatHuman(
    String(row.text),
    Array.isArray(row.targets) ? row.targets.map(String) : [],
    {
      profileId: String(row.author_profile_id),
      displayName: String(row.author_display_name),
      handle: String(row.author_handle),
    },
    Boolean(row.addressed_to_all),
  );
}
function formatHuman(
  text: string,
  targets: string[],
  author: HumanAuthorSnapshot,
  addressedToAll: boolean,
) {
  const recipient = addressedToAll
    ? "all agents"
    : targets.length
      ? targets.map((handle) => `@${handle}`).join(", ")
      : "not specified (message without agent runs)";
  return `[Human user: ${author.displayName} (@${author.handle}); recipient: ${recipient}]\n${text}`;
}

function attachment(version: WorkspaceVersionRow) {
  return {
    version_id: version.id,
    entry_id: version.entry_id,
    path: version.path,
    name: version.path.split("/").pop() ?? version.path,
    size: version.size,
    mime_type: version.mime_type,
    url: `/api/v1/rooms/${encodeURIComponent(version.room_id)}/workspace/versions/${version.id}`,
    preview_url: `/api/v1/rooms/${encodeURIComponent(version.room_id)}/workspace/versions/${version.id}/preview`,
  };
}
function stripLegacyWorkspaceManifest(value: string) { return value.replace(/\n\nЗафиксированные inline-изображения ответа:\n(?:- [^\n]*(?:\n|$))+/giu, "").trimEnd(); }
