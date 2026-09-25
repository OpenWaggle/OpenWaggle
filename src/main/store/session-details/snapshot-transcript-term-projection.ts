import * as SqlClient from '@effect/sql/SqlClient'
import * as Data from 'effect/Data'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import {
  applyIncrementalSessionTranscriptTerms,
  prepareIncrementalSessionTranscriptTerms,
} from '../../services/session-transcript-term-incremental-projection'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { describeError } from '../../utils/describe-error'

const logger = createLogger('session-transcript-terms')

/** Stale Sessions repaired per background pass; each is its own transaction. */
const REPAIR_BATCH_SIZE = 4
const REPAIR_IDLE_INTERVAL = Duration.seconds(30)
const REPAIR_BACKOFF_BASE_MS = 5_000
const REPAIR_BACKOFF_MAX_MS = 10 * 60_000
const REPAIR_BACKOFF_MAX_EXPONENT = 8
const REPAIR_BACKOFF_FACTOR = 2

class TranscriptTermDriftError extends Data.TaggedError('TranscriptTermDriftError')<{
  readonly tokenCount: number
  readonly occurrences: number
}> {}

function verifyDocumentCount(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly token_count: number; readonly occurrences: number }>`
      SELECT
        COALESCE((SELECT token_count FROM session_transcript_term_documents
          WHERE session_id = ${sessionId}), 0) AS token_count,
        COALESCE((SELECT SUM(occurrences) FROM session_transcript_terms
          WHERE session_id = ${sessionId}), 0) AS occurrences
    `
    const counts = rows[0]
    if (counts && counts.token_count !== counts.occurrences) {
      return yield* new TranscriptTermDriftError({
        tokenCount: counts.token_count,
        occurrences: counts.occurrences,
      })
    }
  })
}

/*
 * Wakes the background repair early. Process-local: the Session Host is the only writer, and a
 * missed wake only delays repair until the next idle pass.
 */
let repairWake: Deferred.Deferred<void> | null = null
function wakeTranscriptTermRepair() {
  if (repairWake) Effect.runSync(Deferred.succeed(repairWake, undefined))
}

/**
 * Marks a Session's derived term index stale by removing its document row.
 *
 * "Nodes but no term document" is the durable stale marker: it survives restarts, disappears with
 * the Session, and is repaired by `repairStaleTranscriptTermProjections` outside any turn's
 * transaction. Only the one document row is removed here; search joins every term to its
 * document, so the Session's remaining term rows are unreachable until the repair replaces them.
 */
