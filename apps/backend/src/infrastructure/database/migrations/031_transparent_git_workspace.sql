ALTER TABLE run_workspace_results
  DROP CONSTRAINT run_workspace_results_workspace_driver_check;
ALTER TABLE run_workspace_results
  DROP CONSTRAINT run_workspace_results_slot_pair;

ALTER TABLE run_workspace_results
  ADD CONSTRAINT run_workspace_results_workspace_driver_check
  CHECK (workspace_driver IN ('legacy','warm','direct'));
ALTER TABLE run_workspace_results
  ADD CONSTRAINT run_workspace_results_slot_pair
  CHECK (
    (workspace_driver IN ('legacy','direct') AND workspace_slot_id IS NULL AND workspace_slot_generation IS NULL)
    OR
    (workspace_driver='warm' AND workspace_slot_id IS NOT NULL AND workspace_slot_generation IS NOT NULL)
  );

ALTER TABLE run_workspace_results ADD COLUMN base_head text;
ALTER TABLE run_workspace_results ADD COLUMN result_head text;
ALTER TABLE run_workspace_results ADD COLUMN checkpoint_sha text;
