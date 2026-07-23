# Harness capability matrix

This page describes what the harness integrations on the current `main` branch
actually pass through to Agenvyl. It is not a list of everything the upstream
tools or models might support, and it is not a roadmap.

Claude Code is experimental. Treat every entry in its column as part of an
experimental integration, even where the individual capability is supported.

## How to read the matrix

| Status | Meaning |
| --- | --- |
| ✅ Supported | Agenvyl exposes the capability through this integration. |
| ◐ Conditional | Availability depends on the selected model, the upstream catalog, a feature flag, or an explicit opt-in. |
| — Unavailable | Agenvyl does not pass the capability through, even if the upstream tool might provide it. |

A supported integration capability is not a guarantee that every model,
provider, account, or upstream version implements it identically.

## Configuration

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY |
| --- | --- | --- | --- | --- | --- |
| Model catalog and selection | ✅ `/v1/models` | ✅ Provider catalog | ✅ App-server catalog | ✅ CLI catalog | ✅ CLI catalog |
| Plan workflow | ◐ Instruction-only Plan | ◐ Native with an upstream `plan` agent; otherwise instruction-only | ✅ Native Plan | ✅ Native Plan | ✅ Native Plan |
| Work/edit workflow | ✅ Normal execution | ✅ Normal execution | ✅ Native Work | ✅ Native Work | ◐ Requires an `accept-edits` instance |
| Reasoning effort control | — | ◐ Enabled model variants from the upstream catalog | ◐ Model-dependent levels | ◐ Model-dependent levels | — |
| Permission profiles | — | — | ✅ Read only or workspace write; full access is opt-in | ✅ Ask before edits or accept edits | ◐ Plan-only or `accept-edits` instance ceiling |
| Agent variants | — | ◐ Supplied by the upstream agent catalog | — | — | — |

Plan workflow appears only when Agenvyl's experimental Plan Mode is enabled.
For OpenCode, catalog agents marked hidden or as subagents are not offered as
variants. The dedicated `plan` agent is represented as Plan workflow instead
of an agent variant. OpenCode model variants are shown as reasoning effort
choices. A variant can bundle reasoning budget with other model settings;
**Auto** sends no per-run variant and leaves the choice to OpenCode.

## Output and observability

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY |
| --- | --- | --- | --- | --- | --- |
| Incremental answer streaming | ✅ | ✅ | ✅ | ✅ | — Final answer only |
| Separate reasoning display | — | ✅ | ✅ | ✅ | — |
| Tool activity | ✅ | ✅ | ✅ | ✅ | — |
| Token usage | ✅ Basic totals | ✅ Includes available provider details | ✅ Includes available cache/reasoning details | ✅ Includes available cache details | — |
| Upstream retry status | — Unknown retry events are not published | ✅ | — | ✅ | — |

Usage fields vary by provider and model. `✅` means Agenvyl preserves the safe
usage data it receives, not that every token category will always be present.

## Interaction

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY |
| --- | --- | --- | --- | --- | --- |
| Runtime approvals | ✅ | ✅ | ✅ | ✅ | — |
| Structured clarifications | — Fails closed | ✅ Up to four questions, including multi-select | ✅ Up to four questions, including multi-select | ✅ Up to four questions, including multi-select | — Text questions only |

When an integration cannot safely represent an upstream interaction, it does
not guess an answer. Hermes rejects unsupported clarification requests. AGY can
write questions in its final Plan response, but that is not an interactive
structured clarification.

## Lifecycle

| Capability | Hermes | OpenCode | Codex CLI | Claude Code *(experimental)* | AGY |
| --- | --- | --- | --- | --- | --- |
| Cancellation | ✅ | ✅ | ✅ | ✅ | ✅ |
| Concurrent runs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Event replay and Core reattach | ✅ Same Connector epoch | ✅ Same Connector epoch | ✅ Same Connector epoch | ✅ Same Connector epoch | ✅ Same Connector epoch |

Replay and Core reattach work only while the same Connector process epoch is
alive and the requested events remain replayable. If Connector restarts, Core
does not attach an old run to the new process: the run ends fail-closed.

## Important distinctions

- **Reasoning effort** is a configuration control such as low, medium, or high.
  **Reasoning output** is a separate stream that Agenvyl can display. A model
  can expose one without exposing the other.
- A **permission profile** selects a run-wide safety policy before execution.
  A **runtime approval** is a request from the running harness to allow a
  specific action.
- **Native Plan** selects a plan mode implemented by the harness. In
  **instruction-only Plan**, Agenvyl asks a normal run to plan without editing,
  but the harness does not provide a dedicated technical mode.
- **Streaming** publishes answer deltas while the harness is running.
  **Final-only** means Agenvyl receives one answer after the process exits; it
  must not invent intermediate output.

## Connector contract vocabulary

Connector instances advertise exactly eight formal `ConnectorCapability`
values:

- `model_catalog`
- `execution_profiles`
- `text_streaming`
- `reasoning`
- `tools`
- `approvals`
- `clarifications`
- `usage`

The catalog supplies the available models and the concrete execution controls
for an instance. For example, the `execution_profiles` capability alone does
not imply that every harness offers permission profiles, reasoning levels, or
agent variants.

Cancellation, retry visibility, concurrent execution, and replay/reattach are
lifecycle behavior. They are intentionally described in this document but are
not members of the `ConnectorCapability` enum.

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
npm exec vitest run apps/connector/src/adapters/antigravity/adapter.test.ts
```

Opt-in live smoke scripts exist for Hermes, OpenCode, Codex, Claude, and AGY.
They require separately configured tools and credentials and are not run by
the normal local check. See [Testing](../development/testing.md) for the safety
rules. Passing fixtures or a live smoke check does not certify every model or
provider combination.
