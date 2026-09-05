export const SESSION_TRANSCRIPT_TERMS_TABLE_STATEMENT = `
  CREATE TABLE session_transcript_terms (
    term TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    occurrences INTEGER NOT NULL CHECK (occurrences > 0),
    first_node_id TEXT NOT NULL,
    first_created_order INTEGER NOT NULL,
    first_run_id TEXT,
    PRIMARY KEY (term, session_id)
  ) WITHOUT ROWID
  `

export const SESSION_TRANSCRIPT_TERMS_SESSION_INDEX_STATEMENT = `
  CREATE INDEX idx_session_transcript_terms_session
  ON session_transcript_terms (session_id, term)
  `

export const SESSION_TRANSCRIPT_TERM_DOCUMENTS_TABLE_STATEMENT = `
  CREATE TABLE session_transcript_term_documents (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    token_count INTEGER NOT NULL CHECK (token_count >= 0)
  )
  `

export const SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS = [
  SESSION_TRANSCRIPT_TERMS_TABLE_STATEMENT,
  SESSION_TRANSCRIPT_TERMS_SESSION_INDEX_STATEMENT,
  SESSION_TRANSCRIPT_TERM_DOCUMENTS_TABLE_STATEMENT,
] as const
