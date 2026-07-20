# OpenCode transport decision after the ACP spike

**Status:** accepted on 17 July 2026.

**Decision:** the first built-in OpenCode adapter will use OpenCode's native
server API through its generated TypeScript SDK. ACP remains a supported future
adapter-internal transport, but it is not the v1 implementation path and it is
never exposed directly to Core.

## Scope

This is the deliberately limited spike required before implementing the
OpenCode adapter. It evaluates process lifecycle, streaming, tools and
permissions, model and mode discovery, cancellation, reconnect semantics, and
their mapping to the existing Connector execution contract. It does not change
Core, UI, the Connector HTTP/SSE boundary, or production adapter code.

The comparison uses ACP v1, the official
[ACP protocol documentation](https://agentclientprotocol.com/protocol/v1/initialization),
OpenCode's official [ACP support](https://opencode.ai/docs/acp/), and the
current OpenCode [server](https://opencode.ai/docs/server/) and
[SDK](https://opencode.ai/docs/sdk/) documentation. A local black-box probe was
also run against `opencode 1.17.15`.

## What the spike proved

The local probe started `opencode acp` over newline-delimited JSON-RPC stdio
and completed `initialize` followed by `session/new` in the repository
workspace. OpenCode negotiated ACP protocol version 1 and advertised load,
resume, close, fork, list, image, embedded-context, and MCP capabilities. The
new session returned live `model` and `mode` select options; in the probe the
available modes were `build` and `plan`.

This validates that ACP is a real OpenCode integration surface, not merely an
editor-specific wrapper. Most execution primitives map cleanly:

| Connector concern | ACP/OpenCode primitive | Adapter mapping |
| --- | --- | --- |
| Start | `initialize`, `session/new`, `session/prompt` | One fresh ACP session per execution |
| Text stream | `session/update` message chunks | `output.text.delta` |
| Tools | `tool_call` and `tool_call_update` | Normalized tool lifecycle |
| Approval | `session/request_permission` | Pending approval plus explicit resolution |
| Model/mode | Session `configOptions`, then `session/set_config_option` | Model and mode catalog/selection |
| Stop | `session/cancel`; `session/close` for cleanup | Idempotent Connector stop and terminal cancellation |
| Usage | `usage_update` | Optional normalized usage event |

ACP nevertheless does not replace the Connector contract:

- ACP notifications have no Connector-owned durable cursor or bounded replay;
- ACP session load/resume restores conversation state, not the ordered event
  history of an active Agenvyl execution;
- Connector still owns idempotent start/stop, exactly one terminal event,
  pending-request reconciliation, redaction, safe errors, and its runtime epoch;
- ACP stdio makes Connector the supervising client process. Direct Core-to-ACP
  coupling would leak subprocess and vendor lifecycle concerns into Core.

For v1, a Connector or adapter restart therefore keeps the already accepted
rule: active executions fail explicitly. ACP resume is not presented as
durable active-turn recovery.

## Why native OpenCode wins for the first adapter

ACP covers most lifecycle requirements, but its standard `session/prompt`
accepts content blocks rather than Agenvyl's role-aware input contract. In
particular, ACP v1 has no standard first-class field for our per-execution
`systemPrompt`, nor a role-preserving way to seed the canonical alternating
user/assistant history into a fresh session. Flattening those values into one
user message would weaken instruction hierarchy and change conversation
semantics, so it is not an acceptable implicit adapter transformation.

The native OpenCode message API exposes `system`, `model`, `agent`, `noReply`,
and message parts explicitly. It also provides provider/model discovery,
asynchronous prompt submission, session status and abort endpoints, permission
resolution, and an SSE event stream. Those primitives match the validated
adapter contract without inventing an ACP extension or lowering system
instructions to user content.

There are two additional ACP limitations to keep explicit:

- model and mode options are session-scoped, so a catalog probe must create a
  session rather than query a side-effect-free global catalog;
- ACP v1 standardizes permission requests but not Agenvyl's arbitrary
  clarification request shape. An ACP adapter must not advertise
  `clarifications` until both surfacing and resolution pass a black-box test.

These are adapter concerns, not reasons to redesign Core or the Connector API.

## Options considered

### Direct ACP from Core — rejected

This removes the normalization boundary while failing to provide cursor/replay,
runtime epoch, terminal-state enforcement, or HTTP isolation. It also makes
Core an ACP client and subprocess supervisor.

### ACP wrapped inside the OpenCode adapter — deferred

This is structurally sound and is the only acceptable way to adopt ACP later.
The Connector would supervise one ACP subprocess per configured OpenCode
instance, create a fresh session per execution, translate notifications, and
retain all current execution/cursor/epoch guarantees. It is deferred because
canonical system/history input currently requires non-standard behavior.

### Native OpenCode server/SDK inside the adapter — accepted for v1

This preserves the Connector boundary, maps the complete current input
contract, and uses OpenCode's documented catalog, prompt, permission, abort,
status, and event surfaces. The SDK and OpenCode runtime must be pinned to a
tested version range; normalized contract tests remain authoritative so the
transport can be replaced later.

## Implemented adapter constraints

The first OpenCode adapter must:

1. use the generated official OpenCode TypeScript SDK behind the existing
   internal adapter interface;
2. create a fresh OpenCode session for every Connector execution attempt;
3. pass system instructions, canonical history, current message, selected
   model/mode, and the resolved room workspace without flattening roles;
4. map OpenCode events to the existing normalized lifecycle and keep raw
   payloads bounded and redacted;
5. advertise approvals and the supported single-question clarification subset
   only after reply behavior is contract-tested; malformed, batched and
   multi-select questions remain fail-closed;
6. use Connector-owned replay and epoch semantics, never OpenCode event IDs as
   public cursors;
7. keep the transport replaceable: no OpenCode SDK types may cross the adapter
   boundary;
8. normalize native assistant `message.updated` token snapshots by message ID,
   suppress duplicates, and publish only exact non-negative integer counters;
   missing native totals must remain absent and cost must not be inferred.

## ACP reconsideration gate

Reconsider ACP as the OpenCode transport only when a pinned OpenCode/ACP pair
can pass the same adapter contract tests and one of these becomes true:

- ACP standardizes role-aware context seeding and a first-class system prompt;
- OpenCode documents a stable ACP extension with equivalent semantics; or
- Agenvyl intentionally changes its canonical input contract after a separate
  architecture decision.

Until then, ACP is useful evidence that the adapter seam is correctly shaped,
not a reason to bypass it.
