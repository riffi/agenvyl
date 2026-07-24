ALTER TABLE run_workspace_results
  DROP CONSTRAINT run_workspace_results_publish_status_check;
ALTER TABLE run_workspace_results
  ADD CONSTRAINT run_workspace_results_publish_status_check
  CHECK (publish_status IN ('pending','published','partially_published','not_published','noop','failed'));

ALTER TABLE run_workspace_results
  ADD COLUMN cleanup_status text NOT NULL DEFAULT 'pending'
  CHECK (cleanup_status IN ('pending','complete','quarantined'));
ALTER TABLE run_workspace_results ADD COLUMN cleanup_retry_at timestamptz;
ALTER TABLE run_workspace_results ADD COLUMN cleanup_expires_at timestamptz;
ALTER TABLE run_workspace_results ADD COLUMN cleanup_error text;

UPDATE run_workspace_results
SET cleanup_expires_at=created_at+interval '24 hours';

ALTER TABLE run_workspace_results
  ALTER COLUMN cleanup_expires_at SET NOT NULL;
ALTER TABLE run_workspace_results
  ALTER COLUMN cleanup_expires_at SET DEFAULT (now()+interval '24 hours');

CREATE INDEX run_workspace_results_cleanup_pending
  ON run_workspace_results(cleanup_retry_at,updated_at)
  WHERE cleanup_status='pending';
