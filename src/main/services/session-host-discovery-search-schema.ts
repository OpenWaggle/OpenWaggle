import { sessionTranscriptSearchContentSql } from './session-transcript-search-content-sql'

const INITIAL_DISCOVERY_CONTENT = sessionTranscriptSearchContentSql('initial_node')
const PREVIEW_DISCOVERY_CONTENT = sessionTranscriptSearchContentSql('preview_node')

export const SESSION_DISCOVERY_SEARCH_ROW_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_discovery_search_rows (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    search_rowid INTEGER NOT NULL UNIQUE,
    initial_objective TEXT NOT NULL,
    current_preview TEXT NOT NULL
  ) WITHOUT ROWID
  `,
  `
  CREATE TRIGGER session_discovery_search_rows_delete
  BEFORE DELETE ON session_discovery_search_rows BEGIN
    DELETE FROM session_node_discovery_search WHERE rowid = old.search_rowid;
  END
  `,
] as const

export function refreshSessionLexicalDiscoverySql(sessionIdSql: string) {
  return `
    DELETE FROM session_discovery_search_rows WHERE session_id = ${sessionIdSql};
    INSERT INTO session_node_discovery_search (
      session_id, initial_objective, current_preview
    )
    SELECT sessions.id,
      COALESCE((
        SELECT ${INITIAL_DISCOVERY_CONTENT}
        FROM session_nodes AS initial_node
        WHERE initial_node.session_id = sessions.id AND initial_node.role = 'user'
        ORDER BY initial_node.created_order, initial_node.id LIMIT 1
      ), ''),
      COALESCE((
        SELECT ${PREVIEW_DISCOVERY_CONTENT}
        FROM session_nodes AS preview_node
        WHERE preview_node.session_id = sessions.id
          AND preview_node.role IN ('user', 'assistant')
        ORDER BY preview_node.created_order DESC, preview_node.id DESC LIMIT 1
      ), '')
    FROM sessions WHERE sessions.id = ${sessionIdSql};
    INSERT INTO session_discovery_search_rows (
      session_id, search_rowid, initial_objective, current_preview
    )
    SELECT session_id, rowid, initial_objective, current_preview
    FROM session_node_discovery_search WHERE rowid = last_insert_rowid();
  `
}
