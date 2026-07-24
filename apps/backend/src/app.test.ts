import { describe, expect, it, vi } from "vitest";
import { buildApp as buildAppBase } from "./app.js";
import type { AppOptions } from "./app/buildApp.js";
import { connectTestDatabase, testDatabaseUrl } from "./testDatabase.js";
import { connectorContractFixtures } from "@agenvyl/connector-contract";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const connectorOptions = {
  connectorUrl: "http://connector.test",
  connectorToken: "x".repeat(32),
} as const;
const buildApp = (options: AppOptions = {}) =>
  buildAppBase({ ...connectorOptions, ...options });
function db() {
  return testDatabaseUrl("app");
}
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
function personaCatalogFetch(
  models: Array<{
    id: string;
    root?: string;
    reasoningEfforts?: string[];
    defaultReasoningEffort?: string | null;
  }>,
  includeOpenCode = false,
  submitted: Array<Record<string, unknown>> = [],
) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v2/instances"))
      return Response.json({
        apiVersion: "v2",
        connectorEpoch: "persona-catalog-epoch",
        instances: [
          {
            id: "local-hermes",
            type: "hermes",
            status: "healthy",
            capabilities: [
              "model_catalog",
              "execution_profiles",
              "text_streaming",
              "tools",
              "approvals",
            ],
          },
          ...(includeOpenCode
            ? [
                {
                  id: "local-opencode",
                  type: "opencode",
                  status: "healthy",
                  capabilities: [
                    "model_catalog",
                    "execution_profiles",
                    "text_streaming",
                    "tools",
                    "approvals",
                  ],
                },
              ]
            : []),
        ],
      });
    if (url.endsWith("/v2/instances/local-hermes/catalog"))
      return Response.json({
        apiVersion: "v2",
        connectorEpoch: "persona-catalog-epoch",
        instanceId: "local-hermes",
        models: models.map((model) => ({
          id: model.id,
          label: model.root ?? model.id,
          ...(model.reasoningEfforts
            ? { reasoningEfforts: model.reasoningEfforts }
            : {}),
          ...(model.defaultReasoningEffort !== undefined
            ? { defaultReasoningEffort: model.defaultReasoningEffort }
            : {}),
        })),
        controls: {
          nativeWorkflowModes: [],
          permissionProfiles: [],
          agentVariants: [],
        },
      });
    if (url.endsWith("/v2/instances/local-opencode/catalog"))
      return Response.json({
        apiVersion: "v2",
        connectorEpoch: "persona-catalog-epoch",
        instanceId: "local-opencode",
        models: [{ id: "fixture/model", label: "Fixture Model" }],
        controls: {
          nativeWorkflowModes: ["plan", "work"],
          permissionProfiles: [],
          agentVariants: [{ id: "build", label: "Build" }],
        },
      });
    if (url.endsWith("/v2/executions") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      submitted.push(body);
      return Response.json(
        {
          execution: {
            ...connectorContractFixtures.execution,
            executionId: String(body.executionId),
            connectorEpoch: "persona-catalog-epoch",
            instanceId: String(body.harnessInstanceId),
            modelId: String(body.modelId),
            executionProfile: body.executionProfile,
            cursor: 2,
            pendingRequests: [],
          },
        },
        { status: 201 },
      );
    }
    const match = url.match(/\/v2\/executions\/([^/]+)\/events\?after=2$/);
    if (match) {
      const executionId = decodeURIComponent(match[1]),
        events = [
          {
            ...connectorContractFixtures.textEvent,
            executionId,
            connectorEpoch: "persona-catalog-epoch",
            cursor: 3,
            payload: { text: "prior answer" },
          },
          {
            ...connectorContractFixtures.textEvent,
            executionId,
            connectorEpoch: "persona-catalog-epoch",
            cursor: 4,
            type: "execution.completed",
            payload: {},
          },
        ];
      return new Response(
        events
          .map(
            (event) =>
              `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return new Response("{}", { status: 500 });
  });
}
describe("backend smoke", () => {
  it("separates liveness from dependency-aware readiness", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 503 }));
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    expect((await app.inject("/health")).body).toBe("ok");
    const personas = (await app.inject("/api/v1/personas")).json();
    expect(personas).toHaveLength(4);
    expect(
      personas.every(
        (p: { effective_model: unknown }) => p.effective_model === null,
      ),
    ).toBe(true);
    const readiness = await app.inject("/api/v1/health");
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({
      status: "not_ready",
      database: "ok",
      run_gateway: { ok: false },
    });
    expect(readiness.json()).not.toHaveProperty("hermes");
    await app.close();
  });
  it("persists a no-target message without calling Hermes", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload: { text: "just save this" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().runIds).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("runtime features", () => {
  it("publishes Plan Mode as disabled by default and rejects its workflow", async () => {
    const file = db(),
      app = await buildApp({
        databaseUrl: file,
        fetch: vi.fn<typeof fetch>(),
        distPath: "missing-dist",
      }),
      sql = connectTestDatabase(file);
    expect((await app.inject("/api/v1/features")).json()).toEqual({
      plan_mode: false,
      preview_origin: "http://127.0.0.1:8792",
    });
    const requests = [
      await app.inject({
        method: "POST",
        url: "/api/v1/rooms/demo-room/messages",
        payload: {
          text: "@architect plan",
          execution_intent: { kind: "plan" },
        },
      }),
      await app.inject({
        method: "POST",
        url: "/api/v1/rooms/demo-room/messages",
        payload: {
          text: "@architect implement",
          execution_intent: {
            kind: "implement",
            approved_plan_version_id: "version-1",
          },
        },
      }),
      await app.inject({
        method: "PUT",
        url: "/api/v1/rooms/demo-room/plan",
        payload: { content: "# Plan", expected_version_id: "version-1" },
      }),
      await app.inject({
        method: "PUT",
        url: "/api/v1/rooms/demo-room/approved-plan",
        payload: { version_id: "version-1" },
      }),
      await app.inject({
        method: "DELETE",
        url: "/api/v1/rooms/demo-room/approved-plan",
      }),
    ];
    for (const response of requests) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "plan_mode_disabled" });
    }
    expect((await sql`SELECT COUNT(*)::int count FROM agent_runs`)[0]).toEqual({
      count: 0,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/rooms/demo-room/messages",
          payload: { text: "ordinary note" },
        })
      ).statusCode,
    ).toBe(202);
    const now = new Date().toISOString(),
      profiles = [
        {
          ...workProfile,
          workflowMode: "plan" as const,
          planEnforcement: "native" as const,
        },
        {
          ...workProfile,
          implementationPlanVersionId: "historical-plan-version",
        },
      ],
      runIds: string[] = [];
    for (const [index, executionProfile] of profiles.entries()) {
      const messageId = crypto.randomUUID(),
        runId = crypto.randomUUID();
      runIds.push(runId);
      await sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at)VALUES(${messageId},'demo-room',${`historical ${index}`},${sql.json(["architect"])},${sql.json([runId])},${now})`;
      await sql`INSERT INTO response_slots(id,message_id,persona_id,created_at)VALUES(${runId},${messageId},'persona-architect',${now})`;
      await sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,execution_profile,status,response_slot_id,created_at,updated_at)VALUES(${runId},${messageId},'demo-room','persona-architect','persona-architect-v1','architect','sol','local-hermes','hermes','sol',${sql.json(executionProfile)},'completed',${runId},${now},${now})`;
    }
    for (const runId of runIds) {
      const retry = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/retry`,
      });
      expect(retry.statusCode).toBe(409);
      expect(retry.json()).toMatchObject({ error: "plan_mode_disabled" });
    }
    expect((await sql`SELECT COUNT(*)::int count FROM agent_runs`)[0]).toEqual({
      count: 2,
    });
    await sql.end();
    await app.close();
  });
});

