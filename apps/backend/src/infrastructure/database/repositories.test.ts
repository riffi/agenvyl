import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { connectTestDatabase, testDatabaseUrl } from "../../testDatabase.js";
import { stableSessionId } from "../../modules/runs/stableSessionId.js";
import { createRepositories } from "./createRepositories.js";
import { Database } from "./Database.js";

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
const profiles = (personas: Array<{ id: string }>) =>
  new Map(personas.map((persona) => [persona.id, workProfile]));

describe("PostgreSQL repositories", () => {
  it("applies migrations and the explicit legacy test seed idempotently", async () => {
    const url = testDatabaseUrl("migrations");
    let p = await createRepositories(url);
    expect(await p.personas.list()).toHaveLength(4);
    expect((await p.rooms.list()).map((r) => r.id)).toContain("demo-room");
    expect(
      (
        await p.database
          .sql`SELECT version FROM schema_migrations ORDER BY version`
      ).map((row) => row.version),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(
      await p.database.sql`SELECT to_regclass('hermes_session_mappings') name`,
    ).toEqual([{ name: null }]);
    expect(
      (await p.personas.list()).every(
        (persona) =>
          persona.group_id === null &&
          persona.harness_instance_id === "local-hermes" &&
          persona.harness_type === "hermes" &&
          persona.model_id === persona.requested_model &&
          persona.permission_profile_id === null &&
          persona.agent_variant_id === null,
      ),
    ).toBe(true);
    await p.database.close();
    p = await createRepositories(url);
    expect(await p.personas.list()).toHaveLength(4);
    await p.database.close();
  });
  it("leaves a fresh production database empty and awaiting setup", async () => {
    const database = await Database.connect(testDatabaseUrl("fresh_setup"));
    expect(await database.sql`SELECT COUNT(*)::int count FROM rooms`).toEqual([
      { count: 0 },
    ]);
    expect(
      await database.sql`SELECT COUNT(*)::int count FROM personas`,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await database.sql`SELECT completed_at FROM installation_state WHERE id=true`
      )[0]?.completed_at,
    ).toBeNull();
    await database.close();
  });
  it("backfills immutable snapshots when upgrading an initial-schema database", async () => {
    const url = testDatabaseUrl("migration_v1"),
      parsed = new URL(url),
      schema = parsed.searchParams.get("schema")!;
    parsed.searchParams.delete("schema");
    const bootstrap = postgres(parsed.toString(), { max: 1 });
    await bootstrap`CREATE SCHEMA ${bootstrap(schema)}`;
    await bootstrap.end();
    const sql = connectTestDatabase(url),
      source = await readFile(
        new URL("./migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
      now = new Date().toISOString();
    await sql`CREATE TABLE schema_migrations (version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
    await sql.unsafe(source);
    await sql`INSERT INTO schema_migrations(version,name)VALUES(1,'initial')`;
    await sql`INSERT INTO personas(id,handle,name,role,color,requested_model,effective_model,current_version_id,created_at,updated_at) VALUES('legacy-persona','legacy','Legacy','','#000','legacy-model',NULL,'legacy-version',${now},${now})`;
    await sql`INSERT INTO persona_versions(id,persona_id,version,requested_model,system_prompt,created_at) VALUES('legacy-version','legacy-persona',1,'legacy-model','legacy prompt',${now})`;
    await sql`INSERT INTO rooms(id,title,created_at,event_sequence) VALUES('legacy-room','Legacy',${now},1)`;
    await sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at) VALUES('legacy-message','legacy-room','question',${sql.json(["legacy"])},${sql.json(["legacy-run"])},${now})`;
    await sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,status,created_at,updated_at) VALUES('legacy-run','legacy-message','legacy-room','legacy-persona','legacy-version','legacy','legacy-model','completed',${now},${now})`;
    await sql`INSERT INTO room_events(id,event_id,room_id,sequence,type,payload,created_at) VALUES('legacy-event','legacy-event','legacy-room',1,'run.created',${sql.json({ id: "legacy-run", messageId: "legacy-message", agent: "legacy", requestedModel: "legacy-model", status: "completed", text: "", tools: [] })},${now})`;
    await sql.end();
    const repositories = await createRepositories(url);
    expect(
      (
        await repositories.database
          .sql`SELECT version FROM schema_migrations ORDER BY version`
      ).map((row) => row.version),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(
      (
        await repositories.database
          .sql`SELECT completed_at,first_room_id FROM installation_state WHERE id=true`
      )[0],
    ).toMatchObject({
      first_room_id: "legacy-room",
      completed_at: expect.any(Date),
    });
    expect(
      (
        await repositories.database
          .sql`SELECT author_profile_id,author_display_name,author_handle FROM room_messages WHERE id='legacy-message'`
      )[0],
    ).toEqual({
      author_profile_id: "local-user",
      author_display_name: "User",
      author_handle: "user",
    });
    expect(
      (
        await repositories.database
          .sql`SELECT harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id FROM personas WHERE id='legacy-persona'`
      )[0],
    ).toEqual({
      harness_instance_id: "local-hermes",
      harness_type: "hermes",
      model_id: "legacy-model",
      permission_profile_id: null,
      agent_variant_id: null,
    });
    expect(
      (
        await repositories.database
          .sql`SELECT harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id FROM persona_versions WHERE id='legacy-version'`
      )[0],
    ).toEqual({
      harness_instance_id: "local-hermes",
      harness_type: "hermes",
      model_id: "legacy-model",
      permission_profile_id: null,
      agent_variant_id: null,
    });
    expect(
      (
        await repositories.database
          .sql`SELECT harness_instance_id,harness_type,model_id,execution_profile,connector_execution_id,connector_epoch,connector_cursor,upstream_metadata FROM agent_runs WHERE id='legacy-run'`
      )[0],
    ).toEqual({
      harness_instance_id: "local-hermes",
      harness_type: "hermes",
      model_id: "legacy-model",
      execution_profile: workProfile,
      connector_execution_id: null,
      connector_epoch: null,
      connector_cursor: null,
      upstream_metadata: {},
    });
    expect(
      (
        await repositories.database
          .sql`SELECT payload FROM room_events WHERE id='legacy-event'`
      )[0]?.payload,
    ).toMatchObject({
      harnessInstanceId: "local-hermes",
      harnessType: "hermes",
      modelId: "legacy-model",
      executionProfile: workProfile,
    });
    expect(
      await repositories.database
        .sql`SELECT to_regclass('persona_groups') name`,
    ).toEqual([{ name: "persona_groups" }]);
    expect(
      await repositories.database
        .sql`SELECT to_regclass('hermes_session_mappings') name`,
    ).toEqual([{ name: null }]);
    await repositories.database.close();
  });
  it("persists a round atomically with immutable harness snapshots", async () => {
    const p = await createRepositories(testDatabaseUrl("round"));
    const persona = (await p.personas.find("persona-architect"))!;
    const round = await p.messages.createRound(
        "demo-room",
        "question",
        [persona],
        profiles([persona]),
      ),
      runId = round.runs[0].id;
    expect(round.events.map((e) => [e.sequence, e.type])).toEqual([
      [1, "message.created"],
      [2, "run.created"],
    ]);
    expect(round.events[1].payload).toMatchObject({
      requestedModel: "sol",
      harnessInstanceId: "local-hermes",
      harnessType: "hermes",
      modelId: "sol",
      executionProfile: workProfile,
    });
    expect(
      (
        await p.database
          .sql`SELECT harness_instance_id,harness_type,model_id,execution_profile,connector_execution_id,connector_epoch,connector_cursor,upstream_metadata FROM agent_runs WHERE id=${runId}`
      )[0],
    ).toEqual({
      harness_instance_id: "local-hermes",
      harness_type: "hermes",
      model_id: "sol",
      execution_profile: workProfile,
      connector_execution_id: null,
      connector_epoch: null,
      connector_cursor: null,
      upstream_metadata: {},
    });
    await expect(
      p.database
        .sql`UPDATE agent_runs SET connector_execution_id='incomplete' WHERE id=${runId}`,
    ).rejects.toMatchObject({ code: "23514" });
    await p.database
      .sql`UPDATE agent_runs SET connector_execution_id='execution-1',connector_epoch='epoch-1',connector_cursor=0,upstream_metadata=${p.database.sql.json({ nativeRunId: "upstream-1" })} WHERE id=${runId}`;
    expect(
      (
        await p.database
          .sql`SELECT connector_execution_id,connector_epoch,connector_cursor,upstream_metadata FROM agent_runs WHERE id=${runId}`
      )[0],
    ).toEqual({
      connector_execution_id: "execution-1",
      connector_epoch: "epoch-1",
      connector_cursor: "0",
      upstream_metadata: { nativeRunId: "upstream-1" },
    });
    expect(await p.roomEvents.replay("demo-room", 1)).toEqual([
      round.events[1],
    ]);
    await p.database.close();
  });
  it("allows only one active Plan run in a room", async () => {
    const p = await createRepositories(testDatabaseUrl("single_plan"));
    const persona = (await p.personas.find("persona-architect"))!,
      planProfile = {
        ...workProfile,
        workflowMode: "plan" as const,
        planEnforcement: "instruction_only" as const,
      },
      planProfiles = new Map([[persona.id, planProfile]]);
    await p.messages.createRound(
      "demo-room",
      "first plan",
      [persona],
      planProfiles,
      undefined,
      [],
      false,
      { kind: "plan" },
    );
    await expect(
      p.messages.createRound(
        "demo-room",
        "second plan",
        [persona],
        planProfiles,
        undefined,
        [],
        false,
        { kind: "plan" },
      ),
    ).rejects.toThrow("plan_run_active");
    await p.database.close();
  });
  it("accepts a Connector cursor and its Core events atomically and idempotently", async () => {
    const p = await createRepositories(testDatabaseUrl("connector_transition")),
      persona = (await p.personas.find("persona-architect"))!,
      round = await p.messages.createRound(
        "demo-room",
        "question",
        [persona],
        profiles([persona]),
      ),
      runId = round.runs[0].id,
      checkpoint = {
        executionId: "execution-1",
        connectorEpoch: "epoch-1",
        cursor: 2,
      };
    await p.runs.bindConnectorExecution(runId, checkpoint);
    const transition = { ...checkpoint, cursor: 3 },
      mapped = [
        {
          type: "run.reasoning.delta" as const,
          payload: { runId, text: "think" },
        },
        { type: "run.delta" as const, payload: { runId, text: "once" } },
      ];
    expect(
      await p.runs.acceptConnectorTransition(runId, transition, mapped),
    ).toMatchObject({ accepted: true });
    expect(
      await p.runs.acceptConnectorTransition(runId, transition, mapped),
    ).toEqual({ accepted: false, roomId: null, events: [] });
    await p.runs.advanceConnectorCheckpoint(runId, checkpoint);
    await expect(
      p.runs.acceptConnectorTransition(
        runId,
        { ...checkpoint, cursor: 5 },
        mapped,
      ),
    ).rejects.toThrow("non-contiguous");
    expect(
      (
        await p.database
          .sql`SELECT connector_cursor,reasoning,text FROM agent_runs WHERE id=${runId}`
      )[0],
    ).toEqual({ connector_cursor: "3", reasoning: "think", text: "once" });
    expect(
      (await p.roomEvents.replay("demo-room", 0)).filter(
        (event) => event.type === "run.delta",
      ),
    ).toHaveLength(1);
    await p.database.close();
  });
  it("durably projects and replays transient upstream state across timeline reload", async () => {
    const p = await createRepositories(testDatabaseUrl("upstream_status")),
      persona = (await p.personas.find("persona-architect"))!,
      round = await p.messages.createRound(
        "demo-room",
        "question",
        [persona],
        profiles([persona]),
      ),
      runId = round.runs[0].id,
      checkpoint = {
        executionId: "execution-1",
        connectorEpoch: "epoch-1",
        cursor: 2,
      };
    await p.runs.bindConnectorExecution(runId, checkpoint);
    await p.runs.acceptConnectorTransition(
      runId,
      { ...checkpoint, cursor: 3 },
      [
        {
          type: "run.upstream_status",
          payload: {
            runId,
            state: "waiting_upstream",
            reason: "awaiting_response",
            retryable: true,
          },
        },
      ],
    );
    expect(
      (await p.rooms.timeline("demo-room", undefined, 10))?.runs[0],
    ).toMatchObject({
      attemptNumber: 1,
      upstreamStatus: {
        state: "waiting_upstream",
        reason: "awaiting_response",
        retryable: true,
      },
      connector: { state: "degraded", checkpointed: true },
    });
    await p.runs.acceptConnectorTransition(
      runId,
      { ...checkpoint, cursor: 4 },
      [
        {
          type: "run.upstream_status",
          payload: {
            runId,
            state: "retrying",
            reason: "provider_unavailable",
            retryable: true,
            attempt: 1,
          },
        },
      ],
    );
    expect(
      (await p.rooms.timeline("demo-room", undefined, 10))?.runs[0]
        .upstreamStatus,
    ).toEqual({
      state: "retrying",
      reason: "provider_unavailable",
      retryable: true,
      attempt: 1,
    });
    expect(
      (await p.roomEvents.replay("demo-room", 2))
        .filter((event) => event.type === "run.upstream_status")
        .map((event) => event.payload),
    ).toMatchObject([
      { runId, state: "waiting_upstream", reason: "awaiting_response" },
      { runId, state: "retrying", reason: "provider_unavailable" },
    ]);
    await p.runs.acceptConnectorTransition(
      runId,
      { ...checkpoint, cursor: 5 },
      [
        {
          type: "run.upstream_status",
          payload: {
            runId,
            state: "recovered",
            reason: "provider_unavailable",
            retryable: false,
            attempt: 1,
          },
        },
      ],
    );
    expect(
      (await p.rooms.timeline("demo-room", undefined, 10))?.runs[0],
    ).toMatchObject({ connector: { state: "active", checkpointed: true } });
    expect(
      (await p.rooms.timeline("demo-room", undefined, 10))?.runs[0]
        .upstreamStatus,
    ).toBeUndefined();
    expect(
      (
        await p.database
          .sql`SELECT status,upstream_status FROM agent_runs WHERE id=${runId}`
      )[0],
    ).toEqual({ status: "queued", upstream_status: null });
    await p.runs.finishNonTerminal(
      runId,
      "failed",
      "Connector is unavailable",
      "connector_unavailable",
    );
    expect(
      (await p.rooms.timeline("demo-room", undefined, 10))?.runs[0],
    ).toMatchObject({
      status: "failed",
      errorCode: "connector_unavailable",
      connector: { state: "unavailable", checkpointed: true },
    });
    await p.database.close();
  });
  it("reconstructs immutable harness snapshots and attempt numbers without the current catalog", async () => {
    const p = await createRepositories(testDatabaseUrl("timeline_attempts"));
    const persona = (await p.personas.create({
        handle: "open",
        name: "OpenCode",
        room_id: "demo-room",
        requested_model: "provider/model-v1",
        harness_instance_id: "local-opencode",
        harness_type: "opencode",
        model_id: "provider/model-v1",
        permission_profile_id: null,
        agent_variant_id: "build",
      }))!,
      openProfile = { ...workProfile, agentVariantId: "build" };
    const round = await p.messages.createRound(
        "demo-room",
        "question",
        [persona],
        new Map([[persona.id, openProfile]]),
      ),
      first = round.runs[0];
    await p.roomEvents.append("demo-room", "run.status", {
      runId: first.id,
      status: "completed",
    });
    await p.personas.update(persona.id, {
      harness_instance_id: "replacement",
      harness_type: "future",
      model_id: "model-v2",
      requested_model: "model-v2",
      permission_profile_id: null,
      agent_variant_id: null,
    });
    const retry = await p.runs.retry(first.id);
    expect(retry).toMatchObject({
      status: "created",
      harnessInstanceId: "local-opencode",
      harnessType: "opencode",
      modelId: "provider/model-v1",
      executionProfile: openProfile,
    });
    const timeline = await p.rooms.timeline("demo-room", undefined, 10),
      runs = timeline!.runs.filter((run) => run.responseSlotId === first.id);
    expect(
      runs.map((run) => ({
        attempt: run.attemptNumber,
        instance: run.harnessInstanceId,
        type: run.harnessType,
        model: run.modelId,
        profile: run.executionProfile,
      })),
    ).toEqual([
      {
        attempt: 1,
        instance: "local-opencode",
        type: "opencode",
        model: "provider/model-v1",
        profile: openProfile,
      },
      {
        attempt: 2,
        instance: "local-opencode",
        type: "opencode",
        model: "provider/model-v1",
        profile: openProfile,
      },
    ]);
    await p.database.close();
  });
  it("keeps the original execution profile when retrying after a persona route change", async () => {
    const p = await createRepositories(testDatabaseUrl("agy_retry_snapshot"));
    const persona = (await p.personas.create({
        handle: "agy",
        name: "AGY",
        room_id: "demo-room",
        requested_model: "gemini",
        harness_instance_id: "local-antigravity",
        harness_type: "antigravity",
        model_id: "gemini",
        permission_profile_id: "plan",
        agent_variant_id: null,
      }))!,
      planProfile = { ...workProfile, permissionProfileId: "plan" };
    const round = await p.messages.createRound(
        "demo-room",
        "retry AGY",
        [persona],
        new Map([[persona.id, planProfile]]),
      ),
      source = round.runs[0];
    await p.database
      .sql`UPDATE agent_runs SET status='failed',error='upstream failed' WHERE id=${source.id}`;
    await p.personas.update(persona.id, {
      permission_profile_id: "accept-edits",
    });
    const retry = await p.runs.retry(source.id);
    expect(retry).toMatchObject({
      status: "created",
      personaVersionId: source.version.id,
      harnessInstanceId: "local-antigravity",
      harnessType: "antigravity",
      modelId: "gemini",
      executionProfile: planProfile,
    });
    expect(
      (
        await p.database
          .sql`SELECT persona_version_id,execution_profile,retry_of_run_id FROM agent_runs WHERE id=${retry.status === "created" ? retry.runId : ""}`
      )[0],
    ).toEqual({
      persona_version_id: source.version.id,
      execution_profile: planProfile,
      retry_of_run_id: source.id,
    });
    await p.database.close();
  });
  it("loads completed timeline text as paginated snapshots instead of token replay", async () => {
    const p = await createRepositories(testDatabaseUrl("timeline"));
    const persona = (await p.personas.find("persona-architect"))!;
    for (const text of ["one", "two", "three"]) {
      const round = await p.messages.createRound(
        "demo-room",
        text,
        [persona],
        profiles([persona]),
      );
      await p.roomEvents.append("demo-room", "run.delta", {
        runId: round.runs[0].id,
        text: `answer ${text}`,
      });
      await p.roomEvents.append("demo-room", "run.status", {
        runId: round.runs[0].id,
        status: "completed",
      });
    }
    const latest = await p.rooms.timeline("demo-room", undefined, 2);
    expect(latest?.messages.map((message) => message.text)).toEqual([
      "two",
      "three",
    ]);
    expect(latest?.runs.map((run) => run.text)).toEqual([
      "answer two",
      "answer three",
    ]);
    expect(latest?.runs.every((run) => run.requestedModel === "sol")).toBe(
      true,
    );
    expect(latest).toMatchObject({ hasMore: true, lastSequence: 12 });
    const older = await p.rooms.timeline("demo-room", latest?.nextCursor, 2);
    expect(older?.messages.map((message) => message.text)).toEqual(["one"]);
    expect(older?.hasMore).toBe(false);
    await p.database.close();
  });
  it("retains tool input and detail across empty completion snapshots", async () => {
    const p = await createRepositories(testDatabaseUrl("tool_input"));
    const persona = (await p.personas.find("persona-architect"))!;
    const round = await p.messages.createRound(
      "demo-room",
      "inspect",
      [persona],
      profiles([persona]),
    );
    const runId = round.runs[0].id;
    await p.roomEvents.append("demo-room", "tool.updated", {
      runId,
      tool: {
        id: "tool-1",
        name: "read_file",
        detail: "src/app.ts",
        input: '{"path":"src/app.ts"}',
        status: "started",
      },
    });
    await p.roomEvents.append("demo-room", "tool.updated", {
      runId,
      tool: {
        id: "tool-1",
        name: "read_file",
        detail: "",
        status: "completed",
      },
    });
    const timeline = await p.rooms.timeline("demo-room", undefined, 10);
    expect(timeline?.runs[0].tools[0]).toMatchObject({
      id: "tool-1",
      input: '{"path":"src/app.ts"}',
      detail: "src/app.ts",
      status: "completed",
    });
    await p.database.close();
  });
  it("restores structured clarification questions after a timeline reload", async () => {
    const p = await createRepositories(testDatabaseUrl("structured_request"));
    const persona = (await p.personas.find("persona-architect"))!,
      round = await p.messages.createRound(
        "demo-room",
        "inspect",
        [persona],
        profiles([persona]),
      ),
      runId = round.runs[0].id,
      questions = Array.from({ length: 4 }, (_, index) => ({
        id: `question-${index + 1}`,
        header: `Q${index + 1}`,
        question: `Question ${index + 1}?`,
        options: [{ label: "Yes", description: "Proceed" }],
        isOther: false,
        isSecret: false,
        ...(index === 1 ? { multiSelect: true } : {}),
      }));
    await p.roomEvents.append("demo-room", "request.created", {
      runId,
      kind: "clarification",
      prompt: "More input",
      questions,
      autoResolutionMs: 60_000,
    });
    const request = (await p.rooms.timeline("demo-room", undefined, 10))
      ?.runs[0].request;
    expect(request).toEqual({
      kind: "clarification",
      prompt: "More input",
      questions,
      autoResolutionMs: 60_000,
    });
    await p.database.close();
  });
  it("distinguishes human snapshots, own assistant answers and peer-agent transport roles", async () => {
    const p = await createRepositories(testDatabaseUrl("history"));
    await p.userProfile.update("Владимир", "vladimir");
    const architect = (await p.personas.find("persona-architect"))!,
      coder = (await p.personas.find("persona-coder"))!;
    const first = await p.messages.createRound(
      "demo-room",
      "question",
      [architect, coder],
      profiles([architect, coder]),
    );
    expect(first.message).toMatchObject({
      text: "question",
      author: { displayName: "Владимир", handle: "vladimir" },
      addressedToAll: false,
    });
    for (const item of first.runs) {
      await p.roomEvents.append("demo-room", "run.delta", {
        runId: item.id,
        text: `${item.persona.handle} answer`,
      });
      await p.roomEvents.append("demo-room", "run.status", {
        runId: item.id,
        status: "completed",
      });
    }
    await p.userProfile.update("Новое имя", "renamed");
    const next = await p.messages.createRound(
      "demo-room",
      "next",
      [architect, coder],
      profiles([architect, coder]),
    );
    expect(next.runs[0].history).toEqual([
      {
        role: "user",
        content:
          "[Human user: Владимир (@vladimir); recipient: @architect, @coder]\nquestion",
      },
      { role: "assistant", content: "architect answer" },
      {
        role: "user",
        content: expect.stringContaining("[Other agent: @coder]\ncoder answer"),
      },
    ]);
    expect(next.runs[0].history[2].content).toContain("not the human user");
    expect(next.runs[1].history[1]).toEqual({
      role: "assistant",
      content: "coder answer",
    });
    expect(next.runs[1].history[2].content).toContain(
      "[Other agent: @architect]",
    );
    expect(
      (await p.messages.find("demo-room", first.message.id))?.author,
    ).toEqual({
      profileId: "local-user",
      displayName: "Владимир",
      handle: "vladimir",
    });
    await p.database.close();
  });
  it("reorders persona groups atomically into contiguous positions", async () => {
    const p = await createRepositories(testDatabaseUrl("group_reorder"));
    const first = await p.personaGroups.create("First"),
      second = await p.personaGroups.create("Second"),
      third = await p.personaGroups.create("Third");
    await expect(p.personaGroups.reorder(first.id, 2)).resolves.toMatchObject({
      id: first.id,
      position: 2,
    });
    expect(
      (await p.personaGroups.list()).map((group) => [
        group.name,
        group.position,
      ]),
    ).toEqual([
      ["Second", 0],
      ["Third", 1],
      ["First", 2],
    ]);
    await expect(p.personaGroups.reorder(second.id, 3)).resolves.toBe(
      "out_of_range",
    );
    expect(third.id).toBeTruthy();
    await p.database.close();
  });
  it("generates stable provider-safe session ids", () => {
    const id = stableSessionId("room", "version");
    expect(id).toHaveLength(51);
    expect(id).toBe(stableSessionId("room", "version"));
  });
});
