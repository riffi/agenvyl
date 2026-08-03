UPDATE room_events
SET payload = jsonb_set(payload, '{tool,status}', '"failed"'::jsonb, false)
WHERE type = 'tool.updated'
  AND payload #>> '{tool,status}' = 'completed'
  AND payload #>> '{tool,detail}' = 'Tool failed';
