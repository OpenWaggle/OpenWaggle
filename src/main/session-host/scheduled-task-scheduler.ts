import * as SqlClient from '@effect/sql/SqlClient'
import * as Cause from 'effect/Cause'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { runHostWakeCheck } from '../adapters/scheduled-tasks/wake-check-process'
import { settleHeartbeatRunOutcome } from '../application/scheduled-task-heartbeat-commands'
import {
  type HeartbeatRunEnd,
  installScheduledTaskHooks,
} from '../application/scheduled-task-hooks'
import { createLogger } from '../logger'
import { ScheduledTaskRepository } from '../ports/scheduled-task-repository'
import { fireScheduledTask } from './scheduled-task-firing'
import { settleInterruptedFirings } from './scheduled-task-interrupted-runs'
import {
  archiveFinishedLaunches,
  forTask,
  pauseArchivedHeartbeats,
  stopRevokedCreators,
} from './scheduled-task-sweeps'
import { tryGetSessionHostEventRuntime } from './session-host-events'

const logger = createLogger('scheduled-tasks')

/** How often the scheduler looks for due tasks; changes wake it sooner. */
export const SCHEDULED_TASK_TICK_MS = 30_000
/** A Heartbeat waiting for its Session looks again this often. */
const BUSY_RECHECK_MS = 60_000
const DUE_BATCH_LIMIT = 8
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

function fireDue(sql: SqlClient.SqlClient, state: SchedulerState, now: number) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const due = yield* repository.listDue(now, DUE_BATCH_LIMIT)
    for (const record of due) {
      if (state.inProgress.has(record.id)) continue
      if ((state.recheckAfter.get(record.id) ?? 0) > now) continue
      state.inProgress.add(record.id)
      yield* forTask(
        record,
        'fire',
        fireScheduledTask(sql, { record, trigger: 'schedule', now }).pipe(
          Effect.tap((outcome) =>
            Effect.sync(() => {
              if (outcome === 'waiting') state.recheckAfter.set(record.id, now + BUSY_RECHECK_MS)
              else state.recheckAfter.delete(record.id)
            }),
          ),
          // A firing that failed waits like a busy one rather than retrying on every tick.
          Effect.tapErrorCause(() =>
            Effect.sync(() => state.recheckAfter.set(record.id, now + BUSY_RECHECK_MS)),
          ),
          Effect.ensuring(Effect.sync(() => state.inProgress.delete(record.id))),
        ),
      )
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

/** Settles a Heartbeat Run's outcome in the background; the Run's own settlement never waits. */
function settleRunEnd(context: Context.Context<FiringDependencies>, end: HeartbeatRunEnd) {
  Effect.runFork(
    settleHeartbeatRunOutcome(end).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() =>
          logger.warn('Could not settle a Heartbeat Run outcome', { cause: Cause.pretty(cause) }),
        ),
      ),
      Effect.provide(context),
    ),
  )
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
    runWakeCheck: runHostWakeCheck,
    heartbeatRunEnded: (end) => settleRunEnd(context, end),
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
