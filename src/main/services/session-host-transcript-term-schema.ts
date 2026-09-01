export const SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_transcript_terms (
    term TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    occurrences INTEGER NOT NULL CHECK (occurrences > 0),
    first_node_id TEXT NOT NULL,
    first_created_order INTEGER NOT NULL,
    first_run_id TEXT,
    term_frequency REAL NOT NULL DEFAULT 0
      CHECK (term_frequency >= 0 AND term_frequency <= 1),
    PRIMARY KEY (term, session_id)
  ) WITHOUT ROWID
  `,
  `
  CREATE INDEX idx_session_transcript_terms_session
  ON session_transcript_terms (session_id, term)
  `,
  `
  CREATE INDEX idx_session_transcript_terms_rank
  ON session_transcript_terms (term, term_frequency DESC, session_id)
  `,
  `
  CREATE TABLE session_transcript_term_documents (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    token_count INTEGER NOT NULL CHECK (token_count >= 0)
  )
  `,
] as const
