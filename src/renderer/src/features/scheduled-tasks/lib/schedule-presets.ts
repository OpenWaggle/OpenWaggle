import { match } from '@diegogbrisa/ts-match'
import {
  HEARTBEAT_MIN_INTERVAL_MINUTES,
  type IsoWeekday,
  LAUNCH_SCHEDULE_MIN_INTERVAL_MINUTES,
  SCHEDULED_TASK_MAX_INTERVAL_MINUTES,
  SCHEDULED_TASK_RRULE_MAX_LENGTH,
  type ScheduledTaskKind,
  type TaskSchedule,
} from '@shared/types/scheduled-task'

/** The editor's schedule choices; each maps to exactly one Task schedule. */
export type SchedulePreset = 'interval' | 'daily' | 'weekdays' | 'weekly' | 'rrule'
export type IntervalUnit = 'minutes' | 'hours'

export interface ScheduleDraft {
  readonly preset: SchedulePreset
  /** Text as typed, so a half-entered number is not coerced away. */
  readonly intervalAmount: string
  readonly intervalUnit: IntervalUnit
  /** `HH:MM`, as a time input yields it. */
  readonly time: string
  /** For the weekly preset. */
  readonly weekdays: readonly IsoWeekday[]
  readonly rule: string
}

export type ScheduleDraftResult =
  | { readonly ok: true; readonly schedule: TaskSchedule }
  | { readonly ok: false; readonly error: string }

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440
const DEFAULT_HEARTBEAT_INTERVAL = '30'
const DEFAULT_DAILY_TIME = '09:00'
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const INTEGER_PATTERN = /^\d+$/

export const WORKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5]
const WEEKEND: readonly IsoWeekday[] = [6, 7]
const EVERY_DAY_COUNT = 7

export const WEEKDAY_SHORT_LABELS: Readonly<Record<IsoWeekday, string>> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
}

export function minimumIntervalMinutes(kind: ScheduledTaskKind) {
  return kind === 'heartbeat'
    ? HEARTBEAT_MIN_INTERVAL_MINUTES
    : LAUNCH_SCHEDULE_MIN_INTERVAL_MINUTES
}

/** A Heartbeat checks in every 30 minutes; a Launch schedule starts work each weekday morning. */
export function defaultScheduleDraft(kind: ScheduledTaskKind): ScheduleDraft {
  return {
    preset: kind === 'heartbeat' ? 'interval' : 'weekdays',
    intervalAmount: DEFAULT_HEARTBEAT_INTERVAL,
    intervalUnit: 'minutes',
    time: DEFAULT_DAILY_TIME,
    weekdays: WORKDAYS,
    rule: '',
  }
}

function sortedWeekdays(weekdays: readonly IsoWeekday[]) {
  return [...new Set(weekdays)].sort((left, right) => left - right)
}

function sameWeekdays(left: readonly IsoWeekday[], right: readonly IsoWeekday[]) {
  const sorted = sortedWeekdays(left)
  return sorted.length === right.length && sorted.every((day, index) => day === right[index])
}

function intervalSchedule(draft: ScheduleDraft, kind: ScheduledTaskKind): ScheduleDraftResult {
  const amount = draft.intervalAmount.trim()
  if (!INTEGER_PATTERN.test(amount) || Number(amount) === 0) {
    return { ok: false, error: 'Enter a whole number for the interval.' }
  }
  const everyMinutes = Number(amount) * (draft.intervalUnit === 'hours' ? MINUTES_PER_HOUR : 1)
  const minimum = minimumIntervalMinutes(kind)
  if (everyMinutes < minimum) {
    const label = kind === 'heartbeat' ? 'A Heartbeat' : 'A Launch schedule'
    return { ok: false, error: `${label} runs at most every ${String(minimum)} minutes.` }
  }
  if (everyMinutes > SCHEDULED_TASK_MAX_INTERVAL_MINUTES) {
    return { ok: false, error: 'The interval can be at most 31 days.' }
  }
  return { ok: true, schedule: { kind: 'interval', everyMinutes } }
}

function dailySchedule(
  time: string,
  weekdays: readonly IsoWeekday[] | undefined,
): ScheduleDraftResult {
  if (!TIME_PATTERN.test(time)) return { ok: false, error: 'Choose a time of day.' }
  if (weekdays === undefined) return { ok: true, schedule: { kind: 'daily', at: time } }
  if (weekdays.length === 0) return { ok: false, error: 'Choose at least one day.' }
  return { ok: true, schedule: { kind: 'daily', at: time, weekdays: sortedWeekdays(weekdays) } }
}