function markStale(sql: SqlClient.SqlClient, sessionId: string, reason: unknown) {
  return sql
    .withTransaction(
      sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`,
    )
    .pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          logger.warn('Transcript term index is stale; repairing it after the snapshot commits', {
            sessionId,
            error: describeError(reason),
          })
          wakeTranscriptTermRepair()
        }),
      ),
      Effect.catchAll((error) =>
        Effect.sync(() =>
          logger.error('Could not mark the transcript term index stale', {
            sessionId,
            error: describeError(error),
            reason: describeError(reason),
          }),
        ),
      ),
    )
}

/** Whether a Session already awaits exact repair: it has nodes but no term document. */
function isAlreadyStale(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.map(
    sql<{ readonly stale: number }>`
      SELECT (
        NOT EXISTS (SELECT 1 FROM session_transcript_term_documents WHERE session_id = ${sessionId})
        AND EXISTS (SELECT 1 FROM session_nodes WHERE session_id = ${sessionId})
      ) AS stale
    `,
    (rows) => rows[0]?.stale === 1,
  )
}

/**
 * Runs a snapshot's node reconciliation with its incremental transcript-term projection, without
 * letting the derived index fail or delay the snapshot (ADR 0037).
 *
 * The incremental path captures the changed nodes' terms before reconciliation and applies the
 * delta after it, each in a savepoint, then checks the document count against its inverted index.
 * Reproduced: a drifted count made the delta negative, `CHECK (token_count >= 0)` failed, and the
 * whole turn was lost. Any failure now rolls back only the projection and marks it stale.
 */
export function reconcileWithTranscriptTermProjection<E, R>(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: string
  readonly nodeIds: readonly string[]
  readonly reconcile: Effect.Effect<void, E, R>
}) {
  const { sql, sessionId, nodeIds } = input
  return Effect.gen(function* () {
    if (nodeIds.length === 0) {
      yield* input.reconcile
      return
    }
    /*
     * An incremental delta over a stale Session would build a partial index for only the changed
     * nodes, which the aggregate check accepts and the repair never selects again.
     */
    if (yield* isAlreadyStale(sql, sessionId)) {
      yield* input.reconcile
      wakeTranscriptTermRepair()
      return
    }
    const prepareFailure = yield* sql
      .withTransaction(prepareIncrementalSessionTranscriptTerms(sql, sessionId, nodeIds))
      .pipe(
        Effect.as(null),
        Effect.catchAll((error) => Effect.succeed<unknown>(error)),
      )
    yield* input.reconcile
    const applyFailure =
      prepareFailure ??
      (yield* sql
        .withTransaction(
          Effect.zipRight(
            applyIncrementalSessionTranscriptTerms(sql, sessionId, nodeIds),
            verifyDocumentCount(sql, sessionId),
          ),
        )
        .pipe(
          Effect.as(null),
          Effect.catchAll((error) => Effect.succeed<unknown>(error)),
        ))
    if (applyFailure !== null) yield* markStale(sql, sessionId, applyFailure)
  })
}

const failureBackoff = new Map<string, { readonly failures: number; readonly retryAt: number }>()

/** Forgets backoff for Sessions that were deleted or repaired by another path. */
function pruneBackoff(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    if (failureBackoff.size === 0) return
    const tracked = JSON.stringify([...failureBackoff.keys()])
    const rows = yield* sql<{ readonly id: string }>`
      SELECT sessions.id FROM sessions
      WHERE sessions.id IN (SELECT CAST(value AS TEXT) FROM json_each(${tracked}))
        AND NOT EXISTS (
          SELECT 1 FROM session_transcript_term_documents AS documents
          WHERE documents.session_id = sessions.id
        )
    `
    const stillStale = new Set(rows.map((row) => row.id))
    for (const id of [...failureBackoff.keys()]) if (!stillStale.has(id)) failureBackoff.delete(id)
  })
}

function backoffDelay(failures: number) {
  return Math.min(
    REPAIR_BACKOFF_MAX_MS,
    REPAIR_BACKOFF_BASE_MS *
      REPAIR_BACKOFF_FACTOR ** Math.min(failures, REPAIR_BACKOFF_MAX_EXPONENT),
  )
}

/**
 * Rebuilds up to `limit` stale Session term indexes, each in its own transaction.
 *
 * Deleted Sessions are never selected. A failing Session backs off exponentially, so one bad
 * Session cannot starve the others or retry on every pass.
 */
export function repairStaleTranscriptTermProjections(
  sql: SqlClient.SqlClient,
  options: { readonly limit?: number; readonly now?: number } = {},
) {
  return Effect.gen(function* () {
    const now = options.now ?? Date.now()
    const limit = options.limit ?? REPAIR_BATCH_SIZE
    const skipped = [...failureBackoff].filter(([, entry]) => entry.retryAt > now).map(([id]) => id)
    const rows = yield* sql<{ readonly id: string }>`
      SELECT sessions.id FROM sessions
      WHERE NOT EXISTS (
          SELECT 1 FROM session_transcript_term_documents AS documents
          WHERE documents.session_id = sessions.id
        )
        AND EXISTS (SELECT 1 FROM session_nodes AS nodes WHERE nodes.session_id = sessions.id)
        AND sessions.id NOT IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(skipped)}))
      LIMIT ${limit}
    `
    yield* pruneBackoff(sql)
    let repaired = 0
    for (const { id } of rows) {
      const ok = yield* sql.withTransaction(refreshSessionTranscriptTerms(sql, [id])).pipe(
        Effect.as(true),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            const failures = (failureBackoff.get(id)?.failures ?? 0) + 1
            // Measured from the failure, not the pass start, so a slow batch cannot re-select it.
            const failedAt = options.now ?? Date.now()
            failureBackoff.set(id, { failures, retryAt: failedAt + backoffDelay(failures) })
            logger.error('Transcript term repair failed; backing off', {
              sessionId: id,
              failures,
              error: describeError(error),
            })
            return false
          }),
        ),
      )
      if (!ok) continue
      failureBackoff.delete(id)
      repaired += 1
    }
    return { selected: rows.length, repaired }
  })
}

/** Test-only: forget backoff state between cases. */
export function resetTranscriptTermRepairBackoff() {
  failureBackoff.clear()
}

/** Host-owned background repair of stale transcript term indexes (ADR 0037). */
export const runTranscriptTermRepairBackground = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const loop = Effect.gen(function* () {
    const wake = yield* Deferred.make<void>()
    repairWake = wake
    const result = yield* repairStaleTranscriptTermProjections(sql).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.error('Transcript term repair pass failed', { error: describeError(error) })
          return { selected: 0, repaired: 0 }
        }),
      ),
    )
    // A full batch may have more behind it; otherwise wait for a wake or the idle interval.
    if (result.selected < REPAIR_BATCH_SIZE) {
      yield* Effect.race(Deferred.await(wake), Effect.sleep(REPAIR_IDLE_INTERVAL))
    }
  })
  yield* Effect.forkScoped(Effect.forever(loop))
})
