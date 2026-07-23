import { AppError } from "../../shared/errors/AppError.js";
import type { RoomRepository } from "../rooms/rooms.repository.js";
import type { PersonaRepository } from "./personas.repository.js";
import {
  isValidHandle,
  normalizeHandle,
} from "../../shared/identity/handles.js";

type HarnessCatalog = {
  catalog(): Promise<{
    instances: Array<{
      id: string;
      type: string;
      status: string;
      models: Array<{ id: string; reasoningEfforts?: string[] }>;
      controls: {
        permissionProfiles: Array<{ id: string }>;
        agentVariants: Array<{ id: string }>;
      };
    }>;
  }>;
};
type HarnessSelectionInput = {
  requested_model?: string | null;
  harness_instance_id?: string;
  model_id?: string;
  permission_profile_id?: string | null;
  agent_variant_id?: string | null;
  default_reasoning_effort?: string | null;
};
type HarnessSelection = {
  requested_model: string;
  harness_instance_id: string;
  harness_type: string;
  model_id: string;
  permission_profile_id: string | null;
  agent_variant_id: string | null;
};
export type CreatePersonaInput = {
  handle?: string;
  name?: string;
  room_id?: string;
  role?: string;
  color?: string;
  system_prompt?: string;
  group_id?: string | null;
} & HarnessSelectionInput;

