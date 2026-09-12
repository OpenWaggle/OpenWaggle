export const SESSION_NODE_SEARCH_ROW_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_node_search_rows (
    node_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    search_rowid INTEGER NOT NULL UNIQUE,
    created_order INTEGER NOT NULL,
    searchable INTEGER NOT NULL CHECK (searchable IN (0, 1))
  ) WITHOUT ROWID
  `,
  `
  CREATE INDEX idx_session_node_search_rows_session
  ON session_node_search_rows (session_id, search_rowid)
  `,
  `
  CREATE INDEX idx_session_node_search_rows_semantic_hot
  ON session_node_search_rows (session_id, created_order DESC, node_id DESC)
  WHERE searchable = 1
  `,
] as const
