import type * as SqlClient from '@effect/sql/SqlClient'
import type { SqlError } from '@effect/sql/SqlError'
import * as Effect from 'effect/Effect'
import {
  prepareProjectionStaging,
  refreshBatch,
  refreshSessionTranscriptTerms,
  STAGING_CONTENT_SQL,
} from './session-transcript-term-projection'

/** Nodes one slice of a sliced rebuild stages; a slice is one short transaction. */
export const TRANSCRIPT_TERM_REBUILD_SLICE_NODES = 400
/** Term rows one step of publishing a sliced rebuild deletes or inserts. */
export const TRANSCRIPT_TERM_REBUILD_PUBLISH_CHUNK = 1_000
/** Times a sliced rebuild starts over after the Session changed under it, before one last pass. */
const SLICED_REBUILD_MAX_RESTARTS = 3
const NO_CREATED_ORDER = Number.MIN_SAFE_INTEGER
const ACCUMULATOR_TABLE = 'session_transcript_rebuild_terms'

function prepareRebuildAccumulator(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TEMP TABLE IF NOT EXISTS ${ACCUMULATOR_TABLE} (
      term TEXT PRIMARY KEY,
      occurrences INTEGER NOT NULL,
      first_node_id TEXT NOT NULL,
      first_created_order INTEGER NOT NULL,
      first_run_id TEXT
    ) WITHOUT ROWID`)
    yield* sql.unsafe(`DELETE FROM temp.${ACCUMULATOR_TABLE}`)
  })
}

function nodeMutationRevision(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.map(
    sql<{ readonly revision: number }>`
      SELECT node_mutation_revision AS revision FROM session_control_states
      WHERE session_id = ${sessionId}
    `,
    (rows) => rows[0]?.revision ?? null,
  )
}

/** Stages the next `limit` nodes after `afterCreatedOrder` and adds their terms to the total. */
function accumulateSlice(
  sql: SqlClient.SqlClient,
  sessionId: string,
  afterCreatedOrder: number,
  limit: number,
) {
  return Effect.gen(function* () {
    yield* prepareProjectionStaging(sql)
    yield* sql.unsafe(
      `INSERT INTO temp.session_transcript_projection_source (
        session_id, node_id, created_order, run_id, content
      )
      SELECT nodes.session_id, nodes.id, nodes.created_order,
        json_extract(nodes.metadata_json, '$.openWaggle.runId'),
        ${STAGING_CONTENT_SQL}
      FROM session_nodes AS nodes
      WHERE nodes.session_id = ? AND nodes.created_order > ?
      ORDER BY nodes.created_order, nodes.id
      LIMIT ?`,
      [sessionId, afterCreatedOrder, limit],
    )
    const staged = yield* sql.unsafe<{ readonly count: number; readonly last: number | null }>(
      `SELECT COUNT(*) AS count, MAX(created_order) AS last
       FROM temp.session_transcript_projection_source`,
    )
    yield* sql.unsafe(`
      INSERT INTO temp.session_transcript_projection_search (rowid, content)
      SELECT rowid, content FROM temp.session_transcript_projection_source
    `)
    // Slices run in created order, so a term's first evidence is always from its first slice.
    yield* sql.unsafe(`
      WITH term_groups AS (
        SELECT vocabulary.term, COUNT(*) AS occurrences,
          MIN(printf('%020d:%s', source.created_order, source.node_id)) AS evidence_key
        FROM temp.session_transcript_projection_vocab AS vocabulary
        JOIN temp.session_transcript_projection_source AS source
          ON source.rowid = vocabulary.doc
        GROUP BY vocabulary.term
      )
      INSERT INTO temp.${ACCUMULATOR_TABLE} (
        term, occurrences, first_node_id, first_created_order, first_run_id
      )
      SELECT term_groups.term, term_groups.occurrences,
        source.node_id, source.created_order, source.run_id
      FROM term_groups
      JOIN temp.session_transcript_projection_source AS source
        ON source.node_id = substr(term_groups.evidence_key, 22)
      WHERE true
      ON CONFLICT (term) DO UPDATE SET occurrences = occurrences + excluded.occurrences
    `)
    return { count: staged[0]?.count ?? 0, last: staged[0]?.last ?? afterCreatedOrder }
  })
}

function sessionExists(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.map(
    sql<{ readonly id: string }>`SELECT id FROM sessions WHERE id = ${sessionId}`,
    (rows) => rows.length > 0,
  )
}

type PublishCursor =
  | { readonly phase: 'delete' }
  | { readonly phase: 'insert'; readonly afterTerm: string }

/**
 * One bounded step of replacing the Session's terms with the accumulated totals: up to `chunk`
 * old rows deleted, then up to `chunk` new rows inserted, and the term document with the last
 * step. The old rows are unreachable while the Session has no document, and so are the new ones
 * until the document is published.
 */
function publishAccumulatedTermsStep(
  sql: SqlClient.SqlClient,
  sessionId: string,
  cursor: PublishCursor,
  chunk: number,
) {
  return Effect.gen(function* () {
    // Deleted between slices: its terms went with it.
    if (!(yield* sessionExists(sql, sessionId))) return null
    let afterTerm = cursor.phase === 'insert' ? cursor.afterTerm : ''
    if (cursor.phase === 'delete') {
      const deleted = yield* sql.unsafe<{ readonly term: string }>(
        `DELETE FROM session_transcript_terms
         WHERE session_id = ? AND term IN (
           SELECT term FROM session_transcript_terms WHERE session_id = ? LIMIT ?
         )
         RETURNING term`,
        [sessionId, sessionId, chunk],
      )
      if (deleted.length >= chunk) return { phase: 'delete' } satisfies PublishCursor
      yield* sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`
    }
    const inserted = yield* sql.unsafe<{ readonly term: string }>(
      `INSERT INTO session_transcript_terms (
        term, session_id, occurrences, first_node_id, first_created_order, first_run_id
      )
      SELECT term, ?, occurrences, first_node_id, first_created_order, first_run_id
      FROM temp.${ACCUMULATOR_TABLE}
      WHERE term > ?
      ORDER BY term
      LIMIT ?
      RETURNING term`,
      [sessionId, afterTerm, chunk],
    )
    if (inserted.length >= chunk) {
      for (const row of inserted) if (row.term > afterTerm) afterTerm = row.term
      return { phase: 'insert', afterTerm } satisfies PublishCursor
    }
    yield* sql.unsafe(
      `INSERT INTO session_transcript_term_documents (session_id, token_count)
       SELECT ?, COALESCE(SUM(occurrences), 0) FROM temp.${ACCUMULATOR_TABLE}`,
      [sessionId],
    )
    yield* sql.unsafe(`DELETE FROM temp.${ACCUMULATOR_TABLE}`)
    return null
  })
}

