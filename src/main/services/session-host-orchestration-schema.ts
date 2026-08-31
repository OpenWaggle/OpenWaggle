export const SESSION_ORCHESTRATION_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_orchestration_updates (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    worker_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    source_run_id TEXT NOT NULL REFERENCES session_runs(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('ready_for_review', 'needs_attention')),
    summary TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered')),
    delivered_run_id TEXT REFERENCES session_runs(id),
    delivered_item_id TEXT,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER,
    UNIQUE (delegation_id, source_run_id, state),
    CHECK (
      (status = 'pending' AND delivered_run_id IS NULL AND delivered_item_id IS NULL AND delivered_at IS NULL)
      OR (status = 'delivered' AND delivered_run_id IS NOT NULL AND delivered_item_id IS NOT NULL AND delivered_at IS NOT NULL)
    )
  )
  `,
  `
  CREATE INDEX idx_session_orchestration_updates_pending
  ON session_orchestration_updates (parent_session_id, status, created_at, id)
  `,
  `
  CREATE TABLE delegation_specification_updates (
    id TEXT PRIMARY KEY,
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    worker_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    specification_revision INTEGER NOT NULL CHECK (specification_revision > 0),
    specification_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered')),
    delivered_run_id TEXT REFERENCES session_runs(id),
    delivered_item_id TEXT,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER,
    UNIQUE (delegation_id, specification_revision),
    CHECK (
      (status = 'pending' AND delivered_run_id IS NULL AND delivered_item_id IS NULL AND delivered_at IS NULL)
      OR (status = 'delivered' AND delivered_run_id IS NOT NULL AND delivered_item_id IS NOT NULL AND delivered_at IS NOT NULL)
    )
  )
  `,
  `
  CREATE INDEX idx_delegation_specification_updates_pending
  ON delegation_specification_updates (worker_session_id, status, created_at, id)
  `,
] as const
