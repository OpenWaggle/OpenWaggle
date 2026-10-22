import type { ScheduledTaskAttention, ScheduledTaskRunTrigger } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import { missedOccurrences } from '../domain/scheduled-tasks/task-schedule'
import {
  type ScheduledTaskRecord,
  type ScheduledTaskRecordChanges,
  ScheduledTaskRepository,
} from '../ports/scheduled-task-repository'
import { nextFiringOf, scheduleDefinitionOf } from './scheduled-task-presentation'

/** A firing this much later than planned was missed (the Host was down or the machine slept). */
export const SCHEDULED_TASK_CATCH_UP_GRACE_MS = 2 * 60_000
const BOOKKEEPING_ATTEMPTS = 3

export interface ScheduledTaskFiringTiming {
  readonly trigger: ScheduledTaskRunTrigger
  /** The nominal time this firing stands for: the latest one due. */
  readonly nominalAt: number
  /** Further firings this one covers, which were missed and will not run on their own. */
  readonly missedCount: number
  /**
   * A Heartbeat that waited for its Session past its next fire time: the firing it waited with,
   * which is recorded as skipped instead of covered.
   */
  readonly supersededNominalAt: number | null
}

/**
 * What a due firing stands for. Every firing missed while the Host was down or the machine slept
 * collapses into one catch-up run (ADR 0057); a Heartbeat still waiting for its Session when the
 * next fire time comes records the earlier firing as skipped.
 */
export function firingTiming(
  record: ScheduledTaskRecord,
  trigger: 'schedule' | 'run-now',
  now: number,
): ScheduledTaskFiringTiming {
  if (trigger === 'run-now') {
    return { trigger: 'run-now', nominalAt: now, missedCount: 0, supersededNominalAt: null }
  }
  const pending = record.nextNominalAt ?? now
  const later = missedOccurrences(scheduleDefinitionOf(record), pending, now)
  const waited = record.waitingSince !== null
  if (later.latest === null) {
    const late =
      record.nextRunAt !== null && now - record.nextRunAt > SCHEDULED_TASK_CATCH_UP_GRACE_MS
    return {
      trigger: late && !waited ? 'catch-up' : 'schedule',
      nominalAt: pending,
      missedCount: 0,
      supersededNominalAt: null,
    }
  }
  return {
    trigger: waited ? 'schedule' : 'catch-up',
    nominalAt: later.latest,
    missedCount: waited ? later.count - 1 : later.count,
    supersededNominalAt: waited ? pending : null,
  }
}

export interface ScheduledTaskAdvance {
  /** The nominal time the firing stood for; null for a run-now, which leaves the schedule. */
  readonly firedNominalAt: number | null
  readonly started: boolean
  /** Stops the task and says why (ADR 0057: a task stopped for an authority reason). */
  readonly attention?: ScheduledTaskAttention
  readonly now: number
}

function advanceChanges(
  current: ScheduledTaskRecord,
  advance: ScheduledTaskAdvance,
  scheduleAnchor: number,
): ScheduledTaskRecordChanges {
  const runCount = current.runCount + (advance.started ? 1 : 0)
  const updatedAt = Math.max(advance.now, current.updatedAt + 1)
  if (advance.attention) {
    return {
      runCount,
      enabled: false,
      attention: advance.attention,
      nextRunAt: null,
      nextNominalAt: null,
      waitingSince: null,
      updatedAt,
    }
  }
  // Someone rescheduled the task while it fired: their plan stands, the count still moves on.
  if (advance.firedNominalAt === null || current.anchorAt !== scheduleAnchor) {
    const ended = current.maxRuns !== null && runCount >= current.maxRuns
    return {
      runCount,
      updatedAt,
      ...(ended ? { enabled: false, nextRunAt: null, nextNominalAt: null } : {}),
    }
  }
  const next = nextFiringOf({ ...current, runCount }, Math.max(advance.now, advance.firedNominalAt))
  return {
    runCount,
    nextRunAt: next?.runAt ?? null,
    nextNominalAt: next?.nominalAt ?? null,
    waitingSince: null,
    ...(next ? {} : { enabled: false }),
    updatedAt,
  }
}

function applyWithRetry(
  taskId: string,
  change: (current: ScheduledTaskRecord) => ScheduledTaskRecordChanges | null,
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    for (let attempt = 0; attempt < BOOKKEEPING_ATTEMPTS; attempt += 1) {
      const current = yield* repository.get(taskId)
      if (!current) return null
      const changes = change(current)
      if (!changes) return current
      const stored = yield* repository.update(taskId, current.updatedAt, changes)
      if (stored) return stored
    }
    return null
  })
}

/** Moves a task on after a firing: its count, its next fire time, or its stop. */
export function advanceScheduledTask(record: ScheduledTaskRecord, advance: ScheduledTaskAdvance) {
  return applyWithRetry(record.id, (current) => advanceChanges(current, advance, record.anchorAt))
}

/** Marks a Heartbeat waiting for its Session, standing for the latest firing due. */
export function markScheduledTaskWaiting(
  record: ScheduledTaskRecord,
  input: { readonly nominalAt: number; readonly now: number },
) {
  return applyWithRetry(record.id, (current) =>
    current.anchorAt !== record.anchorAt || !current.enabled
      ? null
      : {
          waitingSince: current.waitingSince ?? input.now,
          nextNominalAt: input.nominalAt,
          updatedAt: Math.max(input.now, current.updatedAt + 1),
        },
  )
}

/** Stops a task without a run, such as a Heartbeat whose Session was archived. */
export function stopScheduledTask(record: ScheduledTaskRecord, attention: ScheduledTaskAttention) {
  return applyWithRetry(record.id, (current) =>
    current.enabled
      ? {
          enabled: false,
          attention,
          nextRunAt: null,
          nextNominalAt: null,
          waitingSince: null,
          updatedAt: Math.max(attention.since, current.updatedAt + 1),
        }
      : null,
  )
}