describe("execution routing", () => {
  it("keeps the human distinct from @mim across a routed @deeflash conversation", async () => {
    const submitted: Array<Record<string, unknown>> = [];
    const request = personaCatalogFetch(
      [{ id: "sol", root: "model" }],
      false,
      submitted,
    );
    const url = db(),
      app = await buildApp({
        databaseUrl: url,
        fetch: request,
        distPath: "missing-dist",
      }),
      sql = connectTestDatabase(url);
    await sql`UPDATE personas SET handle='deeflash' WHERE id='persona-architect'`;
    await sql`UPDATE personas SET handle='mim' WHERE id='persona-coder'`;
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/user-profile",
          payload: { display_name: "Владимир", handle: "vladimir" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/rooms/demo-room/messages",
          payload: { text: "@deeflash что скажешь о миме?" },
        })
      ).statusCode,
    ).toBe(202);
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    await vi.waitFor(async () =>
      expect(
        (
          await sql`SELECT status FROM agent_runs ORDER BY created_at DESC LIMIT 1`
        )[0]?.status,
      ).toBe("completed"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/rooms/demo-room/messages",
          payload: {
            text: "а ты раньше думал, что Мим — это я?",
            targets: ["deeflash"],
          },
        })
      ).statusCode,
    ).toBe(202);
    await vi.waitFor(() => expect(submitted).toHaveLength(2));
    const firstInput = submitted[0].input as {
        message: string;
        systemPrompt: string;
        history: Array<{ role: string; content: string }>;
      },
      secondInput = submitted[1].input as typeof firstInput;
    expect(firstInput.message).toContain(
      "[Human user: Владимир (@vladimir); recipient: @deeflash]\n@deeflash что скажешь о миме?",
    );
    expect(secondInput.message).toContain(
      "[Human user: Владимир (@vladimir); recipient: @deeflash]\nа ты раньше думал, что Мим — это я?",
    );
    expect(secondInput.systemPrompt).toContain(
      "The human user is Владимир (@vladimir)",
    );
    expect(secondInput.systemPrompt).toContain("- @mim — Coder");
    expect(secondInput.systemPrompt).toContain(
      "Never identify the human user as an agent",
    );
    expect(secondInput.history[0].content).toContain(
      "[Human user: Владимир (@vladimir); recipient: @deeflash]",
    );
    expect(JSON.stringify(submitted[1])).not.toContain(
      "Human user: Mim (@mim)",
    );
    await sql.end();
    await app.close();
  });

  it("routes new runs through the Connector backend", async () => {
    const file = db(),
      request = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "http://connector.test/v2/instances")
          return Response.json(connectorContractFixtures.instances);
        if (url === "http://connector.test/v2/instances/local-hermes/catalog")
          return Response.json(connectorContractFixtures.catalog);
        if (
          url === "http://connector.test/v2/executions" &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(String(init.body)) as { executionId: string };
          return Response.json(
            {
              execution: {
                ...connectorContractFixtures.execution,
                executionId: body.executionId,
                cursor: 2,
                pendingRequests: [],
              },
            },
            { status: 201 },
          );
        }
        const match = url.match(/\/v2\/executions\/([^/]+)\/events\?after=2$/);
        if (match) {
          const executionId = decodeURIComponent(match[1]);
          const events = [
            { ...connectorContractFixtures.textEvent, executionId, cursor: 3 },
            {
              ...connectorContractFixtures.textEvent,
              executionId,
              cursor: 4,
              type: "execution.completed",
              payload: {},
            },
          ];
          return new Response(
            events
              .map(
                (event) =>
                  `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              )
              .join(""),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("{}", { status: 500 });
      });
    const app = await buildApp({
        databaseUrl: file,
        fetch: request,
        distPath: "missing-dist",
      }),
      response = await app.inject({
        method: "POST",
        url: "/api/v1/rooms/demo-room/messages",
        payload: { text: "hello", targets: ["architect"] },
      }),
      runId = response.json().runIds[0] as string,
      sql = connectTestDatabase(file);
    expect(response.statusCode).toBe(202);
    await vi.waitFor(async () =>
      expect(
        (await sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0]?.status,
      ).toBe("completed"),
    );
    expect(
      (
        await sql`SELECT upstream_run_id,connector_execution_id,connector_epoch,connector_cursor FROM agent_runs WHERE id=${runId}`
      )[0],
    ).toEqual({
      upstream_run_id: null,
      connector_execution_id: runId,
      connector_epoch: "epoch-1",
      connector_cursor: "4",
    });
    const timeline = (
        await app.inject("/api/v1/rooms/demo-room/timeline")
      ).json(),
      snapshot = timeline.runs.find((run: { id: string }) => run.id === runId);
    expect(snapshot).toMatchObject({
      harnessInstanceId: "local-hermes",
      harnessType: "hermes",
      modelId: "sol",
      executionProfile: { workflowMode: "work" },
      attemptNumber: 1,
      status: "completed",
      connector: { state: "terminal", checkpointed: true },
    });
    expect(snapshot).not.toHaveProperty("connectorExecutionId");
    expect(snapshot).not.toHaveProperty("connectorEpoch");
    expect(snapshot).not.toHaveProperty("connectorCursor");
    expect(
      request.mock.calls.some(([input]) => String(input).includes("/v1/runs")),
    ).toBe(false);
    await sql.end();
    await app.close();
  });

  it("versions plan.md, approves a version, and injects it only for explicit implementation", async () => {
    const file = db(),
      workspaceRoot = await mkdtemp(join(tmpdir(), "agenvyl-plan-test-")),
      submitted: Array<Record<string, unknown>> = [],
      request = personaCatalogFetch(
        [
          {
            id: "sol",
            root: "model",
            reasoningEfforts: ["low"],
            defaultReasoningEffort: "low",
          },
          {
            id: "qwen",
            root: "builder",
            reasoningEfforts: ["low"],
            defaultReasoningEffort: "low",
          },
        ],
        false,
        submitted,
      ),
      app = await buildApp({
        databaseUrl: file,
        fetch: request,
        workspaceRoot,
        workspaceAgentRoot: workspaceRoot,
        distPath: "missing-dist",
        planModeEnabled: true,
      }),
      sql = connectTestDatabase(file);
    for (const personaId of ["persona-architect", "persona-coder"]) {
      const participant = await app.inject({
        method: "PATCH",
        url: `/api/v1/rooms/demo-room/participants/${personaId}`,
        payload: { reasoning_effort_override: "low" },
      });
      expect(participant.statusCode, participant.body).toBe(200);
      expect(participant.json()).toMatchObject({
        persona: { id: personaId },
        reasoning_effort_override: "low",
      });
    }
    const proposed = await app.inject({
        method: "POST",
        url: "/api/v1/rooms/demo-room/messages",
        payload: {
          text: "@architect propose a plan",
          execution_intent: { kind: "plan" },
        },
      }),
      planRunId = proposed.json().runIds[0] as string;
    expect(proposed.statusCode).toBe(202);
    await vi.waitFor(
      async () =>
        expect(
          (await sql`SELECT status FROM agent_runs WHERE id=${planRunId}`)[0]
            ?.status,
        ).toBe("completed"),
      { timeout: 5_000 },
    );
    expect(
      (
        await sql`SELECT execution_profile FROM agent_runs WHERE id=${planRunId}`
      )[0]?.execution_profile,
    ).toEqual({
      ...workProfile,
      workflowMode: "plan",
      requestedReasoningEffort: "low",
      reasoningEffort: "low",
      reasoningEffortFallback: false,
      reasoningEffortSource: "room_override",
      planEnforcement: "instruction_only",
    });
    const timeline = (
        await app.inject("/api/v1/rooms/demo-room/timeline")
      ).json(),
      current = timeline.executionState.plan.current as {
        entry_id: string;
        version_id: string;
      };
    expect(current).toEqual({
      entry_id: expect.any(String),
      version_id: expect.any(String),
    });
    expect(
      (
        await sql`SELECT version_id,attribution FROM run_artifacts WHERE run_id=${planRunId}`
      )[0],
    ).toEqual({ version_id: current.version_id, attribution: "exact" });
    const approved = await app.inject({
      method: "PUT",
      url: "/api/v1/rooms/demo-room/approved-plan",
      payload: { version_id: current.version_id },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().plan.approved).toEqual(current);
    const ordinary = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload: { text: "@coder inspect only" },
    });
    expect(ordinary.statusCode).toBe(202);
    await vi.waitFor(() => expect(submitted).toHaveLength(2));
    expect(
      (submitted[1].input as { systemPrompt: string }).systemPrompt,
    ).not.toContain("<approved_plan");
    const implementation = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload: {
        text: "@coder implement it",
        execution_intent: {
          kind: "implement",
          approved_plan_version_id: current.version_id,
        },
      },
    });
    expect(implementation.statusCode, implementation.body).toBe(202);
    const workRunId = implementation.json().runIds[0] as string;
    await vi.waitFor(() => expect(submitted).toHaveLength(3));
    expect(
      (
        await sql`SELECT implementation_plan_version_id,execution_profile FROM agent_runs WHERE id=${workRunId}`
      )[0],
    ).toEqual({
      implementation_plan_version_id: current.version_id,
      execution_profile: {
        ...workProfile,
        requestedReasoningEffort: "low",
        reasoningEffort: "low",
        reasoningEffortFallback: false,
        reasoningEffortSource: "room_override",
        implementationPlanVersionId: current.version_id,
      },
    });
    const workInput = submitted[2].input as { systemPrompt: string };
    expect(workInput.systemPrompt).toContain(
      `<approved_plan version_id="${current.version_id}" path="plan.md">`,
    );
    expect(workInput.systemPrompt).toContain(
      "\nprior answer\n</approved_plan>",
    );
    const edited = await app.inject({
      method: "PUT",
      url: "/api/v1/rooms/demo-room/plan",
      payload: {
        content: "# Revised plan",
        expected_version_id: current.version_id,
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().version.id).not.toBe(current.version_id);
    const editedVersion = edited.json().version.id as string;
    const staleEdit = await app.inject({
      method: "PUT",
      url: "/api/v1/rooms/demo-room/plan",
      payload: {
        content: "# Stale overwrite",
        expected_version_id: current.version_id,
      },
    });
    expect(staleEdit.statusCode).toBe(409);
    expect(staleEdit.json()).toMatchObject({ error: "plan_version_conflict" });
    const unchanged = await app.inject({
      method: "PUT",
      url: "/api/v1/rooms/demo-room/plan",
      payload: {
        content: "# Revised plan",
        expected_version_id: editedVersion,
      },
    });
    expect(unchanged.statusCode).toBe(200);
    expect(unchanged.json().version.id).toBe(editedVersion);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/rooms/demo-room/approved-plan",
          payload: { version_id: current.version_id },
        })
      ).statusCode,
    ).toBe(409);
    const changed = (
      await app.inject("/api/v1/rooms/demo-room/timeline")
    ).json().executionState.plan;
    expect(changed.approved.version_id).toBe(current.version_id);
    expect(changed.current.version_id).toBe(edited.json().version.id);
    const cleared = await app.inject({
      method: "DELETE",
      url: "/api/v1/rooms/demo-room/approved-plan",
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().plan.approved).toBeNull();
    await vi.waitFor(async () =>
      expect(
        (await sql`SELECT status FROM agent_runs WHERE id=${workRunId}`)[0]
          ?.status,
      ).toBe("completed"),
    );
    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${workRunId}/retry`,
    });
    expect(retried.statusCode).toBe(202);
    const retryRunId = retried.json().run_id as string;
    await vi.waitFor(() => expect(submitted).toHaveLength(4));
    expect(
      (submitted[3].input as { systemPrompt: string }).systemPrompt,
    ).toContain(
      `<approved_plan version_id="${current.version_id}" path="plan.md">`,
    );
    expect(
      (
        await sql`SELECT implementation_plan_version_id FROM agent_runs WHERE id=${retryRunId}`
      )[0],
    ).toEqual({ implementation_plan_version_id: current.version_id });
    await sql.end();
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
});

