CREATE TABLE local_user_profiles (
  id text PRIMARY KEY CHECK (id = 'local-user'),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  handle text NOT NULL CHECK (handle = lower(handle) AND handle <> 'all' AND handle ~ '^[a-z0-9][a-z0-9_-]*$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

INSERT INTO local_user_profiles(id,display_name,handle,created_at,updated_at)
SELECT 'local-user','User',
  CASE WHEN EXISTS(SELECT 1 FROM personas WHERE lower(handle)='user')
    THEN 'user_'||substr(md5(clock_timestamp()::text),1,8) ELSE 'user' END,
  now(),now();

ALTER TABLE room_messages
  ADD COLUMN author_profile_id text REFERENCES local_user_profiles(id),
  ADD COLUMN author_display_name text,
  ADD COLUMN author_handle text,
  ADD COLUMN addressed_to_all boolean NOT NULL DEFAULT false;

UPDATE room_messages m SET
  author_profile_id=p.id,
  author_display_name=p.display_name,
  author_handle=p.handle
FROM local_user_profiles p WHERE p.id='local-user';

ALTER TABLE room_messages
  ALTER COLUMN author_profile_id SET NOT NULL,
  ALTER COLUMN author_display_name SET NOT NULL,
  ALTER COLUMN author_handle SET NOT NULL,
  ALTER COLUMN author_profile_id SET DEFAULT 'local-user';

CREATE OR REPLACE FUNCTION snapshot_local_user_on_message_insert() RETURNS trigger AS $$
DECLARE profile local_user_profiles%ROWTYPE;
BEGIN
  IF NEW.author_display_name IS NULL OR NEW.author_handle IS NULL THEN
    SELECT * INTO STRICT profile FROM local_user_profiles WHERE id='local-user';
    NEW.author_profile_id := profile.id;
    NEW.author_display_name := profile.display_name;
    NEW.author_handle := profile.handle;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER room_messages_human_author_snapshot
  BEFORE INSERT ON room_messages
  FOR EACH ROW EXECUTE FUNCTION snapshot_local_user_on_message_insert();

CREATE OR REPLACE FUNCTION enforce_human_persona_handle_separation() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('agenvyl-human-persona-handles'));
  IF TG_TABLE_NAME='personas' AND EXISTS(
    SELECT 1 FROM local_user_profiles WHERE lower(handle)=lower(NEW.handle)
  ) THEN RAISE EXCEPTION 'persona handle conflicts with local user handle' USING ERRCODE='23505';
  END IF;
  IF TG_TABLE_NAME='local_user_profiles' AND EXISTS(
    SELECT 1 FROM personas WHERE lower(handle)=lower(NEW.handle)
  ) THEN RAISE EXCEPTION 'local user handle conflicts with persona handle' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personas_human_handle_conflict
  BEFORE INSERT OR UPDATE OF handle ON personas
  FOR EACH ROW EXECUTE FUNCTION enforce_human_persona_handle_separation();
CREATE TRIGGER local_user_persona_handle_conflict
  BEFORE INSERT OR UPDATE OF handle ON local_user_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_human_persona_handle_separation();
