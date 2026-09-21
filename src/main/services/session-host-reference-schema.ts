export const SESSION_REPORT_REFERENCE_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_report_references (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('session-id', 'title', 'agent-definition')),
    normalized_reference TEXT NOT NULL CHECK (length(normalized_reference) > 0),
    PRIMARY KEY (session_id, kind)
  )
  `,
  `
  CREATE INDEX idx_session_report_references_lookup
  ON session_report_references (normalized_reference, session_id)
  `,
] as const
