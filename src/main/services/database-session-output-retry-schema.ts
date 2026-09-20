export const SESSION_OUTPUT_RETRY_SCHEMA_STATEMENT = `
  CREATE TABLE IF NOT EXISTS session_output_retries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('commit', 'change-request')),
    commit_hash TEXT,
    summary TEXT,
    title TEXT,
    url TEXT,
    node_id TEXT,
    branch_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  )
  `
