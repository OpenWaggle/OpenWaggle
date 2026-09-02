export const SESSION_RUN_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN (
      'starting', 'active', 'stopping', 'completed', 'failed', 'interrupted',
      'interrupted-by-host-loss', 'interrupted-by-interaction-timeout'
    )),
    intent_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_runs_session_status
  ON session_runs (session_id, status, updated_at DESC, id)
  `,
  `
  CREATE INDEX idx_session_runs_session_updated
  ON session_runs (session_id, updated_at DESC, id DESC)
  `,
  `
  CREATE TABLE session_visit_receipts (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    last_visited_at INTEGER NOT NULL CHECK (last_visited_at >= 0),
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE session_authorization_requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES session_runs(id) ON DELETE CASCADE,
    request_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
    decision_reason TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    CHECK (
      (status = 'pending' AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_at IS NOT NULL)
    )
  )
  `,
  `
  CREATE INDEX idx_session_authorization_requests_run_status
  ON session_authorization_requests (run_id, status, created_at, id)
  `,
] as const
