ALTER TABLE personas
  ADD COLUMN harness_instance_id text,
  ADD COLUMN harness_type text,
  ADD COLUMN model_id text,
  ADD COLUMN mode_id text;

UPDATE personas
SET harness_instance_id = 'local-hermes',
    harness_type = 'hermes',
    model_id = COALESCE(requested_model, effective_model, 'unknown');

ALTER TABLE personas
  ALTER COLUMN harness_instance_id SET NOT NULL,
  ALTER COLUMN harness_type SET NOT NULL,
  ALTER COLUMN model_id SET NOT NULL,
  ADD CONSTRAINT personas_harness_instance_nonempty CHECK (harness_instance_id <> ''),
  ADD CONSTRAINT personas_harness_type_nonempty CHECK (harness_type <> ''),
  ADD CONSTRAINT personas_model_id_nonempty CHECK (model_id <> '');

ALTER TABLE persona_versions
  ADD COLUMN harness_instance_id text,
  ADD COLUMN harness_type text,
  ADD COLUMN model_id text,
  ADD COLUMN mode_id text;

UPDATE persona_versions version
SET harness_instance_id = persona.harness_instance_id,
    harness_type = persona.harness_type,
    model_id = COALESCE(version.requested_model, persona.model_id)
FROM personas persona
WHERE persona.id = version.persona_id;

ALTER TABLE persona_versions
  ALTER COLUMN harness_instance_id SET NOT NULL,
  ALTER COLUMN harness_type SET NOT NULL,
  ALTER COLUMN model_id SET NOT NULL,
  ADD CONSTRAINT persona_versions_harness_instance_nonempty CHECK (harness_instance_id <> ''),
  ADD CONSTRAINT persona_versions_harness_type_nonempty CHECK (harness_type <> ''),
  ADD CONSTRAINT persona_versions_model_id_nonempty CHECK (model_id <> '');

ALTER TABLE agent_runs
  ADD COLUMN harness_instance_id text,
  ADD COLUMN harness_type text,
  ADD COLUMN model_id text,
  ADD COLUMN mode_id text,
  ADD COLUMN connector_execution_id text,
  ADD COLUMN connector_epoch text,
  ADD COLUMN connector_cursor bigint,
  ADD COLUMN upstream_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE agent_runs
SET harness_instance_id = 'local-hermes',
    harness_type = 'hermes',
    model_id = requested_model;

ALTER TABLE agent_runs
  ALTER COLUMN harness_instance_id SET NOT NULL,
  ALTER COLUMN harness_type SET NOT NULL,
  ALTER COLUMN model_id SET NOT NULL,
  ADD CONSTRAINT agent_runs_harness_instance_nonempty CHECK (harness_instance_id <> ''),
  ADD CONSTRAINT agent_runs_harness_type_nonempty CHECK (harness_type <> ''),
  ADD CONSTRAINT agent_runs_model_id_nonempty CHECK (model_id <> ''),
  ADD CONSTRAINT agent_runs_connector_cursor_nonnegative CHECK (connector_cursor IS NULL OR connector_cursor >= 0),
  ADD CONSTRAINT agent_runs_connector_state_complete CHECK (
    (connector_execution_id IS NULL AND connector_epoch IS NULL AND connector_cursor IS NULL)
    OR
    (connector_execution_id IS NOT NULL AND connector_epoch IS NOT NULL AND connector_cursor IS NOT NULL)
  ),
  ADD CONSTRAINT agent_runs_upstream_metadata_object CHECK (jsonb_typeof(upstream_metadata) = 'object');

UPDATE room_events event
SET payload = event.payload || jsonb_build_object(
  'harnessInstanceId', run.harness_instance_id,
  'harnessType', run.harness_type,
  'modelId', run.model_id,
  'modeId', run.mode_id
)
FROM agent_runs run
WHERE event.type = 'run.created'
  AND event.payload->>'id' = run.id;
