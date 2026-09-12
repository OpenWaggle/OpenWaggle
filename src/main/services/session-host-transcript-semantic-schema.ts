export const SESSION_TRANSCRIPT_SEMANTIC_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_transcript_search_stats (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    searchable_node_count INTEGER NOT NULL DEFAULT 0 CHECK (searchable_node_count >= 0)
  ) WITHOUT ROWID
  `,
  `
  INSERT INTO session_transcript_search_stats (session_id, searchable_node_count)
  SELECT id, 0 FROM sessions
  `,
  `
  CREATE TABLE session_transcript_semantic_scopes (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    requested_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    node_limit INTEGER NOT NULL CHECK (node_limit > 0),
    vector_bytes_per_node INTEGER NOT NULL CHECK (vector_bytes_per_node > 0),
    source_revision INTEGER NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    prepared_source_revision INTEGER NOT NULL DEFAULT -1 CHECK (prepared_source_revision >= -1),
    searchable_node_count INTEGER NOT NULL DEFAULT 0 CHECK (searchable_node_count >= 0),
    eligible_node_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_node_count >= 0),
    coverage_limited INTEGER NOT NULL DEFAULT 0 CHECK (coverage_limited IN (0, 1)),
    coverage_limit_reason TEXT CHECK (coverage_limit_reason IN (
      'per-session-node-limit', 'storage-budget',
      'per-session-node-limit-and-storage-budget'
    ))
  )
  `,
  `
  CREATE INDEX idx_session_transcript_semantic_scopes_lru
  ON session_transcript_semantic_scopes (expires_at, last_accessed_at, session_id)
  `,
  `
  CREATE TABLE session_transcript_semantic_leases (
    operation_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES session_transcript_semantic_scopes(session_id)
      ON DELETE CASCADE,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (operation_id, session_id)
  )
  `,
  `
  CREATE INDEX idx_session_transcript_semantic_leases_expiry
  ON session_transcript_semantic_leases (expires_at, session_id, operation_id)
  `,
  `
  CREATE TABLE session_transcript_embeddings (
    node_id TEXT PRIMARY KEY REFERENCES session_nodes(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    source_hash TEXT NOT NULL,
    vector BLOB NOT NULL,
    snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision > 0),
    created_order INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_transcript_embeddings_scope
  ON session_transcript_embeddings (
    session_id, model_revision, snapshot_revision, created_order, node_id
  )
  `,
  `
  CREATE TABLE session_transcript_embedding_queue (
    node_id TEXT PRIMARY KEY REFERENCES session_nodes(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    queued_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_transcript_embedding_queue_order
  ON session_transcript_embedding_queue (queued_at, session_id, node_id)
  `,
  `
  CREATE INDEX idx_session_transcript_embedding_queue_session
  ON session_transcript_embedding_queue (session_id, node_id)
  `,
  `
  CREATE TABLE session_semantic_transcript_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    status TEXT NOT NULL CHECK (status IN ('preparing', 'ready', 'failed')),
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    snapshot_revision INTEGER NOT NULL DEFAULT 0,
    prepared_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    preparation_operation_id TEXT,
    failure_message TEXT,
    updated_at INTEGER NOT NULL
  )
  `,
] as const