type RebuildStep =
  | { readonly kind: 'accumulate'; readonly afterCreatedOrder: number }
  | { readonly kind: 'publish'; readonly cursor: PublishCursor }
  | { readonly kind: 'done' }
  | { readonly kind: 'changed' }

function rebuildStep(
  sql: SqlClient.SqlClient,
  sessionId: string,
  current: Extract<RebuildStep, { readonly kind: 'accumulate' | 'publish' }>,
  revision: number,
  sliceNodes: number,
  publishChunk: number,
): Effect.Effect<RebuildStep, SqlError> {
  return Effect.gen(function* () {
    if ((yield* nodeMutationRevision(sql, sessionId)) !== revision) return { kind: 'changed' }
    if (current.kind === 'accumulate') {
      const slice = yield* accumulateSlice(sql, sessionId, current.afterCreatedOrder, sliceNodes)
      if (slice.count >= sliceNodes) return { kind: 'accumulate', afterCreatedOrder: slice.last }
      // Every node is counted: start replacing the terms in this same transaction.
    }
    const cursor: PublishCursor = current.kind === 'publish' ? current.cursor : { phase: 'delete' }
    const next = yield* publishAccumulatedTermsStep(sql, sessionId, cursor, publishChunk)
    return next === null ? { kind: 'done' } : { kind: 'publish', cursor: next }
  })
}

/**
 * Rebuilds one Session's term index exactly like `refreshSessionTranscriptTerms`, but in bounded
 * steps, each its own short transaction, with `betweenSlices` (an event-loop yield in the Host)
 * between them: `sliceNodes` nodes staged per step, then `publishChunk` term rows replaced per step.
 * A 300k-node profile's repair otherwise held the Host's only thread for one Session's whole
 * transcript at a time, and the loop for every Session in a row (ADR 0037).
 *
 * The totals accumulate in a temporary table and the term document is written by the last step,
 * so a reader never sees a partial index: until then the Session has no term document, the stale
 * marker search already skips. Appended nodes land after the cursor and are picked up by a later
 * slice; an edit, deletion or historical insert bumps the Session's node-mutation revision, and the
 * rebuild starts over. After `SLICED_REBUILD_MAX_RESTARTS` it does one single-transaction rebuild.
 */
export function rebuildSessionTranscriptTermsInSlices(
  sql: SqlClient.SqlClient,
  sessionId: string,
  options: {
    readonly sliceNodes?: number
    readonly publishChunk?: number
    readonly betweenSlices?: Effect.Effect<void>
  } = {},
) {
  const sliceNodes = options.sliceNodes ?? TRANSCRIPT_TERM_REBUILD_SLICE_NODES
  const publishChunk = options.publishChunk ?? TRANSCRIPT_TERM_REBUILD_PUBLISH_CHUNK
  const betweenSlices = options.betweenSlices ?? Effect.void
  return Effect.gen(function* () {
    for (let attempt = 0; attempt <= SLICED_REBUILD_MAX_RESTARTS; attempt += 1) {
      // The first step reads the revision every later step must still see.
      const initial = yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* nodeMutationRevision(sql, sessionId)
          if (revision === null) {
            // No control state to detect edits between steps with: one transaction, as before.
            yield* refreshBatch(sql, [sessionId])
            return null
          }
          yield* prepareRebuildAccumulator(sql)
          return revision
        }),
      )
      if (initial === null) return
      let step: RebuildStep = { kind: 'accumulate', afterCreatedOrder: NO_CREATED_ORDER }
      while (step.kind === 'accumulate' || step.kind === 'publish') {
        step = yield* sql.withTransaction(
          rebuildStep(sql, sessionId, step, initial, sliceNodes, publishChunk),
        )
        if (step.kind !== 'done') yield* betweenSlices
      }
      if (step.kind === 'done') return
    }
    yield* sql.withTransaction(refreshSessionTranscriptTerms(sql, [sessionId]))
  })
}
