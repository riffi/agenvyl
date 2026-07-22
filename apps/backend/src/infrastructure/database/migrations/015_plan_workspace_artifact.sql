ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_approved_plan_run_fk;
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_approved_plan_run_fk;

ALTER TABLE rooms
  ADD COLUMN approved_plan_version_id text;

ALTER TABLE agent_runs
  ADD COLUMN implementation_plan_version_id text;

UPDATE agent_runs
SET execution_profile = (execution_profile - 'approvedPlanRunId') ||
  jsonb_build_object('implementationPlanVersionId', NULL);

UPDATE room_events
SET payload = jsonb_set(
  payload,
  '{executionProfile}',
  ((payload->'executionProfile') - 'approvedPlanRunId') ||
    jsonb_build_object('implementationPlanVersionId', NULL)
)
WHERE type = 'run.created' AND payload ? 'executionProfile';

UPDATE room_events
SET payload = payload - 'workflow_mode'
WHERE type = 'room.execution_profile.updated';

UPDATE room_events
SET type = 'room.plan.approval.updated',
    payload = jsonb_build_object('approved', NULL)
WHERE type = 'room.approved_plan.updated';

ALTER TABLE rooms
  DROP COLUMN workflow_mode,
  DROP COLUMN approved_plan_run_id;

ALTER TABLE agent_runs
  DROP COLUMN approved_plan_run_id;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_approved_plan_version_fk FOREIGN KEY (approved_plan_version_id)
  REFERENCES workspace_versions(id) ON DELETE SET NULL;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_implementation_plan_version_fk FOREIGN KEY (implementation_plan_version_id)
  REFERENCES workspace_versions(id) ON DELETE SET NULL;
