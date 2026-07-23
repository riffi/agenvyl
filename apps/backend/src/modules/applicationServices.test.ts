import { describe, expect, it, vi } from "vitest";
import { AppError } from "../shared/errors/AppError.js";
import { RoomsService } from "./rooms/rooms.service.js";
import { PersonasService } from "./personas/personas.service.js";
import { CreateMessageRound } from "./messages/createMessageRound.js";
import { RunsService } from "./runs/runs.service.js";
import { PersonaGroupsService } from "./persona-groups/personaGroups.service.js";

describe("application services", () => {
  const controls = {
    nativeWorkflowModes: [] as Array<"plan" | "work">,
    permissionProfiles: [] as Array<{ id: string }>,
    agentVariants: [] as Array<{ id: string }>,
  };
  const workProfile = {
    workflowMode: "work" as const,
    requestedReasoningEffort: null,
    reasoningEffort: null,
    reasoningEffortFallback: false,
    reasoningEffortSource: "auto",
    planEnforcement: null,
    permissionProfileId: null,
    agentVariantId: null,
    implementationPlanVersionId: null,
  };
  it("maps room repository outcomes to typed application errors", async () => {
    const service = new RoomsService({
      delete: vi.fn().mockResolvedValue("busy"),
    } as never);
    await expect(service.delete("room")).rejects.toMatchObject({
      code: "room_busy",
      statusCode: 409,
    });
  });
  it("normalizes persona input and compatible model selection before persistence", async () => {
    const create = vi.fn().mockImplementation(async (input) => input);
    const service = new PersonasService(
      { create } as never,
      { exists: vi.fn().mockResolvedValue(true) } as never,
      {
        catalog: vi
          .fn()
          .mockResolvedValue({
            instances: [
              {
                id: "local-hermes",
                type: "hermes",
                status: "healthy",
                models: [{ id: "sol" }],
                controls,
              },
            ],
          }),
      } as never,
    );
    await service.create({
      handle: " @LEAD ",
      name: " Lead ",
      requested_model: "sol",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: "lead",
        name: "Lead",
        requested_model: "sol",
        harness_instance_id: "local-hermes",
        harness_type: "hermes",
        model_id: "sol",
        permission_profile_id: null,
        agent_variant_id: null,
      }),
    );
  });
  it("validates provider permission profiles independently from workflow", async () => {
    const create = vi.fn().mockImplementation(async (input) => input),
      catalog = {
        instances: [
          {
            id: "local-antigravity",
            type: "antigravity",
            status: "healthy",
            models: [{ id: "gemini" }],
            controls: {
              ...controls,
              permissionProfiles: [{ id: "plan" }, { id: "accept-edits" }],
            },
          },
        ],
      },
      service = new PersonasService(
        { create } as never,
        { exists: vi.fn() } as never,
        { catalog: vi.fn().mockResolvedValue(catalog) } as never,
      );
    await expect(
      service.create({
        handle: "agy",
        name: "AGY",
        harness_instance_id: "local-antigravity",
        model_id: "gemini",
        permission_profile_id: "missing",
      }),
    ).rejects.toMatchObject({
      code: "unknown_permission_profile",
      statusCode: 400,
    });
    expect(create).not.toHaveBeenCalled();
    await service.create({
      handle: "agy",
      name: "AGY",
      harness_instance_id: "local-antigravity",
      model_id: "gemini",
      permission_profile_id: "plan",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        harness_type: "antigravity",
        permission_profile_id: "plan",
      }),
    );
  });
  it("validates and forwards an absolute persona group position", async () => {
    const reorder = vi.fn().mockResolvedValue({ id: "group", position: 1 });
    const service = new PersonaGroupsService({ reorder } as never);
    await expect(
      service.reorder("group", { position: -1 }),
    ).rejects.toMatchObject({ code: "invalid_position", statusCode: 400 });
    await service.reorder("group", { position: 1 });
    expect(reorder).toHaveBeenCalledWith("group", 1);
  });
  it("rejects unknown message targets before persistence", async () => {
    const execute = new CreateMessageRound({
      personas: { list: vi.fn().mockResolvedValue([]) },
      messages: { find: vi.fn() },
      events: {},
      harnesses: { catalog: vi.fn() },
      activeRuns: {},
      runExecutor: {},
    } as never);
    await expect(
      execute.execute({ roomId: "room", text: "hello", targets: ["missing"] }),
    ).rejects.toEqual(
      expect.objectContaining<AppError>({
        code: "unknown_target",
        statusCode: 400,
      }),
    );
  });
  it("requires exactly one responder for a one-shot Plan request", async () => {
    const execute = new CreateMessageRound({
      personas: { list: vi.fn().mockResolvedValue([]) },
      messages: { find: vi.fn() },
      events: {},
      harnesses: { catalog: vi.fn() },
      activeRuns: {},
      runExecutor: {},
    } as never);
    await expect(
      execute.execute({
        roomId: "room",
        text: "plan it",
        targets: [],
        executionIntent: { kind: "plan" },
      }),
    ).rejects.toEqual(
      expect.objectContaining<AppError>({
        code: "plan_requires_single_agent",
        statusCode: 400,
      }),
    );
  });
  it("validates runs against the selected Connector harness catalog", async () => {
    const persona = {
        id: "persona-opencode",
        handle: "opencode",
        requested_model: "provider/model",
        harness_instance_id: "local-opencode",
        harness_type: "opencode",
        model_id: "provider/model",
        permission_profile_id: null,
        agent_variant_id: "build",
      },
      setEffectiveModel = vi.fn(),
      catalog = vi.fn().mockResolvedValue({
        instances: [
          {
            id: "local-opencode",
            type: "opencode",
            status: "healthy",
            models: [{ id: "provider/model", label: "Provider Model" }],
            controls: { ...controls, agentVariants: [{ id: "build" }] },
          },
        ],
      }),
      service = new CreateMessageRound({
        personas: {
          list: vi.fn().mockResolvedValue([persona]),
          setEffectiveModel,
        },
        rooms: {
          executionState: vi
            .fn()
            .mockResolvedValue({
              profile: { reasoning_effort: null },
              plan: { path: "plan.md", current: null, approved: null },
            }),
        },
        messages: {
          createRound: vi.fn(
            async (
              _roomId,
              _text,
              _targets,
              resolveProfile: (input: {
                persona: typeof persona;
                version: typeof persona & {
                  default_reasoning_effort: null;
                };
                roomOverride: null;
              }) => unknown,
            ) => {
              resolveProfile({
                persona,
                version: { ...persona, default_reasoning_effort: null },
                roomOverride: null,
              });
              return { duplicate: true, message: { id: "message" } };
            },
          ),
        },
        events: {},
        harnesses: {
          catalog,
        },
        activeRuns: {},
        runExecutor: {},
      } as never);
    await expect(
      service.execute({ roomId: "room", text: "hello", targets: ["opencode"] }),
    ).resolves.toMatchObject({ status: "duplicate" });
    expect(catalog).toHaveBeenCalledOnce();
    expect(setEffectiveModel).not.toHaveBeenCalled();
  });
  it("starts a persisted retry and returns its wire result", async () => {
    const activeRuns = { add: vi.fn() },
      events = { publishPersisted: vi.fn() },
      executor = { start: vi.fn() },
      runs = {
        retry: vi
          .fn()
          .mockResolvedValue({
            status: "created",
            runId: "retry",
            roomId: "room",
            personaVersionId: "version",
            requestedModel: "sol",
            harnessInstanceId: "local-hermes",
            harnessType: "hermes",
            modelId: "sol",
            executionProfile: workProfile,
            history: [],
            event: {},
            text: "again",
          }),
      };
    const service = new RunsService({
      runs,
      events,
      activeRuns,
      executor,
    } as never);
    await expect(service.retry("source")).resolves.toEqual({
      run_id: "retry",
      retry_of_run_id: "source",
    });
    expect(activeRuns.add).toHaveBeenCalledWith(
      expect.objectContaining({
        harnessInstanceId: "local-hermes",
        harnessType: "hermes",
        modelId: "sol",
        executionProfile: workProfile,
      }),
    );
    expect(executor.start).toHaveBeenCalledWith("retry", "again");
  });
});
