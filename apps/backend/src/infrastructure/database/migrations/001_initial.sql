CREATE TABLE personas (
  id text PRIMARY KEY, handle text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL,
  color text NOT NULL, requested_model text, effective_model text, current_version_id text NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, archived_at timestamptz
);
CREATE TABLE persona_versions (
  id text PRIMARY KEY, persona_id text NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  version integer NOT NULL, requested_model text, system_prompt text NOT NULL,
  created_at timestamptz NOT NULL, UNIQUE(persona_id, version)
);
CREATE TABLE rooms (
  id text PRIMARY KEY, title text NOT NULL, created_at timestamptz NOT NULL,
  event_sequence bigint NOT NULL DEFAULT 0
);
CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE room_participants (
  room_id text NOT NULL REFERENCES rooms(id), persona_id text NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  PRIMARY KEY(room_id, persona_id)
);
CREATE TABLE hermes_session_mappings (
  room_id text NOT NULL, persona_version_id text NOT NULL REFERENCES persona_versions(id) ON DELETE CASCADE,
  session_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL, PRIMARY KEY(room_id, persona_version_id)
);
CREATE TABLE room_messages (
  id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id), text text NOT NULL,
  targets jsonb NOT NULL, run_ids jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE response_slots (
  id text PRIMARY KEY, message_id text NOT NULL REFERENCES room_messages(id),
  persona_id text NOT NULL REFERENCES personas(id), selected_run_id text, created_at timestamptz NOT NULL,
  UNIQUE(message_id, persona_id)
);
CREATE TABLE agent_runs (
  id text PRIMARY KEY, message_id text NOT NULL REFERENCES room_messages(id), room_id text NOT NULL REFERENCES rooms(id),
  persona_id text NOT NULL REFERENCES personas(id), persona_version_id text NOT NULL REFERENCES persona_versions(id),
  persona_handle text NOT NULL, requested_model text NOT NULL, status text NOT NULL, text text NOT NULL DEFAULT '',
  upstream_run_id text, error text, retry_of_run_id text REFERENCES agent_runs(id),
  response_slot_id text REFERENCES response_slots(id), context jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
ALTER TABLE response_slots ADD CONSTRAINT response_slots_selected_run_fk
  FOREIGN KEY (selected_run_id) REFERENCES agent_runs(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE room_events (
  id text PRIMARY KEY, event_id text NOT NULL UNIQUE, room_id text NOT NULL REFERENCES rooms(id),
  sequence bigint NOT NULL, type text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE(room_id, sequence)
);
CREATE INDEX room_messages_room_created ON room_messages(room_id, created_at);
CREATE INDEX agent_runs_message ON agent_runs(message_id);
CREATE INDEX room_events_replay ON room_events(room_id, sequence);
