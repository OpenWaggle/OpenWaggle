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
import {
  holdsPersonFollowUp,
  type RunCaller,
  workerRunAdmissionRefusal,
} from './sqlite-worker-run-admission'

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

/**
 * The capacity rule for the Run `state` is starting (`sqlite-worker-run-admission.ts`): only
 * agents' work can be refused. A Run the person's request starts, and a Run that acts for the
 * person, are always admitted. `requestCaller` is who sent the request that starts it; a Hive
 * wake has none of its own, so its caller never reads as a request from the person.
 */
export function newRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  hostRunCeiling: number,
  requestCaller?: RunCaller,
) {
  return workerRunAdmissionRefusal(sql, {
    sessionId: state.sessionId,
    runCaller: startingRunCaller(state),
    ...(requestCaller ? { requestCaller } : {}),
    hostRunCeiling,
  })
}

/** Who the starting Run acts for; a state with no starting Run is held to the agents' rule. */
function startingRunCaller(state: SessionControlSessionState): RunCaller {
  if (state.run.state !== 'starting') return { callerId: '' }
  const { callerId, idempotencyKey, hiveWake } = state.run.intent
  return hiveWake ? { callerId, idempotencyKey, hiveWake } : { callerId, idempotencyKey }
}

function queueUpdated(
  operation: DeliveringOperation,
  state: SessionControlSessionState,
  withdrawn: WithdrawnFollowUps,
): SessionControlMutationOutcome {
  return {
    operation,
    effect: 'queue-updated',
    sessionId: state.sessionId,
    queueState: state.followUpQueue.state,
    queueRevision: state.followUpQueue.revision,
    remainingFollowUpIds: state.followUpQueue.items.map((item) => item.id),
    ...withdrawn,
    stateRevision: state.revision,
  }
}

type WithdrawnFollowUps = { readonly withdrawnFollowUpIds?: readonly string[] }

/** A delivery decision rebuilds the outcome; the ids a withdraw removed must survive it. */
function withdrawnFollowUps(outcome: SessionControlMutationOutcome): WithdrawnFollowUps {
  return outcome.effect === 'queue-updated' && outcome.withdrawnFollowUpIds
    ? { withdrawnFollowUpIds: outcome.withdrawnFollowUpIds }
    : {}
}

/**
 * Applies the delivery rule to an accepted queue decision. The head's current authorization is
 * checked before it starts, and a Run the Host cannot admit pauses the queue instead (with
 * `parent-limit` for either Worker limit).
 */
export function deliverAfterQueueDecision(
  sql: SqlClient.SqlClient,
  input: {
    readonly decision: SessionControlMutationDecision
    readonly operation: SessionControlMutationCommand['operation']
    readonly nextRunId: RunId | undefined
    readonly hostRunCeiling: number
    /** Who sent the queue change; the person's own change always delivers. */
    readonly requestCaller: RunCaller
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
  const withdrawn = withdrawnFollowUps(decision.outcome)
  return Effect.gen(function* () {
    const candidate = deliverIdleQueueHead(decision.state, nextRunId)
    if (!candidate.delivered) {
      return {
        ...decision,
        state: candidate.state,
        outcome: queueUpdated(operation, candidate.state, withdrawn),
      }
    }
    const authorized = yield* applyCurrentFollowUpAuthorization(sql, decision.state)
    const delivery = deliverIdleQueueHead(authorized, nextRunId)
    if (!delivery.delivered) {
      return {
        ...decision,
        state: delivery.state,
        outcome: queueUpdated(operation, delivery.state, withdrawn),
      }
    }
    const refusal = (yield* holdsPersonFollowUp(sql, delivery.state.followUpQueue.items))
      ? undefined
      : yield* newRunAdmissionRefusal(
          sql,
          delivery.state,
          input.hostRunCeiling,
          input.requestCaller,
        )
    if (refusal) {
      // Both Worker limits pause as `parent-limit`, a reason every binary decodes: it marks a
      // queue that waits on capacity, delivered again when the Session's Run settles with the
      // person's Follow-up in it, or when the person resumes it.
      const paused = pauseUndeliveredQueue(authorized, 'parent-limit')
      return { ...decision, state: paused, outcome: queueUpdated(operation, paused, withdrawn) }
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
        ...withdrawn,
        queueRevision: delivery.state.followUpQueue.revision,
        stateRevision: delivery.state.revision,
      },
    } satisfies SessionControlMutationDecision
  })
}
