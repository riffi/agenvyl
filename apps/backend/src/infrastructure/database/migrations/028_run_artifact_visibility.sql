ALTER TABLE run_artifacts
  ADD COLUMN visibility text NOT NULL DEFAULT 'project'
  CHECK (visibility IN ('project','hidden'));

UPDATE run_artifacts AS artifact
SET visibility='hidden'
FROM workspace_versions AS version
WHERE version.id=artifact.version_id
  AND (
    lower(version.path) ~ '(^|/)(node_modules|dist|build|out|coverage|playwright-report|test-results|ms-playwright|\.playwright|\.git|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.cache|\.turbo|\.parcel-cache|\.next|\.nuxt|\.svelte-kit|\.npm|\.pnpm-store)(/|$)'
    OR lower(version.path) ~ '(^|/)\.yarn/(cache|unplugged)(/|$)'
    OR (
      lower(version.path) ~ '(^|/)\.env(?:\..+)?$'
      AND lower(version.path) !~ '(^|/)\.env\.example$'
    )
    OR lower(version.path) ~ '(^|/)\.ds_store$'
    OR lower(version.path) ~ '\.tsbuildinfo$'
  );

CREATE INDEX run_artifacts_run_visibility_created_idx
  ON run_artifacts(run_id,visibility,created_at);
