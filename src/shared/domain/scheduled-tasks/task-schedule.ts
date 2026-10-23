import {
  HEARTBEAT_MIN_INTERVAL_MINUTES,
  LAUNCH_SCHEDULE_MIN_INTERVAL_MINUTES,
  type ScheduledTaskKind,
  type TaskSchedule,
} from '@shared/types/scheduled-task'
import { isValidTimeZone } from '@shared/utils/zoned-time'
import { nextRecurrence } from './recurrence-evaluation'
import { parseRecurrenceRule } from './recurrence-rule'
import type { RecurrenceRule } from './recurrence-types'

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
/** Hourly-or-slower schedules fire within ±5 minutes of their nominal time (ADR 0057). */
export const SCHEDULED_TASK_JITTER_MS = 5 * MINUTE_MS
const JITTER_SPAN_SECONDS = 601
const JITTER_OFFSET_SECONDS = 300
const SECOND_MS = 1000
/** Occurrences sampled to check a recurrence rule's spacing. */
const SPACING_SAMPLE = 64
/** Missed firings counted for a catch-up; the rest are reported as "more than". */
export const MISSED_FIRING_COUNT_LIMIT = 1000
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const DAYS_PER_WEEK = 7

export interface ScheduleDefinition {
  readonly taskId: string
  readonly schedule: TaskSchedule
  readonly timeZone: string
  /** Where the schedule's occurrences are counted from: the task's creation or last reschedule. */
  readonly anchorAt: number
  readonly endsAt: number | null
}

export interface PlannedFiring {
  readonly nominalAt: number
  /** The nominal time with its jitter, never before the time it was planned after. */
  readonly runAt: number
}

export type ScheduleValidation =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: 'invalid_schedule' | 'invalid_time_zone'
      readonly message: string
    }

function dailyRule(schedule: Extract<TaskSchedule, { kind: 'daily' }>): RecurrenceRule {
  const [hour, minute] = schedule.at.split(':').map(Number)
  return {
    frequency: 'DAILY',
    interval: 1,
    byHour: [hour ?? 0],
    byMinute: [minute ?? 0],
    ...(schedule.weekdays && schedule.weekdays.length < DAYS_PER_WEEK
      ? { byWeekday: [...new Set(schedule.weekdays)].map((weekday) => ({ weekday })) }
      : {}),
  }
}

function recurrenceOf(schedule: TaskSchedule): RecurrenceRule | string {
  if (schedule.kind === 'interval') {
    return { frequency: 'MINUTELY', interval: schedule.everyMinutes }
  }
  if (schedule.kind === 'daily') return dailyRule(schedule)
  const parsed = parseRecurrenceRule(schedule.rule)
  return parsed.ok ? parsed.rule : parsed.message
}

export function minimumIntervalMinutes(kind: ScheduledTaskKind) {
  return kind === 'heartbeat'
    ? HEARTBEAT_MIN_INTERVAL_MINUTES
    : LAUNCH_SCHEDULE_MIN_INTERVAL_MINUTES
}

function nominalAfter(definition: ScheduleDefinition, rule: RecurrenceRule, after: number) {
  const next = nextRecurrence(rule, definition.timeZone, definition.anchorAt, after)
  if (next === null) return null
  return definition.endsAt !== null && next > definition.endsAt ? null : next
}

/** The first nominal fire time strictly after `after`, or null once the schedule has ended. */
export function nextNominalAt(definition: ScheduleDefinition, after: number) {
  const rule = recurrenceOf(definition.schedule)
  return typeof rule === 'string' ? null : nominalAfter(definition, rule, after)
}

function fnv1a(text: string) {
  let hash = FNV_OFFSET
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash
}

function smallestGapMinutes(definition: ScheduleDefinition, rule: RecurrenceRule, from: number) {
  let previous = nominalAfter({ ...definition, endsAt: null }, rule, from)
  if (previous === null) return null
  let smallest = Number.POSITIVE_INFINITY
  for (let index = 0; index < SPACING_SAMPLE; index += 1) {
    const next = nominalAfter({ ...definition, endsAt: null }, rule, previous)
    if (next === null) break
    smallest = Math.min(smallest, (next - previous) / MINUTE_MS)
    previous = next
  }
  return smallest
}

/** Whether a schedule fires hourly or slower, which is when its firings are spread out. */
function isJittered(definition: ScheduleDefinition, rule: RecurrenceRule) {
  if (definition.schedule.kind === 'interval') {
    return definition.schedule.everyMinutes >= HOUR_MINUTES
  }
  if (definition.schedule.kind === 'daily') return true
  if (rule.frequency === 'MINUTELY') return rule.interval >= HOUR_MINUTES
  const gap = smallestGapMinutes(definition, rule, definition.anchorAt)
  return gap !== null && gap >= HOUR_MINUTES
}

/** Whether a schedule's firings are spread by up to ±5 minutes (hourly or slower). */
export function isScheduleJittered(definition: ScheduleDefinition) {
  const rule = recurrenceOf(definition.schedule)
  return typeof rule !== 'string' && isJittered(definition, rule)
}

