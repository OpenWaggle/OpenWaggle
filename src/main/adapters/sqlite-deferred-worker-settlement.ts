import type * as SqlClient from '@effect/sql/SqlClient'
import { RunId, type SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { waitsOnHeldNextFollowUp } from '../domain/session-control/follow-up-delivery'
import { SessionControlRepositoryError } from '../errors'
import { ensureFollowUpEditHoldTable } from './sqlite-follow-up-edit-holds'
import { loadSessionControlState } from './sqlite-session-control-state'
import { settleWorkerDelegation } from './sqlite-session-control-worker-settlement'

/*
 * A Worker whose Run completes while its queue's next Follow-up is out for an edit is not done:
 * its Delegation settles after the Run that Follow-up starts (ADR 0043). The completed Run is kept
 * in a connection-scoped TEMP table (see `sqlite-follow-up-edit-holds.ts`) in case the edit ends
 * without starting one. Like the holds it waits on, it is lost on a Host restart; the Worker then
 * stays `working` until its next Run settles.
 */

export interface DeferredWorkerSettlement {
  readonly runId: string
  readonly finalResponse?: string
}

/** Records the completed Run whose Delegation settlement waits on a held Follow-up. */
export function deferWorkerSettlement(
  sql: SqlClient.SqlClient,
  sessionId: string,
  settlement: DeferredWorkerSettlement,
) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    yield* sql`
      INSERT INTO temp.session_deferred_worker_settlements (session_id, run_id, final_response)
      VALUES (${sessionId}, ${settlement.runId}, ${settlement.finalResponse ?? null})
      ON CONFLICT(session_id) DO UPDATE SET
        run_id = excluded.run_id,
        final_response = excluded.final_response
    `
  })
}

/** Removes and returns a Session's deferred Worker settlement. */
export function takeDeferredWorkerSettlement(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<{ readonly run_id: string; readonly final_response: string | null }>`
      DELETE FROM temp.session_deferred_worker_settlements WHERE session_id = ${sessionId}
      RETURNING run_id, final_response
    `
    const row = rows[0]
    if (!row) return undefined
    const settlement: DeferredWorkerSettlement = {
      runId: row.run_id,
      ...(row.final_response === null ? {} : { finalResponse: row.final_response }),
    }
    return settlement
  })
}

/** Whether a Session has a deferred Worker settlement, without taking it. */
function hasDeferredWorkerSettlement(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    yield* ensureFollowUpEditHoldTable(sql)
    const rows = yield* sql<{ readonly session_id: string }>`
      SELECT session_id FROM temp.session_deferred_worker_settlements
      WHERE session_id = ${sessionId}
    `
    return rows.length > 0
  })
}

/**
 * Settles a Worker's Delegation that a held Follow-up deferred (see `settle`), once the Session is
 * idle and its queue no longer waits on an edit: the edit ended (withdrawn, cancelled, saved into a
 * paused queue) without starting a Run. A Run that started instead settles it itself.
 */
export function settleDeferredWorkerDelegation(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        if (!(yield* hasDeferredWorkerSettlement(sql, sessionId))) return undefined
        const state = yield* loadSessionControlState(sql, sessionId)
        if (state.run.state === 'idle' && waitsOnHeldNextFollowUp(state)) return undefined
        const deferred = yield* takeDeferredWorkerSettlement(sql, sessionId)
        if (!deferred || state.run.state !== 'idle') return undefined
        const runId = RunId(deferred.runId)
        return yield* settleWorkerDelegation(
          sql,
          {
            sessionId,
            runId,
            nextRunId: runId,
            terminalStatus: 'completed',
            ...(deferred.finalResponse ? { finalResponse: deferred.finalResponse } : {}),
          },
          false,
          Date.now(),
        )
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : new SessionControlRepositoryError({
              operation: 'settle-deferred-worker-delegation',
              cause,
            }),
      ),
    )
}
