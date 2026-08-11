# Harness capability matrix

This page describes what the harness integrations on the current `main` branch
actually pass through to Agenvyl. It is not a list of everything the upstream
tools or models might support, and it is not a roadmap.

Claude Code and Cursor CLI are experimental. Treat every entry in their columns
as part of an experimental integration, even where a capability is supported.

## How to read the matrix

| Status | Meaning |
| --- | --- |
| ✅ Supported | Agenvyl exposes the capability through this integration. |
| ◐ Conditional | Availability depends on the selected model, the upstream catalog, a feature flag, or an explicit opt-in. |
| — Unavailable | Agenvyl does not pass the capability through, even if the upstream tool might provide it. |

A supported integration capability is not a guarantee that every model,
provider, account, or upstream version implements it identically.

## Configuration

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY | Cursor CLI *(experimental)* |
| --- | --- | --- | --- | --- | --- | --- |
| Model catalog and selection | ✅ `/v1/models` | ✅ Provider catalog | ✅ App-server catalog | ✅ CLI catalog | ✅ CLI catalog | ✅ CLI catalog |
| Plan workflow | ◐ Instruction-only Plan | ◐ Native with an upstream `plan` agent; otherwise instruction-only | ✅ Native Plan | ✅ Native Plan | ✅ Native Plan | ✅ Native Plan |
| Work/edit workflow | ✅ Normal execution | ✅ Normal execution | ✅ Native Work | ✅ Native Work | ◐ Requires `accept-edits` | ◐ Requires `accept-edits` |
| Reasoning effort control | — | ◐ Enabled model variants | ◐ Model-dependent levels | ◐ Model-dependent levels | — | — |
| Permission profiles | — | ✅ Standard or Auto-approve | ✅ Read only/workspace write/full access | ✅ Ask before edits or accept edits | ◐ Plan only or accept edits | ◐ Plan only or `--force` |
| Agent variants | — | ◐ Upstream catalog | — | — | — | — |

Plan workflow is always available as a sticky room mode.
For OpenCode, catalog agents marked hidden or as subagents are not offered as
variants. The dedicated `plan` agent is represented as Plan workflow instead
of an agent variant. OpenCode model variants are shown as reasoning effort
choices. A variant can bundle reasoning budget with other model settings;
**Auto** sends no per-run variant and leaves the choice to OpenCode.
OpenCode **Auto-approve** applies only to Work runs. External-directory access
remains bounded by the instance allowlist, independently of the selected
permission profile.

## Output and observability

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY | Cursor CLI *(experimental)* |
| --- | --- | --- | --- | --- | --- | --- |
| Incremental answer streaming | ✅ | ✅ | ✅ | ✅ | — Final answer only | ✅ |
| Separate reasoning display | — | ✅ | ✅ | ✅ | — | — |
| Tool activity | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Token usage | ✅ Basic totals | ✅ Provider details | ✅ Cache/reasoning details | ✅ Cache details | — | — |
| Upstream retry status | — | ✅ | — | ✅ | — | — |

Usage fields vary by provider and model. `✅` means Agenvyl preserves the safe
usage data it receives, not that every token category will always be present.

## Interaction

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY | Cursor CLI *(experimental)* |
| --- | --- | --- | --- | --- | --- | --- |
| Runtime approvals | ✅ | ✅ | ✅ | ✅ | — | — |
| Structured clarifications | — Fails closed | ✅ Up to four questions | ✅ Up to four questions | ✅ Up to four questions | — Text only | — Text only |

When an integration cannot safely represent an upstream interaction, it does
not guess an answer. Hermes rejects unsupported clarification requests. AGY can
write questions in its final Plan response, but that is not an interactive
structured clarification.

## Lifecycle

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY | Cursor CLI *(experimental)* |
| --- | --- | --- | --- | --- | --- | --- |
| Cancellation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Add instruction to active run | — | — | ✅ | — | — | — |
| Concurrent runs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Event replay and Core reattach | ✅ Same epoch | ✅ Same epoch | ✅ Same epoch | ✅ Same epoch | ✅ Same epoch | ✅ Same epoch |

Concurrent-run support means the harness can participate in parallel Plan runs
within one room and in runs from different rooms. Work is an exclusive FIFO
writer: it waits for active Plan runs and blocks later Plan runs until it
finishes.

Replay and Core reattach work only while the same Connector process epoch is
alive and the requested events remain replayable. If Connector restarts, Core
does not attach an old run to the new process: the run ends fail-closed.

Add instruction is a Codex-only cooperative interrupt. It interrupts the current
turn and starts a new turn in the same Codex thread, run, and workspace. It is not a
pause or rollback: a command may finish before the interrupt is observed, and
filesystem or external side effects that already happened remain in place.

## Important distinctions

- **Reasoning effort** is a configuration control such as low, medium, or high.
  **Reasoning output** is a separate stream that Agenvyl can display. A model
  can expose one without exposing the other.
- A **permission profile** selects a run-wide safety policy before execution.
  A **runtime approval** is a request from the running harness to allow a
  specific action.
- **Native Plan** selects a plan mode implemented by the harness. In
  **instruction-only Plan**, Agenvyl asks a normal run to plan without editing,
  but the harness does not provide a dedicated technical mode. Instruction-only
  enforcement cannot technically block external-project writes. Native Plan is
  also not a universal operating-system sandbox.
- **Streaming** publishes answer deltas while the harness is running.
  **Final-only** means Agenvyl receives one answer after the process exits; it
  must not invent intermediate output.

## Connector contract vocabulary

Connector instances advertise exactly nine formal `ConnectorCapability`
values:

- `model_catalog`
- `execution_profiles`
- `text_streaming`
- `reasoning`
- `tools`
- `approvals`
- `clarifications`
- `elicitations`
- `usage`

The catalog supplies the available models and the concrete execution controls
for an instance. For example, the `execution_profiles` capability alone does
not imply that every harness offers permission profiles, reasoning levels, or
agent variants.

Cancellation, retry visibility, concurrent execution, and replay/reattach are
lifecycle behavior. They are intentionally described in this document but are
not members of the `ConnectorCapability` enum.

Add instruction is lifecycle behavior too. A Connector instance advertises it with the
optional `interventionMode: "interrupt_then_continue"` metadata field. Instances
that omit the field are unsupported; Core and the UI do not emulate a fallback.

## Verification and maintenance

This matrix is maintained manually alongside the adapters and their catalogs.
The deterministic fixture and adapter suites are available through:

```bash
npm run test:e2e:hermes
npm run test:e2e:opencode
npm run test:codex
npm run test:e2e:codex
npm run test:claude
npm run test:e2e:claude
npm run test:cursor
npm run test:e2e:cursor
npm exec vitest run apps/connector/src/adapters/antigravity/adapter.test.ts
```

Opt-in live smoke scripts exist for Hermes, OpenCode, Codex, Claude, AGY, and
Cursor CLI.
They require separately configured tools and credentials and are not run by
the normal local check. See [Testing](../development/testing.md) for the safety
rules. Passing fixtures or a live smoke check does not certify every model or
provider combination.
