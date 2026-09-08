export const SESSION_EXPORT_PATH_CHECKPOINT_STRIDE = 256

export const SESSION_EXPORT_SELECTED_PATH_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS session_export_selected_paths (
    export_operation_id TEXT PRIMARY KEY
      REFERENCES session_export_operations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    selected_branch_id TEXT NOT NULL,
    selected_head_node_id TEXT NOT NULL REFERENCES session_nodes(id) ON DELETE CASCADE,
    node_mutation_revision INTEGER NOT NULL CHECK (node_mutation_revision >= 0),
    captured_at INTEGER NOT NULL
  )
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

export const SESSION_EXPORT_PATH_CHECKPOINT_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS session_export_path_index_states (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    topology_revision INTEGER NOT NULL DEFAULT 0 CHECK (topology_revision >= 0),
    indexed_topology_revision INTEGER NOT NULL DEFAULT 0 CHECK (
      indexed_topology_revision >= 0 AND indexed_topology_revision <= topology_revision
    )
  ) WITHOUT ROWID
  `,
  `
  INSERT OR IGNORE INTO session_export_path_index_states (
    session_id, topology_revision, indexed_topology_revision
  )
  SELECT sessions.id,
    CASE WHEN EXISTS (
      SELECT 1 FROM session_nodes WHERE session_nodes.session_id = sessions.id
    ) THEN 1 ELSE 0 END,
    0
  FROM sessions
  `,
  `
  CREATE TABLE IF NOT EXISTS session_export_path_checkpoints (
    node_id TEXT NOT NULL REFERENCES session_nodes(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    path_depth INTEGER NOT NULL CHECK (
      path_depth >= 0 AND path_depth % ${SESSION_EXPORT_PATH_CHECKPOINT_STRIDE} = 0
    ),
    parent_checkpoint_node_id TEXT NOT NULL,
    jump_checkpoint_node_id TEXT NOT NULL,
    topology_revision INTEGER NOT NULL CHECK (topology_revision >= 0),
    PRIMARY KEY (node_id, topology_revision)
  ) WITHOUT ROWID
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_export_path_checkpoints_session_revision
  ON session_export_path_checkpoints (session_id, topology_revision, path_depth, node_id)
  `,
  `
  CREATE VIEW IF NOT EXISTS session_export_path_checkpoint_build_input AS
  SELECT id AS node_id, session_id, parent_id, path_depth, 0 AS topology_revision
  FROM session_nodes
  WHERE 0
  `,
  `
  CREATE TRIGGER IF NOT EXISTS session_export_path_checkpoint_build
  INSTEAD OF INSERT ON session_export_path_checkpoint_build_input
  WHEN NEW.path_depth >= 0
    AND NEW.path_depth % ${SESSION_EXPORT_PATH_CHECKPOINT_STRIDE} = 0
  BEGIN
    INSERT OR REPLACE INTO session_export_path_checkpoints (
      node_id, session_id, path_depth, parent_checkpoint_node_id,
      jump_checkpoint_node_id, topology_revision
    )
    SELECT NEW.node_id, NEW.session_id, NEW.path_depth, NEW.node_id, NEW.node_id,
      NEW.topology_revision
    FROM session_export_path_index_states AS state
    WHERE state.session_id = NEW.session_id
      AND state.topology_revision = NEW.topology_revision
      AND NEW.path_depth = 0;

    INSERT OR REPLACE INTO session_export_path_checkpoints (
      node_id, session_id, path_depth, parent_checkpoint_node_id,
      jump_checkpoint_node_id, topology_revision
    )
    WITH RECURSIVE ancestry(id, parent_id, path_depth, steps) AS (
      SELECT NEW.node_id, NEW.parent_id, NEW.path_depth, 0
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.path_depth, ancestry.steps + 1
      FROM session_nodes AS parent
      JOIN ancestry ON ancestry.parent_id = parent.id
      WHERE parent.session_id = NEW.session_id
        AND ancestry.steps < ${SESSION_EXPORT_PATH_CHECKPOINT_STRIDE}
    ),
    parent_checkpoint(node_id) AS (
      SELECT id
      FROM ancestry
      WHERE path_depth = NEW.path_depth - ${SESSION_EXPORT_PATH_CHECKPOINT_STRIDE}
        AND steps = ${SESSION_EXPORT_PATH_CHECKPOINT_STRIDE}
      LIMIT 1
    )
    SELECT NEW.node_id, NEW.session_id, NEW.path_depth, parent.node_id,
      CASE
        WHEN parent.path_depth - parent_jump.path_depth =
          parent_jump.path_depth - parent_jump_jump.path_depth
          THEN parent_jump_jump.node_id
        ELSE parent.node_id
      END,
      NEW.topology_revision
    FROM parent_checkpoint
    JOIN session_export_path_index_states AS state
      ON state.session_id = NEW.session_id
      AND state.topology_revision = NEW.topology_revision
    JOIN session_export_path_checkpoints AS parent
      ON parent.node_id = parent_checkpoint.node_id
      AND parent.session_id = NEW.session_id
      AND parent.topology_revision = NEW.topology_revision
    JOIN session_export_path_checkpoints AS parent_jump
      ON parent_jump.node_id = parent.jump_checkpoint_node_id
      AND parent_jump.session_id = NEW.session_id
      AND parent_jump.topology_revision = NEW.topology_revision
    JOIN session_export_path_checkpoints AS parent_jump_jump
      ON parent_jump_jump.node_id = parent_jump.jump_checkpoint_node_id
      AND parent_jump_jump.session_id = NEW.session_id
      AND parent_jump_jump.topology_revision = NEW.topology_revision
    WHERE NEW.path_depth > 0;
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS session_export_path_index_session_insert
  AFTER INSERT ON sessions
  BEGIN
    INSERT OR IGNORE INTO session_export_path_index_states (
      session_id, topology_revision, indexed_topology_revision
    ) VALUES (NEW.id, 0, 0);
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS session_export_path_checkpoint_node_insert
  AFTER INSERT ON session_nodes
  WHEN NEW.path_depth >= 0
    AND NEW.path_depth % ${SESSION_EXPORT_PATH_CHECKPOINT_STRIDE} = 0
  BEGIN
    INSERT INTO session_export_path_checkpoint_build_input (
      node_id, session_id, parent_id, path_depth, topology_revision
    )
    SELECT NEW.id, NEW.session_id, NEW.parent_id, NEW.path_depth, state.topology_revision
    FROM session_export_path_index_states AS state
    WHERE state.session_id = NEW.session_id
      AND state.indexed_topology_revision = state.topology_revision;
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS session_export_path_index_topology_update
  AFTER UPDATE OF session_id, parent_id, path_depth ON session_nodes
  WHEN OLD.session_id <> NEW.session_id
    OR OLD.parent_id IS NOT NEW.parent_id
    OR OLD.path_depth <> NEW.path_depth
  BEGIN
    UPDATE session_export_path_index_states
    SET topology_revision = topology_revision + 1
    WHERE session_id = OLD.session_id;
    UPDATE session_export_path_index_states
    SET topology_revision = topology_revision + 1
    WHERE session_id = NEW.session_id AND NEW.session_id <> OLD.session_id;
  END
  `,
] as const

// Existing paths are indexed lazily in fixed, resumable batches. Keeping migration 29 to schema
// work only avoids a corpus-sized write transaction during startup.
export const SESSION_EXPORT_PATH_CHECKPOINT_BACKFILL_STATEMENTS = [] as const

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
