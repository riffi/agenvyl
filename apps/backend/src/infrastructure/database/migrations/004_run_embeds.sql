CREATE TABLE run_embeds (
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image')),
  path text NOT NULL,
  version_id text REFERENCES workspace_versions(id),
  error text CHECK (error IN ('invalid_path','not_found','unsupported_type','limit_exceeded')),
  PRIMARY KEY(run_id,position),
  UNIQUE(run_id,path),
  CHECK ((version_id IS NOT NULL AND error IS NULL) OR (version_id IS NULL AND error IS NOT NULL))
);
CREATE INDEX run_embeds_version ON run_embeds(version_id) WHERE version_id IS NOT NULL;
