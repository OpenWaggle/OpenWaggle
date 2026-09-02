import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { sessionTranscriptSearchContentSql } from './session-transcript-search-content-sql'

const STAGING_CONTENT_SQL = sessionTranscriptSearchContentSql('nodes')
const SESSION_VOCABULARY_TABLE = 'session_transcript_incremental_session_vocabulary'
const SOURCE_TABLE = 'session_transcript_incremental_source'
const SEARCH_TABLE = 'session_transcript_incremental_search'
const CHANGED_VOCABULARY_TABLE = 'session_transcript_incremental_changed_vocabulary'
const BEFORE_TABLE = 'session_transcript_incremental_before'
const AFTER_TABLE = 'session_transcript_incremental_after'
const AFFECTED_TABLE = 'session_transcript_incremental_affected'
const DELTA_TABLE = 'session_transcript_incremental_delta'
const EVIDENCE_TABLE = 'session_transcript_incremental_evidence'

function prepareStaging(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.${SESSION_VOCABULARY_TABLE}
      USING fts5vocab(main, session_node_search, 'instance')`)
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS ${SOURCE_TABLE} (
      node_id TEXT PRIMARY KEY,
      content TEXT NOT NULL
    )`)
    yield* sql.unsafe(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.${SEARCH_TABLE}
      USING fts5(content, tokenize = 'unicode61 remove_diacritics 2')`)
    yield* sql.unsafe(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.${CHANGED_VOCABULARY_TABLE}
      USING fts5vocab(${SEARCH_TABLE}, 'instance')`)
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS ${BEFORE_TABLE} (
      node_id TEXT NOT NULL,
      term TEXT NOT NULL,
      occurrences INTEGER NOT NULL,
      PRIMARY KEY (node_id, term)
    ) WITHOUT ROWID`)
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS ${AFTER_TABLE} (
      node_id TEXT NOT NULL,
      term TEXT NOT NULL,
      occurrences INTEGER NOT NULL,
      PRIMARY KEY (node_id, term)
    ) WITHOUT ROWID`)
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS ${AFFECTED_TABLE} (
      term TEXT PRIMARY KEY
    ) WITHOUT ROWID`)
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS ${DELTA_TABLE} (
      term TEXT PRIMARY KEY,
      delta INTEGER NOT NULL
    ) WITHOUT ROWID`)
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS ${EVIDENCE_TABLE} (
      term TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      created_order INTEGER NOT NULL,
      run_id TEXT
    ) WITHOUT ROWID`)
    yield* sql.unsafe(`DELETE FROM temp.${BEFORE_TABLE}`)
    yield* sql.unsafe(`DELETE FROM temp.${AFTER_TABLE}`)
    yield* sql.unsafe(`DELETE FROM temp.${AFFECTED_TABLE}`)
    yield* sql.unsafe(`DELETE FROM temp.${DELTA_TABLE}`)
    yield* sql.unsafe(`DELETE FROM temp.${EVIDENCE_TABLE}`)
    yield* sql.unsafe(`DELETE FROM temp.${SEARCH_TABLE}`)
    yield* sql.unsafe(`DELETE FROM temp.${SOURCE_TABLE}`)
  })
}

function captureNodeTerms(
  sql: SqlClient.SqlClient,
  table: typeof BEFORE_TABLE | typeof AFTER_TABLE,
  sessionId: string,
  nodeIds: readonly string[],
) {
  const nodeIdsJson = JSON.stringify(nodeIds)
  return Effect.gen(function* () {
    yield* sql.unsafe(`DELETE FROM temp.${SEARCH_TABLE}`)
    yield* sql.unsafe(`DELETE FROM temp.${SOURCE_TABLE}`)
    if (nodeIds.length === 0) return
    yield* sql.unsafe(
      `INSERT INTO temp.${SOURCE_TABLE} (node_id, content)
       SELECT nodes.id, ${STAGING_CONTENT_SQL}
       FROM session_nodes AS nodes
       JOIN json_each(?) AS changed_nodes
         ON CAST(changed_nodes.value AS TEXT) = nodes.id
       WHERE nodes.session_id = ?`,
      [nodeIdsJson, sessionId],
    )
    yield* sql.unsafe(
      `INSERT INTO temp.${SEARCH_TABLE} (rowid, content)
       SELECT rowid, content FROM temp.${SOURCE_TABLE}`,
    )
    yield* sql.unsafe(
      `INSERT INTO temp.${table} (node_id, term, occurrences)
       SELECT source.node_id, vocabulary.term, COUNT(*)
       FROM temp.${CHANGED_VOCABULARY_TABLE} AS vocabulary
       JOIN temp.${SOURCE_TABLE} AS source ON source.rowid = vocabulary.doc
       GROUP BY source.node_id, vocabulary.term`,
    )
  })
}

/** Captures changed nodes' exact term contribution before snapshot reconciliation. */
export function prepareIncrementalSessionTranscriptTerms(
  sql: SqlClient.SqlClient,
  sessionId: string,
  nodeIds: readonly string[],
) {
  if (nodeIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    yield* prepareStaging(sql)
    yield* captureNodeTerms(sql, BEFORE_TABLE, sessionId, nodeIds)
  })
}

function stageTermChanges(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`
      INSERT INTO temp.${AFFECTED_TABLE} (term)
      SELECT term FROM temp.${BEFORE_TABLE}
      UNION
      SELECT term FROM temp.${AFTER_TABLE}
    `)
    yield* sql.unsafe(`
      INSERT INTO temp.${DELTA_TABLE} (term, delta)
      SELECT term, SUM(delta) FROM (
        SELECT term, -occurrences AS delta FROM temp.${BEFORE_TABLE}
        UNION ALL
        SELECT term, occurrences AS delta FROM temp.${AFTER_TABLE}
      )
      GROUP BY term
      HAVING SUM(delta) <> 0
    `)
  })
}

function stageEvidence(sql: SqlClient.SqlClient, sessionId: string) {
  return sql.unsafe(
    `INSERT INTO temp.${EVIDENCE_TABLE} (term, node_id, created_order, run_id)
    SELECT term, node_id, created_order, run_id FROM (
      SELECT vocabulary.term, search_rows.node_id, nodes.created_order,
        json_extract(nodes.metadata_json, '$.openWaggle.runId') AS run_id,
        ROW_NUMBER() OVER (
          PARTITION BY vocabulary.term
          ORDER BY nodes.created_order, search_rows.node_id
        ) AS evidence_position
      FROM temp.${AFFECTED_TABLE} AS affected
      CROSS JOIN temp.${SESSION_VOCABULARY_TABLE} AS vocabulary
      JOIN session_node_search_rows AS search_rows
        ON search_rows.search_rowid = vocabulary.doc
      JOIN session_nodes AS nodes ON nodes.id = search_rows.node_id
      WHERE vocabulary.term = affected.term AND search_rows.session_id = ?
    )
    WHERE evidence_position = 1`,
    [sessionId],
  )
}

function applyTermCounts(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    yield* sql.unsafe(
      `DELETE FROM session_transcript_terms
       WHERE session_id = ?
         AND term IN (SELECT term FROM temp.${DELTA_TABLE})
         AND occurrences + (
           SELECT delta FROM temp.${DELTA_TABLE}
           WHERE ${DELTA_TABLE}.term = session_transcript_terms.term
         ) <= 0`,
      [sessionId],
    )
    yield* sql.unsafe(
      `UPDATE session_transcript_terms
       SET occurrences = occurrences + (
         SELECT delta FROM temp.${DELTA_TABLE}
         WHERE ${DELTA_TABLE}.term = session_transcript_terms.term
       )
       WHERE session_id = ?
         AND term IN (SELECT term FROM temp.${DELTA_TABLE})`,
      [sessionId],
    )
    yield* sql.unsafe(
      `INSERT INTO session_transcript_terms (
        term, session_id, occurrences, first_node_id, first_created_order, first_run_id,
        term_frequency
      )
      SELECT deltas.term, ?, deltas.delta, evidence.node_id, evidence.created_order,
        evidence.run_id, 0
      FROM temp.${DELTA_TABLE} AS deltas
      JOIN temp.${EVIDENCE_TABLE} AS evidence ON evidence.term = deltas.term
      WHERE deltas.delta > 0
        AND NOT EXISTS (
          SELECT 1 FROM session_transcript_terms AS existing
          WHERE existing.session_id = ? AND existing.term = deltas.term
        )`,
      [sessionId, sessionId],
    )
  })
}

function publishTermMetadata(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    yield* sql.unsafe(
      `UPDATE session_transcript_terms
       SET first_node_id = (
           SELECT node_id FROM temp.${EVIDENCE_TABLE}
           WHERE ${EVIDENCE_TABLE}.term = session_transcript_terms.term
         ),
         first_created_order = (
           SELECT created_order FROM temp.${EVIDENCE_TABLE}
           WHERE ${EVIDENCE_TABLE}.term = session_transcript_terms.term
         ),
         first_run_id = (
           SELECT run_id FROM temp.${EVIDENCE_TABLE}
           WHERE ${EVIDENCE_TABLE}.term = session_transcript_terms.term
         )
       WHERE session_id = ?
         AND term IN (SELECT term FROM temp.${EVIDENCE_TABLE})`,
      [sessionId],
    )
    yield* sql.unsafe(
      `INSERT INTO session_transcript_term_documents (session_id, token_count)
       VALUES (?, (
         SELECT COALESCE(SUM(occurrences), 0)
         FROM session_transcript_terms WHERE session_id = ?
       ))
       ON CONFLICT(session_id) DO UPDATE SET token_count = excluded.token_count`,
      [sessionId, sessionId],
    )
    yield* sql.unsafe(
      `UPDATE session_transcript_terms
       SET term_frequency = CAST(occurrences AS REAL) / (
         SELECT token_count FROM session_transcript_term_documents WHERE session_id = ?
       )
       WHERE session_id = ?`,
      [sessionId, sessionId],
    )
  })
}

/** Applies exact term-count and first-evidence deltas after snapshot reconciliation. */
export function applyIncrementalSessionTranscriptTerms(
  sql: SqlClient.SqlClient,
  sessionId: string,
  nodeIds: readonly string[],
) {
  if (nodeIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    yield* captureNodeTerms(sql, AFTER_TABLE, sessionId, nodeIds)
    yield* stageTermChanges(sql)
    yield* stageEvidence(sql, sessionId)
    yield* applyTermCounts(sql, sessionId)
    yield* publishTermMetadata(sql, sessionId)
  })
}
