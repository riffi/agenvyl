ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS usage JSONB;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_usage_object
  CHECK (usage IS NULL OR jsonb_typeof(usage) = 'object');
