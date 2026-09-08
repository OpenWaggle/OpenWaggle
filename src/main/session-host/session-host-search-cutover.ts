import type { DatabaseSync } from 'node:sqlite'
import { SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS } from '../services/session-host-discovery-term-population'
import { sessionTranscriptSearchContentSql } from '../services/session-transcript-search-content-sql'
import { queryCutoverRecord } from './session-host-cutover-database'

const CUTOVER_TRANSCRIPT_SEARCH_CONTENT = sessionTranscriptSearchContentSql('session_nodes')
const CUTOVER_ROW_TRANSCRIPT_SEARCH_CONTENT = sessionTranscriptSearchContentSql('nodes')
const CUTOVER_INITIAL_DISCOVERY_CONTENT = sessionTranscriptSearchContentSql('initial_node')
const CUTOVER_PREVIEW_DISCOVERY_CONTENT = sessionTranscriptSearchContentSql('preview_node')
const NODE_SEARCH_SESSION_INDEX = 'idx_session_node_search_rows_session'

function populateNodeSearchRows(database: DatabaseSync) {
  const hasSessionIndex =
    queryCutoverRecord(
      database,
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ?",
      NODE_SEARCH_SESSION_INDEX,
    )?.present === 1
  if (hasSessionIndex) database.exec(`DROP INDEX ${NODE_SEARCH_SESSION_INDEX}`)
  try {
    database.exec(`
      INSERT INTO session_node_search_rows (
        node_id, session_id, search_rowid, created_order, searchable
      )
      SELECT search.node_id, search.session_id, search.rowid, nodes.created_order,
        CASE WHEN trim(${CUTOVER_ROW_TRANSCRIPT_SEARCH_CONTENT}) <> '' THEN 1 ELSE 0 END
      FROM session_node_search AS search
      JOIN session_nodes AS nodes ON nodes.id = search.node_id;
    `)
  } finally {
    if (hasSessionIndex) {
      database.exec(`CREATE INDEX ${NODE_SEARCH_SESSION_INDEX}
        ON session_node_search_rows (session_id, search_rowid)`)
    }
  }
}

export function populateSessionSearchCatalog(database: DatabaseSync) {
  database.exec(`
    INSERT INTO session_title_search (session_id, title) SELECT id, title FROM sessions;
    INSERT INTO session_project_search (session_id, project_path)
    SELECT id, COALESCE(project_path, '') FROM sessions;
    INSERT INTO session_catalog_search (session_id, title, project_path)
    SELECT id, title, COALESCE(project_path, '') FROM sessions;
    INSERT INTO session_node_search (session_id, node_id, content)
    SELECT session_id, id, ${CUTOVER_TRANSCRIPT_SEARCH_CONTENT} FROM session_nodes;
  `)
  populateNodeSearchRows(database)
  database.exec(`
    UPDATE session_transcript_search_stats SET searchable_node_count = 0;
    INSERT INTO session_transcript_search_stats (session_id, searchable_node_count)
    SELECT session_id, COUNT(*)
    FROM session_node_search_rows
    WHERE searchable = 1
    GROUP BY session_id
    ON CONFLICT(session_id) DO UPDATE SET
      searchable_node_count = excluded.searchable_node_count;
  `)
  database.exec(`
    INSERT INTO session_node_discovery_search (
      session_id, archived, initial_objective, current_preview
    )
    SELECT sessions.id, sessions.archived,
      COALESCE((
        SELECT ${CUTOVER_INITIAL_DISCOVERY_CONTENT}
        FROM session_nodes AS initial_node
        WHERE initial_node.session_id = sessions.id AND initial_node.role = 'user'
        ORDER BY initial_node.created_order, initial_node.id LIMIT 1
      ), ''),
      COALESCE((
        SELECT ${CUTOVER_PREVIEW_DISCOVERY_CONTENT}
        FROM session_nodes AS preview_node
        WHERE preview_node.session_id = sessions.id
          AND preview_node.role IN ('user', 'assistant')
        ORDER BY preview_node.created_order DESC, preview_node.id DESC LIMIT 1
      ), '')
    FROM sessions;
    INSERT INTO session_discovery_search_rows (
      session_id, search_rowid, initial_objective, current_preview
    )
    SELECT session_id, rowid, initial_objective, current_preview
    FROM session_node_discovery_search;
  `)
  for (const statement of SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS) database.exec(statement)
}
