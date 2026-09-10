CREATE TABLE workspace_restores (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('run','restore')),
  target_id text NOT NULL,
  fingerprint text NOT NULL,
  original_head text NOT NULL,
  branch_ref text NOT NULL,
  before_head text NOT NULL,
  target_head text NOT NULL,
  result_head text NOT NULL,
  preview_run_id text REFERENCES agent_runs(id) ON DELETE SET NULL,
  output_fingerprint text NOT NULL,
  preserved_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(room_id,request_id)
);
CREATE INDEX workspace_restores_history ON workspace_restores(room_id,created_at DESC);
CREATE UNIQUE INDEX workspace_restore_pending ON workspace_restores(room_id) WHERE status='pending';
