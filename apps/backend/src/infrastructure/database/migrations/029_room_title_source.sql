ALTER TABLE rooms
  ADD COLUMN title_source text NOT NULL DEFAULT 'manual';

ALTER TABLE rooms
  ADD CONSTRAINT rooms_title_source_check
  CHECK (title_source IN ('pending', 'generated', 'manual'));
