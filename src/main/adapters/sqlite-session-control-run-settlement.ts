import type * as SqlClient from '@effect/sql/SqlClient'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import {
  deliverIdleQueueHead,
  isFollowUpEditHeld,
  pauseUndeliveredQueue,
} from '../domain/session-control/follow-up-delivery'
import type {
  SessionControlFollowUp,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'
import {
  isPersonStartedRun,
  queueHoldsPersonFollowUp,
} from '../domain/session-control/person-started-run'
import { applyQueueMutation } from '../domain/session-control/queue-aggregate'
import {
  settleAndScheduleNextFollowUp,
  settleSessionRun,
} from '../domain/session-control/run-lifecycle'
import { pauseStrandedFollowUps } from '../domain/session-control/undelivered-steering'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'
import { releaseDeliveredSteerAttachments } from './session-control-attachment-references'
import { persistSessionControlState } from './sqlite-session-control-state'
import { hasPendingReplacementForRun } from './sqlite-session-follow-up-reservation'
import { storedHostRunCeiling } from './sqlite-session-parent-run-admission'
import { workerRunAdmissionRefusal } from './sqlite-worker-run-admission'

const QUEUE_REVISION_INCREMENT = 1

export type SettleInput = Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0]

export function replacementIsPending(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  input: SettleInput,
) {
  if (state.run.state !== 'stopping' || state.run.runId !== input.runId) {
    return Effect.succeed(false)
  }
  return hasPendingReplacementForRun(sql, input.sessionId, input.runId)
}

const PAUSE_REASON_BY_TERMINAL_STATUS = {
  failed: 'run-failed',
  interrupted: 'run-interrupted',
  'interrupted-by-interaction-timeout': 'run-timed-out',
} as const satisfies Record<
  Exclude<SettleInput['terminalStatus'], 'completed'>,
  FollowUpQueuePauseReason
>

function pauseRunningQueue(
  state: SessionControlSessionState,
  nextRunId: SettleInput['nextRunId'],
  reason: FollowUpQueuePauseReason,
) {
  if (state.followUpQueue.state !== 'running') return state
  const paused = applyQueueMutation({
    state,
    mutation: { type: 'pause', expectedRevision: state.followUpQueue.revision, reason },
    nextRunId,
  })
  return paused.accepted ? paused.state : state
}

/**
 * Settles a Run that did not complete. The rule for Follow-ups: the failure pauses those accepted
 * up to its terminal event, which were queued without knowing the Run would fail. One accepted
 * after it was sent by someone who had seen the Run end, so it is an explicit retry: the first such
 * Follow-up starts now, ahead of the paused ones, and the queue pauses only if earlier ones remain.
 */
function settleUnsuccessfulRun(
  state: SessionControlSessionState,
  input: SettleInput & { readonly terminalStatus: keyof typeof PAUSE_REASON_BY_TERMINAL_STATUS },
) {
  const settled = settleSessionRun(state, input.runId)
  if (!settled.accepted) return { ...settled, scheduled: undefined }
  const { terminalEventAt } = input
  const isRetry = (item: SessionControlFollowUp) =>
    terminalEventAt !== undefined && item.intent.acceptedAt > terminalEventAt
  const items = settled.state.followUpQueue.items
  const hasEarlierFollowUps = terminalEventAt === undefined || items.some((item) => !isRetry(item))
  const next = hasEarlierFollowUps
    ? pauseRunningQueue(
        settled.state,
        input.nextRunId,
        PAUSE_REASON_BY_TERMINAL_STATUS[input.terminalStatus],
      )
    : settled.state
  const retryIndex = items.findIndex(isRetry)
  const retry = items[retryIndex]
  if (retry?.deliveryState !== 'pending') {
    return { accepted: true as const, state: next, scheduled: undefined }
  }
  // A Follow-up edit hold stops delivery at the held item, so a retry behind one waits for the
  // hold to end; `deliverIdleQueueHead` starts it then.
  if (terminalEventAt !== undefined && items.slice(0, retryIndex + 1).some(isFollowUpEditHeld)) {
    return {
      accepted: true as const,
      state: {
        ...next,
        followUpQueue: { ...next.followUpQueue, deferredRetryAfter: terminalEventAt },
      },
      scheduled: undefined,
    }
  }
  return {
    accepted: true as const,
    state: {
      ...next,
      run: { state: 'starting' as const, runId: input.nextRunId, intent: retry.intent },
      followUpQueue: {
        ...next.followUpQueue,
        revision: next.followUpQueue.revision + QUEUE_REVISION_INCREMENT,
        items: next.followUpQueue.items.filter((item) => item.id !== retry.id),
      },
    },
    scheduled: { followUpId: retry.id, runId: input.nextRunId, intent: retry.intent },
  }
}

