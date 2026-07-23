DELETE FROM room_events
WHERE type = 'room.execution_profile.updated';

ALTER TABLE rooms
  DROP COLUMN reasoning_effort;
