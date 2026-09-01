import type { DatabaseSync } from 'node:sqlite'
import { queryCutoverRecord } from './session-host-cutover-database'

export function validateTranscriptTermCounts(database: DatabaseSync) {
  const nodeRows = queryCutoverRecord(
    database,
    `SELECT
      (SELECT COUNT(*) FROM session_nodes) AS nodes,
      (SELECT COUNT(*) FROM session_node_search_rows) AS indexed_nodes`,
  )
  if (nodeRows?.nodes !== nodeRows?.indexed_nodes) {
    throw new Error('Session Host node search row mapping is incomplete.')
  }
  const invalid = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count
      FROM session_transcript_term_documents AS documents
      WHERE documents.token_count <> COALESCE((
        SELECT SUM(terms.occurrences) FROM session_transcript_terms AS terms
        WHERE terms.session_id = documents.session_id
      ), 0)`,
  )?.count
  if (invalid !== 0) {
    throw new Error('Session Host transcript term counts do not match their inverted index.')
  }
  const invalidFrequency = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count
      FROM session_transcript_terms AS terms
      JOIN session_transcript_term_documents AS documents
        ON documents.session_id = terms.session_id
      WHERE documents.token_count = 0
        OR abs(terms.term_frequency -
          CAST(terms.occurrences AS REAL) / documents.token_count) > 0.000000001`,
  )?.count
  if (invalidFrequency !== 0) {
    throw new Error('Session Host transcript term frequencies are invalid.')
  }
}
