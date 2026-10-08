import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'
import {
  type PiSessionFileState,
  readPiProjectionFreshnessWithSql,
} from '../pi-session-file-freshness'
import { withSessionLock } from '../session-lock'
import { runStoreEffect } from '../store-runtime'
import { persistPiSessionSnapshotWithSql } from './persist-snapshot'

export interface PersistExternalPiSnapshotInput extends PersistSessionSnapshotInput {
  readonly expectedRevision: number
  readonly fingerprint: PiSessionFileState
}

/**
 * Replaces a Session's projection with its Pi file as another application left it (ADR 0050).
 *
 * Refused when a snapshot was persisted after the file was read: that snapshot is newer, and this
 * one would put back the projection it replaced. Unlike a Run's snapshot this does not make the
 * Session the most recent one; it moves only as far as the file's own last write.
 */
export async function persistExternalPiSnapshot(
  input: PersistExternalPiSnapshotInput,
): Promise<boolean> {
  return withSessionLock(input.sessionId, async () => {
    const now = Date.now()
    return runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const freshness = yield* readPiProjectionFreshnessWithSql(sql, input.sessionId)
            if (freshness.revision !== input.expectedRevision) return false
            const rows = yield* sql<{ readonly updated_at: number }>`
              SELECT updated_at FROM sessions WHERE id = ${input.sessionId} LIMIT 1
            `
            const previous = rows[0]
            if (!previous) return false
            yield* persistPiSessionSnapshotWithSql(sql, input, now, input.fingerprint)
            yield* sql`
              UPDATE sessions
              SET updated_at = ${Math.max(previous.updated_at, Math.floor(input.fingerprint.mtimeMs))}
              WHERE id = ${input.sessionId}
            `
            return true
          }),
        )
      }),
    )
  })
}
