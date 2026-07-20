ALTER TABLE run_embeds DROP CONSTRAINT run_embeds_error_check;
ALTER TABLE run_embeds ADD CONSTRAINT run_embeds_error_check
  CHECK (error IN ('invalid_path','not_found','unsupported_type','invalid_content','limit_exceeded'));
