ALTER TABLE agent_runs
  ADD COLUMN upstream_status jsonb;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_upstream_status_object CHECK (
    upstream_status IS NULL OR jsonb_typeof(upstream_status) = 'object'
  );