describe("harness catalog", () => {
  it("aggregates Connector instances, capabilities, models and execution controls without switching routing", async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/v2/instances"))
        return Response.json(connectorContractFixtures.instances);
      if (url.endsWith("/v2/instances/local-hermes/catalog"))
        return Response.json(connectorContractFixtures.catalog);
      return new Response("{}", { status: 500 });
    });
    const app = await buildApp({
        databaseUrl: db(),
        fetch: request,
        distPath: "missing-dist",
      }),
      response = await app.inject("/api/v1/harnesses");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connectorEpoch: "epoch-1",
      cache:{state:'fresh',refreshedAt:expect.any(String),expiresAt:expect.any(String)},
      instances: [
        {
          ...connectorContractFixtures.instances.instances[0],
          models: connectorContractFixtures.catalog.models,
          controls: connectorContractFixtures.catalog.controls,
          catalogCache:{state:'fresh',refreshedAt:expect.any(String)},
        },
      ],
    });
    expect(request.mock.calls.map(([input]) => String(input))).toEqual([
      "http://connector.test/v2/instances",
      "http://connector.test/v2/instances/local-hermes/catalog",
    ]);
    expect((await app.inject("/api/v1/harnesses")).statusCode).toBe(200);
    expect(request).toHaveBeenCalledTimes(2);
    expect((await app.inject("/api/v1/harnesses?refresh=true")).statusCode).toBe(200);
    expect(request).toHaveBeenCalledTimes(4);
    await app.close();
  });

  it("fails closed with a vendor-neutral error when Connector discovery is unavailable", async () => {
    const app = await buildApp({
        databaseUrl: db(),
        fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
        distPath: "missing-dist",
      }),
      response = await app.inject("/api/v1/harnesses");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "connector_unavailable" });
    await app.close();
  });
});

