CREATE TABLE persona_groups (
  id text PRIMARY KEY, name text NOT NULL, position integer NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX persona_groups_name_ci ON persona_groups (lower(name));
CREATE UNIQUE INDEX persona_groups_position ON persona_groups (position);
ALTER TABLE personas ADD COLUMN group_id text REFERENCES persona_groups(id) ON DELETE SET NULL;
CREATE INDEX personas_group_id ON personas(group_id);
