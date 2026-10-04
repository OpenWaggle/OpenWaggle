import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  FOLLOW_UP_EDIT_ATTACHMENT_RETENTION_MS,
  FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS,
} from '../domain/session-control/follow-up-edit-lease'
import type {
  SessionControlFollowUpEditHold,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'

/**
 * Follow-up edit holds are lease state (ADR 0044). They live in connection-scoped SQLite TEMP
 * tables: the Host's single connection makes them transactional with the queue state they block,
 * they never enter the database file's schema (no migration, nothing for older binaries to
 * refuse), and they disappear when the Host's connection closes, so a Host restart releases every
 * hold (Host-loss recovery then pauses the queues they blocked). A lease is counted in Host sweeps
 * (`missed_sweeps`, see `follow-up-edit-lease.ts`); a hold that reached the lease is gone
 * everywhere at once: loads ignore it and renewal refuses it.
 *
 * Alongside the holds, lease state that dies with them:
 * - the deferred retry of a failed Run that waits behind a hold;
 * - the deferred settlement of a Worker's Delegation, whose next Follow-up waits on an edit;
 * - attachments named by edits, which outlive their last reference for a while so a retried save
 *   or a lost edit queued as a new message can still bind them.
 */
const CREATE_LEASE_TABLES = [
  `CREATE TEMP TABLE IF NOT EXISTS session_follow_up_edit_holds (
    follow_up_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    hold_id TEXT NOT NULL UNIQUE,
    holder_caller_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    missed_sweeps INTEGER NOT NULL,
    base_queue_revision INTEGER NOT NULL
  )`,
  `CREATE TEMP TABLE IF NOT EXISTS session_follow_up_deferred_retries (
    session_id TEXT PRIMARY KEY,
    accepted_after INTEGER NOT NULL
  )`,
  `CREATE TEMP TABLE IF NOT EXISTS session_follow_up_edit_attachments (
    session_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    retained_until REAL NOT NULL,
    PRIMARY KEY (session_id, attachment_id)
  )`,
  `CREATE TEMP TABLE IF NOT EXISTS session_deferred_worker_settlements (
    session_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    final_response TEXT
  )`,
]

interface EditHoldRow {
  readonly follow_up_id: string
  readonly session_id: string
  readonly hold_id: string
  readonly holder_caller_id: string
  readonly acquired_at: number
  readonly missed_sweeps: number
  readonly base_queue_revision: number
}

export function ensureFollowUpEditHoldTable(sql: SqlClient.SqlClient) {
  return Effect.forEach(CREATE_LEASE_TABLES, (statement) => sql.unsafe(statement), {
    discard: true,
  })
}

function toHold(row: EditHoldRow): SessionControlFollowUpEditHold {
  return {
    holdId: row.hold_id,
    holderCallerId: row.holder_caller_id,
    acquiredAt: row.acquired_at,
    missedSweeps: row.missed_sweeps,
    baseQueueRevision: row.base_queue_revision,
  }
}

/** Live holds of one Session, keyed by Follow-up. */
export function listSessionFollowUpEditHolds(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<EditHoldRow>`
      SELECT follow_up_id, session_id, hold_id, holder_caller_id, acquired_at, missed_sweeps,
        base_queue_revision
      FROM temp.session_follow_up_edit_holds
      WHERE session_id = ${sessionId} AND missed_sweeps < ${FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS}
    `
    return new Map(rows.map((row) => [row.follow_up_id, toHold(row)]))
  })
}

/** Attaches live holds and a deferred retry to a Session state loaded from the database. */
export function withFollowUpEditLeaseState(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
) {
  return Effect.gen(function* () {
    const holds = yield* listSessionFollowUpEditHolds(sql, state.sessionId)
    const retries = yield* sql<{ readonly accepted_after: number }>`
      SELECT accepted_after FROM temp.session_follow_up_deferred_retries
      WHERE session_id = ${state.sessionId}
    `
    const deferredRetryAfter = retries[0]?.accepted_after
    if (holds.size === 0 && deferredRetryAfter === undefined) return state
    return {
      ...state,
      followUpQueue: {
        ...state.followUpQueue,
        ...(deferredRetryAfter === undefined ? {} : { deferredRetryAfter }),
        items: state.followUpQueue.items.map((item) => {
          const editHold = holds.get(item.id)
          return editHold ? { ...item, editHold } : item
        }),
      },
    }
  })
}

/** Keeps attachments an edit names bound to the Session for a while after their last reference. */
export function retainFollowUpEditAttachments(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: string; readonly attachmentIds: readonly string[] },
  now: number,
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    for (const attachmentId of new Set(input.attachmentIds)) {
      yield* sql`
        INSERT INTO temp.session_follow_up_edit_attachments (
          session_id, attachment_id, retained_until
        ) VALUES (${input.sessionId}, ${attachmentId}, ${now + FOLLOW_UP_EDIT_ATTACHMENT_RETENTION_MS})
        ON CONFLICT(session_id, attachment_id) DO UPDATE SET retained_until = excluded.retained_until
      `
    }
  })
}

