ALTER TABLE workspace_versions ADD COLUMN room_id text;
UPDATE workspace_versions v
SET room_id=e.room_id
FROM workspace_entries e
WHERE e.id=v.entry_id;
ALTER TABLE workspace_versions ALTER COLUMN room_id SET NOT NULL;
ALTER TABLE workspace_versions
  ADD CONSTRAINT workspace_versions_room_fk
  FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE;
CREATE INDEX workspace_versions_room_path_created
  ON workspace_versions(room_id,path,created_at DESC);

ALTER TABLE workspace_versions DROP CONSTRAINT workspace_versions_entry_id_fkey;
ALTER TABLE workspace_versions ALTER COLUMN entry_id DROP NOT NULL;
ALTER TABLE workspace_versions
  ADD CONSTRAINT workspace_versions_entry_id_fkey
  FOREIGN KEY(entry_id) REFERENCES workspace_entries(id) ON DELETE SET NULL;

CREATE TABLE workspace_snapshots (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('published','run')),
  base_snapshot_id text REFERENCES workspace_snapshots(id) ON DELETE SET NULL,
  source_run_id text REFERENCES agent_runs(id) ON DELETE SET NULL,
  manifest_sha256 text NOT NULL,
  completeness text NOT NULL CHECK (completeness IN ('complete','incomplete')),
  created_at timestamptz NOT NULL,
  UNIQUE(source_run_id)
);
CREATE INDEX workspace_snapshots_room_created
  ON workspace_snapshots(room_id,created_at DESC);

ALTER TABLE workspace_versions ADD COLUMN origin_snapshot_id text;
ALTER TABLE workspace_versions
  ADD CONSTRAINT workspace_versions_origin_snapshot_fk
  FOREIGN KEY(origin_snapshot_id) REFERENCES workspace_snapshots(id) ON DELETE SET NULL;

CREATE TABLE workspace_snapshot_entries (
  snapshot_id text NOT NULL REFERENCES workspace_snapshots(id) ON DELETE CASCADE,
  path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('file','directory')),
  version_id text REFERENCES workspace_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY(snapshot_id,path),
  CHECK (
    (kind='file' AND version_id IS NOT NULL)
    OR (kind='directory' AND version_id IS NULL)
  )
);
CREATE INDEX workspace_snapshot_entries_version
  ON workspace_snapshot_entries(version_id)
  WHERE version_id IS NOT NULL;

CREATE TABLE run_workspace_results (
  run_id text PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  base_snapshot_id text NOT NULL REFERENCES workspace_snapshots(id) ON DELETE RESTRICT,
  result_snapshot_id text REFERENCES workspace_snapshots(id) ON DELETE SET NULL,
  published_snapshot_id text REFERENCES workspace_snapshots(id) ON DELETE SET NULL,
  capture_status text NOT NULL CHECK (capture_status IN ('preparing','ready','finalizing','complete','incomplete','failed')),
  publish_status text NOT NULL CHECK (publish_status IN ('pending','published','partially_published','not_published','failed')),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count>=0),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE workspace_publish_conflicts (
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  path text NOT NULL,
  base_kind text CHECK (base_kind IN ('file','directory')),
  base_version_id text REFERENCES workspace_versions(id) ON DELETE RESTRICT,
  current_kind text CHECK (current_kind IN ('file','directory')),
  current_version_id text REFERENCES workspace_versions(id) ON DELETE RESTRICT,
  candidate_kind text CHECK (candidate_kind IN ('file','directory')),
  candidate_version_id text REFERENCES workspace_versions(id) ON DELETE RESTRICT,
  resolution text CHECK (resolution IN ('current','candidate','delete')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(run_id,path)
);

ALTER TABLE rooms ADD COLUMN current_workspace_snapshot_id text;
ALTER TABLE rooms
  ADD CONSTRAINT rooms_current_workspace_snapshot_fk
  FOREIGN KEY(current_workspace_snapshot_id) REFERENCES workspace_snapshots(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE rooms ADD COLUMN workspace_materialization_status text
  NOT NULL DEFAULT 'ready'
  CHECK (workspace_materialization_status IN ('pending','ready','failed'));

ALTER TABLE message_attachments ADD COLUMN snapshot_id text;
ALTER TABLE message_attachments
  ADD CONSTRAINT message_attachments_snapshot_fk
  FOREIGN KEY(snapshot_id) REFERENCES workspace_snapshots(id) ON DELETE SET NULL;

INSERT INTO workspace_snapshots(
  id,room_id,kind,base_snapshot_id,source_run_id,manifest_sha256,completeness,created_at
)
SELECT
  'initial-'||r.id,
  r.id,
  'published',
  NULL,
  NULL,
  'initial:'||r.id,
  'complete',
  now()
FROM rooms r;

INSERT INTO workspace_snapshot_entries(snapshot_id,path,kind,version_id)
SELECT
  'initial-'||e.room_id,
  e.path,
  e.kind,
  CASE WHEN e.kind='file' THEN e.current_version_id ELSE NULL END
FROM workspace_entries e
WHERE e.deleted_at IS NULL
  AND e.status='tracked'
  AND (e.kind='directory' OR e.current_version_id IS NOT NULL);

UPDATE workspace_snapshots
SET manifest_sha256=encode(sha256(convert_to('','UTF8')),'hex')
WHERE kind='published' AND id LIKE 'initial-%';

UPDATE workspace_snapshots s
SET manifest_sha256=encoded.digest
FROM (
  SELECT
    snapshot_id,
    encode(
      sha256(
        convert_to(
          COALESCE(
            string_agg(path||chr(31)||kind||chr(31)||COALESCE(version_id,''),E'\n' ORDER BY path),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    ) digest
  FROM workspace_snapshot_entries
  GROUP BY snapshot_id
) encoded
WHERE s.id=encoded.snapshot_id;

UPDATE rooms
SET current_workspace_snapshot_id='initial-'||id;
