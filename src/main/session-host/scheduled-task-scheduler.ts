import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { hasAnyActiveRun } from '../application/active-session-runs'
import { stopScheduledTask } from '../application/scheduled-task-bookkeeping'
import { installScheduledTaskHooks } from '../application/scheduled-task-hooks'
import { createLogger } from '../logger'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
  type ScheduledTaskSessionActivity,
} from '../ports/scheduled-task-repository'
import { resolveScheduledTaskCaller } from './scheduled-task-caller'
import { dispatchScheduledTaskCommand } from './scheduled-task-dispatch'
import { fireScheduledTask } from './scheduled-task-firing'
import { settleInterruptedFirings } from './scheduled-task-interrupted-runs'
import { tryGetSessionHostEventRuntime } from './session-host-events'

const logger = createLogger('scheduled-tasks')

/** How often the scheduler looks for due tasks; changes wake it sooner. */
export const SCHEDULED_TASK_TICK_MS = 30_000
/** A Heartbeat waiting for its Session looks again this often. */
const BUSY_RECHECK_MS = 60_000
const DUE_BATCH_LIMIT = 8
const ARCHIVE_SWEEP_RUNS = 10
/** Ticks between checks that every enabled task's creator still holds its authority. */
const AUTHORITY_SWEEP_TICKS = 10

type FiringDependencies = Effect.Effect.Context<ReturnType<typeof fireScheduledTask>>

interface SchedulerState {
  ticks: number
  readonly inProgress: Set<string>
  readonly recheckAfter: Map<string, number>
  wake: (() => void) | null
  releaseHold: (() => void) | null
}

/** An enabled task keeps the Host from idling out; none lets it (ADR 0057). */
function updateLivenessHold(state: SchedulerState, hold: boolean) {
  const liveness = tryGetSessionHostEventRuntime()?.liveness
  if (!liveness) return
  if ((!hold || liveness.isDraining()) && state.releaseHold) {
    state.releaseHold()
    state.releaseHold = null
    return
  }
  if (hold && !state.releaseHold && !liveness.isDraining()) {
    try {
      state.releaseHold = liveness.acquire('scheduled-task')
    } catch {
      // The Host is stopping; nothing more fires.
    }
  }
}

function pauseArchivedHeartbeats(enabled: readonly ScheduledTaskRecord[], now: number) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    for (const record of enabled) {
      if (record.target.kind !== 'heartbeat') continue
      const activity = yield* repository.sessionActivity(record.target.sessionId)
      if (activity && !activity.archived) continue
      yield* stopScheduledTask(record, {
        reason: activity ? 'target-session-archived' : 'target-session-missing',
        message: activity
          ? 'Its Session was archived; restore the Session and turn the Heartbeat back on.'
          : 'Its Session no longer exists.',
        since: now,
      })
    }
  })
}

/**
 * Stops tasks whose creator lost its authority, such as a revoked CLI client profile, so they
 * show as needing attention before their next fire time (ADR 0057). Local-user tasks never lose it.
 */
function stopRevokedCreators(
  sql: SqlClient.SqlClient,
  enabled: readonly ScheduledTaskRecord[],
  now: number,
) {
  return Effect.gen(function* () {
    for (const record of enabled) {
      if (record.creator.kind === 'local-user') continue
      const resolution = yield* resolveScheduledTaskCaller(sql, record)
      if (resolution.live) continue
      yield* stopScheduledTask(record, {
        reason: 'creator-authority-revoked',
        message: resolution.message,
        since: now,
      })
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
function archiveFinishedLaunches(
  sql: SqlClient.SqlClient,
  enabled: readonly ScheduledTaskRecord[],
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    for (const record of enabled) {
      if (record.target.kind !== 'launch' || !record.target.archiveFinishedSessions) continue
      const runs = yield* repository.listRuns({ taskId: record.id, limit: ARCHIVE_SWEEP_RUNS })
      for (const run of runs) {
        if (run.status !== 'started' || !run.sessionId) continue
        const activity = yield* repository.sessionActivity(run.sessionId)
        if (!finishedUntouched(run.sessionId, activity)) continue
        const resolution = yield* resolveScheduledTaskCaller(sql, record)
        if (!resolution.live) break
        const key = `scheduled-task-archive:${run.id}`
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
    }
  })
}

function fireDue(sql: SqlClient.SqlClient, state: SchedulerState, now: number) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const due = yield* repository.listDue(now, DUE_BATCH_LIMIT)
    for (const record of due) {
      if (state.inProgress.has(record.id)) continue
      if ((state.recheckAfter.get(record.id) ?? 0) > now) continue
      state.inProgress.add(record.id)
      const outcome = yield* fireScheduledTask(sql, { record, trigger: 'schedule', now }).pipe(
        Effect.ensuring(Effect.sync(() => state.inProgress.delete(record.id))),
      )
      if (outcome === 'waiting') state.recheckAfter.set(record.id, now + BUSY_RECHECK_MS)
      else state.recheckAfter.delete(record.id)
    }
  })
}

