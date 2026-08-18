ALTER TABLE room_messages
  DROP CONSTRAINT room_messages_delivery_status_check,
  ADD CONSTRAINT room_messages_delivery_status_check
    CHECK (delivery_status IN ('delivered','started_fresh','queued','dispatching','continued','fallback','applied','failed'));
