import type {
  ScheduledTaskAttention,
  ScheduledTaskAttentionReason,
  ScheduledTaskRunReason,
} from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import {
  advanceScheduledTask,
  type firingTiming,
  markScheduledTaskWaiting,
} from '../application/scheduled-task-bookkeeping'
import { scheduledTaskHooks } from '../application/scheduled-task-hooks'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
  type ScheduledTaskRunSettlement,
  type ScheduledTaskRunStart,
} from '../ports/scheduled-task-repository'

export type ScheduledTaskFiringOutcome = 'recorded' | 'waiting'

export interface Firing {
  readonly record: ScheduledTaskRecord
  readonly now: number
  readonly timing: ReturnType<typeof firingTiming>
  readonly run: ScheduledTaskRunStart
}

export function attentionFor(reason: ScheduledTaskAttentionReason, message: string, now: number) {
  return { reason, message, since: now } satisfies ScheduledTaskAttention
}

export function newRunStart(
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
export function recordWithoutDispatch(
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

export function stopWithAttention(
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

type WaitReason = 'session-busy' | 'pi-cli-wrote-last' | 'wake-check-unapproved'

const WAIT_MESSAGES: Readonly<Record<WaitReason, string>> = {
  'session-busy': 'The Session was busy until the next fire time.',
  'pi-cli-wrote-last':
    'The pi CLI wrote to this Session last; continue it in OpenWaggle to resume the Heartbeat.',
  'wake-check-unapproved': 'Waiting for you to approve its Wake check.',
}

export function waitForSession(firing: Firing, reason: WaitReason) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const message = WAIT_MESSAGES[reason]
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
