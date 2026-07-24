UPDATE room_events
SET payload = payload #- '{persona,role}'
WHERE type = 'room.participant.updated'
  AND payload #> '{persona,role}' IS NOT NULL;

ALTER TABLE personas DROP COLUMN role;