function tick(sql: SqlClient.SqlClient, state: SchedulerState) {
  return Effect.gen(function* () {
    const runtime = tryGetSessionHostEventRuntime()
    if (runtime?.liveness.isDraining()) {
      updateLivenessHold(state, false)
      return
    }
    const repository = yield* ScheduledTaskRepository
    const now = Date.now()
    const enabled = yield* repository.listEnabled()
    updateLivenessHold(state, enabled.length > 0)
    if (enabled.length === 0) return
    yield* pauseArchivedHeartbeats(enabled, now)
    state.ticks += 1
    if (state.ticks % AUTHORITY_SWEEP_TICKS === 1) yield* stopRevokedCreators(sql, enabled, now)
    yield* fireDue(sql, state, now)
    yield* archiveFinishedLaunches(sql, enabled)
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) return
        logger.warn('Scheduled task tick failed', { cause: Cause.pretty(cause) })
      }),
    ),
  )
}

function waitForWake(state: SchedulerState) {
  return Effect.async<void>((resume) => {
    state.wake = () => resume(Effect.void)
    return Effect.sync(() => {
      state.wake = null
    })
  })
}

function runNow(
  sql: SqlClient.SqlClient,
  state: SchedulerState,
  context: Context.Context<FiringDependencies>,
  taskId: string,
) {
  return Effect.sync(() => {
    if (state.inProgress.has(taskId)) return 'busy' as const
    if (tryGetSessionHostEventRuntime()?.liveness.isDraining()) return 'unavailable' as const
    state.inProgress.add(taskId)
    const firing = Effect.gen(function* () {
      const repository = yield* ScheduledTaskRepository
      const record = yield* repository.get(taskId)
      if (!record) return
      yield* fireScheduledTask(sql, { record, trigger: 'run-now', now: Date.now() })
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() =>
          logger.warn('Scheduled task run-now failed', { cause: Cause.pretty(cause) }),
        ),
      ),
      Effect.ensuring(Effect.sync(() => state.inProgress.delete(taskId))),
      Effect.provide(context),
    )
    Effect.runFork(firing)
    return 'accepted' as const
  })
}

/**
 * The Session Host's scheduler (ADR 0057): it fires due Scheduled tasks through the same
 * Session Control operations a person would use, holds the Host open while any task is enabled,
 * and settles runs a previous Host stopped in the middle of.
 */
export const runScheduledTaskSchedulerBackground = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const context = yield* Effect.context<FiringDependencies>()
  yield* settleInterruptedFirings.pipe(
    Effect.catchAll((error) =>
      Effect.sync(() =>
        logger.warn('Could not settle interrupted scheduled runs', { error: String(error) }),
      ),
    ),
  )
  const state: SchedulerState = {
    ticks: 0,
    inProgress: new Set(),
    recheckAfter: new Map(),
    wake: null,
    releaseHold: null,
  }
  const releaseHooks = installScheduledTaskHooks({
    tasksChanged: () => state.wake?.(),
    requestRunNow: (taskId) => runNow(sql, state, context, taskId),
  })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      releaseHooks()
      updateLivenessHold(state, false)
    }),
  )
  const loop = Effect.gen(function* () {
    while (true) {
      yield* tick(sql, state).pipe(Effect.provide(context))
      yield* Effect.raceFirst(waitForWake(state), Effect.sleep(SCHEDULED_TASK_TICK_MS))
    }
  })
  yield* Effect.forkScoped(loop)
})