/** Why a settling Run's next Run waits: a Worker limit was full when it would have started. */
type SettlementDeferral = 'parent-limit' | 'host-ceiling'

export function planRunSettlement(
  state: SessionControlSessionState,
  input: SettleInput,
  deferral?: SettlementDeferral,
) {
  if (input.suppressFollowUpScheduling) {
    return { ...settleSessionRun(state, input.runId), scheduled: undefined }
  }
  if (deferral) {
    const settled = settleSessionRun(state, input.runId)
    if (!settled.accepted) return { ...settled, scheduled: undefined }
    // No reason for the ceiling: older binaries decode a missing one, and none names it.
    const paused =
      deferral === 'parent-limit'
        ? pauseRunningQueue(settled.state, input.nextRunId, 'parent-limit')
        : pauseUndeliveredQueue(settled.state)
    return { ...settled, state: paused, scheduled: undefined }
  }
  const { terminalStatus } = input
  const result =
    terminalStatus === 'completed'
      ? settleAndScheduleNextFollowUp(state, input.runId, input.nextRunId)
      : settleUnsuccessfulRun(state, { ...input, terminalStatus })
  if (!result.accepted || result.scheduled) return result
  // Whatever an idle queue could deliver now is delivered, so it never waits with nothing to wake it.
  const delivery = deliverIdleQueueHead(result.state, input.nextRunId)
  return delivery.delivered
    ? { accepted: true as const, state: delivery.state, scheduled: delivery.delivered }
    : { ...result, state: delivery.state }
}

/**
 * Plans the settlement, deferring the next Run when a Worker limit is full: the parent's Workers
 * per parent for a Worker, and Active Workers for an agent-made Session's Run or an agent's Run in
 * the person's Session, which a Run the person started there may have passed. A Follow-up the
 * person sent runs next whatever the limits, and so does an agent's queued ahead of one the
 * person sent: a running queue delivers in order (ADR 0030, amended 2026-11-09 and 2026-11-10). With no Run to start (an empty queue, or a head held for the
 * person's edit) nothing waits, so the queue is not paused: a pause there outlived the limit, and
 * held back the person's edited or later Follow-ups, which are admitted when they are delivered.
 */
export function planRunSettlementWithinWorkerLimits(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  input: SettleInput,
) {
  return Effect.gen(function* () {
    const planned = planRunSettlement(state, input)
    if (input.suppressFollowUpScheduling) return planned
    const nextRun = planned.accepted ? planned.scheduled : undefined
    if (!nextRun || isPersonStartedRun(nextRun.intent)) return planned
    if (queueHoldsPersonFollowUp(planned.state.followUpQueue)) return planned
    const refusal = yield* workerRunAdmissionRefusal(sql, {
      sessionId: input.sessionId,
      caller: nextRun.intent,
      hostRunCeiling: storedHostRunCeiling(sql),
    })
    if (!refusal) return planned
    return planRunSettlement(
      state,
      input,
      refusal === 'parent_concurrency_limit_reached' ? 'parent-limit' : 'host-ceiling',
    )
  })
}

/**
 * Settle a Run that no longer owns its Session: a pending replacement is taking over (`stopping`
 * with a replace operation in flight), or another writer already displaced it. The Session state
 * is not this Run's to change, but its Undelivered steering messages still return to the queue,
 * with their own state revision, which the result reports so the change is published. A queue left
 * running on a Session with no Run is paused, since nothing would schedule it.
 */
export function settleDisplacedRun(
  sql: SqlClient.SqlClient,
  input: {
    readonly loadedState: SessionControlSessionState
    readonly returned: SessionControlSessionState
    readonly input: SettleInput
    readonly code?: 'run_not_starting' | 'run_not_active' | 'run_changed'
  },
) {
  return Effect.gen(function* () {
    const code = input.code ?? 'run_not_active'
    if (input.returned === input.loadedState) return { accepted: false, code } as const
    const state = pauseStrandedFollowUps(input.returned)
    yield* persistSessionControlState(sql, state, Date.now())
    yield* releaseDeliveredSteerAttachments(sql, input.input)
    return { accepted: false, code, stateRevision: state.revision } as const
  })
}
