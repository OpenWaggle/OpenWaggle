import type * as SqlClient from '@effect/sql/SqlClient'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import {
  applyIncrementalSessionTranscriptTerms,
  prepareIncrementalSessionTranscriptTerms,
} from '../../services/session-transcript-term-incremental-projection'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { describeError } from '../../utils/describe-error'

const logger = createLogger('session-transcript-terms')

class TranscriptTermDriftError extends Data.TaggedError('TranscriptTermDriftError')<{
  readonly tokenCount: number
  readonly occurrences: number
}> {}

/**
 * Sessions whose index could not be repaired inside their snapshot transaction.
 *
 * Retried after the snapshot commits, in a transaction of their own, so a turn never waits on or
 * fails because of derived data (ADR 0037).
 */
const pendingTermRebuilds = new Set<string>()

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

function rebuildInSavepoint(sql: SqlClient.SqlClient, sessionId: string) {
  return sql.withTransaction(refreshSessionTranscriptTerms(sql, [sessionId])).pipe(
    Effect.catchAll((error) => {
      pendingTermRebuilds.add(sessionId)
      return Effect.sync(() =>
        logger.error('Transcript term rebuild failed; retrying after the snapshot commits', {
          sessionId,
          error: describeError(error),
        }),
      )
    }),
  )
}

/**
 * Runs a snapshot's node reconciliation with its incremental transcript-term projection, without
 * letting the derived index fail the snapshot.
 *
 * The incremental path captures the changed nodes' terms before reconciliation and applies the
 * delta after it, each inside a savepoint. A failed step, or a document count that disagrees with
 * its inverted index afterwards, rolls back only that savepoint and rebuilds the Session's index
 * exactly. Reproduced: a drifted count made the delta negative, `CHECK (token_count >= 0)` failed,
 * and the whole turn was lost.
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
    const prepared = yield* sql
      .withTransaction(prepareIncrementalSessionTranscriptTerms(sql, sessionId, nodeIds))
      .pipe(
        Effect.as(true),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.warn('Transcript term capture failed; rebuilding the Session index', {
              sessionId,
              error: describeError(error),
            })
            return false
          }),
        ),
      )
    yield* input.reconcile
    const applied = prepared
      ? yield* sql
          .withTransaction(
            Effect.zipRight(
              applyIncrementalSessionTranscriptTerms(sql, sessionId, nodeIds),
              verifyDocumentCount(sql, sessionId),
            ),
          )
          .pipe(
            Effect.as(true),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                logger.warn('Transcript term index drifted; rebuilding the Session index', {
                  sessionId,
                  error: describeError(error),
                })
                return false
              }),
            ),
          )
      : false
    if (!applied) yield* rebuildInSavepoint(sql, sessionId)
  })
}

/** Retries index rebuilds that could not complete inside their snapshot transaction. */
export function drainPendingTranscriptTermRebuilds(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    for (const sessionId of [...pendingTermRebuilds]) {
      pendingTermRebuilds.delete(sessionId)
      yield* sql.withTransaction(refreshSessionTranscriptTerms(sql, [sessionId])).pipe(
        Effect.catchAll((error) => {
          pendingTermRebuilds.add(sessionId)
          return Effect.sync(() =>
            logger.error('Deferred transcript term rebuild failed', {
              sessionId,
              error: describeError(error),
            }),
          )
        }),
      )
    }
  })
}
