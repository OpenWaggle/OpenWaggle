import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { hasAnyActiveRun } from '../application/active-session-runs'
import { stopScheduledTask } from '../application/scheduled-task-bookkeeping'
import { isLocalUserCallerId } from '../domain/session-control/root-session-project-reach'
import { createLogger } from '../logger'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
  type ScheduledTaskSessionActivity,
} from '../ports/scheduled-task-repository'
import { resolveScheduledTaskCaller } from './scheduled-task-caller'
import { dispatchScheduledTaskCommand } from './scheduled-task-dispatch'

const logger = createLogger('scheduled-tasks')

const ARCHIVE_SWEEP_RUNS = 10

/**
 * Runs one task's share of a sweep. A failure or defect is logged against that task and the sweep
 * moves on, so one broken task never stops the scheduler from firing the others.
 */
export function forTask<R>(
  record: ScheduledTaskRecord,
  step: string,
  effect: Effect.Effect<unknown, unknown, R>,
) {
  return effect.pipe(
    Effect.asVoid,
    Effect.catchAllCause((cause) =>
      // An interruption stops the whole sweep instead of being logged as this task's failure.
      Cause.isInterruptedOnly(cause)
        ? Effect.interrupt
        : Effect.sync(() =>
            logger.warn('Scheduled task step failed', {
              taskId: record.id,
              step,
              cause: Cause.pretty(cause),
            }),
          ),
    ),
  )
}

export function pauseArchivedHeartbeats(enabled: readonly ScheduledTaskRecord[], now: number) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    for (const record of enabled) {
      const target = record.target
      if (target.kind !== 'heartbeat') continue
      yield* forTask(
        record,
        'pause-archived-heartbeat',
        Effect.gen(function* () {
          const activity = yield* repository.sessionActivity(target.sessionId)
          if (activity && !activity.archived) return
          yield* stopScheduledTask(record, {
            reason: activity ? 'target-session-archived' : 'target-session-missing',
            message: activity
              ? 'Its Session was archived; restore the Session and turn the Heartbeat back on.'
              : 'Its Session no longer exists.',
            since: now,
          })
        }),
      )
    }
  })
}

/**
 * Stops tasks whose caller lost its authority, such as a revoked CLI client profile, so they show
 * as needing attention before their next fire time (ADR 0057), and adopts tasks stored naming the
 * Session agent that created them (ADR 0058). A task running as the local user never loses it.
 */
export function stopRevokedCreators(
  sql: SqlClient.SqlClient,
  enabled: readonly ScheduledTaskRecord[],
  now: number,
) {
  return Effect.gen(function* () {
    for (const record of enabled) {
      if (isLocalUserCallerId(record.creatorCallerId) && record.authorityLimits === null) continue
      yield* forTask(
        record,
        'check-creator-authority',
        Effect.gen(function* () {
          const resolution = yield* resolveScheduledTaskCaller(sql, record)
          if (resolution.live || 'deleted' in resolution) return
          yield* stopScheduledTask(record, {
            reason: 'creator-authority-revoked',
            message: resolution.message,
            since: now,
          })
        }),
      )
    }
  })
}

/** A launched Session whose one Run completed, with nothing waiting and nothing pinned. */
function finishedUntouched(sessionId: string, activity: ScheduledTaskSessionActivity | null) {
  return (
    activity !== null &&
    !activity.archived &&
    activity.activeRunId === null &&
    !hasAnyActiveRun(SessionId(sessionId)) &&
    activity.followUpCount === 0 &&
    !activity.pinned &&
    activity.runCount === 1 &&
    activity.latestRunStatus === 'completed'
  )
}

/**
 * Archives Sessions a Launch schedule started once they finished, when the task asks for it and
 * the user never touched them: their one Run completed, nothing waits, and nothing is pinned.
 */
export function archiveFinishedLaunches(
  sql: SqlClient.SqlClient,
  enabled: readonly ScheduledTaskRecord[],
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    for (const record of enabled) {
      if (record.target.kind !== 'launch' || !record.target.archiveFinishedSessions) continue
      yield* forTask(
        record,
        'archive-finished-launches',
        Effect.gen(function* () {
          const runs = yield* repository.listRuns({ taskId: record.id, limit: ARCHIVE_SWEEP_RUNS })
          const finished: { readonly runId: string; readonly sessionId: string }[] = []
          for (const run of runs) {
            if (run.status !== 'started' || !run.sessionId) continue
            const activity = yield* repository.sessionActivity(run.sessionId)
            if (finishedUntouched(run.sessionId, activity)) {
              finished.push({ runId: run.id, sessionId: run.sessionId })
            }
          }
          if (finished.length === 0) return
          // One authority check (and adoption) per task, not per finished Session.
          const resolution = yield* resolveScheduledTaskCaller(sql, record)
          if (!resolution.live) return
          for (const run of finished) {
            const key = `scheduled-task-archive:${run.runId}`
            yield* dispatchScheduledTaskCommand({
              caller: resolution.caller,
              payload: {
                contract: 'session-control-v2',
                request: {
                  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
                  requestId: key,
                  idempotencyKey: key,
                  command: { operation: 'archive', sessionId: run.sessionId },
                },
              },
            }).pipe(Effect.catchAll(() => Effect.void))
          }
        }),
      )
    }
  })
}
