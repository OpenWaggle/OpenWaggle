import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { tokenizeSessionTranscriptTerms } from './session-transcript-term-tokenizer'

const TRANSCRIPT_SEARCH_REFRESH_BATCH_SIZE = 256
const TRANSCRIPT_TERM_SOURCE_PAGE_SIZE = 64
export const SESSION_TRANSCRIPT_SEARCH_CHUNK_NODE_LIMIT = 64

interface TranscriptTermSourceRow {
  readonly search_rowid: number
  readonly session_id: string
  readonly node_id: string
  readonly content: string
  readonly created_order: number
  readonly run_id: string | null
}

interface TranscriptTermProjectionRow {
  readonly term: string
  readonly sessionId: string
  occurrences: number
  firstNodeId: string
  firstCreatedOrder: number
  firstRunId: string | null
}

function termProjectionRows(sourceRows: readonly TranscriptTermSourceRow[]) {
  const projected = new Map<string, TranscriptTermProjectionRow>()
  const tokenCounts = new Map<string, number>()
  for (const source of sourceRows) {
    const terms = tokenizeSessionTranscriptTerms(source.content)
    tokenCounts.set(source.session_id, (tokenCounts.get(source.session_id) ?? 0) + terms.length)
    for (const term of terms) {
      const key = `${term}\0${source.session_id}`
      const existing = projected.get(key)
      if (!existing) {
        projected.set(key, {
          term,
          sessionId: source.session_id,
          occurrences: 1,
          firstNodeId: source.node_id,
          firstCreatedOrder: source.created_order,
          firstRunId: source.run_id,
        })
        continue
      }
      existing.occurrences += 1
      if (source.created_order < existing.firstCreatedOrder) {
        existing.firstNodeId = source.node_id
        existing.firstCreatedOrder = source.created_order
        existing.firstRunId = source.run_id
      }
    }
  }
  return { rows: [...projected.values()], tokenCounts }
}

function upsertTermRows(sql: SqlClient.SqlClient, rows: readonly TranscriptTermProjectionRow[]) {
  return Effect.gen(function* () {
    for (const row of rows) {
      yield* sql`
        INSERT INTO session_transcript_terms (
          term, session_id, occurrences, first_node_id, first_created_order, first_run_id
        ) VALUES (
          ${row.term}, ${row.sessionId}, ${row.occurrences},
          ${row.firstNodeId}, ${row.firstCreatedOrder}, ${row.firstRunId}
        )
        ON CONFLICT(term, session_id) DO UPDATE SET
          occurrences = session_transcript_terms.occurrences + excluded.occurrences,
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
      `
    }
  })
}

function incrementTokenCounts(sql: SqlClient.SqlClient, tokenCounts: ReadonlyMap<string, number>) {
  return Effect.gen(function* () {
    for (const [sessionId, tokenCount] of tokenCounts) {
      yield* sql`
        UPDATE session_transcript_term_documents
        SET token_count = token_count + ${tokenCount}
        WHERE session_id = ${sessionId}
      `
    }
  })
}

function refreshTermProjection(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return Effect.gen(function* () {
    yield* sql`DELETE FROM session_transcript_terms WHERE session_id IN ${sql.in(sessionIds)}`
    yield* sql`
      DELETE FROM session_transcript_term_documents WHERE session_id IN ${sql.in(sessionIds)}
    `
    yield* sql`
      INSERT INTO session_transcript_term_documents (session_id, token_count)
      SELECT id, 0 FROM sessions WHERE id IN ${sql.in(sessionIds)}
    `
    let afterRowid = 0
    while (true) {
      const sourceRows = yield* sql<TranscriptTermSourceRow>`
        SELECT session_node_search.rowid AS search_rowid, session_node_search.session_id,
          session_node_search.node_id, session_node_search.content, session_nodes.created_order,
          json_extract(session_nodes.metadata_json, '$.openWaggle.runId') AS run_id
        FROM session_node_search
        JOIN session_nodes ON session_nodes.id = session_node_search.node_id
        WHERE session_node_search.session_id IN ${sql.in(sessionIds)}
          AND session_node_search.rowid > ${afterRowid}
        ORDER BY session_node_search.rowid
        LIMIT ${TRANSCRIPT_TERM_SOURCE_PAGE_SIZE}
      `
      if (sourceRows.length === 0) break
      afterRowid = sourceRows.at(-1)?.search_rowid ?? afterRowid
      const projection = termProjectionRows(sourceRows)
      yield* upsertTermRows(sql, projection.rows)
      yield* incrementTokenCounts(sql, projection.tokenCounts)
      if (sourceRows.length < TRANSCRIPT_TERM_SOURCE_PAGE_SIZE) break
    }
  })
}

function refreshBatch(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    yield* refreshTermProjection(sql, sessionIds)
    yield* sql`
      DELETE FROM session_transcript_search
      WHERE session_id IN ${sql.in(sessionIds)}
    `
    yield* sql`
      INSERT INTO session_transcript_search (session_id, chunk_ordinal, content)
      SELECT session_id, chunk_ordinal, GROUP_CONCAT(content, ${'\n'})
      FROM (
        SELECT session_id, content,
          CAST((ROW_NUMBER() OVER (
            PARTITION BY session_id ORDER BY rowid
          ) - 1) / ${SESSION_TRANSCRIPT_SEARCH_CHUNK_NODE_LIMIT} AS INTEGER) AS chunk_ordinal
        FROM session_node_search
        WHERE session_id IN ${sql.in(sessionIds)}
      )
      GROUP BY session_id, chunk_ordinal
    `
  })
}

export function refreshSessionTranscriptSearch(
  sql: SqlClient.SqlClient,
  sessionIds: readonly string[],
) {
  const explicitIds = [...new Set(sessionIds)]
  return Effect.gen(function* () {
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
  })
}