/** Attachments of a Session that Follow-up edits still retain. */
export function retainedFollowUpEditAttachmentIds(
  sql: SqlClient.SqlClient,
  sessionId: string,
  now: number,
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    yield* sql`
      DELETE FROM temp.session_follow_up_edit_attachments WHERE retained_until <= ${now}
    `
    const rows = yield* sql<{ readonly attachment_id: string }>`
      SELECT attachment_id FROM temp.session_follow_up_edit_attachments
      WHERE session_id = ${sessionId}
    `
    return rows.map((row) => row.attachment_id)
  })
}

/**
 * Writes the state's lease state back: a hold the state no longer carries is released, and a
 * deferred retry only lasts while the Session is idle.
 */
export function persistFollowUpEditHolds(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  now: number,
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    yield* sql`DELETE FROM temp.session_follow_up_edit_holds WHERE session_id = ${state.sessionId}`
    for (const item of state.followUpQueue.items) {
      if (!item.editHold) continue
      yield* sql`
        INSERT INTO temp.session_follow_up_edit_holds (
          follow_up_id, session_id, hold_id, holder_caller_id, acquired_at, missed_sweeps,
          base_queue_revision
        )
        VALUES (
          ${item.id},
          ${state.sessionId},
          ${item.editHold.holdId},
          ${item.editHold.holderCallerId},
          ${item.editHold.acquiredAt},
          ${item.editHold.missedSweeps},
          ${item.editHold.baseQueueRevision}
        )
      `
      yield* retainFollowUpEditAttachments(
        sql,
        { sessionId: state.sessionId, attachmentIds: item.intent.attachmentIds },
        now,
      )
    }
    yield* sql`
      DELETE FROM temp.session_follow_up_deferred_retries WHERE session_id = ${state.sessionId}
    `
    const { deferredRetryAfter } = state.followUpQueue
    if (deferredRetryAfter !== undefined && state.run.state === 'idle') {
      yield* sql`
        INSERT INTO temp.session_follow_up_deferred_retries (session_id, accepted_after)
        VALUES (${state.sessionId}, ${deferredRetryAfter})
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
 * Renews a live hold. An expired hold stays expired: once a load could have ignored it, renewing
 * it would resurrect a hold the queue may already have delivered past.
 */
export function renewFollowUpEditHold(
  sql: SqlClient.SqlClient,
  input: FollowUpEditHoldKey & { readonly holderCallerId: string },
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<{ readonly follow_up_id: string }>`
      UPDATE temp.session_follow_up_edit_holds
      SET missed_sweeps = 0
      WHERE follow_up_id = ${input.followUpId}
        AND session_id = ${input.sessionId}
        AND hold_id = ${input.holdId}
        AND holder_caller_id = ${input.holderCallerId}
        AND missed_sweeps < ${FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS}
        AND EXISTS (
          SELECT 1 FROM session_follow_ups
          WHERE session_follow_ups.id = ${input.followUpId}
            AND session_follow_ups.session_id = ${input.sessionId}
        )
      RETURNING follow_up_id
    `
    return rows.length > 0
  })
}

/**
 * One Host sweep: every live hold misses a sweep, and the holds whose lease that used up are
 * returned along with any expired earlier. They are not deleted here: the cancel the sweep sends
 * rewrites the Session's holds without them, so a failed cancel leaves the row for the next sweep.
 * Holds of deleted Sessions are dropped.
 */
export function advanceFollowUpEditHoldLeases(sql: SqlClient.SqlClient) {
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* ensureFollowUpEditHoldTable(sql)
      yield* sql`
        DELETE FROM temp.session_follow_up_edit_holds
        WHERE session_id NOT IN (SELECT session_id FROM session_control_states)
      `
      yield* sql`
        UPDATE temp.session_follow_up_edit_holds
        SET missed_sweeps = missed_sweeps + 1
        WHERE missed_sweeps < ${FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS}
      `
      const rows = yield* sql<EditHoldRow>`
        SELECT follow_up_id, session_id, hold_id, holder_caller_id, acquired_at, missed_sweeps,
          base_queue_revision
        FROM temp.session_follow_up_edit_holds
        WHERE missed_sweeps >= ${FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS}
      `
      return rows.map((row) => ({
        sessionId: row.session_id,
        followUpId: row.follow_up_id,
        holdId: row.hold_id,
        holderCallerId: row.holder_caller_id,
      }))
    }),
  )
}

/** Sessions whose queue waits on a Follow-up edit, with the earliest hold's acquisition time. */
export function listFollowUpEditHeldSessions(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<{ readonly session_id: string; readonly acquired_at: number }>`
      SELECT holds.session_id, MIN(holds.acquired_at) AS acquired_at
      FROM temp.session_follow_up_edit_holds AS holds
      JOIN session_follow_ups ON session_follow_ups.id = holds.follow_up_id
        AND session_follow_ups.session_id = holds.session_id
      WHERE holds.missed_sweeps < ${FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS}
      GROUP BY holds.session_id
    `
    return new Map(rows.map((row) => [row.session_id, row.acquired_at]))
  })
}
