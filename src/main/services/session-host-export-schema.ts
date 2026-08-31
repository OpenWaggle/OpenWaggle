export const SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_export_operations (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('jsonl', 'markdown', 'bundle')),
    destination_path TEXT NOT NULL,
    destination_root TEXT,
    resource_source_root TEXT,
    temporary_path TEXT NOT NULL,
    overwrite_existing INTEGER NOT NULL CHECK (overwrite_existing IN (0, 1)),
    branch_scope TEXT NOT NULL CHECK (branch_scope IN ('active-branch', 'tree')),
    branch_id TEXT,
    include_queue_bodies INTEGER NOT NULL CHECK (include_queue_bodies IN (0, 1)),
    resources_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'queued', 'running', 'installing', 'cancelling', 'completed', 'failed', 'cancelled'
    )),
    snapshot_high_water_mark INTEGER,
    snapshot_state_revision INTEGER,
    snapshot_captured_at INTEGER,
    manifest_json TEXT,
    artifact_sha256 TEXT,
    artifact_size_bytes INTEGER CHECK (artifact_size_bytes IS NULL OR artifact_size_bytes >= 0),
    records_written INTEGER NOT NULL DEFAULT 0 CHECK (records_written >= 0),
    resources_written INTEGER NOT NULL DEFAULT 0 CHECK (resources_written >= 0),
    bytes_written INTEGER NOT NULL DEFAULT 0 CHECK (bytes_written >= 0),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
    execution_token TEXT,
    cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_pending IN (0, 1)),
    error_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE (caller_id, session_id, idempotency_key),
    CHECK (
      (snapshot_high_water_mark IS NULL AND snapshot_state_revision IS NULL
        AND snapshot_captured_at IS NULL AND manifest_json IS NULL)
      OR (snapshot_high_water_mark IS NOT NULL AND snapshot_state_revision IS NOT NULL
        AND snapshot_captured_at IS NOT NULL AND manifest_json IS NOT NULL)
    ),
    CHECK (
      (artifact_sha256 IS NULL AND artifact_size_bytes IS NULL)
      OR (artifact_sha256 IS NOT NULL AND artifact_size_bytes IS NOT NULL)
    ),
    CHECK (
      (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
      OR (status IN ('queued', 'running', 'installing', 'cancelling') AND completed_at IS NULL)
    )
  )
  `,
  `
  CREATE INDEX idx_session_export_operations_session_updated
  ON session_export_operations (session_id, updated_at DESC, id DESC)
  `,
  `
  CREATE INDEX idx_session_export_operations_recovery
  ON session_export_operations (cleanup_pending, status, cancel_requested, updated_at, id)
  `,
  `
  CREATE UNIQUE INDEX idx_session_export_operations_active_destination
  ON session_export_operations (destination_path)
  WHERE status IN ('queued', 'running', 'installing', 'cancelling')
  `,
] as const
