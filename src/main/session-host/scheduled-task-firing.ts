import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type {
  ScheduledTaskAttention,
  ScheduledTaskAttentionReason,
  ScheduledTaskRunReason,
} from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { hasAnyActiveRun } from '../application/active-session-runs'
import {
  advanceScheduledTask,
  firingTiming,
  markScheduledTaskWaiting,
} from '../application/scheduled-task-bookkeeping'
import { scheduledTaskHooks } from '../application/scheduled-task-hooks'
import { scheduledTaskRunPayload } from '../application/scheduled-task-target-authorization'
import { PiSessionFiles } from '../ports/pi-session-discovery'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
  type ScheduledTaskRunSettlement,
  type ScheduledTaskRunStart,
  type ScheduledTaskSessionActivity,
} from '../ports/scheduled-task-repository'
import {
  assertScheduledLaunchProjectKnown,
  resolveScheduledTaskCaller,
} from './scheduled-task-caller'
import { dispatchScheduledTaskCommand } from './scheduled-task-dispatch'
import { settlementOfDispatch, settlementOfFailure } from './scheduled-task-settlement'

export type ScheduledTaskFiringOutcome = 'recorded' | 'waiting'

interface Firing {
  readonly record: ScheduledTaskRecord
  readonly now: number
  readonly timing: ReturnType<typeof firingTiming>
  readonly run: ScheduledTaskRunStart
}

function attentionFor(reason: ScheduledTaskAttentionReason, message: string, now: number) {
  return { reason, message, since: now } satisfies ScheduledTaskAttention
}

function newRunStart(
  record: ScheduledTaskRecord,
  timing: ReturnType<typeof firingTiming>,
  now: number,
  previous: { readonly sessionId?: string; readonly firedAt: number } | null,
): ScheduledTaskRunStart {
  const id = scheduledTaskHooks().newId()
  return {
    id,
    taskId: record.id,
    taskName: record.name,
    trigger: timing.trigger,
    nominalAt: timing.nominalAt,
    firedAt: now,
    missedCount: timing.missedCount,
    idempotencyKey: `scheduled-task-run:${id}`,
    callerId: record.creatorCallerId,
    previousSessionId: previous?.sessionId ?? null,
    previousFiredAt: previous?.firedAt ?? null,
  }
}

/** Records a run that sent nothing and moves the task on; an attention also stops it. */
function recordWithoutDispatch(
  firing: Firing,
  settlement: ScheduledTaskRunSettlement,
  attention?: ScheduledTaskAttention,
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    yield* repository.recordRun({ ...firing.run, ...settlement })
    yield* advanceScheduledTask(firing.record, {
      firedNominalAt: firing.timing.trigger === 'run-now' ? null : firing.timing.nominalAt,
      started: false,
      now: firing.now,
      ...(attention ? { attention } : {}),
    })
    return 'recorded' as const
  })
}

function stopWithAttention(
  firing: Firing,
  reason: ScheduledTaskAttentionReason & ScheduledTaskRunReason,
  message: string,
) {
  return recordWithoutDispatch(
    firing,
    { status: 'failed', reason, message },
    attentionFor(reason, message, firing.now),
  )
}

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

function waitForSession(firing: Firing, reason: 'session-busy' | 'pi-cli-wrote-last') {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const message =
      reason === 'session-busy'
        ? 'The Session was busy until the next fire time.'
        : 'The pi CLI wrote to this Session last; continue it in OpenWaggle to resume the Heartbeat.'
    if (firing.timing.trigger === 'run-now') {
      yield* repository.recordRun({ ...firing.run, status: 'skipped', reason, message })
      return 'recorded' as const
    }
    if (firing.timing.supersededNominalAt !== null) {
      yield* repository.recordRun({
        ...firing.run,
        id: `${firing.run.id}-superseded`,
        idempotencyKey: `${firing.run.idempotencyKey}-superseded`,
        nominalAt: firing.timing.supersededNominalAt,
        missedCount: 0,
        status: 'skipped',
        reason,
        message,
      })
    }
    yield* markScheduledTaskWaiting(firing.record, {
      nominalAt: firing.timing.nominalAt,
      now: firing.now,
    })
    return 'waiting' as const
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
    return busy ? yield* waitForSession(firing, busy) : null
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
    yield* repository.startRun(firing.run)
    const settlement = yield* assertScheduledLaunchProjectKnown(sql, caller, payload).pipe(
      Effect.zipRight(dispatchScheduledTaskCommand({ caller, payload })),
      Effect.map(settlementOfDispatch),
      Effect.catchAll((error) => Effect.succeed(settlementOfFailure(error))),
    )
    yield* repository.settleRun(firing.run.id, settlement.run)
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
    const precheck =
      record.target.kind === 'heartbeat'
        ? yield* heartbeatPrecheck(firing, record.target.sessionId)
        : yield* launchPrecheck(firing)
    if (precheck) return precheck
    return yield* dispatchFiring(sql, firing, resolution.caller)
  })
}
