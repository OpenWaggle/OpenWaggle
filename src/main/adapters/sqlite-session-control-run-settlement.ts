import type * as SqlClient from '@effect/sql/SqlClient'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import type {
  SessionControlFollowUp,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'
import { applyQueueMutation } from '../domain/session-control/queue-aggregate'
import {
  settleAndScheduleNextFollowUp,
  settleSessionRun,
} from '../domain/session-control/run-lifecycle'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'
import { hasPendingReplacementForRun } from './sqlite-session-follow-up-reservation'

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
  const retry = items.find(isRetry)
  if (!retry || retry.deliveryState !== 'pending') {
    return { accepted: true as const, state: next, scheduled: undefined }
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

export function planRunSettlement(
  state: SessionControlSessionState,
  input: SettleInput,
  deferForParentLimit: boolean,
) {
  if (input.suppressFollowUpScheduling) {
    return { ...settleSessionRun(state, input.runId), scheduled: undefined }
  }
  if (input.pauseFollowUpsForHostStop) {
    const settled = settleSessionRun(state, input.runId)
    if (!settled.accepted) return { ...settled, scheduled: undefined }
    return {
      ...settled,
      state: pauseRunningQueue(settled.state, input.nextRunId, 'host-lost'),
      scheduled: undefined,
    }
  }
  if (deferForParentLimit) {
    const settled = settleSessionRun(state, input.runId)
    if (!settled.accepted) return { ...settled, scheduled: undefined }
    return {
      ...settled,
      state: pauseRunningQueue(settled.state, input.nextRunId, 'parent-limit'),
      scheduled: undefined,
    }
  }
  const { terminalStatus } = input
  if (terminalStatus === 'completed') {
    return settleAndScheduleNextFollowUp(state, input.runId, input.nextRunId)
  }
  return settleUnsuccessfulRun(state, { ...input, terminalStatus })
}
