import type {
  Database,
  QueryContext,
} from "../../infrastructure/database/Database.js";
import type { Persona, PersonaVersion } from "../../types.js";
import {
  toPersona,
  toPersonaVersion,
} from "../../infrastructure/database/rowMappers.js";

export class PersonaRepository {
  constructor(private readonly database: Database) {}
  async list(roomId?: string, includeArchived = false): Promise<Persona[]> {
    const db = this.database.sql;
    const rows = roomId
      ? await db`SELECT p.* FROM personas p JOIN room_participants rp ON rp.persona_id=p.id WHERE rp.room_id=${roomId} ${includeArchived ? db`` : db`AND p.archived_at IS NULL`} ORDER BY p.created_at`
      : await db`SELECT p.* FROM personas p WHERE ${includeArchived ? db`TRUE` : db`p.archived_at IS NULL`} ORDER BY p.created_at`;
    return rows.map(toPersona);
  }
  async find(
    id: string,
    db: QueryContext = this.database.sql,
  ): Promise<Persona | undefined> {
    const row = (await db`SELECT * FROM personas WHERE id=${id}`)[0];
    return row ? toPersona(row) : undefined;
  }
  async version(
    id: string,
    db: QueryContext = this.database.sql,
  ): Promise<PersonaVersion | undefined> {
    const row = (await db`SELECT * FROM persona_versions WHERE id=${id}`)[0];
    return row ? toPersonaVersion(row) : undefined;
  }
  async detail(id: string) {
    const p = await this.find(id);
    if (!p) return;
    return {
      ...p,
      system_prompt:
        (await this.version(p.current_version_id))?.system_prompt ?? "",
    };
  }
  async create(input: {
    handle: string;
    name: string;
    room_id?: string;
    color?: string;
    requested_model: string;
    harness_instance_id: string;
    harness_type: string;
    model_id: string;
    permission_profile_id: string | null;
    agent_variant_id: string | null;
    default_reasoning_effort: string | null;
    system_prompt?: string;
    group_id?: string | null;
  }) {
    const now = new Date().toISOString(),
      id = crypto.randomUUID(),
      vid = crypto.randomUUID();
    await this.database.transaction(async (tx) => {
      await tx`INSERT INTO personas(id,handle,name,color,requested_model,effective_model,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id,default_reasoning_effort,current_version_id,group_id,created_at,updated_at) VALUES(${id},${input.handle},${input.name},${input.color ?? "#64748b"},${input.requested_model},NULL,${input.harness_instance_id},${input.harness_type},${input.model_id},${input.permission_profile_id},${input.agent_variant_id},${input.default_reasoning_effort},${vid},${input.group_id ?? null},${now},${now})`;
      await tx`INSERT INTO persona_versions(id,persona_id,version,requested_model,system_prompt,created_at,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id,default_reasoning_effort) VALUES(${vid},${id},1,${input.requested_model},${input.system_prompt ?? ""},${now},${input.harness_instance_id},${input.harness_type},${input.model_id},${input.permission_profile_id},${input.agent_variant_id},${input.default_reasoning_effort})`;
      if (input.room_id)
        await tx`INSERT INTO room_participants(room_id,persona_id) VALUES(${input.room_id},${id})`;
    });
    return this.detail(id);
  }
  async update(
    id: string,
    input: Partial<{
      handle: string;
      name: string;
      color: string;
      requested_model: string;
      harness_instance_id: string;
      harness_type: string;
      model_id: string;
      permission_profile_id: string | null;
      agent_variant_id: string | null;
      default_reasoning_effort: string | null;
      system_prompt: string;
      group_id: string | null;
    }>,
    validateLocked?: (input: {
      current: Persona;
      overrides: Array<{
        room_id: string;
        reasoning_effort_override: string;
      }>;
    }) => void,
  ) {
    const updated = await this.database.transaction(async (tx) => {
      await tx`SELECT r.id FROM rooms r JOIN room_participants rp ON rp.room_id=r.id WHERE rp.persona_id=${id} ORDER BY r.id FOR UPDATE OF r`;
      const oldRow = (
        await tx`SELECT * FROM personas WHERE id=${id} FOR UPDATE`
      )[0];
      if (!oldRow) return false;
      const participantRows =
        await tx`SELECT room_id,reasoning_effort_override FROM room_participants WHERE persona_id=${id} ORDER BY room_id FOR UPDATE`;
      const old = toPersona(oldRow);
      validateLocked?.({
        current: old,
        overrides: participantRows
          .filter((row) => typeof row.reasoning_effort_override === "string")
          .map((row) => ({
            room_id: String(row.room_id),
            reasoning_effort_override: String(row.reasoning_effort_override),
          })),
      });
      const prior = await this.version(old.current_version_id, tx);
      if (!prior) return false;
      const now = new Date().toISOString(),
        vid = crypto.randomUUID(),
        requestedModel =
          input.requested_model ?? old.requested_model ?? old.model_id,
        harnessInstanceId =
          input.harness_instance_id ?? old.harness_instance_id,
        harnessType = input.harness_type ?? old.harness_type,
        modelId = input.model_id ?? old.model_id,
        permissionProfileId =
          input.permission_profile_id === undefined
            ? old.permission_profile_id
            : input.permission_profile_id,
        agentVariantId =
          input.agent_variant_id === undefined
            ? old.agent_variant_id
            : input.agent_variant_id,
        defaultReasoningEffort =
          input.default_reasoning_effort === undefined
            ? old.default_reasoning_effort
            : input.default_reasoning_effort;
      const [{ n }] =
        await tx`SELECT COALESCE(MAX(version),0)::int+1 n FROM persona_versions WHERE persona_id=${id}`;
      await tx`INSERT INTO persona_versions(id,persona_id,version,requested_model,system_prompt,created_at,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id,default_reasoning_effort) VALUES(${vid},${id},${n as number},${requestedModel},${input.system_prompt ?? prior.system_prompt},${now},${harnessInstanceId},${harnessType},${modelId},${permissionProfileId},${agentVariantId},${defaultReasoningEffort})`;
      await tx`UPDATE personas SET handle=${input.handle?.toLowerCase() ?? old.handle},name=${input.name ?? old.name},color=${input.color ?? old.color},requested_model=${requestedModel},harness_instance_id=${harnessInstanceId},harness_type=${harnessType},model_id=${modelId},permission_profile_id=${permissionProfileId},agent_variant_id=${agentVariantId},default_reasoning_effort=${defaultReasoningEffort},group_id=${input.group_id === undefined ? old.group_id : input.group_id},effective_model=NULL,current_version_id=${vid},updated_at=${now} WHERE id=${id}`;
      return true;
    });
    return updated ? this.find(id) : undefined;
  }
  async reasoningOverrides(id: string) {
    return (
      await this.database
        .sql`SELECT room_id,reasoning_effort_override FROM room_participants WHERE persona_id=${id} AND reasoning_effort_override IS NOT NULL ORDER BY room_id`
    ).map((row) => ({
      room_id: String(row.room_id),
      reasoning_effort_override: String(row.reasoning_effort_override),
    }));
  }
  async setArchived(id: string, archived: boolean) {
    const p = await this.find(id);
    if (!p) return "not_found" as const;
    if (Boolean(p.archived_at) === archived) return "conflict" as const;
    await this.database
      .sql`UPDATE personas SET archived_at=${archived ? new Date().toISOString() : null},updated_at=now() WHERE id=${id}`;
    return this.detail(id);
  }
  async delete(id: string) {
    return this.database.transaction(async (tx) => {
      if (!(await tx`SELECT 1 FROM personas WHERE id=${id} FOR UPDATE`).length)
        return { status: "not_found" as const };
      const [d] =
        await tx`SELECT COUNT(*)::int agent_runs FROM agent_runs WHERE persona_id=${id}`;
      if (Number(d.agent_runs))
        return { status: "in_use" as const, dependencies: d };
      await tx`DELETE FROM personas WHERE id=${id}`;
      return { status: "deleted" as const };
    });
  }
  async setEffectiveModel(id: string, model: string | null) {
    await this.database
      .sql`UPDATE personas SET effective_model=${model} WHERE id=${id}`;
  }
}
