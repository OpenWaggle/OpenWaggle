import type * as SqlClient from '@effect/sql/SqlClient'
import type { RunId } from '@shared/types/brand'
import type {
  SessionControlMutationCommand,
  SessionControlMutationOutcome,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  deliverIdleQueueHead,
  pauseUndeliveredQueue,
} from '../domain/session-control/follow-up-delivery'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import type { SessionControlMutationDecision } from '../ports/session-control-repository'
import { applyCurrentFollowUpAuthorization } from './session-follow-up-authorization'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

/**
 * Queue changes whose outcome can report the Run they start. After any of them the queue delivers
 * whatever an idle Session could deliver now: a hold withdrawn, reordered past, adopted,
 * saved, cancelled, or expired must not leave the Session idle with a runnable queue.
 */
const DELIVERING_QUEUE_OPERATIONS = new Set<SessionControlMutationCommand['operation']>([
  'queue-withdraw',
  'queue-reorder',
  'queue-resume',
  'queue-adopt',
  'queue-edit-save',
  'queue-edit-cancel',
])

type DeliveringOperation =
  | 'queue-withdraw'
  | 'queue-reorder'
  | 'queue-resume'
  | 'queue-adopt'
  | 'queue-edit-save'
  | 'queue-edit-cancel'

function isDeliveringOperation(
  operation: SessionControlMutationCommand['operation'],
): operation is DeliveringOperation {
  return DELIVERING_QUEUE_OPERATIONS.has(operation)
}

export function newRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  sessionId: string,
  hostRunCeiling: number,
) {
  return Effect.gen(function* () {
    const parentAdmission = yield* directWorkerRunAdmission(sql, sessionId)
    if (!parentAdmission.admitted) return 'parent_concurrency_limit_reached' as const
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_control_states
      WHERE active_run_id IS NOT NULL
    `
    const hostActiveRuns = rows[0]?.count ?? 0
    return hostActiveRuns >= hostRunCeiling ? ('host_run_ceiling_reached' as const) : undefined
  })
}

function queueUpdated(
  operation: DeliveringOperation,
  state: SessionControlSessionState,
): SessionControlMutationOutcome {
  return {
    operation,
    effect: 'queue-updated',
    sessionId: state.sessionId,
    queueState: state.followUpQueue.state,
    queueRevision: state.followUpQueue.revision,
    followUpIds: state.followUpQueue.items.map((item) => item.id),
    stateRevision: state.revision,
  }
}

/**
 * Applies the delivery rule to an accepted queue decision. The head's current authorization is
 * checked before it starts, and a Run the Host cannot admit pauses the queue instead (with
 * `parent-limit`, or with no reason for the Host's own ceiling).
 */
export function deliverAfterQueueDecision(
  sql: SqlClient.SqlClient,
  input: {
    readonly decision: SessionControlMutationDecision
    readonly operation: SessionControlMutationCommand['operation']
    readonly nextRunId: RunId | undefined
    readonly hostRunCeiling: number
  },
): Effect.Effect<SessionControlMutationDecision, unknown> {
  const { decision, operation, nextRunId } = input
  if (
    !decision.accepted ||
    nextRunId === undefined ||
    decision.outcome.effect !== 'queue-updated' ||
    !isDeliveringOperation(operation)
  ) {
    return Effect.succeed(decision)
  }
  return Effect.gen(function* () {
    const candidate = deliverIdleQueueHead(decision.state, nextRunId)
    if (!candidate.delivered) {
      return {
        ...decision,
        state: candidate.state,
        outcome: queueUpdated(operation, candidate.state),
      }
    }
    const authorized = yield* applyCurrentFollowUpAuthorization(sql, decision.state)
    const delivery = deliverIdleQueueHead(authorized, nextRunId)
    if (!delivery.delivered) {
      return {
        ...decision,
        state: delivery.state,
        outcome: queueUpdated(operation, delivery.state),
      }
    }
    const refusal = yield* newRunAdmissionRefusal(
      sql,
      decision.state.sessionId,
      input.hostRunCeiling,
    )
    if (refusal) {
      const paused = pauseUndeliveredQueue(
        authorized,
        refusal === 'parent_concurrency_limit_reached' ? 'parent-limit' : undefined,
      )
      return { ...decision, state: paused, outcome: queueUpdated(operation, paused) }
    }
    return {
      accepted: true,
      state: delivery.state,
      outcome: {
        operation,
        effect: 'started-run',
        sessionId: delivery.state.sessionId,
        runId: delivery.delivered.runId,
        followUpId: delivery.delivered.followUpId,
        queueRevision: delivery.state.followUpQueue.revision,
        stateRevision: delivery.state.revision,
      },
    } satisfies SessionControlMutationDecision
  })
}
