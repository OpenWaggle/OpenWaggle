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

/**
 * Sessions whose node triggers skip the lexical discovery rebuild. A bulk writer, such as a Run's
 * snapshot, holds a row for the length of its writes and rebuilds the discovery row once at the
 * end (`withDeferredLexicalDiscoveryRefresh`). Rows only live inside that writer's transaction.
 */
export const SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE = 'session_lexical_discovery_deferrals'

export const SESSION_LEXICAL_DISCOVERY_DEFERRAL_SCHEMA_STATEMENT = `
  CREATE TABLE IF NOT EXISTS ${SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE} (
    session_id TEXT PRIMARY KEY
  ) WITHOUT ROWID
`

/** The condition under which a node trigger rebuilds `sessionIdSql`'s discovery row itself. */
export function lexicalDiscoveryRefreshNotDeferredSql(sessionIdSql: string) {
  return `NOT EXISTS (
    SELECT 1 FROM ${SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE} WHERE session_id = ${sessionIdSql}
  )`
}

/**
 * Rebuilds one Session's lexical discovery row: its first user message and its latest user or
 * assistant message. The row's insert trigger also rebuilds its term postings, which is the
 * expensive part on a large database.
 */
export function refreshSessionLexicalDiscoveryStatements(sessionIdSql: string, whenSql = 'true') {
  return [
    `DELETE FROM session_discovery_search_rows
    WHERE session_id = ${sessionIdSql} AND ${whenSql}`,
    `INSERT INTO session_node_discovery_search (
      session_id, archived, initial_objective, current_preview
    )
    SELECT sessions.id, sessions.archived,
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
    FROM sessions WHERE sessions.id = ${sessionIdSql} AND ${whenSql}`,
    `INSERT INTO session_discovery_search_rows (
      session_id, search_rowid, initial_objective, current_preview
    )
    SELECT session_id, rowid, initial_objective, current_preview
    FROM session_node_discovery_search
    WHERE rowid = last_insert_rowid() AND session_id = ${sessionIdSql} AND ${whenSql}`,
  ] as const
}

function refreshSessionLexicalDiscoverySql(sessionIdSql: string, whenSql = 'true') {
  return refreshSessionLexicalDiscoveryStatements(sessionIdSql, whenSql)
    .map((statement) => `\n    ${statement};`)
    .join('')
}

/** The rebuild a node trigger runs unless a bulk writer deferred it for that Session. */
export function refreshSessionLexicalDiscoveryUnlessDeferredSql(
  sessionIdSql: string,
  whenSql = 'true',
) {
  return refreshSessionLexicalDiscoverySql(
    sessionIdSql,
    `${whenSql} AND ${lexicalDiscoveryRefreshNotDeferredSql(sessionIdSql)}`,
  )
}
