import {
  HEARTBEAT_WAKE_CHECK_TIMEOUT_MS,
  type ScheduledTaskRunWakeCheck,
} from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import {
  clearWakeCheckPending,
  markWakeCheckPending,
} from '../application/scheduled-task-bookkeeping'
import { scheduledTaskHooks } from '../application/scheduled-task-hooks'
import { wakeCheckApproval } from '../application/scheduled-task-presentation'
import type {
  HeartbeatRunContext,
  HeartbeatWakeCheckReport,
} from '../domain/scheduled-tasks/heartbeat-run-context'
import { decideWakeCheck } from '../domain/scheduled-tasks/wake-check-decision'
import type {
  ScheduledTaskRecord,
  ScheduledTaskRunSettlement,
  ScheduledTaskSessionActivity,
} from '../ports/scheduled-task-repository'

/** What a firing sends with its request, beyond the Session Control outcome. */
export interface HeartbeatSendExtras {
  readonly wakeCheck?: ScheduledTaskRunWakeCheck
  readonly reason?: 'wake-check-failed'
  readonly message?: string
}

export type HeartbeatGate =
  /** The Session asks for approval and the user has not approved this command yet. */
  | { readonly kind: 'held' }
  /** Nothing is sent; `idle` counts toward Auto-pause. */
  | {
      readonly kind: 'skip'
      readonly settlement: ScheduledTaskRunSettlement
      readonly idle: boolean
    }
  | {
      readonly kind: 'send'
      readonly report?: HeartbeatWakeCheckReport
      readonly extras: HeartbeatSendExtras
    }

const IDLE_MESSAGE = 'The Wake check exited 0 and printed nothing.'

function runCheck(record: ScheduledTaskRecord, activity: ScheduledTaskSessionActivity) {
  const command = record.wakeCheck?.command ?? ''
  if (!activity.workingPath) {
    return Effect.succeed(
      decideWakeCheck(
        command,
        {
          exitCode: null,
          signal: null,
          timedOut: false,
          stdout: '',
          stderr: '',
          truncated: false,
          startError: 'The Session has no workspace.',
        },
        HEARTBEAT_WAKE_CHECK_TIMEOUT_MS,
      ),
    )
  }
  return scheduledTaskHooks()
    .runWakeCheck({ command, workingPath: activity.workingPath, projectPath: activity.projectPath })
    .pipe(
      Effect.map((execution) =>
        decideWakeCheck(command, execution, HEARTBEAT_WAKE_CHECK_TIMEOUT_MS),
      ),
    )
}

/** Whether the Heartbeat must wait for the user to approve its Wake check (#388). */
function heldForApproval(record: ScheduledTaskRecord, now: number) {
  return Effect.gen(function* () {
    const wakeCheck = record.wakeCheck
    if (!wakeCheck || wakeCheckApproval(wakeCheck) === 'approved') return false
    const mode = yield* scheduledTaskHooks().sessionAuthorizationMode(
      record.target.kind === 'heartbeat' ? record.target.sessionId : '',
      record.creatorCallerId,
    )
    if (mode === 'ask-for-approval') {
      yield* markWakeCheckPending(record, now)
      return true
    }
    if (wakeCheck.pendingSince !== null) yield* clearWakeCheckPending(record, now)
    return false
  })
}

/**
 * A Heartbeat's Wake check, run by the Host before anything reaches Pi (#388): a firing it finds
 * nothing for is recorded as skipped and starts no Session, Run or model call. A check that fails
 * is never read as nothing to do: by default it wakes the Run with what it printed.
 */
export function evaluateHeartbeatGate(
  record: ScheduledTaskRecord,
  activity: ScheduledTaskSessionActivity,
  now: number,
) {
  return Effect.gen(function* () {
    if (!record.wakeCheck) return { kind: 'send', extras: {} } satisfies HeartbeatGate
    if (yield* heldForApproval(record, now)) return { kind: 'held' } satisfies HeartbeatGate
    const decision = yield* runCheck(record, activity)
    if (decision.kind === 'idle') {
      return {
        kind: 'skip',
        settlement: {
          status: 'skipped',
          reason: 'wake-check-idle',
          message: IDLE_MESSAGE,
          wakeCheck: 'idle',
        },
        idle: true,
      } satisfies HeartbeatGate
    }
    if (decision.kind === 'failed' && record.wakeCheck.onFailure === 'skip') {
      return {
        kind: 'skip',
        settlement: {
          status: 'skipped',
          reason: 'wake-check-failed',
          message: decision.message,
          wakeCheck: 'failed',
        },
        idle: false,
      } satisfies HeartbeatGate
    }
    return {
      kind: 'send',
      report: decision.report,
      extras: {
        wakeCheck: decision.kind === 'failed' ? 'failed' : 'woke',
        ...(decision.kind === 'failed' ? { reason: 'wake-check-failed' } : {}),
        message: decision.message,
      },
    } satisfies HeartbeatGate
  })
}

/** What the Heartbeat Run is told about its task, as of this firing (#388 decision C). */
export function heartbeatRunContext(
  record: ScheduledTaskRecord,
  report: HeartbeatWakeCheckReport | undefined,
): HeartbeatRunContext | undefined {
  if (record.target.kind !== 'heartbeat') return undefined
  const runNumber = record.runCount + 1
  return {
    runNumber,
    consecutiveIdleRuns: record.consecutiveIdleRuns,
    idlePauseAfter: record.idlePauseAfter,
    stopWhen: record.stopWhen,
    indefinite: record.indefinite,
    endsAt: record.endsAt,
    maxRuns: record.maxRuns,
    remainingRuns: record.maxRuns === null ? null : Math.max(0, record.maxRuns - runNumber),
    ...(record.target.modelId ? { modelId: record.target.modelId } : {}),
    ...(record.target.thinkingLevel ? { thinkingLevel: record.target.thinkingLevel } : {}),
    ...(report ? { wakeCheck: report } : {}),
  }
}
