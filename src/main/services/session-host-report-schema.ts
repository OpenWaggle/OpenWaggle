export const SESSION_REPORT_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE cross_session_reports (
    id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    reply_to_report_id TEXT REFERENCES cross_session_reports(id) ON DELETE SET NULL,
    source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_run_id TEXT REFERENCES session_runs(id),
    authored_by TEXT NOT NULL,
    content TEXT NOT NULL,
    request_reply INTEGER NOT NULL CHECK (request_reply IN (0, 1)),
    created_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_cross_session_reports_correlation
  ON cross_session_reports (correlation_id, created_at, id)
  `,
  `
  CREATE TABLE cross_session_report_deliveries (
    report_id TEXT NOT NULL REFERENCES cross_session_reports(id) ON DELETE CASCADE,
    target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered')),
    delivered_run_id TEXT REFERENCES session_runs(id),
    delivered_item_id TEXT,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER,
    PRIMARY KEY (report_id, target_session_id),
    CHECK (
      (status = 'pending' AND delivered_run_id IS NULL AND delivered_item_id IS NULL AND delivered_at IS NULL)
      OR (status = 'delivered' AND delivered_run_id IS NOT NULL AND delivered_item_id IS NOT NULL AND delivered_at IS NOT NULL)
    )
  )
  `,
  `
  CREATE INDEX idx_cross_session_report_deliveries_pending
  ON cross_session_report_deliveries (target_session_id, status, created_at, report_id)
  `,
] as const
