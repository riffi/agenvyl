ALTER TABLE room_messages
  ADD COLUMN delivery_transition_reason text
    CHECK (delivery_transition_reason IN ('workflow_mode_changed'));

ALTER TABLE pending_agent_follow_ups
  ADD COLUMN execution_profile_snapshot jsonb,
  ADD COLUMN transition_reason text
    CHECK (transition_reason IN ('workflow_mode_changed'));

UPDATE pending_agent_follow_ups pending
SET execution_profile_snapshot = run.execution_profile
FROM agent_runs run
WHERE run.id = pending.anchor_run_id;

ALTER TABLE pending_agent_follow_ups
  ALTER COLUMN execution_profile_snapshot SET NOT NULL;
