CREATE TABLE installation_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  completed_at timestamptz,
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ru')),
  workspace_root text NOT NULL DEFAULT '',
  first_room_id text REFERENCES rooms(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO installation_state(id,completed_at,first_room_id)
SELECT true,
  CASE WHEN EXISTS(SELECT 1 FROM rooms) THEN now() ELSE NULL END,
  (SELECT id FROM rooms WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1);
