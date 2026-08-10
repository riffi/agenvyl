ALTER TABLE preview_bundles ADD COLUMN source_head text;

UPDATE preview_bundles pb
SET source_head=rwr.result_head
FROM run_workspace_results rwr
WHERE rwr.run_id=pb.run_id;

ALTER TABLE preview_bundles DROP COLUMN source_snapshot_id;

DELETE FROM run_workspace_results
WHERE workspace_driver<>'direct' OR base_head IS NULL;

ALTER TABLE run_workspace_results
  DROP CONSTRAINT IF EXISTS run_workspace_results_base_snapshot_id_fkey,
  DROP CONSTRAINT IF EXISTS run_workspace_results_result_snapshot_id_fkey,
  DROP CONSTRAINT IF EXISTS run_workspace_results_published_snapshot_id_fkey,
  DROP CONSTRAINT IF EXISTS run_workspace_results_workspace_slot_id_fkey,
  DROP CONSTRAINT IF EXISTS run_workspace_results_capture_status_check,
  DROP CONSTRAINT IF EXISTS run_workspace_results_publish_status_check,
  DROP CONSTRAINT IF EXISTS run_workspace_results_cleanup_status_check,
  DROP CONSTRAINT IF EXISTS run_workspace_results_workspace_driver_check,
  DROP CONSTRAINT IF EXISTS run_workspace_results_slot_pair;

DROP INDEX IF EXISTS run_workspace_results_cleanup_pending;

ALTER TABLE run_workspace_results
  DROP COLUMN base_snapshot_id,
  DROP COLUMN result_snapshot_id,
  DROP COLUMN published_snapshot_id,
  DROP COLUMN publish_status,
  DROP COLUMN conflict_count,
  DROP COLUMN cleanup_status,
  DROP COLUMN cleanup_retry_at,
  DROP COLUMN cleanup_expires_at,
  DROP COLUMN cleanup_error,
  DROP COLUMN workspace_driver,
  DROP COLUMN workspace_slot_id,
  DROP COLUMN workspace_slot_generation;

ALTER TABLE run_workspace_results
  ALTER COLUMN base_head SET NOT NULL,
  ADD CONSTRAINT run_workspace_results_capture_status_check
    CHECK (capture_status IN ('ready','finalizing','complete','incomplete','failed'));

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_current_workspace_snapshot_fk,
  DROP COLUMN current_workspace_snapshot_id,
  DROP COLUMN workspace_materialization_status;

ALTER TABLE workspace_versions
  DROP CONSTRAINT IF EXISTS workspace_versions_origin_snapshot_fk,
  DROP COLUMN origin_snapshot_id;

ALTER TABLE message_attachments
  DROP CONSTRAINT IF EXISTS message_attachments_snapshot_fk,
  DROP COLUMN snapshot_id;

DROP TABLE workspace_publish_conflicts;
DROP TABLE workspace_slot_entries;
DROP TABLE workspace_slots;
DROP TABLE workspace_snapshot_entries;
DROP TABLE workspace_snapshots;
