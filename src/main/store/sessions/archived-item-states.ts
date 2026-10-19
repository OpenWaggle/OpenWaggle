import * as SqlClient from '@effect/sql/SqlClient'
import { type ArchivedItemRef, archivedItemKey } from '@shared/types/archived-items'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'

interface ArchiveStateRow {
  readonly key: string
  readonly archived_at: number | null
}

/**
 * Each item's Archive time, or null when it exists but is not archived; an item that does not
 * exist has no entry. Bulk actions read this first so they only change what is still in the state
 * the user saw.
 */
export function archivedItemStatesEffect(refs: readonly ArchivedItemRef[]) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const sessionIds = refs.flatMap((ref) => (ref.kind === 'session' ? [ref.sessionId] : []))
    const branchIds = refs.flatMap((ref) => (ref.kind === 'branch' ? [ref.branchId] : []))
    const sessions =
      sessionIds.length === 0
        ? []
        : yield* sql<ArchiveStateRow>`
            SELECT 'session:' || id AS key,
              CASE WHEN archived = 1 THEN COALESCE(archived_at, updated_at) END AS archived_at
            FROM sessions WHERE id IN ${sql.in(sessionIds)}
          `
    const branches =
      branchIds.length === 0
        ? []
        : yield* sql<ArchiveStateRow>`
            SELECT 'branch:' || session_id || ':' || id AS key, archived_at
            FROM session_branches WHERE id IN ${sql.in(branchIds)}
          `
    const states = new Map([...sessions, ...branches].map((row) => [row.key, row.archived_at]))
    return new Map(
      refs.flatMap((ref) => {
        const key = archivedItemKey(ref)
        const state = states.get(key)
        return state === undefined ? [] : [[key, state] as const]
      }),
    )
  })
}

/** Puts back Archive times an Undo carries, only on items that are archived. */
export function setArchiveTimesEffect(
  entries: readonly { readonly ref: ArchivedItemRef; readonly archivedAt: number }[],
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const { ref, archivedAt } of entries) {
      if (ref.kind === 'session') {
        yield* sql`UPDATE sessions SET archived_at = ${archivedAt}
          WHERE id = ${ref.sessionId} AND archived = 1`
      } else {
        yield* sql`UPDATE session_branches SET archived_at = ${archivedAt}
          WHERE id = ${ref.branchId} AND session_id = ${ref.sessionId}
            AND archived_at IS NOT NULL`
      }
    }
  })
}

export async function readArchivedItemStates(
  refs: readonly ArchivedItemRef[],
): Promise<ReadonlyMap<string, number | null>> {
  return runStoreEffect(archivedItemStatesEffect(refs))
}

export async function setArchiveTimes(
  entries: readonly { readonly ref: ArchivedItemRef; readonly archivedAt: number }[],
): Promise<void> {
  await runStoreEffect(setArchiveTimesEffect(entries))
}
