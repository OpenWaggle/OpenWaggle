import type * as SqlClient from '@effect/sql/SqlClient'
import { FOLLOW_UP_EDIT_HOLD_LEASE_MS } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import type {
  SessionControlFollowUp,
  SessionControlFollowUpEditHold,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'

/**
 * Follow-up edit holds are lease state (ADR 0043). They live in a connection-scoped SQLite TEMP
 * table: the Host's single connection makes them transactional with the queue state they block,
 * they never enter the database file's schema (no migration, nothing for older binaries to
 * refuse), and they disappear when the Host's connection closes, so a Host restart releases every
 * hold. A hold past `expires_at` is gone everywhere at once: loads ignore it and renewal refuses it.
 */
const CREATE_EDIT_HOLD_TABLE = `CREATE TEMP TABLE IF NOT EXISTS session_follow_up_edit_holds (
  follow_up_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  hold_id TEXT NOT NULL UNIQUE,
  holder_caller_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)`

interface EditHoldRow {
  readonly follow_up_id: string
  readonly session_id: string
  readonly hold_id: string
  readonly holder_caller_id: string
  readonly acquired_at: number
  readonly expires_at: number
}

export function ensureFollowUpEditHoldTable(sql: SqlClient.SqlClient) {
  return sql.unsafe(CREATE_EDIT_HOLD_TABLE).pipe(Effect.asVoid)
}

function toHold(row: EditHoldRow): SessionControlFollowUpEditHold {
  return {
    holdId: row.hold_id,
    holderCallerId: row.holder_caller_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  }
}

/** Attaches each live hold to its Follow-up. */
export function withFollowUpEditHolds(
  sql: SqlClient.SqlClient,
  sessionId: string,
  items: readonly SessionControlFollowUp[],
  now: number,
) {
  return Effect.gen(function* () {
    const holds = yield* listSessionFollowUpEditHolds(sql, sessionId, now)
    if (holds.size === 0) return items
    return items.map((item) => {
      const editHold = holds.get(item.id)
      return editHold ? { ...item, editHold } : item
    })
  })
}

/** Writes the state's holds back; a hold the state no longer carries is released. */
export function persistFollowUpEditHolds(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    yield* sql`DELETE FROM temp.session_follow_up_edit_holds WHERE session_id = ${state.sessionId}`
    for (const item of state.followUpQueue.items) {
      if (!item.editHold) continue
      yield* sql`
        INSERT INTO temp.session_follow_up_edit_holds (
          follow_up_id, session_id, hold_id, holder_caller_id, acquired_at, expires_at
        )
        VALUES (
          ${item.id},
          ${state.sessionId},
          ${item.editHold.holdId},
          ${item.editHold.holderCallerId},
          ${item.editHold.acquiredAt},
          ${item.editHold.expiresAt}
        )
      `
    }
  })
}

export interface FollowUpEditHoldKey {
  readonly sessionId: string
  readonly followUpId: string
  readonly holdId: string
}

/**
 * Extends a live hold. An expired hold stays expired: once a load could have ignored it, renewing
 * it would resurrect a hold the queue may already have delivered past.
 */
export function renewFollowUpEditHold(
  sql: SqlClient.SqlClient,
  input: FollowUpEditHoldKey & { readonly holderCallerId: string; readonly now: number },
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<{ readonly expires_at: number }>`
      UPDATE temp.session_follow_up_edit_holds
      SET expires_at = ${input.now + FOLLOW_UP_EDIT_HOLD_LEASE_MS}
      WHERE follow_up_id = ${input.followUpId}
        AND session_id = ${input.sessionId}
        AND hold_id = ${input.holdId}
        AND holder_caller_id = ${input.holderCallerId}
        AND expires_at > ${input.now}
        AND EXISTS (
          SELECT 1 FROM session_follow_ups
          WHERE session_follow_ups.id = ${input.followUpId}
            AND session_follow_ups.session_id = ${input.sessionId}
        )
      RETURNING expires_at
    `
    return rows[0]?.expires_at
  })
}

/** Removes expired holds and returns them, so their Sessions can deliver again. */
export function takeExpiredFollowUpEditHolds(sql: SqlClient.SqlClient, now: number) {
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* ensureFollowUpEditHoldTable(sql)
      const rows = yield* sql<EditHoldRow>`
        SELECT follow_up_id, session_id, hold_id, holder_caller_id, acquired_at, expires_at
        FROM temp.session_follow_up_edit_holds
        WHERE expires_at <= ${now}
      `
      if (rows.length === 0) return []
      yield* sql`DELETE FROM temp.session_follow_up_edit_holds WHERE expires_at <= ${now}`
      const existing = yield* sql<{ readonly session_id: string }>`
        SELECT session_id FROM session_control_states
        WHERE session_id IN ${sql.in([...new Set(rows.map((row) => row.session_id))])}
      `
      const liveSessions = new Set(existing.map((row) => row.session_id))
      return rows
        .filter((row) => liveSessions.has(row.session_id))
        .map((row) => ({
          sessionId: row.session_id,
          followUpId: row.follow_up_id,
          holdId: row.hold_id,
          holderCallerId: row.holder_caller_id,
        }))
    }),
  )
}

/** Sessions whose queue waits on a Follow-up edit, with the earliest hold's acquisition time. */
export function listFollowUpEditHeldSessions(sql: SqlClient.SqlClient, now: number) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<{ readonly session_id: string; readonly acquired_at: number }>`
      SELECT holds.session_id, MIN(holds.acquired_at) AS acquired_at
      FROM temp.session_follow_up_edit_holds AS holds
      JOIN session_follow_ups ON session_follow_ups.id = holds.follow_up_id
        AND session_follow_ups.session_id = holds.session_id
      WHERE holds.expires_at > ${now}
      GROUP BY holds.session_id
    `
    return new Map(rows.map((row) => [row.session_id, row.acquired_at]))
  })
}

/** Live holds of one Session, keyed by Follow-up. */
export function listSessionFollowUpEditHolds(
  sql: SqlClient.SqlClient,
  sessionId: string,
  now: number,
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<EditHoldRow>`
      SELECT follow_up_id, session_id, hold_id, holder_caller_id, acquired_at, expires_at
      FROM temp.session_follow_up_edit_holds
      WHERE session_id = ${sessionId} AND expires_at > ${now}
    `
    return new Map(rows.map((row) => [row.follow_up_id, toHold(row)]))
  })
}
