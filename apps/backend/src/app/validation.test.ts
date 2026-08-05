import { describe, expect, it, vi } from "vitest";
import { buildApp as buildAppBase, type AppOptions } from "./buildApp.js";
import { testDatabaseUrl } from "../testDatabase.js";

const buildApp = (options: AppOptions = {}) =>
  buildAppBase({
    connectorUrl: "http://connector.test",
    connectorToken: "x".repeat(32),
    ...options,
  });

describe("route validation contracts", () => {
  it("returns a stable envelope for a body type mismatch", async () => {
    const app = await buildApp({
      databaseUrl: testDatabaseUrl("validation"),
      distPath: "missing-dist",
      fetch: vi.fn<typeof fetch>(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      payload: { title: { unexpected: true } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "validation_error",
      message: "Request does not match the API schema",
    });
    await app.close();
  });

  it("accepts the four answers allowed by a structured clarification request", async () => {
    const app = await buildApp({
      databaseUrl: testDatabaseUrl("validation_structured_answers"),
      distPath: "missing-dist",
      fetch: vi.fn<typeof fetch>(),
    });

    const fourAnswers = Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [
        `question-${index + 1}`,
        ["answer"],
      ]),
    );
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/runs/missing/request",
      payload: { answers: fourAnswers },
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/runs/missing/request",
      payload: { answers: { ...fourAnswers, "question-5": ["answer"] } },
    });

    expect(accepted.statusCode).toBe(404);
    expect(accepted.json()).toMatchObject({ error: "not_found" });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: "validation_error" });
    await app.close();
  });

  it("accepts bounded MCP elicitation answers and rejects invalid decline content",async()=>{
    const app=await buildApp({databaseUrl:testDatabaseUrl("validation_elicitation"),distPath:"missing-dist",fetch:vi.fn<typeof fetch>()});
    const accepted=await app.inject({method:"POST",url:"/api/v1/runs/missing/request",payload:{elicitation:{action:"accept",content:{workspace:"main",confirm:true}}}});
    const rejected=await app.inject({method:"POST",url:"/api/v1/runs/missing/request",payload:{elicitation:{action:"decline",content:{unexpected:true}}}});
    expect(accepted.statusCode).toBe(404);expect(accepted.json()).toMatchObject({error:"not_found"});
    expect(rejected.statusCode).toBe(400);expect(rejected.json()).toMatchObject({error:"validation_error"});
    await app.close();
  });

  it("validates persistent room workflow updates and ignores legacy message intents", async () => {
    const app = await buildApp({
      databaseUrl: testDatabaseUrl("validation_workflow_mode"),
      distPath: "missing-dist",
      fetch: vi.fn<typeof fetch>(),
    });
    const validShape = await app.inject({
      method: "PUT",
      url: "/api/v1/rooms/demo-room/workflow-mode",
      payload: { workflow_mode: "plan" },
    });
    const invalidMode = await app.inject({
      method: "PUT",
      url: "/api/v1/rooms/demo-room/workflow-mode",
      payload: { workflow_mode: "implement" },
    });
    const legacyIntent = await app.inject({
      method: "POST",
      url: "/api/v1/rooms/demo-room/messages",
      payload: {
        text: "@architect inspect",
        execution_intent: { kind: "plan" },
      },
    });
    expect(validShape.statusCode).toBe(200);
    expect(invalidMode.statusCode).toBe(400);
    expect(legacyIntent.statusCode).toBe(503);
    await app.close();
  });
});
