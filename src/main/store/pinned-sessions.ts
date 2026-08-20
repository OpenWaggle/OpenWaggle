/**
 * Pinned session persistence (issue #97, ADR 0019).
 *
 * One row per pin, keyed by session id, with the user's Manual order carried by a
 * fractional `sort_key` string. Consequences of that shape, both deliberate:
 *
 * - Moving a pin writes exactly one row — no renumbering pass over its neighbours.
 * - `session_id` is a foreign key with `ON DELETE CASCADE`, so deleting a session
 *   removes its pin with no application code. Archiving does **not** touch pins:
 *   the row stays and the renderer hides it while the session is archived.
 */

import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { PinnedSession, PinnedSessionMove } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { keyBetween } from './pinned-sessions-sort-key'
import { runStoreEffect } from './store-runtime'

interface PinnedSessionRow {
  readonly session_id: string
  readonly pinned_at: number
  readonly sort_key: string
}

function toPinnedSession(row: PinnedSessionRow): PinnedSession {
  return {
    sessionId: SessionId(row.session_id),
    pinnedAt: row.pinned_at,
    sortKey: row.sort_key,
  }
}

/**
 * Every pin in Manual order.
 *
 * Rows for archived sessions are included: archiving keeps the pin, and hiding the
 * row while archived is a presentation decision the renderer owns.
 */
export async function listPinnedSessions(): Promise<PinnedSession[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<PinnedSessionRow>`
        SELECT session_id, pinned_at, sort_key
        FROM pinned_sessions
        ORDER BY sort_key ASC
      `
      return rows.map(toPinnedSession)
    }),
  )
}

/**
 * Pin a session, appended to the end of Manual order so existing pins keep both
 * their position and their Pinned shortcut. Pinning an already-pinned session is a
 * no-op rather than a move — the caller asked for it to be pinned, and it is.
 */
export async function pinSession(sessionId: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lastRows = yield* sql<{ readonly sort_key: string }>`
        SELECT sort_key FROM pinned_sessions ORDER BY sort_key DESC LIMIT 1
      `
      const sortKey = keyBetween(lastRows[0]?.sort_key ?? null, null)
      yield* sql`
        INSERT INTO pinned_sessions (session_id, pinned_at, sort_key)
        VALUES (${sessionId}, ${Date.now()}, ${sortKey})
        ON CONFLICT(session_id) DO NOTHING
      `
    }),
  )
}

/** Remove a pin. Unpinning something that is not pinned is a no-op. */
export async function unpinSession(sessionId: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM pinned_sessions WHERE session_id = ${sessionId}`
    }),
  )
}

/**
 * Reposition one pin between two neighbours, writing only that pin's row.
 *
 * Ids that are no longer pinned are treated as absent bounds, which makes a stale drop
 * degrade into a move to the nearest end instead of failing.
 */
export async function movePinnedSession(input: PinnedSessionMove): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<PinnedSessionRow>`
        SELECT session_id, pinned_at, sort_key
        FROM pinned_sessions
        ORDER BY sort_key ASC
      `
      const moving = rows.find((row) => row.session_id === input.sessionId)
      if (!moving) return

      const keyOf = (sessionId: SessionId | null) =>
        sessionId === null
          ? null
          : (rows.find((row) => row.session_id === sessionId)?.sort_key ?? null)

      const after = keyOf(input.afterSessionId)
      const before = keyOf(input.beforeSessionId)
      if (after !== null && before !== null && after >= before) return
      if (after === moving.sort_key || before === moving.sort_key) return

      const sortKey = keyBetween(after, before)
      yield* sql`
        UPDATE pinned_sessions SET sort_key = ${sortKey} WHERE session_id = ${input.sessionId}
      `
    }),
  )
}
