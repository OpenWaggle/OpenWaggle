import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'
import { unwrapFiberFailure } from '../../utils/describe-error'
import {
  type PiSessionFileState,
  readPiProjectionFreshnessWithSql,
} from '../pi-session-file-freshness'
import { withSessionLock } from '../session-lock'
import { runStoreEffect } from '../store-runtime'
import { persistPiSessionSnapshotWithSql } from './persist-snapshot'
import { SessionNodeIdConflictError } from './snapshot-node-ownership'

export interface PersistExternalPiSnapshotInput extends PersistSessionSnapshotInput {
  readonly expectedRevision: number
  readonly fingerprint: PiSessionFileState
}

/**
 * Renames entries of the Session's Pi file whose ids another Session holds, returning the snapshot
 * to save instead, or null when it cannot (ADR 0049). Called with the Session's lock held.
 */
export type ExternalSnapshotEntryIdRepair = (
  input: PersistSessionSnapshotInput,
  foreignNodeIds: ReadonlySet<string>,
) => Promise<PersistSessionSnapshotInput | null>

function persistIfCurrent(input: PersistExternalPiSnapshotInput, now: number) {
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
}

/**
 * Replaces a Session's projection with its Pi file as another application left it (ADR 0051).
 *
 * Refused when a snapshot was persisted after the file was read: that snapshot is newer, and this
 * one would put back the projection it replaced. Unlike a Run's snapshot this does not make the
 * Session the most recent one; it moves only as far as the file's own last write.
 *
 * `pi --resume` on a Session OpenWaggle created can add entries whose eight-character ids another
 * Session holds. Those are renamed in the file through `repairEntryIds`, under the same lock, as
 * a Run's snapshot is (ADR 0049); without it every open of the Session would fail the same way.
 */
export async function persistExternalPiSnapshot(
  input: PersistExternalPiSnapshotInput,
  repairEntryIds?: ExternalSnapshotEntryIdRepair,
): Promise<boolean> {
  return withSessionLock(input.sessionId, async () => {
    const now = Date.now()
    try {
      return await persistIfCurrent(input, now)
    } catch (error) {
      const conflict = unwrapFiberFailure(error)
      if (!repairEntryIds || !(conflict instanceof SessionNodeIdConflictError)) throw error
      const repaired = await repairEntryIds(
        input,
        new Set(conflict.conflicts.map((entry) => entry.nodeId)),
      )
      if (!repaired) throw conflict
      return persistIfCurrent({ ...input, ...repaired }, now)
    }
  })
}
