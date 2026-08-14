# Rooms and agent runs

A room keeps one conversation, a set of agents, and one shared Workspace
together. Use separate rooms when tasks should have independent histories and
files.

## Create and reopen rooms

New rooms start in Plan as **New room**. Agenvyl names a room automatically
from its first substantive message or attachment. You can rename it at any time
from the sidebar menu. Existing rooms keep their current workflow mode after an
upgrade.

Opening the Agenvyl Web UI without a room link selects the most recently active
room. Activity is based on the newest message in a room, with room creation time
as the fallback. Agenvyl does not track this as a "last viewed" room.

## Address agents

Use `@handle` to start one agent, mention several agents, or use `@all` to
address every agent in the room. A message without an `@mention` is saved in
the conversation but starts no run.

Each addressed agent gets a separate answer card and run history. A retry
creates a new attempt without rewriting the original one.

## Understand Plan parallelism and the Work queue

Agents from one message receive the same conversation as it existed before
that message. They do not receive another agent's answer from the same message.

In Work, Agenvyl runs one agent at a time in the room. Later Work runs see files
left by earlier runs after those runs finish or stop.

In Plan, agents can run in parallel in the same room, up to the global
concurrency limit. They inspect the same live Workspace. Plan should be
read-only, so do not use parallel Plan with an instruction-only harness when
concurrent file writes would be unsafe.

Work is an exclusive queue barrier. It waits for earlier Plan runs to finish,
and later Plan runs wait behind that Work run. This prevents Plan from
overtaking an already queued implementation step.

Different rooms can run at the same time. If two rooms recommend the same
external project, their agents can therefore access that project concurrently.
Use one room or coordinate the work yourself when concurrent writes to that
external folder would be unsafe.

To make one agent evaluate the others' answers, wait for them to finish and
send a follow-up message such as:

```text
@reviewer Compare the completed answers above and recommend the best approach.
```

## Choose Work or Plan

Plan is the default for a new room. It asks agents to inspect and discuss
without implementing and allows parallel responders. The compact mode button
beside the composer shows Plan or Work with its matching icon; select it to
switch modes when you are ready for ordered implementation. The selected mode
stays active for new messages until you switch it again; retry keeps the mode
of the original run.

Before using an MCP integration in Plan, an agent asks you to confirm a bounded
set of operations, even when those operations only read data. The request names
the integration, target, actions, and expected side effects. Confirming allows
that set of MCP calls in the current run without switching to Work. A different
target or materially different action requires another confirmation. If the
agent cannot request structured confirmation, it provides analysis or a draft
without calling the integration.

Native Plan is the strongest read-only control offered by each harness. An
**Instruction-only** badge means the harness receives a planning instruction
but has no technical read-only control. Parallel instruction-only agents can
still write to the same paths. Plan is not an operating-system sandbox.

## Stop and retry

Stopping a queued run prevents it from starting. Stopping an active run asks
the harness to cancel, but a command or file write may finish before the stop
is observed. Changes already made to the Workspace or an external system are
not rolled back.

After a run reaches Completed, Failed, or Cancelled, use its retry action to
create another attempt when retry is available. The original attempt remains
in the timeline.

## Add an instruction to a run

An active Codex or OpenCode run can accept **Add instruction**. Agenvyl
interrupts the current native turn and continues in the same run with the new
instruction. The answer already produced remains visible as an earlier segment
with its author, time, and instruction status.

Add instruction is not a pause or rollback. Existing tool activity, usage,
elapsed timeout, file changes, and external side effects remain part of the
same run. Stop takes priority over a pending instruction.

The selected completed Codex or OpenCode response also offers **Add
instruction** while its native continuation remains available. That action
creates a linked run in the same timeline card and resumes the preserved native
session without replaying the room conversation.

## Continue with files and builds

Read [Workspace and file previews](workspace.md) for shared files, Git-backed
history, and run finalization. Read [App builds and previews](app-builds.md) for
captured static builds and build history.
