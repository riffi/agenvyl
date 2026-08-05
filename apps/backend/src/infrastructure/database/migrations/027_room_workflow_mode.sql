ALTER TABLE rooms
  ADD COLUMN workflow_mode text NOT NULL DEFAULT 'work';

ALTER TABLE rooms
  ADD CONSTRAINT rooms_workflow_mode CHECK (workflow_mode IN ('plan', 'work'));

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_approved_plan_version_fk;

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_implementation_plan_version_fk;

UPDATE agent_runs
SET execution_profile = execution_profile - 'implementationPlanVersionId';

UPDATE room_events
SET payload = jsonb_set(
  payload,
  '{executionProfile}',
  (payload->'executionProfile') - 'implementationPlanVersionId'
)
WHERE type = 'run.created' AND payload ? 'executionProfile';

DELETE FROM room_events
WHERE type = 'room.plan.approval.updated';

ALTER TABLE rooms
  DROP COLUMN approved_plan_version_id;

ALTER TABLE agent_runs
  DROP COLUMN implementation_plan_version_id;
