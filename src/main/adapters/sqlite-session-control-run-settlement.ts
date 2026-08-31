import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { applyQueueMutation } from '../domain/session-control/queue-aggregate'
import {
  settleAndScheduleNextFollowUp,
  settleSessionRun,
} from '../domain/session-control/run-lifecycle'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'
import { hasPendingReplacementForRun } from './sqlite-session-follow-up-reservation'

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

export function planRunSettlement(
  state: SessionControlSessionState,
  input: SettleInput,
  deferForParentLimit: boolean,
) {
  if (!input.suppressFollowUpScheduling && !deferForParentLimit) {
    return settleAndScheduleNextFollowUp(state, input.runId, input.nextRunId)
  }
  const settled = settleSessionRun(state, input.runId)
  if (!settled.accepted || !deferForParentLimit) {
    return { ...settled, scheduled: undefined }
  }
  if (settled.state.followUpQueue.state !== 'running') {
    return { ...settled, scheduled: undefined }
  }
  const paused = applyQueueMutation({
    state: settled.state,
    mutation: { type: 'pause', expectedRevision: settled.state.followUpQueue.revision },
    nextRunId: input.nextRunId,
  })
  return { ...(paused.accepted ? paused : settled), scheduled: undefined }
}
