import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { tokenizeSessionTranscriptTerms } from '../services/session-transcript-term-tokenizer'

const CUTOVER_TERM_SOURCE_PAGE_SIZE = 64

interface CutoverTermSourceRow {
  readonly searchRowid: number
  readonly sessionId: string
  readonly nodeId: string
  readonly content: string
  readonly createdOrder: number
  readonly runId: string | null
}

function cutoverTermSourceRow(row: Record<string, SQLOutputValue>): CutoverTermSourceRow {
  if (
    typeof row.search_rowid !== 'number' ||
    typeof row.session_id !== 'string' ||
    typeof row.node_id !== 'string' ||
    typeof row.content !== 'string' ||
    typeof row.created_order !== 'number' ||
    (row.run_id !== null && typeof row.run_id !== 'string')
  ) {
    throw new Error('Session transcript term cutover read an invalid source row.')
  }
  return {
    searchRowid: row.search_rowid,
    sessionId: row.session_id,
    nodeId: row.node_id,
    content: row.content,
    createdOrder: row.created_order,
    runId: row.run_id,
  }
}

export function populateSessionTranscriptTermCatalog(database: DatabaseSync) {
  database.exec(`
    INSERT INTO session_transcript_term_documents (session_id, token_count)
    SELECT id, 0 FROM sessions;
  `)
  const selectPage = database.prepare(`
    SELECT session_node_search.rowid AS search_rowid, session_node_search.session_id,
      session_node_search.node_id, session_node_search.content, session_nodes.created_order,
      json_extract(session_nodes.metadata_json, '$.openWaggle.runId') AS run_id
    FROM session_node_search
    JOIN session_nodes ON session_nodes.id = session_node_search.node_id
    WHERE session_node_search.rowid > ?
    ORDER BY session_node_search.rowid
    LIMIT ?
  `)
  const incrementDocument = database.prepare(`
    UPDATE session_transcript_term_documents
    SET token_count = token_count + ? WHERE session_id = ?
  `)
  const upsertTerm = database.prepare(`
    INSERT INTO session_transcript_terms (
      term, session_id, occurrences, first_node_id, first_created_order, first_run_id
    ) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(term, session_id) DO UPDATE SET
      occurrences = session_transcript_terms.occurrences + 1,
      first_node_id = CASE
        WHEN excluded.first_created_order < session_transcript_terms.first_created_order
          THEN excluded.first_node_id
        ELSE session_transcript_terms.first_node_id
      END,
      first_run_id = CASE
        WHEN excluded.first_created_order < session_transcript_terms.first_created_order
          THEN excluded.first_run_id
        ELSE session_transcript_terms.first_run_id
      END,
      first_created_order = MIN(
        session_transcript_terms.first_created_order, excluded.first_created_order
      )
  `)
  let afterRowid = 0
  while (true) {
    const rows = selectPage.all(afterRowid, CUTOVER_TERM_SOURCE_PAGE_SIZE).map(cutoverTermSourceRow)
    if (rows.length === 0) break
    for (const row of rows) {
      const terms = tokenizeSessionTranscriptTerms(row.content)
      incrementDocument.run(terms.length, row.sessionId)
      for (const term of terms) {
        upsertTerm.run(term, row.sessionId, row.nodeId, row.createdOrder, row.runId)
      }
      afterRowid = row.searchRowid
    }
    if (rows.length < CUTOVER_TERM_SOURCE_PAGE_SIZE) break
  }
}
