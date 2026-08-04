CREATE TABLE local_projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  path text NOT NULL,
  path_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX local_projects_name_ci ON local_projects (lower(name));

ALTER TABLE rooms ADD COLUMN project_id text REFERENCES local_projects(id) ON DELETE SET NULL;

ALTER TABLE agent_runs
  ADD COLUMN project_id_snapshot text,
  ADD COLUMN project_name_snapshot text,
  ADD COLUMN project_path_snapshot text,
  ADD COLUMN project_availability text;

ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_project_snapshot_complete CHECK (
  (project_id_snapshot IS NULL AND project_name_snapshot IS NULL AND project_path_snapshot IS NULL AND project_availability IS NULL)
  OR
  (project_id_snapshot IS NOT NULL AND project_name_snapshot IS NOT NULL AND project_path_snapshot IS NOT NULL AND project_availability IN ('available','unavailable','unknown'))
);