export class PersonasService {
  constructor(
    private readonly personas: PersonaRepository,
    private readonly rooms: RoomRepository,
    private readonly harnesses: HarnessCatalog,
  ) {}
  async list(roomId?: string, includeArchived = false) {
    if (roomId && !(await this.rooms.exists(roomId)))
      throw new AppError("room_not_found", 404, "Room not found", {
        room_id: roomId,
      });
    return this.personas.list(roomId, includeArchived);
  }
  async get(id: string) {
    const persona = await this.personas.detail(id);
    if (!persona) throw new AppError("not_found", 404, "Persona not found");
    return persona;
  }
  async create(input: CreatePersonaInput) {
    const handle = normalizeHandle(input.handle),
      name = input.name?.trim();
    if (!handle || !isValidHandle(handle))
      throw new AppError("invalid_handle", 400, "Invalid persona handle");
    if (!name)
      throw new AppError("name_required", 400, "Persona name is required");
    if (input.room_id && !(await this.rooms.exists(input.room_id)))
      throw new AppError("room_not_found", 404, "Room not found", {
        room_id: input.room_id,
      });
    const validated = await this.validateSelection({
        harness_instance_id: input.harness_instance_id ?? "local-hermes",
        model_id: input.model_id ?? input.requested_model ?? undefined,
        permission_profile_id: input.permission_profile_id ?? null,
        agent_variant_id: input.agent_variant_id ?? null,
        requested_model: input.requested_model,
      }),
      defaultReasoningEffort = normalizeEffort(
        input.default_reasoning_effort ?? null,
      );
    assertSupportedEffort(defaultReasoningEffort, validated.reasoningEfforts);
    try {
      return await this.personas.create({
        ...input,
        ...validated.selection,
        default_reasoning_effort: defaultReasoningEffort,
        handle,
        name,
      });
    } catch (error) {
      if (isForeignKeyError(error))
        throw new AppError("unknown_group", 400, "Unknown persona group", {
          group_id: input.group_id,
        });
      throw new AppError(
        "persona_conflict",
        409,
        "Persona conflicts with existing data",
        { handle },
      );
    }
  }
  async update(id: string, input: Record<string, unknown>) {
    const normalized = { ...input };
    delete normalized.harness_type;
    if (typeof normalized.handle === "string") {
      const handle = normalizeHandle(normalized.handle);
      if (!handle || !isValidHandle(handle))
        throw new AppError("invalid_handle", 400, "Invalid persona handle");
      normalized.handle = handle;
    }
    if (normalized.requested_model === null)
      throw new AppError("unknown_model", 400, "Unknown model", {
        model: null,
      });
    const current = await this.personas.find(id);
    if (!current) throw new AppError("not_found", 404, "Persona not found");
    const selectionChanged = hasSelectionInput(normalized),
      defaultProvided = Object.prototype.hasOwnProperty.call(
        normalized,
        "default_reasoning_effort",
      ),
      proposedDefault = defaultProvided
        ? normalizeEffort(normalized.default_reasoning_effort as string | null)
        : current.default_reasoning_effort;
    let validateLocked: Parameters<PersonaRepository["update"]>[2];
    if (defaultProvided) normalized.default_reasoning_effort = proposedDefault;
    if (selectionChanged || (defaultProvided && proposedDefault !== null)) {
      const instanceId =
        typeof normalized.harness_instance_id === "string"
          ? normalized.harness_instance_id
          : current.harness_instance_id;
      const modelId =
        typeof normalized.model_id === "string"
          ? normalized.model_id
          : typeof normalized.requested_model === "string"
            ? normalized.requested_model
            : current.model_id;
      const permissionProfileId =
        normalized.permission_profile_id === null ||
        typeof normalized.permission_profile_id === "string"
          ? normalized.permission_profile_id
          : instanceId === current.harness_instance_id
            ? current.permission_profile_id
            : null;
      const agentVariantId =
        normalized.agent_variant_id === null ||
        typeof normalized.agent_variant_id === "string"
          ? normalized.agent_variant_id
          : instanceId === current.harness_instance_id
            ? current.agent_variant_id
            : null;
      const validated = await this.validateSelection({
        harness_instance_id: instanceId,
        model_id: modelId,
        permission_profile_id: permissionProfileId,
        agent_variant_id: agentVariantId,
        requested_model:
          typeof normalized.requested_model === "string"
            ? normalized.requested_model
            : undefined,
      });
      assertSupportedEffort(proposedDefault, validated.reasoningEfforts);
      Object.assign(normalized, validated.selection);
      if (
        instanceId !== current.harness_instance_id ||
        modelId !== current.model_id
      ) {
        validateLocked = ({ overrides }) => {
          const conflicts = overrides.filter(
            (item) =>
              !validated.reasoningEfforts.includes(
                item.reasoning_effort_override,
              ),
          );
          if (conflicts.length)
            throw new AppError(
              "reasoning_effort_conflict",
              409,
              "The selected model does not support existing room reasoning overrides",
              {
                supported_reasoning_efforts: validated.reasoningEfforts,
                default_reasoning_effort: proposedDefault,
                rooms: conflicts,
              },
            );
        };
      }
    }
    try {
      const updated = await this.personas.update(
        id,
        normalized as never,
        validateLocked,
      );
      if (!updated) throw new AppError("not_found", 404, "Persona not found");
      return this.get(id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isForeignKeyError(error))
        throw new AppError("unknown_group", 400, "Unknown persona group", {
          group_id: normalized.group_id,
        });
      throw new AppError(
        "persona_conflict",
        409,
        "Persona conflicts with existing data",
      );
    }
  }
  async archive(id: string) {
    const result = await this.personas.setArchived(id, true);
    if (result === "not_found")
      throw new AppError("not_found", 404, "Persona not found");
    if (result === "conflict")
      throw new AppError(
        "persona_archived",
        409,
        "Persona is already archived",
      );
    return result;
  }
  async restore(id: string) {
    const result = await this.personas.setArchived(id, false);
    if (result === "not_found")
      throw new AppError("not_found", 404, "Persona not found");
    if (result === "conflict")
      throw new AppError("persona_conflict", 409, "Persona is already active");
    return result;
  }
  async delete(id: string) {
    const result = await this.personas.delete(id);
    if (result.status === "not_found")
      throw new AppError("not_found", 404, "Agent not found");
    if (result.status === "in_use")
      throw new AppError(
        "persona_in_use",
        409,
        "The agent has already been used in runs and cannot be deleted.",
        { dependencies: result.dependencies },
      );
  }
  private async validateSelection(
    input: HarnessSelectionInput,
  ): Promise<{ selection: HarnessSelection; reasoningEfforts: string[] }> {
    const instanceId = input.harness_instance_id?.trim(),
      modelId = input.model_id?.trim();
    if (!instanceId)
      throw new AppError(
        "unknown_harness_instance",
        400,
        "Unknown harness instance",
        { harnessInstanceId: instanceId ?? null },
      );
    if (!modelId)
      throw new AppError("unknown_model", 400, "Unknown model", {
        model: modelId ?? null,
        harnessInstanceId: instanceId,
      });
    if (
      typeof input.requested_model === "string" &&
      input.requested_model.trim() !== modelId
    )
      throw new AppError(
        "harness_selection_conflict",
        400,
        "requested_model and model_id must identify the same model",
      );
    const catalog = await this.harnesses.catalog(),
      instance = catalog.instances.find((item) => item.id === instanceId);
    if (!instance)
      throw new AppError(
        "unknown_harness_instance",
        400,
        "Unknown harness instance",
        { harnessInstanceId: instanceId },
      );
    if (instance.status !== "healthy")
      throw new AppError(
        "harness_unavailable",
        409,
        "Harness instance is unavailable",
        { harnessInstanceId: instanceId, status: instance.status },
      );
    const model = instance.models.find((candidate) => candidate.id === modelId);
    if (!model)
      throw new AppError("unknown_model", 400, "Unknown model", {
        model: modelId,
        harnessInstanceId: instanceId,
      });
    const permissionProfileId = input.permission_profile_id ?? null,
      agentVariantId = input.agent_variant_id ?? null;
    if (
      permissionProfileId &&
      !instance.controls.permissionProfiles.some(
        (option) => option.id === permissionProfileId,
      )
    )
      throw new AppError(
        "unknown_permission_profile",
        400,
        "Unknown permission profile",
        { permissionProfileId, harnessInstanceId: instanceId },
      );
    if (
      agentVariantId &&
      !instance.controls.agentVariants.some(
        (option) => option.id === agentVariantId,
      )
    )
      throw new AppError(
        "unknown_agent_variant",
        400,
        "Unknown agent variant",
        { agentVariantId, harnessInstanceId: instanceId },
      );
    return {
      selection: {
        requested_model: modelId,
        harness_instance_id: instance.id,
        harness_type: instance.type,
        model_id: modelId,
        permission_profile_id: permissionProfileId,
        agent_variant_id: agentVariantId,
      },
      reasoningEfforts: model.reasoningEfforts ?? [],
    };
  }
}
function hasSelectionInput(input: Record<string, unknown>) {
  return [
    "requested_model",
    "harness_instance_id",
    "model_id",
    "permission_profile_id",
    "agent_variant_id",
  ].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}
function isForeignKeyError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "23503",
  );
}
function normalizeEffort(value: string | null) {
  if (value === null) return null;
  const effort = value.trim();
  if (!effort || effort.length > 40)
    throw new AppError(
      "invalid_reasoning_effort",
      400,
      "Reasoning effort must be Auto or a catalog value",
    );
  return effort;
}
function assertSupportedEffort(value: string | null, supported: string[]) {
  if (value !== null && !supported.includes(value))
    throw new AppError(
      "invalid_reasoning_effort",
      400,
      "Reasoning effort is not supported by the selected model",
      { reasoning_effort: value, supported_reasoning_efforts: supported },
    );
}
