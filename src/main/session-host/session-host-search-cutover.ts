import type { DatabaseSync } from 'node:sqlite'
import { sessionTranscriptSearchContentSql } from '../services/session-transcript-search-content-sql'

const CUTOVER_TRANSCRIPT_SEARCH_CONTENT = sessionTranscriptSearchContentSql('session_nodes')
const CUTOVER_INITIAL_DISCOVERY_CONTENT = sessionTranscriptSearchContentSql('initial_node')
const CUTOVER_PREVIEW_DISCOVERY_CONTENT = sessionTranscriptSearchContentSql('preview_node')

export function populateSessionSearchCatalog(database: DatabaseSync) {
  database.exec(`
    INSERT INTO session_title_search (session_id, title) SELECT id, title FROM sessions;
    INSERT INTO session_project_search (session_id, project_path)
    SELECT id, COALESCE(project_path, '') FROM sessions;
    INSERT INTO session_catalog_search (session_id, title, project_path)
    SELECT id, title, COALESCE(project_path, '') FROM sessions;
    INSERT INTO session_node_search (session_id, node_id, content)
    SELECT session_id, id, ${CUTOVER_TRANSCRIPT_SEARCH_CONTENT} FROM session_nodes;
    INSERT INTO session_node_search_rows (node_id, session_id, search_rowid)
    SELECT node_id, session_id, rowid FROM session_node_search;
    INSERT INTO session_node_discovery_search (
      session_id, initial_objective, current_preview
    )
    SELECT sessions.id,
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
    INSERT INTO session_discovery_search_rows (session_id, search_rowid)
    SELECT session_id, rowid FROM session_node_discovery_search;
  `)
}
