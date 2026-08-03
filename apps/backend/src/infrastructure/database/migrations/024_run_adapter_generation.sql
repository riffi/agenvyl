ALTER TABLE agent_runs
  ADD COLUMN adapter_generation bigint,
  ADD CONSTRAINT agent_runs_adapter_generation_positive
    CHECK (adapter_generation IS NULL OR adapter_generation > 0);
