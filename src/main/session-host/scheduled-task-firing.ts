import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { hasAnyActiveRun } from '../application/active-session-runs'
import {
  advanceScheduledTask,
  applyHeartbeatOutcome,
  firingTiming,
} from '../application/scheduled-task-bookkeeping'
import { scheduledTaskRunPayload } from '../application/scheduled-task-target-authorization'
import { PiSessionFiles } from '../ports/pi-session-discovery'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
  type ScheduledTaskSessionActivity,
} from '../ports/scheduled-task-repository'
import {
  assertScheduledLaunchProjectKnown,
  resolveScheduledTaskCaller,
} from './scheduled-task-caller'
import { dispatchScheduledTaskCommand } from './scheduled-task-dispatch'
import {
  attentionFor,
  type Firing,
  newRunStart,
  recordWithoutDispatch,
  stopWithAttention,
  waitForSession,
} from './scheduled-task-firing-records'
import {
  evaluateHeartbeatGate,
  type HeartbeatSendExtras,
  heartbeatRunContext,
} from './scheduled-task-heartbeat-gate'
import { settlementOfDispatch, settlementOfFailure } from './scheduled-task-settlement'

export type { ScheduledTaskFiringOutcome } from './scheduled-task-firing-records'

/** Why a Heartbeat's Session cannot take a run now, or null when it is idle. */
function heartbeatBusyReason(sessionId: string, activity: ScheduledTaskSessionActivity) {
  return Effect.gen(function* () {
    const active = activity.activeRunId !== null || hasAnyActiveRun(SessionId(sessionId))
    if (active || activity.followUpCount > 0) {
      return 'session-busy' as const
    }
    if (!activity.piSessionFile) return null
    const files = yield* Effect.serviceOption(PiSessionFiles)
    if (Option.isNone(files)) return null
    const origin = yield* files.value.lastPromptOrigin(activity.piSessionFile)
    return origin === 'outside' ? ('pi-cli-wrote-last' as const) : null
  })
}

/** A Heartbeat fires only into an idle Session; it never steers or queues (ADR 0057). */
function heartbeatPrecheck(firing: Firing, sessionId: string) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const activity = yield* repository.sessionActivity(sessionId)
    if (!activity) {
      return yield* stopWithAttention(
        firing,
        'target-session-missing',
        'Its Session no longer exists.',
      )
    }
    if (activity.archived) {
      return yield* stopWithAttention(
        firing,
        'target-session-archived',
        'Its Session was archived; restore the Session and turn the Heartbeat back on.',
      )
    }
    const busy = yield* heartbeatBusyReason(sessionId, activity)
    return busy ? yield* waitForSession(firing, busy) : activity
  })
}

interface Dispatch {
  readonly context?: ReturnType<typeof heartbeatRunContext>
  readonly extras: HeartbeatSendExtras
}

/**
 * After an idle Session, the Heartbeat's Wake check decides (#388): held for approval, skipped
 * with nothing sent, or sent with what the check printed. Only `send` reaches Session Control.
 */
function heartbeatGate(firing: Firing, activity: ScheduledTaskSessionActivity) {
  return Effect.gen(function* () {
    const gate = yield* evaluateHeartbeatGate(firing.record, activity, firing.now)
    if (gate.kind === 'held') return yield* waitForSession(firing, 'wake-check-unapproved')
    if (gate.kind === 'skip') {
      const recorded = yield* recordWithoutDispatch(firing, gate.settlement)
      if (gate.idle) yield* applyHeartbeatOutcome(firing.record.id, 'idle', { now: firing.now })
      return recorded
    }
    return {
      context: heartbeatRunContext(firing.record, gate.report),
      extras: gate.extras,
    } satisfies Dispatch
  })
}

/** A Launch schedule has at most one run in progress: a still-running Session skips this one. */
function launchPrecheck(firing: Firing) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const previous = yield* repository.lastStartedRun(firing.record.id)
    if (!previous?.sessionId) return null
    const activity = yield* repository.sessionActivity(previous.sessionId)
    const running =
      hasAnyActiveRun(SessionId(previous.sessionId)) || (activity?.activeRunId ?? null) !== null
    if (!running) return null
    return yield* recordWithoutDispatch(firing, {
      status: 'skipped',
      reason: 'previous-run-active',
      message: 'The Session this task launched last time is still running.',
      sessionId: previous.sessionId,
    })
  })
}

function launchTitle(record: ScheduledTaskRecord, now: number) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: record.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now))
  return `${record.name} · ${date}`
}

function dispatchFiring(
  sql: SqlClient.SqlClient,
  firing: Firing,
  caller: LocalSessionCallerIdentity,
  dispatch: Dispatch,
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const { record } = firing
    const payload = scheduledTaskRunPayload({
      target: record.target,
      requestId: firing.run.idempotencyKey,
      idempotencyKey: firing.run.idempotencyKey,
      text: record.prompt,
      ...(record.kind === 'launch' ? { title: launchTitle(record, firing.now) } : {}),
    })
    yield* repository.startRun({
      ...firing.run,
      ...(dispatch.context ? { context: dispatch.context } : {}),
    })
    const settlement = yield* assertScheduledLaunchProjectKnown(sql, caller, payload).pipe(
      Effect.zipRight(dispatchScheduledTaskCommand({ caller, payload })),
      Effect.map(settlementOfDispatch),
      Effect.catchAll((error) => Effect.succeed(settlementOfFailure(error))),
    )
    yield* repository.settleRun(
      firing.run.id,
      settlement.run.status === 'started'
        ? { ...settlement.run, ...dispatch.extras }
        : {
            ...settlement.run,
            ...(dispatch.extras.wakeCheck ? { wakeCheck: dispatch.extras.wakeCheck } : {}),
          },
    )
    yield* advanceScheduledTask(record, {
      firedNominalAt: firing.timing.trigger === 'run-now' ? null : firing.timing.nominalAt,
      started: settlement.run.status === 'started',
      now: firing.now,
      ...(settlement.attention
        ? {
            attention: attentionFor(settlement.attention, settlement.run.message ?? '', firing.now),
          }
        : {}),
    })
    return 'recorded' as const
  })
}

/** One firing of a Scheduled task: its checks, its request, and its record (ADR 0057). */
export function fireScheduledTask(
  sql: SqlClient.SqlClient,
  input: {
    readonly record: ScheduledTaskRecord
    readonly trigger: 'schedule' | 'run-now'
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const { record, now } = input
    const timing = firingTiming(record, input.trigger, now)
    const previous = yield* repository.lastStartedRun(record.id)
    const firing: Firing = {
      record,
      now,
      timing,
      run: newRunStart(record, timing, now, previous),
    }
    const resolution = yield* resolveScheduledTaskCaller(sql, record)
    if (!resolution.live) {
      return yield* stopWithAttention(firing, 'creator-authority-revoked', resolution.message)
    }
    if (record.target.kind === 'launch') {
      const precheck = yield* launchPrecheck(firing)
      if (precheck) return precheck
      return yield* dispatchFiring(sql, firing, resolution.caller, { extras: {} })
    }
    const activity = yield* heartbeatPrecheck(firing, record.target.sessionId)
    if (typeof activity === 'string') return activity
    const dispatch = yield* heartbeatGate(firing, activity)
    if (typeof dispatch === 'string') return dispatch
    return yield* dispatchFiring(sql, firing, resolution.caller, dispatch)
  })
}
