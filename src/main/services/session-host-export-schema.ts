export const SESSION_EXPORT_SELECTED_PATH_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS session_export_selected_paths (
    export_operation_id TEXT PRIMARY KEY
      REFERENCES session_export_operations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    selected_branch_id TEXT NOT NULL,
    selected_head_node_id TEXT NOT NULL REFERENCES session_nodes(id) ON DELETE CASCADE,
    node_mutation_revision INTEGER NOT NULL CHECK (node_mutation_revision >= 0),
    materialized_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS session_export_selected_path_nodes (
    export_operation_id TEXT NOT NULL
      REFERENCES session_export_selected_paths(export_operation_id) ON DELETE CASCADE,
    created_order INTEGER NOT NULL CHECK (created_order >= 0),
    node_id TEXT NOT NULL,
    PRIMARY KEY (export_operation_id, created_order)
  ) WITHOUT ROWID
  `,
  `
  CREATE TRIGGER IF NOT EXISTS session_export_selected_path_terminal_cleanup
  AFTER UPDATE OF status ON session_export_operations
  WHEN NEW.status IN ('completed', 'failed', 'cancelled')
  BEGIN
    DELETE FROM session_export_selected_paths WHERE export_operation_id = NEW.id;
  END
  `,
] as const

export const SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_export_operations (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL,
    origin_profile_id TEXT,
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
    manifest_summary_json TEXT,
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
        AND snapshot_captured_at IS NULL AND manifest_json IS NULL
        AND manifest_summary_json IS NULL)
      OR (snapshot_high_water_mark IS NOT NULL AND snapshot_state_revision IS NOT NULL
        AND snapshot_captured_at IS NOT NULL AND manifest_json IS NOT NULL
        AND manifest_summary_json IS NOT NULL)
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
  CREATE VIEW session_export_operation_summaries AS
  SELECT id, caller_id, origin_profile_id, session_id, idempotency_key, format, destination_path,
    destination_root, resource_source_root, temporary_path, overwrite_existing,
    branch_scope, branch_id, include_queue_bodies, resources_json, status,
    manifest_summary_json AS manifest_json, artifact_sha256, artifact_size_bytes,
    records_written, resources_written, bytes_written, cancel_requested, execution_token,
    cleanup_pending, error_json, created_at, updated_at, completed_at
  FROM session_export_operations
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
  CREATE INDEX idx_session_export_operations_scheduler
  ON session_export_operations (status, cancel_requested, origin_profile_id, created_at, id)
  `,
  `
  CREATE UNIQUE INDEX idx_session_export_operations_active_destination
  ON session_export_operations (destination_path)
  WHERE status IN ('queued', 'running', 'installing', 'cancelling')
  `,
  ...SESSION_EXPORT_SELECTED_PATH_SCHEMA_STATEMENTS,
] as const
