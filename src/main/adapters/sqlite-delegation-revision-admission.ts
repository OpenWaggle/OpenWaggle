import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionHostRefusalCode } from '@shared/domain/session-host-refusals'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { delegationRevisionKey } from '../domain/session-control/delegation-revision-follow-up'
import { liveCallerMessageBlockReason } from './session-follow-up-authorization'
import { storedHostRunCeiling } from './sqlite-session-parent-run-admission'
import { workerRunAdmissionRefusal } from './sqlite-worker-run-admission'

/** Whether a Follow-up queued now on the Session would start a Run at once. */
function followUpStartsRun(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly active_run_id: string | null; readonly queue_state: string }>`
    SELECT active_run_id, queue_state FROM session_control_states WHERE session_id = ${sessionId}
  `.pipe(
    Effect.map((rows) => {
      const row = rows[0]
      return !row || (row.active_run_id === null && row.queue_state !== 'paused')
    }),
  )
}

/**
 * Why the revision request a command would send its Worker (#454) could not reach it, checked in
 * the command's transaction so that a refused command changes nothing, or undefined when it can:
 *
 * - `worker_message_denied`: the caller may not message the Worker, by the check queued Follow-up
 *   delivery makes and by the live caller's own authority (`liveCallerMessageBlockReason`).
 * - `parent_concurrency_limit_reached` or `host_run_ceiling_reached`: the Worker is idle, so the
 *   request would start a Run, and a Worker limit is full. Retryable, as for a `follow_up`; the
 *   person's own command is never held back. A busy Worker's request waits in its queue instead.
 */
export function revisionDeliveryRefusal(
  sql: SqlClient.SqlClient,
  input: {
    readonly callerId: string
    readonly caller?: LocalSessionCallerIdentity
    readonly workerSessionId: string
    readonly operation: string
    readonly idempotencyKey: string
  },
): Effect.Effect<SessionHostRefusalCode | undefined, unknown> {
  return Effect.gen(function* () {
    const blocked = yield* liveCallerMessageBlockReason(sql, {
      sessionId: input.workerSessionId,
      callerId: input.callerId,
      ...(input.caller ? { caller: input.caller } : {}),
    })
    if (blocked) return 'worker_message_denied' as const
    if (!(yield* followUpStartsRun(sql, input.workerSessionId))) return undefined
    return yield* workerRunAdmissionRefusal(sql, {
      sessionId: input.workerSessionId,
      caller: {
        callerId: input.callerId,
        idempotencyKey: delegationRevisionKey(input.operation, input.idempotencyKey),
      },
      hostRunCeiling: storedHostRunCeiling(sql),
    })
  })
}
