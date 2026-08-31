import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as POLICY } from '../domain/session-transcript-semantic-storage-policy'

export function recentTranscriptNodeIds(sessionId: string) {
  return `SELECT nodes.id FROM session_nodes AS nodes
    JOIN session_node_search AS search ON search.node_id = nodes.id
    WHERE nodes.session_id = ${sessionId} AND trim(search.content) <> ''
    ORDER BY nodes.created_order DESC, nodes.id DESC
    LIMIT COALESCE((SELECT node_limit FROM session_transcript_semantic_scopes
      WHERE session_id = ${sessionId}), 0)`
}

export const NEW_NODE_IS_TRANSCRIPT_ELIGIBLE = `new.id IN (${recentTranscriptNodeIds('new.session_id')})`

export const TRANSCRIPT_STORAGE_HAS_CAPACITY = `
  (SELECT COUNT(*) FROM session_transcript_embedding_queue) < ${POLICY.queuedNodeLimit}
  AND (SELECT COUNT(*) FROM (
    SELECT node_id FROM session_transcript_embeddings
    UNION SELECT node_id FROM session_transcript_embedding_queue
  )) < ${POLICY.totalNodeLimit}
  AND (
    (SELECT COALESCE(SUM(length(vector)), 0) FROM session_transcript_embeddings)
    + (SELECT COALESCE(SUM(scope.vector_bytes_per_node), 0)
      FROM session_transcript_embedding_queue AS queue
      JOIN session_transcript_semantic_scopes AS scope ON scope.session_id = queue.session_id)
    + scopes.vector_bytes_per_node
  ) <= ${POLICY.vectorByteLimit}
`

export function refreshTranscriptScopeCoverageSql(sessionId: string) {
  const searchableCount = `(SELECT COUNT(*) FROM session_nodes AS coverage_nodes
    JOIN session_node_search AS coverage_search ON coverage_search.node_id = coverage_nodes.id
    WHERE coverage_nodes.session_id = ${sessionId} AND trim(coverage_search.content) <> '')`
  const missingEligible = `EXISTS (
    SELECT 1 FROM session_nodes AS missing_nodes
    JOIN session_node_search AS missing_search ON missing_search.node_id = missing_nodes.id
    LEFT JOIN session_transcript_embeddings AS missing_embeddings
      ON missing_embeddings.node_id = missing_nodes.id
    LEFT JOIN session_transcript_embedding_queue AS missing_queue
      ON missing_queue.node_id = missing_nodes.id
    WHERE missing_nodes.session_id = ${sessionId}
      AND trim(missing_search.content) <> ''
      AND missing_nodes.id IN (${recentTranscriptNodeIds(sessionId)})
      AND missing_embeddings.node_id IS NULL AND missing_queue.node_id IS NULL
  )`
  return `UPDATE session_transcript_semantic_scopes SET
    searchable_node_count = ${searchableCount},
    eligible_node_count = MIN(${searchableCount}, node_limit),
    coverage_limited = CASE
      WHEN ${searchableCount} > node_limit OR ${missingEligible} THEN 1 ELSE 0 END,
    coverage_limit_reason = CASE
      WHEN ${searchableCount} > node_limit AND ${missingEligible}
        THEN 'per-session-node-limit-and-storage-budget'
      WHEN ${searchableCount} > node_limit THEN 'per-session-node-limit'
      WHEN ${missingEligible} THEN 'storage-budget'
      ELSE NULL END
    WHERE session_id = ${sessionId};`
}

export const SESSION_TRANSCRIPT_SEMANTIC_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_transcript_semantic_scopes (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    requested_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    node_limit INTEGER NOT NULL CHECK (node_limit > 0),
    vector_bytes_per_node INTEGER NOT NULL CHECK (vector_bytes_per_node > 0),
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
