import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

const TRANSCRIPT_SEARCH_REFRESH_BATCH_SIZE = 256

interface DirtyTranscriptSearchRow {
  readonly session_id: string
}

function refreshBatch(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    yield* sql`
      DELETE FROM session_transcript_search
      WHERE session_id IN ${sql.in(sessionIds)}
    `
    yield* sql`
      INSERT INTO session_transcript_search (session_id, content)
      SELECT session_id, GROUP_CONCAT(content, ${'\n'})
      FROM session_node_search
      WHERE session_id IN ${sql.in(sessionIds)}
      GROUP BY session_id
    `
    yield* sql`
      DELETE FROM session_transcript_search_dirty
      WHERE session_id IN ${sql.in(sessionIds)}
    `
  })
}

export function refreshSessionTranscriptSearch(
  sql: SqlClient.SqlClient,
  sessionIds?: readonly string[],
) {
  const explicitIds = sessionIds ? [...new Set(sessionIds)] : undefined
  return Effect.gen(function* () {
    if (explicitIds) {
      for (
        let offset = 0;
        offset < explicitIds.length;
        offset += TRANSCRIPT_SEARCH_REFRESH_BATCH_SIZE
      ) {
        yield* refreshBatch(
          sql,
          explicitIds.slice(offset, offset + TRANSCRIPT_SEARCH_REFRESH_BATCH_SIZE),
        )
      }
      return
    }
    while (true) {
      const dirty = yield* sql<DirtyTranscriptSearchRow>`
        SELECT session_id FROM session_transcript_search_dirty
        ORDER BY session_id
        LIMIT ${TRANSCRIPT_SEARCH_REFRESH_BATCH_SIZE}
      `
      if (dirty.length === 0) return
      yield* refreshBatch(
        sql,
        dirty.map((row) => row.session_id),
      )
    }
  })
}
