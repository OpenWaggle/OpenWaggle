import {
  isScheduleJittered,
  type ScheduleDefinition,
  upcomingNominalTimes,
  validateTaskSchedule,
} from '@shared/domain/scheduled-tasks/task-schedule'
import type { ScheduledTask, ScheduledTaskKind, TaskSchedule } from '@shared/types/scheduled-task'

const PREVIEW_COUNT = 3
const PREVIEW_ID = 'schedule-preview'

export type SchedulePreview =
  | { readonly ok: true; readonly times: readonly number[]; readonly jittered: boolean }
  | { readonly ok: false; readonly error: string }

function sameSchedule(left: TaskSchedule, right: TaskSchedule) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** The stored task's next nominal time, when the draft keeps its schedule and zone. */
function unchangedNextRun(input: {
  readonly schedule: TaskSchedule
  readonly timeZone: string
  readonly now: number
  readonly stored?: ScheduledTask | null
}) {
  const { stored } = input
  if (!stored || stored.nextNominalAt === null || stored.nextNominalAt <= input.now) return null
  if (stored.timeZone !== input.timeZone || !sameSchedule(stored.schedule, input.schedule)) {
    return null
  }
  return stored.nextNominalAt
}

/**
 * The next fire times a schedule would have if saved now, with the same rules the Session Host
 * applies (ADR 0057). Jitter is reported, not applied: it depends on the saved task's id.
 */
export function previewSchedule(input: {
  readonly kind: ScheduledTaskKind
  readonly schedule: TaskSchedule
  readonly timeZone: string
  readonly endsAt: number | null
  readonly now: number
  /** The saved task being edited: an unchanged schedule keeps its own occurrences. */
  readonly stored?: ScheduledTask | null
}): SchedulePreview {
  const validation = validateTaskSchedule(input)
  if (!validation.ok) return { ok: false, error: validation.message }
  const next = unchangedNextRun(input)
  const definition: ScheduleDefinition = {
    taskId: PREVIEW_ID,
    schedule: input.schedule,
    timeZone: input.timeZone,
    anchorAt: next ?? input.now,
    endsAt: input.endsAt,
  }
  const times =
    next === null
      ? upcomingNominalTimes(definition, input.now, PREVIEW_COUNT)
      : [next, ...upcomingNominalTimes(definition, next, PREVIEW_COUNT - 1)]
  return { ok: true, times, jittered: isScheduleJittered(definition) }
}
