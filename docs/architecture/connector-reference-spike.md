# Connector reference-validation spike

**Status:** gate passed on 17 July 2026. This document validates the Agenvyl
Connector contract before its implementation. It is a design input for the
Connector and Core migration, not a public adapter SDK specification.

## Scope and source snapshots

The spike compares the existing Hermes integration with three deliberately
different execution models and one multi-provider implementation reference:

- Hermes Runs API, represented at the time by the direct `HttpHermesAdapter`
  (removed after the Connector-only cutover) and its contract tests;
- OpenCode at commit
  [`3238daa`](https://github.com/anomalyco/opencode/tree/3238daa851409746e15c00824eaa95550544061c),
  plus its generated v2 TypeScript types;
- Codex App Server from the official
  [protocol documentation](https://developers.openai.com/codex/app-server) and
  schemas generated locally by `codex-cli 0.144.5`;
- Open Multi-Agent at commit
  [`42bd057`](https://github.com/open-multi-agent/open-multi-agent/tree/42bd0572c96c29af036db13d2d786c854770ec24);
- Conduit at commit
  [`3d4362e`](https://github.com/conduit-cli/conduit/tree/3d4362e2370a850eaccfd3a0982839c5213c957d).

The source snapshots are recorded because these protocols evolve. Connector
adapters must use generated upstream types where available and pin a tested
upstream version range.

## 1. Lifecycle matrix

| Concern | Hermes | OpenCode | Codex App Server | Normalized Connector meaning |
| --- | --- | --- | --- | --- |
| Execution root | Run ID inside a fresh session | Fresh session; async prompt starts work | Fresh thread plus one turn | One Agenvyl execution per attempt |
| Start | `POST /v1/runs` | create session, then `prompt_async` | `thread/start`, then `turn/start` | Idempotent `start(executionId, input)` |
| Running signal | `run.started` / deltas | `session.status=busy`, message/part events | `turn/started`, item events | `running` plus ordered events |
| Text | assistant/message delta | text part update/delta | `item/agentMessage/delta` | `output.text.delta` |
| Tool lifecycle | `tool.*` | tool parts with call/part IDs | item started/delta/completed | `tool.started`, `tool.updated`, `tool.completed` |
| Approval | approval request and reply endpoint | `permission.asked`; permission reply endpoint | server-initiated approval request and JSON-RPC response | `request.opened(kind=approval)` plus `resolveRequest` |
| Clarification | event exists; verified reply endpoint absent | `question.asked`; reply/reject endpoints | `item/tool/requestUserInput` request/response | `request.opened(kind=clarification)` plus `resolveRequest` |
| Stop | stop endpoint | session abort endpoint | `turn/interrupt` | Idempotent `stop`; terminal `cancelled` |
| Success | `run.completed` | session becomes idle after accepted prompt | `turn/completed(status=completed)` | Exactly one `execution.completed` |
| Failure | `run.failed` | `session.error` or failed message/tool state | `turn/completed(status=failed)` | Exactly one `execution.failed` |
| Reconnect | upstream stream has no Core-owned cursor | event stream reconnects but `/event` has no replay parameter | transport notifications; state is readable by thread/turn | Connector-owned replay cursor and status reconciliation |
| Runtime restart | orphaned run must be reconciled | pending in-memory requests disappear with instance | thread is durable but active turn continuity is not a Connector guarantee | Changed Connector epoch makes active executions fail explicitly |

Open Multi-Agent confirms that a small `run`/`stream` backend seam is enough to
hide different execution engines from an orchestrator. It also demonstrates
that cancellation belongs in the shared lifecycle while permissions are a
capability. Its default ACP auto-approval is intentionally **not** adopted:
Agenvyl always routes interactive decisions to the user.

Conduit confirms two operational choices: harness/provider selection is data,
not a branch in room semantics, and unknown raw events are valuable for
diagnostics. Agenvyl keeps raw vendor data bounded, redacted and outside public
Core contracts.

## 2. Normalized flow examples

The examples name semantic events, not the final serialized wire envelope.
Every event carries Connector `cursor`, `executionId`, `occurredAt`, and
optional adapter-owned opaque metadata.

### Text and tools

```text
execution.accepted
execution.started
output.text.delta*
tool.started(toolId, name)
tool.updated*(toolId, safeSummary)
tool.completed(toolId, outcome)
output.text.delta*
execution.completed
```

`toolId` is stable within the execution. Raw arguments and output are not
logged by default. A deliberately bounded, sanitized summary may enter the
product event stream.

### Approval or clarification

```text
request.opened(requestId, kind, prompt, choices)
execution.status(waiting_for_user)
POST resolveRequest(requestId, resolution)
request.resolved(requestId, outcome)
execution.status(running)
...or execution.failed(code=unsupported_interaction)
```

Resolution outcomes are `answered`, `declined`, `cancelled`, `expired`, or
`superseded`. Repeating the same resolution is successful and returns the
current request snapshot; a different second resolution is a conflict.

An adapter may advertise approval or clarification only when it can both
surface and resolve that request. If an unadvertised interactive request still
arrives, Connector must fail the execution with `unsupported_interaction`.
It must never auto-approve.

### Cancellation

```text
stop(executionId)
execution.status(stopping)
adapter stop/abort/interrupt
execution.cancelled
```

Stopping queued, running, or waiting executions is supported. Repeating stop
after a terminal state returns the existing terminal snapshot. A late upstream
success after cancellation is diagnostic metadata and cannot replace the
Connector terminal state.

### Reconnect

```text
Core persists cursor N with the derived room event
Core reconnects with after=N
Connector replays N+1..current, then follows live events
```

If `N` predates the bounded replay window, Connector returns
`replay_unavailable`. Core must not continue with potentially missing text or
tool events; it reconciles the execution snapshot and terminates the local run
with an explicit recovery error.

### Terminal failure and runtime restart

```text
execution.failed(code, safeMessage)
```

There is exactly one terminal event. Adapter process exit, malformed upstream
events, stream end without a terminal signal, replay loss and unsupported
interaction are failures with stable Connector error codes.

Connector generates an ephemeral `connectorEpoch` at startup. Execution
snapshots include that epoch. If Core observes a changed epoch while it owns a
non-terminal run, that run fails as `connector_restarted`; v1 does not claim
durable execution recovery across Connector restarts.

## 3. Validated contract boundary

### Required adapter lifecycle

Every built-in adapter implements these internal operations:

1. `start` — start one isolated attempt and return upstream identity;
2. `inspect` — return the current normalized execution snapshot;
3. `events` — yield normalized live lifecycle events;
4. `stop` — request cancellation and report whether it was accepted.

The Connector, not the adapter, owns idempotency, event cursor allocation,
bounded replay, terminal-state enforcement, authentication and request routing.

### Optional capability ports

- `modelCatalog`
- `modeCatalog`
- `textStreaming`
- `reasoning`
- `tools`
- `approvals`
- `clarifications`
- `usage`

`resolveRequest` is mandatory when `approvals` or `clarifications` is true.
Native resume, fork, handoff, cost, arbitrary adapter options and dynamic
third-party plugins remain post-v1.

Capability discovery is per configured harness instance. An unhealthy instance
is degraded independently and cannot be selected for a new run; it does not
make healthy instances unavailable.

### Execution snapshot

The normalized snapshot must expose, regardless of transport:

- execution ID and Connector epoch;
- harness instance ID and adapter type;
- `queued`, `running`, `waiting_for_user`, `stopping`, or terminal status;
- latest Connector cursor and earliest replayable cursor;
- zero or more pending normalized requests;
- terminal error code and safe message when failed;
- opaque upstream identity only to Connector internals and diagnostics.

This snapshot is required because request events can be missed during a
disconnect. OpenCode itself recovers pending questions and permissions by
listing pending state; Codex emits `serverRequest/resolved` even when a request
is cleared by completion or interruption. Connector must offer the same
reconciliation property to Core.

## 4. Identity mapping

| Agenvyl identity | Hermes | OpenCode | Codex | Persistence boundary |
| --- | --- | --- | --- | --- |
| Local run ID | Core run ID | Core run ID | Core run ID | Core, immutable |
| Connector execution ID | Same as local run ID | Same | Same | Core and Connector |
| Attempt conversation | session ID | session ID | thread ID | Opaque upstream metadata |
| Active unit | run ID | assistant message / prompt | turn ID | Opaque upstream metadata |
| Stream item | tool/request vendor ID | message ID + part/call ID | item ID | Opaque upstream metadata |
| User request | approval/request ID when present | permission/question request ID | JSON-RPC request ID plus thread/turn/item IDs | Connector request ID plus opaque mapping |

Connector request IDs are generated locally and map to vendor request IDs.
Vendor IDs are never accepted as Core API identifiers. Each retry is a new
execution and a new upstream session/thread; rejected attempts cannot leak into
the next canonical context.

## 5. HTTP plus SSE validation

HTTP plus SSE is sufficient for the Connector boundary even though some
upstreams are bidirectional:

1. Connector sends state changes and `request.opened` over its replayable SSE;
2. Core persists and presents the request to the user;
3. Core resolves it through an authenticated HTTP command;
4. Connector correlates that command with the pending vendor request and emits
   `request.resolved`.

SSE is therefore the ordered observation channel, not a bidirectional socket.
This represents OpenCode's event-plus-reply endpoints and Codex's
server-initiated JSON-RPC requests without exposing either transport to Core.

The preliminary endpoint family remains structurally valid, with these
requirements:

- execution creation is idempotent by Agenvyl run ID;
- status returns pending requests and replay bounds;
- events accept a Connector cursor, never an upstream cursor;
- request resolution and stop are idempotent commands;
- replay loss has an explicit error rather than silent live continuation.

Exact HTTP field names and schemas belong to the Connector implementation
contract tests. They are not duplicated in the adapter SDK.

## 6. Opaque vendor metadata

Connector may retain the following metadata for bounded diagnostics and
correlation:

- upstream session/thread/run/turn/message/item/tool/request IDs;
- upstream event type, event ID and sequence when supplied;
- provider/model identifiers actually selected by the harness;
- safe terminal reason/code and process exit code;
- adapter version, protocol version and Connector epoch;
- retry attempt number and upstream timestamps;
- redacted unknown event shape or a hash/size summary of its payload.

The following must not enter normal logs or the public Core API:

- prompts, canonical history or assistant response bodies;
- credentials, authorization headers or OAuth material;
- raw tool input/output, command output or file contents;
- absolute host paths beyond a sanitized workspace-relative representation.

Raw event retention is opt-in diagnostics, bounded by count/bytes/time, and
redacted before storage. Conduit's raw event view is the product inspiration,
not permission to persist sensitive payloads indiscriminately.

## 7. Decision log

1. **Gate passed.** Hermes, OpenCode and Codex fit one lifecycle without
   vendor branches in Core.
2. **Keep HTTP plus SSE.** Server-initiated requests become normalized pending
   resources resolved by authenticated HTTP commands.
3. **Connector owns cursor and replay.** Upstream event IDs are metadata only;
   neither OpenCode `/event` nor Codex notifications provide the Connector
   replay guarantee required by Core.
4. **Add snapshot reconciliation.** Status includes pending requests and replay
   bounds, not only a scalar state.
5. **Add Connector epoch.** v1 detects restart and fails active executions
   explicitly instead of pretending to resume them.
6. **Separate lifecycle from capabilities.** `start`, `inspect`, `events` and
   `stop` are universal; catalog, interaction and rich event types are optional
   ports.
7. **No auto-approval.** Open Multi-Agent's autonomous ACP default is unsuitable
   for a user-controlled room product.
8. **Keep vendor metadata opaque.** Conduit-style raw diagnostics are useful,
   but bounded and redacted; they do not expand Core contracts.
9. **Do not persist native conversation history as truth.** Every attempt still
   starts from Agenvyl's immutable canonical snapshot.

## Gate result and implementation order

The reference-validation gate is complete. The next implementation increment
may now freeze versioned Connector wire schemas and connector-related database
fields. The recommended order is:

1. add immutable harness instance/model/mode snapshots and execution cursor
   fields through a forward migration;
2. define contract fixtures for lifecycle, replay and requests;
3. create the host-side Connector shell with authentication, instance discovery
   and an in-memory execution registry;
4. move the Hermes adapter behind that contract;
5. add the OpenCode adapter against its generated SDK and run the same contract
   suite.

## Primary references

- [OpenCode server and SSE API](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode event handler at the reviewed commit](https://github.com/anomalyco/opencode/blob/3238daa851409746e15c00824eaa95550544061c/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts)
- [OpenCode permission implementation](https://github.com/anomalyco/opencode/blob/3238daa851409746e15c00824eaa95550544061c/packages/opencode/src/permission/index.ts)
- [OpenCode question implementation](https://github.com/anomalyco/opencode/blob/3238daa851409746e15c00824eaa95550544061c/packages/opencode/src/question/index.ts)
- [Codex App Server protocol](https://developers.openai.com/codex/app-server)
- [Open Multi-Agent external agents](https://github.com/open-multi-agent/open-multi-agent/blob/42bd0572c96c29af036db13d2d786c854770ec24/docs/external-agents.md)
- [Open Multi-Agent `AgentBackend`](https://github.com/open-multi-agent/open-multi-agent/blob/42bd0572c96c29af036db13d2d786c854770ec24/packages/core/src/agent/runner.ts)
- [Conduit normalized agent events](https://github.com/conduit-cli/conduit/blob/3d4362e2370a850eaccfd3a0982839c5213c957d/src/agent/events.rs)
- [Conduit raw event representation](https://github.com/conduit-cli/conduit/blob/3d4362e2370a850eaccfd3a0982839c5213c957d/src/ui/components/raw_events_types.rs)
