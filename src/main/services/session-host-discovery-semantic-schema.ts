export const SESSION_DISCOVERY_SEMANTIC_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_semantic_discovery_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    status TEXT NOT NULL CHECK (status IN ('preparing', 'ready', 'failed')),
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    snapshot_revision INTEGER NOT NULL DEFAULT 0,
    deletion_compaction_revision INTEGER NOT NULL DEFAULT 0,
    prepared_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    preparation_operation_id TEXT,
    failure_message TEXT,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE session_discovery_embeddings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    source_hash TEXT NOT NULL,
    vector BLOB NOT NULL,
    snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision > 0),
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_discovery_embeddings_snapshot
  ON session_discovery_embeddings (model_revision, snapshot_revision, session_id)
  `,
  `
  CREATE TABLE session_discovery_embedding_deletions (
    session_id TEXT PRIMARY KEY,
    snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision > 0)
  )
  `,
  `
  CREATE INDEX idx_session_discovery_embedding_deletions_snapshot
  ON session_discovery_embedding_deletions (snapshot_revision, session_id)
  `,
  `
  CREATE TABLE session_discovery_embedding_queue (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    queued_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_discovery_embedding_queue_order
  ON session_discovery_embedding_queue (queued_at, session_id)
  `,
] as const
