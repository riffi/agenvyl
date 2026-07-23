import { describe, expect, it } from "vitest";
import { resolveExecutionProfile } from "./executionProfile";

const controls = {
  nativeWorkflowModes: ["plan", "work"] as Array<"plan" | "work">,
  permissionProfiles: [{ id: "workspace-write" }],
  agentVariants: [],
};
const base = {
  controls,
  permissionProfileId: null,
  agentVariantId: null,
};

describe("resolveExecutionProfile", () => {
  it("keeps a supported room override and snapshots native Plan", () =>
    expect(
      resolveExecutionProfile({
        ...base,
        roomOverride: "high",
        personaDefault: null,
        intent: { kind: "plan" },
        model: {
          id: "gpt",
          reasoningEfforts: ["low", "high"],
          defaultReasoningEffort: "low",
        },
      }),
    ).toEqual({
      workflowMode: "plan",
      requestedReasoningEffort: "high",
      reasoningEffort: "high",
      reasoningEffortFallback: false,
      reasoningEffortSource: "room_override",
      planEnforcement: "native",
      permissionProfileId: "workspace-write",
      agentVariantId: null,
      implementationPlanVersionId: null,
    }));

  it("preserves the requested source when catalog drift causes fallback", () =>
    expect(
      resolveExecutionProfile({
        ...base,
        roomOverride: "max",
        personaDefault: null,
        intent: {
          kind: "implement",
          approved_plan_version_id: "version-1",
        },
        model: {
          id: "small",
          reasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
        },
        controls: { ...controls, nativeWorkflowModes: [] },
        permissionProfileId: "read-only",
        agentVariantId: "build",
      }),
    ).toMatchObject({
      workflowMode: "work",
      requestedReasoningEffort: "max",
      reasoningEffort: "low",
      reasoningEffortFallback: true,
      reasoningEffortSource: "room_override",
      planEnforcement: null,
      permissionProfileId: "read-only",
      agentVariantId: "build",
      implementationPlanVersionId: "version-1",
    }));

  it("resolves persona, model, and Auto inheritance in order", () => {
    const model = {
      id: "gpt",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "low",
    };
    expect(
      resolveExecutionProfile({
        ...base,
        roomOverride: null,
        personaDefault: "high",
        model,
      }),
    ).toMatchObject({
      requestedReasoningEffort: "high",
      reasoningEffort: "high",
      reasoningEffortSource: "persona_default",
    });
    expect(
      resolveExecutionProfile({
        ...base,
        roomOverride: null,
        personaDefault: null,
        model,
      }),
    ).toMatchObject({
      requestedReasoningEffort: "low",
      reasoningEffort: "low",
      reasoningEffortSource: "model_default",
    });
    expect(
      resolveExecutionProfile({
        ...base,
        roomOverride: null,
        personaDefault: null,
        model: { id: "plain" },
      }),
    ).toMatchObject({
      requestedReasoningEffort: null,
      reasoningEffort: null,
      reasoningEffortSource: "auto",
    });
  });

  it("does not carry an approved plan into ordinary Work", () =>
    expect(
      resolveExecutionProfile({
        ...base,
        roomOverride: null,
        personaDefault: null,
        model: { id: "small" },
      }).implementationPlanVersionId,
    ).toBeNull());

  it("marks unsupported Plan as instruction-only", () =>
    expect(
      resolveExecutionProfile({
        ...base,
        roomOverride: null,
        personaDefault: null,
        intent: { kind: "plan" },
        model: { id: "hermes" },
        controls: {
          nativeWorkflowModes: [],
          permissionProfiles: [],
          agentVariants: [],
        },
      }).planEnforcement,
    ).toBe("instruction_only"));
});
