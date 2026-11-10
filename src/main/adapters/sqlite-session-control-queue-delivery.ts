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
import { isHostFollowUpEditHoldReleaseKey } from '../domain/session-control/follow-up-edit-hold-release-key'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import {
  queueHoldsPersonFollowUp,
  type StartingRunCaller,
} from '../domain/session-control/person-started-run'
import { isLocalUserCallerId } from '../domain/session-control/root-session-project-reach'
import type { SessionControlMutationDecision } from '../ports/session-control-repository'
import { applyCurrentFollowUpAuthorization } from './session-follow-up-authorization'
import { workerRunAdmissionRefusal } from './sqlite-worker-run-admission'

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

/** Who acts in a mutation: its caller, operation and request key. */
interface MutationActor {
  readonly callerId: string
  readonly operation: SessionControlMutationCommand['operation']
  readonly idempotencyKey: string
}

/**
 * The capacity rule for the Run `state` is starting: only an agent-made Session's Run that an
 * agent or the Host starts can be refused (`sqlite-worker-run-admission.ts`). The person's Runs,
 * a Run the person's own queue action delivers, and the Runs of the person's Sessions are always
 * admitted.
 */
export function newRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  hostRunCeiling: number,
  actor?: MutationActor,
) {
  return workerRunAdmissionRefusal(sql, {
    sessionId: state.sessionId,
    caller: startingRunCaller(state, actor),
    hostRunCeiling,
  })
}

/** Who the starting Run acts for; a state with no starting Run is held to the Worker rule. */
function startingRunCaller(
  state: SessionControlSessionState,
  actor: MutationActor | undefined,
): StartingRunCaller {
  if (state.run.state !== 'starting') return { callerId: '' }
  const { callerId, idempotencyKey, hiveWake } = state.run.intent
  // The Host's release of an edit hold (expired, or its window gone) is sent as the person who
  // held it, but it is not their action.
  const personActed =
    actor !== undefined &&
    isDeliveringOperation(actor.operation) &&
    isLocalUserCallerId(actor.callerId) &&
    !isHostFollowUpEditHoldReleaseKey(actor.idempotencyKey)
  return {
    callerId,
    idempotencyKey,
    ...(hiveWake ? { hiveWake } : {}),
    ...(personActed ? { personActed } : {}),
  }
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
 * `parent-limit`, or with no reason for the Host's own ceiling).
 */
export function deliverAfterQueueDecision(
  sql: SqlClient.SqlClient,
  input: {
    readonly decision: SessionControlMutationDecision
    readonly operation: SessionControlMutationCommand['operation']
    readonly nextRunId: RunId | undefined
    readonly hostRunCeiling: number
    /** The mutation's caller: the person's own queue action delivers its Run whatever the limits. */
    readonly callerId: string
    readonly idempotencyKey: string
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
    // A running queue delivers in order: holding its agent head back would hold back the
    // person's Follow-up behind it.
    const refusal = queueHoldsPersonFollowUp(delivery.state.followUpQueue)
      ? undefined
      : yield* newRunAdmissionRefusal(sql, delivery.state, input.hostRunCeiling, {
          callerId: input.callerId,
          operation,
          idempotencyKey: input.idempotencyKey,
        })
    if (refusal) {
      const paused = pauseUndeliveredQueue(
        authorized,
        refusal === 'parent_concurrency_limit_reached' ? 'parent-limit' : undefined,
      )
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
