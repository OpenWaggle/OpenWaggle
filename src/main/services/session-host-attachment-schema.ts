export const SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_prepared_attachments (
    id TEXT PRIMARY KEY,
    owner_caller_id TEXT NOT NULL,
    preparation_request_id TEXT NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'pdf')),
    origin TEXT NOT NULL CHECK (origin IN ('user-file', 'auto-paste-text')),
    name TEXT NOT NULL,
    real_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    source_base64 TEXT NOT NULL,
    extracted_text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    bound_at INTEGER,
    expires_at INTEGER
  )
  `,
  `
  CREATE INDEX idx_session_prepared_attachments_created
  ON session_prepared_attachments (created_at, id)
  `,
  `
  CREATE INDEX idx_session_prepared_attachments_owner_expiry
  ON session_prepared_attachments (owner_caller_id, session_id, expires_at, id)
  `,
  `
  CREATE INDEX idx_session_prepared_attachments_session
  ON session_prepared_attachments (session_id, id)
  `,
] as const
