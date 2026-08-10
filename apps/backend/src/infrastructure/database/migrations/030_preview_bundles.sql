CREATE TABLE preview_bundles (
  id text PRIMARY KEY,
  run_id text NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  source_snapshot_id text REFERENCES workspace_snapshots(id) ON DELETE SET NULL,
  entrypoint text NOT NULL,
  source_manifest_sha256 text NOT NULL,
  bundle_sha256 text,
  bundle_size bigint,
  uncompressed_size bigint NOT NULL,
  file_count integer NOT NULL,
  status text NOT NULL CHECK (status IN ('capturing','ready','failed')),
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (status='ready' AND bundle_sha256 IS NOT NULL AND bundle_size IS NOT NULL AND error IS NULL)
    OR status<>'ready'
  )
);

CREATE INDEX preview_bundles_room_created
  ON preview_bundles(room_id,created_at DESC)
  WHERE status='ready';
