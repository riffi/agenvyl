ALTER TABLE agent_runs
  ADD COLUMN continued_from_run_id text REFERENCES agent_runs(id),
  ADD COLUMN continuation_instruction_id text,
  ADD COLUMN continuation_instruction text,
  ADD COLUMN continuation_author jsonb,
  ADD COLUMN continuation_retention text CHECK (continuation_retention IN ('explicit_release','provider_managed')),
  ADD COLUMN system_prompt_snapshot text;

CREATE UNIQUE INDEX agent_runs_continuation_instruction
  ON agent_runs(continuation_instruction_id)
  WHERE continuation_instruction_id IS NOT NULL;
CREATE UNIQUE INDEX agent_runs_active_continuation_child
  ON agent_runs(continued_from_run_id)
  WHERE continued_from_run_id IS NOT NULL
    AND status IN ('queued','streaming','finalizing','stopping','waiting_approval','waiting_clarification');

CREATE TABLE run_continuation_chains (
  root_run_id text PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  room_id text NOT NULL REFERENCES rooms(id),
  response_slot_id text NOT NULL REFERENCES response_slots(id),
  head_run_id text NOT NULL REFERENCES agent_runs(id),
  active_child_run_id text REFERENCES agent_runs(id),
  native_handle text NOT NULL,
  harness_instance_id text NOT NULL,
  harness_type text NOT NULL,
  retention text NOT NULL CHECK (retention IN ('explicit_release','provider_managed')),
  eligible_after_sequence bigint NOT NULL,
  active_started_sequence bigint,
  invalidated_sequence bigint,
  release_state text NOT NULL DEFAULT 'retained' CHECK (release_state IN ('retained','pending','released','provider_retained','not_found','release_failed')),
  release_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX run_continuation_chains_cleanup
  ON run_continuation_chains(release_state,room_id)
  WHERE invalidated_sequence IS NOT NULL;

CREATE TABLE run_continuation_ledger (
  intervention_id text PRIMARY KEY,
  source_run_id text NOT NULL REFERENCES agent_runs(id),
  child_run_id text NOT NULL REFERENCES agent_runs(id),
  instruction text NOT NULL,
  author_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
