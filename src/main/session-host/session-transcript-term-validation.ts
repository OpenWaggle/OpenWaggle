import type { DatabaseSync } from 'node:sqlite'
import { queryCutoverRecord } from './session-host-cutover-database'

export function validateTranscriptTermCounts(database: DatabaseSync) {
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
}
