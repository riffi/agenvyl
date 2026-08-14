ALTER TABLE rooms
  ADD COLUMN conversation_routing_mode text NOT NULL DEFAULT 'auto'
    CHECK (conversation_routing_mode IN ('auto','room_context','agent_session'));

ALTER TABLE room_messages
  ADD COLUMN delivery_route text
    CHECK (delivery_route IN ('room_context','agent_session','active_intervention')),
  ADD COLUMN delivery_status text
    CHECK (delivery_status IN ('delivered','queued','dispatching','continued','fallback','applied','failed')),
  ADD COLUMN delivery_agent_handle text,
  ADD COLUMN delivery_anchor_run_id text REFERENCES agent_runs(id),
  ADD COLUMN delivery_run_id text REFERENCES agent_runs(id),
  ADD COLUMN delivery_error text,
  ADD COLUMN delivery_updated_at timestamptz;

CREATE TABLE pending_agent_follow_ups (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  message_id text NOT NULL UNIQUE REFERENCES room_messages(id) ON DELETE CASCADE,
  persona_id text NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  persona_handle text NOT NULL,
  anchor_run_id text NOT NULL REFERENCES agent_runs(id),
  delivery_kind text NOT NULL CHECK (delivery_kind IN ('after_response','apply_now')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dispatching','delivered','failed')),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX pending_agent_follow_ups_one_per_agent
  ON pending_agent_follow_ups(room_id,persona_id)
  WHERE status IN ('queued','dispatching');
CREATE INDEX pending_agent_follow_ups_anchor
  ON pending_agent_follow_ups(anchor_run_id,status);
