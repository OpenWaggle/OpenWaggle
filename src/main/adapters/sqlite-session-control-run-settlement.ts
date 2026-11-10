import type * as SqlClient from '@effect/sql/SqlClient'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import {
  deliverIdleQueueHead,
  isFollowUpEditHeld,
  markFollowUpNeedsAttention,
} from '../domain/session-control/follow-up-delivery'
import type {
  SessionControlFollowUp,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'
import { isPersonStartedRun } from '../domain/session-control/person-started-run'
import { applyQueueMutation } from '../domain/session-control/queue-aggregate'
import {
  settleAndScheduleNextFollowUp,
  settleSessionRun,
} from '../domain/session-control/run-lifecycle'
import { pauseStrandedFollowUps } from '../domain/session-control/undelivered-steering'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'
import { releaseDeliveredSteerAttachments } from './session-control-attachment-references'
import { messageCallerBlockReason } from './session-follow-up-authorization'
import { deliverAuthorizedPersonFollowUpPastCapacity } from './session-person-follow-up-past-capacity'
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
 * Pauses for a Run's failure. A queue that waited only on agents' capacity (`parent-limit`) takes
 * the failure's reason instead: the person's Follow-ups accepted before the failure wait for their
 * Resume, never for a slot, which would start them on its own.
 */
function pauseForFailure(
  state: SessionControlSessionState,
  nextRunId: SettleInput['nextRunId'],
  reason: FollowUpQueuePauseReason,
) {
  const queue = state.followUpQueue
  if (queue.state !== 'paused' || queue.pauseReason !== 'parent-limit') {
    return pauseRunningQueue(state, nextRunId, reason)
  }
  return {
    ...state,
    followUpQueue: {
      ...queue,
      pauseReason: reason,
      revision: queue.revision + QUEUE_REVISION_INCREMENT,
    },
  }
}

/**
 * Settles a Run that did not complete. The rule for Follow-ups: the failure pauses those accepted
 * up to its terminal event, which were queued without knowing the Run would fail. One accepted
 * after it was sent by someone who had seen the Run end, so it is an explicit retry: the first such
 * Follow-up starts now, ahead of the paused ones, and the queue pauses only if earlier ones remain.
 * With `personRetryOnly` (a Worker limit holds back agents' retries) the first retry the person
 * sent starts instead, and agents' retries wait in a queue paused `parent-limit` if it still ran.
 */
function settleUnsuccessfulRun(
  state: SessionControlSessionState,
  input: SettleInput & { readonly terminalStatus: keyof typeof PAUSE_REASON_BY_TERMINAL_STATUS },
  personRetryOnly = false,
) {
  const settled = settleSessionRun(state, input.runId)
  if (!settled.accepted) return { ...settled, scheduled: undefined }
  const { terminalEventAt } = input
  const isRetry = (item: SessionControlFollowUp) =>
    terminalEventAt !== undefined && item.intent.acceptedAt > terminalEventAt
  const items = settled.state.followUpQueue.items
  const hasEarlierFollowUps = terminalEventAt === undefined || items.some((item) => !isRetry(item))
  const failed = hasEarlierFollowUps
    ? pauseForFailure(
        settled.state,
        input.nextRunId,
        PAUSE_REASON_BY_TERMINAL_STATUS[input.terminalStatus],
      )
    : settled.state
  const next = personRetryOnly ? pauseRunningQueue(failed, input.nextRunId, 'parent-limit') : failed
  const retryIndex = items.findIndex(
    (item) => isRetry(item) && (!personRetryOnly || isPersonStartedRun(item.intent)),
  )
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

/**
 * Plans a Run's settlement. `deferred` says a Worker limit holds back the agents' Run it would
 * start next: a completed Run's queue then pauses with `parent-limit` (a reason every binary
 * decodes) unless it was paused already, and an unsuccessful Run's starts only the person's retry.
 */
export function planRunSettlement(
  state: SessionControlSessionState,
  input: SettleInput,
  deferred = false,
) {
  if (input.suppressFollowUpScheduling) {
    return { ...settleSessionRun(state, input.runId), scheduled: undefined }
  }
  const { terminalStatus } = input
  if (deferred && terminalStatus !== 'completed') {
    return settleUnsuccessfulRun(state, { ...input, terminalStatus }, true)
  }
  if (deferred) {
    const settled = settleSessionRun(state, input.runId)
    if (!settled.accepted) return { ...settled, scheduled: undefined }
    const paused = pauseRunningQueue(settled.state, input.nextRunId, 'parent-limit')
    return { ...settled, state: paused, scheduled: undefined }
  }
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
 * person sent runs next whatever the limits. After a completed Run, the person's first Follow-up
 * in a queue that waits on capacity starts ahead of the agents' ones the limit holds back
 * (`deliverPersonFollowUpPastCapacity`), and after an unsuccessful one the person's first retry
 * does (ADR 0030, amended 2026-11-09 and 2026-11-10). With no Run to start (an empty queue, or a
 * head held for the person's edit) nothing waits, so the queue is not paused: a pause there
 * outlived the limit, and held back the person's edited or later Follow-ups, which are admitted
 * when they are delivered.
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
    if (nextRun && isPersonStartedRun(nextRun.intent)) return planned
    const refusal = nextRun
      ? yield* workerRunAdmissionRefusal(sql, {
          sessionId: input.sessionId,
          caller: nextRun.intent,
          hostRunCeiling: storedHostRunCeiling(sql),
        })
      : undefined
    if (nextRun && !refusal) return planned
    if (input.terminalStatus !== 'completed') {
      return refusal ? yield* planPersonRetry(sql, state, input) : planned
    }
    const settled = refusal ? planRunSettlement(state, input, true) : planned
    if (!settled.accepted) return settled
    const delivery = yield* deliverAuthorizedPersonFollowUpPastCapacity(
      sql,
      settled.state,
      input.nextRunId,
    )
    return delivery.delivered
      ? { accepted: true as const, state: delivery.state, scheduled: delivery.delivered }
      : { ...settled, state: delivery.state }
  })
}

/**
 * Settles an unsuccessful Run whose agents' retry a Worker limit holds back, starting the person's
 * retry instead after the current-authority check (ADR 0057): one whose authority changed needs
 * attention, and nothing starts.
 */
function planPersonRetry(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  input: SettleInput,
) {
  return Effect.gen(function* () {
    const planned = planRunSettlement(state, input, true)
    if (!planned.accepted || !planned.scheduled) return planned
    const { followUpId, intent } = planned.scheduled
    const reason = yield* messageCallerBlockReason(sql, input.sessionId, intent.callerId)
    return reason
      ? planRunSettlement(markFollowUpNeedsAttention(state, followUpId, reason), input, true)
      : planned
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
