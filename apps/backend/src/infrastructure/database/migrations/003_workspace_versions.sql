ALTER TABLE rooms ADD COLUMN deleted_at timestamptz;

CREATE TABLE workspace_entries (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('file','directory')),
  size bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  status text NOT NULL DEFAULT 'tracked' CHECK (status IN ('tracked','oversize')),
  current_version_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  UNIQUE(room_id,path)
);

CREATE TABLE workspace_versions (
  id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES workspace_entries(id) ON DELETE CASCADE,
  path text NOT NULL,
  size bigint NOT NULL,
  mime_type text NOT NULL,
  sha256 text NOT NULL,
  source text NOT NULL CHECK (source IN ('user','agent','external')),
  run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);
ALTER TABLE workspace_entries ADD CONSTRAINT workspace_entries_current_version_fk
  FOREIGN KEY(current_version_id) REFERENCES workspace_versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX workspace_entries_room_path ON workspace_entries(room_id,path) WHERE deleted_at IS NULL;
CREATE INDEX workspace_versions_entry_created ON workspace_versions(entry_id,created_at DESC);
CREATE INDEX workspace_versions_sha ON workspace_versions(sha256);

CREATE TABLE message_attachments (
  message_id text NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  version_id text NOT NULL REFERENCES workspace_versions(id),
  position integer NOT NULL,
  PRIMARY KEY(message_id,version_id), UNIQUE(message_id,position)
);

CREATE TABLE run_artifacts (
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  version_id text NOT NULL REFERENCES workspace_versions(id),
  change text NOT NULL CHECK (change IN ('created','updated','deleted')),
  attribution text NOT NULL CHECK (attribution IN ('exact','shared','external')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(run_id,version_id)
);
