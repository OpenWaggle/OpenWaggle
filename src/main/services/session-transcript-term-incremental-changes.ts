import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

export function stageIncrementalSessionTranscriptTermChanges(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`
      INSERT INTO temp.session_transcript_incremental_affected (term)
      SELECT term FROM temp.session_transcript_incremental_before
      UNION
      SELECT term FROM temp.session_transcript_incremental_after
    `)
    yield* sql.unsafe(`
      INSERT INTO temp.session_transcript_incremental_delta (term, delta)
      SELECT term, SUM(delta) FROM (
        SELECT term, -occurrences AS delta FROM temp.session_transcript_incremental_before
        UNION ALL
        SELECT term, occurrences AS delta FROM temp.session_transcript_incremental_after
      )
      GROUP BY term
      HAVING SUM(delta) <> 0
    `)
  })
}
