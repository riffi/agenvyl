CREATE TABLE workspace_slots (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  persona_id text NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  slot_index smallint NOT NULL CHECK (slot_index BETWEEN 0 AND 1),
  owner_run_id text REFERENCES agent_runs(id) ON DELETE SET NULL,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
  materialized_snapshot_id text REFERENCES workspace_snapshots(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('preparing','ready','running','dirty','quarantined')),
  lease_expires_at timestamptz,
  quarantine_started_at timestamptz,
  quarantine_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(room_id,persona_id,slot_index)
);

CREATE UNIQUE INDEX workspace_slots_owner
  ON workspace_slots(owner_run_id)
  WHERE owner_run_id IS NOT NULL;
CREATE INDEX workspace_slots_available
  ON workspace_slots(room_id,persona_id,slot_index)
  WHERE owner_run_id IS NULL AND state='ready';

ALTER TABLE run_workspace_results
  ADD COLUMN workspace_driver text NOT NULL DEFAULT 'legacy'
  CHECK (workspace_driver IN ('legacy','warm'));
ALTER TABLE run_workspace_results
  ADD COLUMN workspace_slot_id text REFERENCES workspace_slots(id) ON DELETE SET NULL;
ALTER TABLE run_workspace_results ADD COLUMN workspace_slot_generation bigint;
ALTER TABLE run_workspace_results
  ADD CONSTRAINT run_workspace_results_slot_pair
  CHECK (
    (workspace_driver='legacy' AND workspace_slot_id IS NULL AND workspace_slot_generation IS NULL)
    OR
    (workspace_driver='warm' AND workspace_slot_id IS NOT NULL AND workspace_slot_generation IS NOT NULL)
  );