/** The next `count` nominal fire times after `after`, for a schedule preview. */
export function upcomingNominalTimes(definition: ScheduleDefinition, after: number, count: number) {
  const times: number[] = []
  let cursor = after
  while (times.length < count) {
    const next = nextNominalAt(definition, cursor)
    if (next === null) break
    times.push(next)
    cursor = next
  }
  return times
}

/**
 * A deterministic offset within ±5 minutes, from the task and its nominal time, so tasks set for
 * the same minute do not all reach their providers together and a retried plan is the same.
 */
export function jitterMs(taskId: string, nominalAt: number) {
  const seconds =
    (fnv1a(`${taskId}:${String(nominalAt)}`) % JITTER_SPAN_SECONDS) - JITTER_OFFSET_SECONDS
  return seconds * SECOND_MS
}

/** The next firing after `after`, with its jitter. */
export function planNextFiring(
  definition: ScheduleDefinition,
  after: number,
): PlannedFiring | null {
  const rule = recurrenceOf(definition.schedule)
  if (typeof rule === 'string') return null
  const nominal = nominalAfter(definition, rule, after)
  if (nominal === null) return null
  const runAt = isJittered(definition, rule)
    ? nominal + jitterMs(definition.taskId, nominal)
    : nominal
  return { nominalAt: nominal, runAt: Math.max(after, runAt) }
}

/** The first look-back window when counting stopped early; it doubles until it holds a firing. */
const LATEST_SEARCH_WINDOW_MS = HOUR_MINUTES * MINUTE_MS
const LATEST_SEARCH_GROWTH = 2

function latestInWindow(
  definition: ScheduleDefinition,
  rule: RecurrenceRule,
  fromExclusive: number,
  upToInclusive: number,
) {
  let latest: number | null = null
  let cursor = fromExclusive
  for (let step = 0; step < MISSED_FIRING_COUNT_LIMIT; step += 1) {
    const next = nominalAfter(definition, rule, cursor)
    if (next === null || next > upToInclusive) return latest
    latest = next
    cursor = next
  }
  return null
}

/** The latest occurrence in `(floorExclusive, upToInclusive]`, found by looking back from the end. */
function latestOccurrence(
  definition: ScheduleDefinition,
  rule: RecurrenceRule,
  floorExclusive: number,
  upToInclusive: number,
) {
  for (let window = LATEST_SEARCH_WINDOW_MS; ; window *= LATEST_SEARCH_GROWTH) {
    const from = Math.max(floorExclusive, upToInclusive - window)
    const latest = latestInWindow(definition, rule, from, upToInclusive)
    if (latest !== null || from === floorExclusive) return latest
  }
}

/**
 * Occurrences in `(afterExclusive, upToInclusive]`: how many a Host that was down or asleep
 * missed, and the latest of them, which a catch-up run names. The count stops at
 * `MISSED_FIRING_COUNT_LIMIT`; the latest is still the true latest.
 */
export function missedOccurrences(
  definition: ScheduleDefinition,
  afterExclusive: number,
  upToInclusive: number,
) {
  const rule = recurrenceOf(definition.schedule)
  if (typeof rule === 'string') return { count: 0, latest: null }
  let count = 0
  let latest: number | null = null
  let cursor = afterExclusive
  while (count < MISSED_FIRING_COUNT_LIMIT) {
    const next = nominalAfter(definition, rule, cursor)
    if (next === null || next > upToInclusive) return { count, latest }
    count += 1
    latest = next
    cursor = next
  }
  return { count, latest: latestOccurrence(definition, rule, cursor, upToInclusive) ?? latest }
}

/** Checks a schedule a caller asks for: its zone, its rule, and the kind's minimum spacing. */
export function validateTaskSchedule(input: {
  readonly kind: ScheduledTaskKind
  readonly schedule: TaskSchedule
  readonly timeZone: string
  readonly now: number
}): ScheduleValidation {
  if (!isValidTimeZone(input.timeZone)) {
    return {
      ok: false,
      code: 'invalid_time_zone',
      message: `${input.timeZone} is not a known time zone.`,
    }
  }
  const minimum = minimumIntervalMinutes(input.kind)
  const kindLabel = input.kind === 'heartbeat' ? 'A Heartbeat' : 'A Launch schedule'
  const rule = recurrenceOf(input.schedule)
  if (typeof rule === 'string') return { ok: false, code: 'invalid_schedule', message: rule }
  if (input.schedule.kind === 'interval' && input.schedule.everyMinutes < minimum) {
    return {
      ok: false,
      code: 'invalid_schedule',
      message: `${kindLabel} fires at most every ${String(minimum)} minutes.`,
    }
  }
  const definition: ScheduleDefinition = {
    taskId: 'validation',
    schedule: input.schedule,
    timeZone: input.timeZone,
    anchorAt: input.now,
    endsAt: null,
  }
  const gap = smallestGapMinutes(definition, rule, input.now)
  if (gap === null) {
    return { ok: false, code: 'invalid_schedule', message: 'This schedule never fires.' }
  }
  if (gap < minimum) {
    return {
      ok: false,
      code: 'invalid_schedule',
      message: `${kindLabel} fires at most every ${String(minimum)} minutes; this schedule fires ${String(Math.round(gap))} minutes apart.`,
    }
  }
  return { ok: true }
}
