export const CURRENT_SESSION_LINEAGE_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS session_lineage (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_definition_name TEXT,
    delegation_state TEXT NOT NULL CHECK (
      delegation_state IN (
        'working',
        'waiting',
        'needs_attention',
        'ready_for_review',
        'revision_requested',
        'accepted',
        'cancelled'
      )
    ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (session_id <> parent_session_id)
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_lineage_parent
  ON session_lineage (parent_session_id)
  `,
] as const