function ruleSchedule(rule: string): ScheduleDraftResult {
  const trimmed = rule.trim().replace(/^RRULE:/i, '')
  if (trimmed === '') return { ok: false, error: 'Enter a recurrence rule, such as FREQ=DAILY.' }
  if (trimmed.length > SCHEDULED_TASK_RRULE_MAX_LENGTH) {
    return { ok: false, error: 'The recurrence rule is too long.' }
  }
  return { ok: true, schedule: { kind: 'rrule', rule: trimmed } }
}

/** The Task schedule an editor draft describes, or why it does not describe one yet. */
export function scheduleFromDraft(
  draft: ScheduleDraft,
  kind: ScheduledTaskKind,
): ScheduleDraftResult {
  return match(draft.preset)
    .with('interval', () => intervalSchedule(draft, kind))
    .with('daily', () => dailySchedule(draft.time, undefined))
    .with('weekdays', () => dailySchedule(draft.time, WORKDAYS))
    .with('weekly', () => dailySchedule(draft.time, draft.weekdays))
    .with('rrule', () => ruleSchedule(draft.rule))
    .exhaustive()
}

function dailyPreset(weekdays: readonly IsoWeekday[] | undefined): SchedulePreset {
  if (weekdays === undefined || weekdays.length === EVERY_DAY_COUNT) return 'daily'
  return sameWeekdays(weekdays, WORKDAYS) ? 'weekdays' : 'weekly'
}

/** The editor draft for a stored Task schedule, so Edit opens on the matching preset. */
export function draftFromSchedule(schedule: TaskSchedule, kind: ScheduledTaskKind): ScheduleDraft {
  const base = defaultScheduleDraft(kind)
  return match(schedule)
    .with({ kind: 'interval' }, ({ everyMinutes }) => {
      const inHours = everyMinutes % MINUTES_PER_HOUR === 0
      return {
        ...base,
        preset: 'interval' as const,
        intervalAmount: String(inHours ? everyMinutes / MINUTES_PER_HOUR : everyMinutes),
        intervalUnit: inHours ? ('hours' as const) : ('minutes' as const),
      }
    })
    .with({ kind: 'daily' }, ({ at, weekdays }) => ({
      ...base,
      preset: dailyPreset(weekdays),
      time: at,
      weekdays: weekdays === undefined ? base.weekdays : sortedWeekdays(weekdays),
    }))
    .with({ kind: 'rrule' }, ({ rule }) => ({ ...base, preset: 'rrule' as const, rule }))
    .exhaustive()
}

function plural(count: number, unit: string) {
  return count === 1 ? `Every ${unit}` : `Every ${String(count)} ${unit}s`
}

function describeInterval(everyMinutes: number) {
  if (everyMinutes % MINUTES_PER_DAY === 0) return plural(everyMinutes / MINUTES_PER_DAY, 'day')
  if (everyMinutes % MINUTES_PER_HOUR === 0) return plural(everyMinutes / MINUTES_PER_HOUR, 'hour')
  return plural(everyMinutes, 'minute')
}

function describeDaily(at: string, weekdays: readonly IsoWeekday[] | undefined) {
  if (weekdays === undefined || sortedWeekdays(weekdays).length === EVERY_DAY_COUNT) {
    return `Daily at ${at}`
  }
  if (sameWeekdays(weekdays, WORKDAYS)) return `Weekdays at ${at}`
  if (sameWeekdays(weekdays, WEEKEND)) return `Weekends at ${at}`
  const days = sortedWeekdays(weekdays).map((day) => WEEKDAY_SHORT_LABELS[day])
  return `Weekly on ${days.join(', ')} at ${at}`
}

/** A short human description: "Every 30 minutes", "Weekdays at 09:00", "Custom rule". */
export function describeSchedule(schedule: TaskSchedule) {
  return match(schedule)
    .with({ kind: 'interval' }, ({ everyMinutes }) => describeInterval(everyMinutes))
    .with({ kind: 'daily' }, ({ at, weekdays }) => describeDaily(at, weekdays))
    .with({ kind: 'rrule' }, () => 'Custom rule')
    .exhaustive()
}
