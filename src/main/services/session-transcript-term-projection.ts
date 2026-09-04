import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { sessionTranscriptSearchContentSql } from './session-transcript-search-content-sql'

const TRANSCRIPT_TERM_REFRESH_BATCH_SIZE = 256
const STAGING_CONTENT_SQL = sessionTranscriptSearchContentSql('nodes')

function prepareProjectionStaging(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS session_transcript_projection_ids (
      session_id TEXT PRIMARY KEY
    ) WITHOUT ROWID`)
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS session_transcript_projection_source (
      session_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      created_order INTEGER NOT NULL,
      run_id TEXT,
      content TEXT NOT NULL
    )`)
    yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS temp.idx_transcript_projection_source_session
      ON session_transcript_projection_source (session_id, created_order, node_id)`)
    yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS temp.idx_transcript_projection_source_node
      ON session_transcript_projection_source (node_id)`)
    yield* sql.unsafe(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.session_transcript_projection_search
      USING fts5(content, tokenize = 'unicode61 remove_diacritics 2')`)
    yield* sql.unsafe(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.session_transcript_projection_vocab
      USING fts5vocab(session_transcript_projection_search, 'instance')`)
    yield* sql.unsafe('DELETE FROM temp.session_transcript_projection_search')
    yield* sql.unsafe('DELETE FROM temp.session_transcript_projection_source')
    yield* sql.unsafe('DELETE FROM temp.session_transcript_projection_ids')
  })
}

function stageProjectionSource(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return Effect.gen(function* () {
    yield* prepareProjectionStaging(sql)
    yield* sql`
      INSERT INTO temp.session_transcript_projection_ids (session_id)
      SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(sessionIds)})
    `
    yield* sql.unsafe(`
      INSERT INTO temp.session_transcript_projection_source (
        session_id, node_id, created_order, run_id, content
      )
      SELECT nodes.session_id, nodes.id, nodes.created_order,
        json_extract(nodes.metadata_json, '$.openWaggle.runId'),
        ${STAGING_CONTENT_SQL}
      FROM session_nodes AS nodes
      JOIN temp.session_transcript_projection_ids AS requested
        ON requested.session_id = nodes.session_id
      ORDER BY nodes.session_id, nodes.created_order, nodes.id
    `)
    yield* sql.unsafe(`
      INSERT INTO temp.session_transcript_projection_search (rowid, content)
      SELECT rowid, content FROM temp.session_transcript_projection_source
    `)
  })
}

function rebuildTermCatalog(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return Effect.gen(function* () {
    yield* sql`DELETE FROM session_transcript_terms WHERE session_id IN ${sql.in(sessionIds)}`
    yield* sql`
      DELETE FROM session_transcript_term_documents WHERE session_id IN ${sql.in(sessionIds)}
    `
    yield* sql.unsafe(`
      INSERT INTO session_transcript_term_documents (session_id, token_count)
      SELECT requested.session_id, COALESCE(token_counts.token_count, 0)
      FROM temp.session_transcript_projection_ids AS requested
      LEFT JOIN (
        SELECT source.session_id, COUNT(*) AS token_count
        FROM temp.session_transcript_projection_vocab AS vocabulary
        JOIN temp.session_transcript_projection_source AS source
          ON source.rowid = vocabulary.doc
        GROUP BY source.session_id
      ) AS token_counts ON token_counts.session_id = requested.session_id
    `)
    yield* sql.unsafe(`
      WITH term_groups AS (
        SELECT vocabulary.term, source.session_id, COUNT(*) AS occurrences,
          MIN(printf('%020d:%s', source.created_order, source.node_id)) AS evidence_key
        FROM temp.session_transcript_projection_vocab AS vocabulary
        JOIN temp.session_transcript_projection_source AS source
          ON source.rowid = vocabulary.doc
        GROUP BY vocabulary.term, source.session_id
      )
      INSERT INTO session_transcript_terms (
        term, session_id, occurrences, first_node_id, first_created_order, first_run_id,
        term_frequency
      )
      SELECT term_groups.term, term_groups.session_id, term_groups.occurrences,
        source.node_id, source.created_order, source.run_id,
        CAST(term_groups.occurrences AS REAL) / documents.token_count
      FROM term_groups
      JOIN temp.session_transcript_projection_source AS source
        ON source.node_id = substr(term_groups.evidence_key, 22)
      JOIN session_transcript_term_documents AS documents
        ON documents.session_id = term_groups.session_id
    `)
  })
}

function refreshBatch(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    yield* stageProjectionSource(sql, sessionIds)
    yield* rebuildTermCatalog(sql, sessionIds)
  })
}

export function refreshSessionTranscriptTerms(
  sql: SqlClient.SqlClient,
  sessionIds: readonly string[],
) {
  const explicitIds = [...new Set(sessionIds)]
  return Effect.gen(function* () {
    for (
      let offset = 0;
      offset < explicitIds.length;
      offset += TRANSCRIPT_TERM_REFRESH_BATCH_SIZE
    ) {
      yield* refreshBatch(
        sql,
        explicitIds.slice(offset, offset + TRANSCRIPT_TERM_REFRESH_BATCH_SIZE),
      )
    }
  })
}
