ALTER TABLE agent_runs
  ADD COLUMN execution_deadline_at timestamptz,
  ADD COLUMN error_code text;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_error_code_nonempty CHECK (error_code IS NULL OR error_code <> '');