describe("room management", () => {
  it("creates, lists and updates room participants", async () => {
    const app = await buildApp({
      databaseUrl: db(),
      fetch: vi.fn<typeof fetch>(),
      distPath: "missing-dist",
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      payload: { title: "Новый проект", persona_ids: ["persona-architect"] },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json();
    expect(room).toMatchObject({ title: "Новый проект", participant_count: 1 });
    expect(
      (await app.inject(`/api/v1/personas?room_id=${room.id}`))
        .json()
        .map((persona: { handle: string }) => persona.handle),
    ).toEqual(["architect"]);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/v1/rooms/${room.id}/participants/persona-coder`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject(`/api/v1/personas?room_id=${room.id}`)).json(),
    ).toHaveLength(2);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/rooms/${room.id}`,
          payload: { title: "Переименовано" },
        })
      ).json().title,
    ).toBe("Переименовано");
    await app.close();
  });

  it("moves a room and its conversation to the recoverable trash", async () => {
    const file = db();
    const app = await buildApp({
      databaseUrl: file,
      fetch: vi.fn<typeof fetch>(),
      distPath: "missing-dist",
    });
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/rooms",
        payload: { title: "Удалить меня", persona_ids: ["persona-architect"] },
      })
    ).json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/rooms/${created.id}/messages`,
          payload: { text: "local note" },
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/rooms/${created.id}`,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject("/api/v1/rooms"))
        .json()
        .some((room: { id: string }) => room.id === created.id),
    ).toBe(false);
    const sql = connectTestDatabase(file);
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM room_messages WHERE room_id=${created.id}`
      )[0],
    ).toEqual({ count: 1 });
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM room_participants WHERE room_id=${created.id}`
      )[0],
    ).toEqual({ count: 1 });
    await sql.end();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/rooms/${created.id}/restore`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject("/api/v1/rooms"))
        .json()
        .some((room: { id: string }) => room.id === created.id),
    ).toBe(true);
    await app.close();
  });

  it("deduplicates retried client message ids without a second Connector execution", async () => {
    const file = db(),
      submitted: Array<Record<string, unknown>> = [],
      fetchMock = personaCatalogFetch(
        [{ id: "sol", root: "model" }],
        false,
        submitted,
      ),
      app = await buildApp({
        databaseUrl: file,
        fetch: fetchMock,
        distPath: "missing-dist",
      }),
      messageId = crypto.randomUUID(),
      payload = {
        text: "hello",
        targets: ["architect"],
        message_id: messageId,
      };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload,
    });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(submitted).toHaveLength(1);
    const sql = connectTestDatabase(file);
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM room_messages WHERE id=${messageId}`
      )[0],
    ).toEqual({ count: 1 });
    await sql.end();
    await app.close();
  });
});

