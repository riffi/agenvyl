ALTER TABLE workspace_slots ADD COLUMN cache_state text NOT NULL DEFAULT 'invalid'
  CHECK (cache_state IN ('valid','invalid','unsupported'));
ALTER TABLE workspace_slots ADD COLUMN cache_capability_key text;
ALTER TABLE workspace_slots ADD COLUMN cache_fence_mtime_ns text;
ALTER TABLE workspace_slots ADD COLUMN cache_verified_generation bigint;

CREATE TABLE workspace_slot_entries (
  slot_id text NOT NULL REFERENCES workspace_slots(id) ON DELETE CASCADE,
  path text NOT NULL,
  version_id text NOT NULL REFERENCES workspace_versions(id) ON DELETE RESTRICT,
  size_bytes bigint NOT NULL CHECK (size_bytes>=0),
  mtime_ns text NOT NULL,
  ctime_ns text NOT NULL,
  device_id text NOT NULL,
  file_id text NOT NULL,
  PRIMARY KEY(slot_id,path)
);
