/** Native tokenizer facts only. Scores and corpus statistics remain owned by FTS5. */
export const SESSION_DISCOVERY_TERM_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_discovery_term_postings (
    session_id TEXT NOT NULL
      REFERENCES session_discovery_search_rows(session_id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    search_rowid INTEGER NOT NULL,
    initial_frequency INTEGER NOT NULL CHECK(initial_frequency >= 0),
    preview_frequency INTEGER NOT NULL CHECK(preview_frequency >= 0),
    token_count INTEGER NOT NULL CHECK(token_count >= 0),
    PRIMARY KEY(session_id, term)
  ) WITHOUT ROWID
  `,
  `
  CREATE INDEX idx_session_discovery_term_members
  ON session_discovery_term_postings (
    term, initial_frequency, preview_frequency, token_count, session_id, search_rowid
  )
  `,
  `
  CREATE TABLE session_discovery_term_signatures (
    term TEXT NOT NULL,
    initial_frequency INTEGER NOT NULL CHECK(initial_frequency >= 0),
    preview_frequency INTEGER NOT NULL CHECK(preview_frequency >= 0),
    token_count INTEGER NOT NULL CHECK(token_count >= 0),
    representative_rowid INTEGER NOT NULL,
    member_count INTEGER NOT NULL CHECK(member_count >= 0),
    PRIMARY KEY(term, initial_frequency, preview_frequency, token_count)
  ) WITHOUT ROWID
  `,
  `
  CREATE VIRTUAL TABLE session_discovery_term_stage USING fts5(
    initial_objective, current_preview, tokenize = 'unicode61 remove_diacritics 2'
  )
  `,
  `
  CREATE VIRTUAL TABLE session_discovery_term_stage_vocabulary
  USING fts5vocab(session_discovery_term_stage, 'instance')
  `,
] as const
