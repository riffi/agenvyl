ALTER TABLE personas
  ADD COLUMN default_reasoning_effort text;

ALTER TABLE persona_versions
  ADD COLUMN default_reasoning_effort text;

ALTER TABLE room_participants
  ADD COLUMN reasoning_effort_override text;

UPDATE room_participants participant
SET reasoning_effort_override = room.reasoning_effort
FROM rooms room
WHERE room.id = participant.room_id
  AND room.reasoning_effort IS NOT NULL;

UPDATE agent_runs
SET execution_profile = execution_profile || jsonb_build_object(
  'reasoningEffortSource',
  CASE
    WHEN execution_profile->>'requestedReasoningEffort' IS NOT NULL THEN 'room_override'
    WHEN execution_profile->>'reasoningEffort' IS NOT NULL THEN 'model_default'
    ELSE 'auto'
  END
);

UPDATE room_events
SET payload = jsonb_set(
  payload,
  '{executionProfile}',
  (payload->'executionProfile') || jsonb_build_object(
    'reasoningEffortSource',
    CASE
      WHEN payload->'executionProfile'->>'requestedReasoningEffort' IS NOT NULL THEN 'room_override'
      WHEN payload->'executionProfile'->>'reasoningEffort' IS NOT NULL THEN 'model_default'
      ELSE 'auto'
    END
  )
)
WHERE type = 'run.created'
  AND payload ? 'executionProfile';
