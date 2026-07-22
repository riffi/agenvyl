ALTER TABLE rooms
  ADD COLUMN workflow_mode text NOT NULL DEFAULT 'work',
  ADD COLUMN reasoning_effort text,
  ADD COLUMN approved_plan_run_id text;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_workflow_mode CHECK (workflow_mode IN ('plan', 'work'));

ALTER TABLE personas
  ADD COLUMN permission_profile_id text,
  ADD COLUMN agent_variant_id text;

ALTER TABLE persona_versions
  ADD COLUMN permission_profile_id text,
  ADD COLUMN agent_variant_id text;

ALTER TABLE agent_runs
  ADD COLUMN execution_profile jsonb,
  ADD COLUMN approved_plan_run_id text;

UPDATE agent_runs
SET execution_profile = jsonb_build_object(
  'workflowMode', 'work',
  'requestedReasoningEffort', NULL,
  'reasoningEffort', NULL,
  'reasoningEffortFallback', false,
  'planEnforcement', NULL,
  'permissionProfileId', NULL,
  'agentVariantId', NULL,
  'approvedPlanRunId', NULL
);

UPDATE room_events
SET payload = (payload - 'modeId') || jsonb_build_object(
  'executionProfile', jsonb_build_object(
    'workflowMode', 'work',
    'requestedReasoningEffort', NULL,
    'reasoningEffort', NULL,
    'reasoningEffortFallback', false,
    'planEnforcement', NULL,
    'permissionProfileId', NULL,
    'agentVariantId', NULL,
    'approvedPlanRunId', NULL
  )
)
WHERE type = 'run.created';

ALTER TABLE agent_runs ALTER COLUMN execution_profile SET NOT NULL;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_approved_plan_run_fk FOREIGN KEY (approved_plan_run_id)
  REFERENCES agent_runs(id) ON DELETE SET NULL;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_approved_plan_run_fk FOREIGN KEY (approved_plan_run_id)
  REFERENCES agent_runs(id) ON DELETE SET NULL;

ALTER TABLE personas DROP COLUMN mode_id;
ALTER TABLE persona_versions DROP COLUMN mode_id;
ALTER TABLE agent_runs DROP COLUMN mode_id;