describe("persona groups", () => {
  const catalog = {
    object: "list",
    data: [{ id: "sol", root: "anthropic/claude-sonnet-4" }],
  };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(JSON.stringify(catalog), { status: 200 }),
    );
  it("orders groups and releases personas when a group is deleted", async () => {
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    const coding = (
      await app.inject({
        method: "POST",
        url: "/api/v1/persona-groups",
        payload: { name: " Coding " },
      })
    ).json();
    const writing = (
      await app.inject({
        method: "POST",
        url: "/api/v1/persona-groups",
        payload: { name: "Writing" },
      })
    ).json();
    expect(
      (await app.inject("/api/v1/persona-groups"))
        .json()
        .map((group: { name: string }) => group.name),
    ).toEqual(["Coding", "Writing"]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/persona-groups",
          payload: { name: "coding" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/persona-groups/${writing.id}/move`,
          payload: { direction: "up" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject("/api/v1/persona-groups"))
        .json()
        .map((group: { id: string }) => group.id),
    ).toEqual([writing.id, coding.id]);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/personas/persona-architect",
          payload: { group_id: coding.id },
        })
      ).json().group_id,
    ).toBe(coding.id);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/persona-groups/${coding.id}`,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject("/api/v1/personas/persona-architect")).json().group_id,
    ).toBeNull();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/personas/persona-architect",
          payload: { group_id: "missing" },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});

describe("Runs API backend", () => {
  const catalog = {
    object: "list",
    data: [
      { id: "sol", root: "anthropic/claude-sonnet-4" },
      { id: "qwen", root: "qwen/qwen3-coder" },
      { id: "gpt", root: "openai/gpt-5" },
      { id: "deepseek", root: "deepseek/deepseek-r1" },
    ],
  };

  it("locally cancels a persisted active run that is missing from process memory", async () => {
    const file = db();
    const app = await buildApp({
      databaseUrl: file,
      fetch: vi.fn<typeof fetch>(),
      distPath: "missing-dist",
    });
    const sql = connectTestDatabase(file);
    const now = new Date().toISOString(),
      messageId = crypto.randomUUID(),
      runId = crypto.randomUUID();
    await sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at) VALUES(${messageId},'demo-room','orphan',${sql.json(["architect"])},${sql.json([runId])},${now})`;
    await sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,execution_profile,status,created_at,updated_at) VALUES(${runId},${messageId},'demo-room','persona-architect','persona-architect-v1','architect','sol','local-hermes','hermes','sol',${sql.json(workProfile)},'streaming',${now},${now})`;
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/cancel`,
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      status: "cancelled",
      adapter: "persisted_run_recovery",
      upstream_stopped: false,
    });
    expect(
      (await sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0],
    ).toEqual({ status: "cancelled" });
    const statuses = (
      await sql`SELECT payload FROM room_events WHERE room_id='demo-room' AND type='run.status' ORDER BY sequence DESC LIMIT 2`
    )
      .map((row) => (row.payload as { status: string }).status)
      .reverse();
    expect(statuses).toEqual(["stopping", "cancelled"]);
    await sql.end();
    await app.close();
  });

  it("creates a linked retry for a failed run on the latest user message", async () => {
    const file = db(),
      submitted: Array<Record<string, unknown>> = [],
      fetchMock = personaCatalogFetch(
        [{ id: "sol", root: "model" }],
        false,
        submitted,
      ),
      app = await buildApp({
        databaseUrl: file,
        fetch: fetchMock,
        distPath: "missing-dist",
      }),
      sql = connectTestDatabase(file),
      now = new Date().toISOString(),
      messageId = crypto.randomUUID(),
      runId = crypto.randomUUID(),
      context = [{ role: "user", content: "earlier" }];
    await sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at) VALUES(${messageId},'demo-room','retry me',${sql.json(["architect"])},${sql.json([runId])},${now})`;
    await sql`INSERT INTO response_slots(id,message_id,persona_id,created_at) VALUES(${runId},${messageId},'persona-architect',${now})`;
    await sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,execution_profile,status,response_slot_id,context,created_at,updated_at) VALUES(${runId},${messageId},'demo-room','persona-architect','persona-architect-v1','architect','sol','local-hermes','hermes','sol',${sql.json(workProfile)},'failed',${runId},${sql.json(context)},${now},${now})`;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/retry`,
      payload: {},
    });
    expect(response.statusCode).toBe(202);
    const retriedId = response.json().run_id;
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    expect(
      (
        await sql`SELECT retry_of_run_id,context,harness_instance_id,harness_type,model_id,execution_profile FROM agent_runs WHERE id=${retriedId}`
      )[0],
    ).toEqual({
      retry_of_run_id: runId,
      context,
      harness_instance_id: "local-hermes",
      harness_type: "hermes",
      model_id: "sol",
      execution_profile: workProfile,
    });
    expect(
      (await sql`SELECT run_ids FROM room_messages WHERE id=${messageId}`)[0]
        ?.run_ids,
    ).toEqual([runId, retriedId]);
    await sql.end();
    await app.close();
  });

  it("rejects retry after the conversation has advanced", async () => {
    const file = db();
    const app = await buildApp({
      databaseUrl: file,
      fetch: vi.fn<typeof fetch>(),
      distPath: "missing-dist",
    });
    const sql = connectTestDatabase(file);
    const now = new Date(),
      messageId = crypto.randomUUID(),
      runId = crypto.randomUUID();
    await sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at) VALUES(${messageId},'demo-room','old',${sql.json(["architect"])},${sql.json([runId])},${now})`;
    await sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,execution_profile,status,created_at,updated_at) VALUES(${runId},${messageId},'demo-room','persona-architect','persona-architect-v1','architect','sol','local-hermes','hermes','sol',${sql.json(workProfile)},'cancelled',${now},${now})`;
    await sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at) VALUES(${crypto.randomUUID()},'demo-room','newer',${sql.json([])},${sql.json([])},${new Date(now.getTime() + 1)})`;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/retry`,
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("conversation_advanced");
    await sql.end();
    await app.close();
  });

  it("returns current prompt detail and validates model aliases while updating", async () => {
    const fetchMock = personaCatalogFetch(catalog.data);
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    const before = (
      await app.inject("/api/v1/personas/persona-architect")
    ).json();
    expect(before.system_prompt).toContain("архитектор");
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/v1/personas/persona-architect",
      payload: { requested_model: "missing" },
    });
    expect(invalid.statusCode).toBe(400);
    const updated = await app.inject({
      method: "PUT",
      url: "/api/v1/personas/persona-architect",
      payload: {
        name: "Lead Architect",
        requested_model: "gpt",
        system_prompt: "New prompt",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      name: "Lead Architect",
      requested_model: "gpt",
      system_prompt: "New prompt",
    });
    expect(updated.json().current_version_id).not.toBe(
      before.current_version_id,
    );
    await app.close();
  });

  it("renames a persona handle with normalization and conflict validation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify(catalog), { status: 200 }),
      );
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    const renamed = await app.inject({
      method: "PUT",
      url: "/api/v1/personas/persona-architect",
      payload: { handle: " @LEAD_ARCHITECT " },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().handle).toBe("lead_architect");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/personas/persona-architect",
          payload: { handle: "bad handle" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/personas/persona-architect",
          payload: { handle: "coder" },
        })
      ).statusCode,
    ).toBe(409);
    await app.close();
  });

  it("exposes the Hermes catalog and rejects unknown persona model keys before persistence", async () => {
    const fetchMock = personaCatalogFetch(catalog.data);
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    expect((await app.inject("/api/v1/models")).statusCode).toBe(404);
    expect((await app.inject("/api/v1/harnesses")).json()).toMatchObject({
      instances: [{ id: "local-hermes" }],
    });
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/personas/persona-architect",
      payload: { requested_model: "missing" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "unknown_model",
      model: "missing",
    });
    expect(
      (await app.inject("/api/v1/personas/persona-architect")).json()
        .requested_model,
    ).toBe("sol");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("fans out one Connector execution per persona with each selected model key", async () => {
    const submitted: Array<Record<string, unknown>> = [];
    const fetchMock = personaCatalogFetch(catalog.data, false, submitted);
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload: { text: "@architect @coder compare approaches" },
    });

    expect(response.statusCode).toBe(202);
    await vi.waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted.map((run) => run.modelId).sort()).toEqual(["qwen", "sol"]);
    expect(new Set(submitted.map((run) => run.executionId)).size).toBe(2);
    await app.close();
  });

  it("passes the same completed pre-round conversation snapshot to every target", async () => {
    const submitted: Array<Record<string, unknown>> = [];
    const fetchMock = personaCatalogFetch(catalog.data, false, submitted);
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/rooms/demo-room/messages",
          payload: { text: "@architect first" },
        })
      ).statusCode,
    ).toBe(202);
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    await vi.waitFor(async () => {
      const eventCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/events?after="),
      );
      expect(eventCalls).toHaveLength(1);
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/rooms/demo-room/messages",
          payload: { text: "second", targets: ["architect", "coder"] },
        })
      ).statusCode,
    ).toBe(202);
    await vi.waitFor(() => expect(submitted).toHaveLength(3));
    const histories = new Map(
      submitted
        .slice(1)
        .map((run) => [
          run.modelId,
          (run.input as { history: unknown }).history,
        ]),
    );
    expect(histories.get("sol")).toEqual([
      {
        role: "user",
        content:
          "[Human user: User (@user); recipient: @architect]\n@architect first",
      },
      { role: "assistant", content: "prior answer" },
    ]);
    expect(histories.get("qwen")).toEqual([
      {
        role: "user",
        content:
          "[Human user: User (@user); recipient: @architect]\n@architect first",
      },
      {
        role: "user",
        content: expect.stringContaining(
          "[Other agent: @architect]\nprior answer",
        ),
      },
    ]);
    expect(new Set(submitted.map((run) => run.executionId)).size).toBe(3);
    await app.close();
  });
});

