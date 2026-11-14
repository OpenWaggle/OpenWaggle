import { Schema } from '@shared/schema'
import type { HostSqliteDatabase } from './host-sqlite-database'
import { queryCutoverCount, queryCutoverRow } from './session-host-cutover-database'

const nodeRowCountsSchema = Schema.Struct({ nodes: Schema.Unknown, indexed_nodes: Schema.Unknown })

export function validateTranscriptTermCounts(database: HostSqliteDatabase) {
  const nodeRows = queryCutoverRow(
    database,
    nodeRowCountsSchema,
    `SELECT
      (SELECT COUNT(*) FROM session_nodes) AS nodes,
      (SELECT COUNT(*) FROM session_node_search_rows) AS indexed_nodes`,
  )
  if (nodeRows?.nodes !== nodeRows?.indexed_nodes) {
    throw new Error('Session Host node search row mapping is incomplete.')
  }
  const invalid = queryCutoverCount(
    database,
    `SELECT COUNT(*) AS count
      FROM session_transcript_term_documents AS documents
      WHERE documents.token_count <> COALESCE((
        SELECT SUM(terms.occurrences) FROM session_transcript_terms AS terms
        WHERE terms.session_id = documents.session_id
      ), 0)`,
  )
  if (invalid !== 0) {
    throw new Error('Session Host transcript term counts do not match their inverted index.')
  }
}