describe("persona lifecycle", () => {
  const catalog = {
    object: "list",
    data: [{ id: "sol", root: "anthropic/claude-sonnet-4" }],
  };
  const fetchMock = () => personaCatalogFetch(catalog.data);
  it("validates and creates an initial version plus room membership", async () => {
    const file = db();
    const app = await buildApp({
      databaseUrl: file,
      fetch: fetchMock(),
      distPath: "missing-dist",
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/personas",
          payload: {
            handle: "bad handle",
            name: "Bad",
            room_id: "demo-room",
            requested_model: "sol",
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/personas",
          payload: {
            handle: "new",
            name: "New",
            room_id: "missing",
            requested_model: "sol",
          },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/personas",
          payload: {
            handle: "new",
            name: "New",
            room_id: "demo-room",
            requested_model: "missing",
          },
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/personas",
      payload: {
        handle: " @NEW_PERSONA ",
        name: " New Persona ",
        room_id: "demo-room",
        requested_model: "sol",
        system_prompt: "hello",
      },
    });
    expect(created.statusCode).toBe(201);
    const persona = created.json();
    expect(persona).toMatchObject({
      handle: "new_persona",
      name: "New Persona",
      system_prompt: "hello",
      archived_at: null,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/personas",
          payload: {
            handle: "NEW_PERSONA",
            name: "Duplicate",
            room_id: "demo-room",
            requested_model: "sol",
          },
        })
      ).statusCode,
    ).toBe(409);
    const globalCreated = await app.inject({
      method: "POST",
      url: "/api/v1/personas",
      payload: { handle: "global", name: "Global", requested_model: "sol" },
    });
    expect(globalCreated.statusCode).toBe(201);
    const sql = connectTestDatabase(file);
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM persona_versions WHERE persona_id=${persona.id}`
      )[0],
    ).toEqual({ count: 1 });
    expect(
      (
        await sql`SELECT room_id FROM room_participants WHERE persona_id=${persona.id}`
      )[0],
    ).toEqual({ room_id: "demo-room" });
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM room_participants WHERE persona_id=${globalCreated.json().id}`
      )[0],
    ).toEqual({ count: 0 });
    await sql.end();
    await app.close();
  });
  it("stores an explicit OpenCode agent variant in the persona and immutable versions", async () => {
    const file = db();
    const app = await buildApp({
      databaseUrl: file,
      fetch: personaCatalogFetch(catalog.data, true),
      distPath: "missing-dist",
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/personas",
      payload: {
        handle: "opencode",
        name: "OpenCode",
        harness_instance_id: "local-opencode",
        model_id: "fixture/model",
        agent_variant_id: "build",
        default_reasoning_effort: null,
        group_id: null,
        system_prompt: "Build carefully",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      requested_model: "fixture/model",
      harness_instance_id: "local-opencode",
      harness_type: "opencode",
      model_id: "fixture/model",
      permission_profile_id: null,
      agent_variant_id: "build",
      default_reasoning_effort: null,
      group_id: null,
    });
    const sql = connectTestDatabase(file);
    expect(
      (
        await sql`SELECT requested_model,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id FROM persona_versions WHERE persona_id=${created.json().id}`
      )[0],
    ).toEqual({
      requested_model: "fixture/model",
      harness_instance_id: "local-opencode",
      harness_type: "opencode",
      model_id: "fixture/model",
      permission_profile_id: null,
      agent_variant_id: "build",
    });
    const updated = await app.inject({
      method: "PUT",
      url: `/api/v1/personas/${created.json().id}`,
      payload: {
        agent_variant_id: null,
        default_reasoning_effort: null,
        group_id: null,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({
      requested_model: "fixture/model",
      harness_instance_id: "local-opencode",
      harness_type: "opencode",
      model_id: "fixture/model",
      agent_variant_id: null,
      default_reasoning_effort: null,
      group_id: null,
    });
    expect(
      (
        await sql`SELECT agent_variant_id FROM persona_versions WHERE persona_id=${created.json().id} ORDER BY version`
      ).map((row) => row.agent_variant_id),
    ).toEqual(["build", null]);
    await sql.end();
    await app.close();
  });
  it("rejects unknown or inconsistent harness selections and unavailable discovery", async () => {
    const app = await buildApp({
      databaseUrl: db(),
      fetch: personaCatalogFetch(catalog.data, true),
      distPath: "missing-dist",
    });
    for (const [payload, code] of [
      [
        { harness_instance_id: "missing", model_id: "fixture/model" },
        "unknown_harness_instance",
      ],
      [
        { harness_instance_id: "local-opencode", model_id: "missing" },
        "unknown_model",
      ],
      [
        {
          harness_instance_id: "local-opencode",
          model_id: "fixture/model",
          agent_variant_id: "missing",
        },
        "unknown_agent_variant",
      ],
      [
        {
          harness_instance_id: "local-opencode",
          model_id: "fixture/model",
          requested_model: "sol",
        },
        "harness_selection_conflict",
      ],
    ] as const) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/personas/persona-architect",
        payload,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error).toBe(code);
    }
    await app.close();
    const unavailable = await buildApp({
      databaseUrl: db(),
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}", { status: 503 })),
      distPath: "missing-dist",
    });
    const response = await unavailable.inject({
      method: "PUT",
      url: "/api/v1/personas/persona-architect",
      payload: { requested_model: "sol" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("connector_unavailable");
    await unavailable.close();
  });
  it("allows persona saves from a same-epoch stale catalog while the runtime is unavailable", async () => {
    let runtimeUnavailable = false;
    const baseFetch = personaCatalogFetch(catalog.data);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (
        runtimeUnavailable &&
        String(input).endsWith("/v2/instances")
      )
        return Response.json({
          apiVersion: "v2",
          connectorEpoch: "persona-catalog-epoch",
          instances: [{
            id: "local-hermes",
            type: "hermes",
            status: "unavailable",
            capabilities: ["model_catalog"],
          }],
        });
      return baseFetch(input, init);
    });
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock,
      distPath: "missing-dist",
    });
    expect((await app.inject("/api/v1/harnesses")).statusCode).toBe(200);
    runtimeUnavailable = true;
    const refreshed = await app.inject("/api/v1/harnesses?refresh=true");
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json().instances[0]).toMatchObject({
      status: "unavailable",
      models: [{ id: "sol" }],
      catalogCache: { state: "stale" },
    });
    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/personas/persona-architect",
      payload: { requested_model: "sol" },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await app.close();
  });
  it("archives out of listings and invocation, then restores invocation", async () => {
    const app = await buildApp({
      databaseUrl: db(),
      fetch: fetchMock(),
      distPath: "missing-dist",
    });
    const archived = await app.inject({
      method: "POST",
      url: "/api/v1/personas/persona-architect/archive",
    });
    expect(archived.statusCode).toBe(200);
    expect(
      (await app.inject("/api/v1/personas"))
        .json()
        .some((p: { id: string }) => p.id === "persona-architect"),
    ).toBe(false);
    expect(
      (await app.inject("/api/v1/personas?include_archived=true"))
        .json()
        .find((p: { id: string }) => p.id === "persona-architect").archived_at,
    ).toBeTruthy();
    expect(
      (await app.inject("/api/v1/personas/persona-architect")).statusCode,
    ).toBe(200);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload: { text: "force", targets: ["architect"] },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe("persona_archived");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/personas/persona-architect/restore",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/rooms/demo-room/messages",
          payload: { text: "restored", targets: ["architect"] },
        })
      ).statusCode,
    ).toBe(202);
    await app.close();
  });
  it("deletes unused intrinsic data but preserves every dependency when used", async () => {
    const file = db();
    const app = await buildApp({
      databaseUrl: file,
      fetch: fetchMock(),
      distPath: "missing-dist",
    });
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/personas",
        payload: {
          handle: "unused",
          name: "Unused",
          room_id: "demo-room",
          requested_model: "sol",
        },
      })
    ).json();
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/personas/${created.id}`,
        })
      ).statusCode,
    ).toBe(204);
    const sql = connectTestDatabase(file);
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM personas WHERE id=${created.id}`
      )[0],
    ).toEqual({ count: 0 });
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM persona_versions WHERE persona_id=${created.id}`
      )[0],
    ).toEqual({ count: 0 });
    expect(
      (
        await sql`SELECT COUNT(*)::int count FROM room_participants WHERE persona_id=${created.id}`
      )[0],
    ).toEqual({ count: 0 });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/rooms/demo-room/messages",
          payload: { text: "used", targets: ["architect"] },
        })
      ).statusCode,
    ).toBe(202);
    const blocked = await app.inject({
      method: "DELETE",
      url: "/api/v1/personas/persona-architect",
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: "persona_in_use",
      dependencies: { agent_runs: 1 },
    });
    expect(
      Number(
        (
          await sql`SELECT COUNT(*) count FROM personas WHERE id='persona-architect'`
        )[0]?.count,
      ),
    ).toBeGreaterThan(0);
    expect(
      Number(
        (
          await sql`SELECT COUNT(*) count FROM persona_versions WHERE persona_id='persona-architect'`
        )[0]?.count,
      ),
    ).toBeGreaterThan(0);
    expect(
      Number(
        (
          await sql`SELECT COUNT(*) count FROM room_participants WHERE persona_id='persona-architect'`
        )[0]?.count,
      ),
    ).toBeGreaterThan(0);
    await sql.end();
    await app.close();
  });
});
