import {
  addDays,
  daysBetween,
  daysInMonth,
  isoWeekday,
  type LocalDate,
  localDateOf,
  monthsBetween,
  weeksBetween,
  zonedDateTime,
  zonedEpoch,
} from '@shared/utils/zoned-time'
import type { RecurrenceRule } from './recurrence-types'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAYS_PER_WEEK = 7
const HOURS_PER_DAY = 24
/** A yearly rule on 29 February needs up to eight years to find its next occurrence. */
const MAX_SCAN_DAYS = 366 * 8 + 2
const MAX_ELAPSED_STEPS = 50_000

function weekdayMatches(rule: RecurrenceRule, date: LocalDate) {
  const weekdays = rule.byWeekday
  if (!weekdays) return true
  const weekday = isoWeekday(date)
  const lastDay = daysInMonth(date.year, date.month)
  return weekdays.some((candidate) => {
    if (candidate.weekday !== weekday) return false
    if (candidate.ordinal === undefined) return true
    const forward = Math.floor((date.day - 1) / DAYS_PER_WEEK) + 1
    const backward = -(Math.floor((lastDay - date.day) / DAYS_PER_WEEK) + 1)
    return candidate.ordinal === forward || candidate.ordinal === backward
  })
}

function monthDayMatches(rule: RecurrenceRule, date: LocalDate) {
  const monthDays = rule.byMonthDay
  if (!monthDays) return true
  const lastDay = daysInMonth(date.year, date.month)
  return monthDays.some((day) => (day > 0 ? day === date.day : lastDay + day + 1 === date.day))
}

/** Day filters a frequency implies from its anchor when the rule names none. */
function defaultDayMatches(rule: RecurrenceRule, date: LocalDate, anchor: LocalDate) {
  if (rule.frequency === 'WEEKLY' && !rule.byWeekday) {
    return isoWeekday(date) === isoWeekday(anchor)
  }
  if (rule.frequency === 'MONTHLY' && !rule.byWeekday && !rule.byMonthDay) {
    return date.day === anchor.day
  }
  if (rule.frequency === 'YEARLY' && !rule.byWeekday && !rule.byMonthDay) {
    return date.day === anchor.day && (rule.byMonth !== undefined || date.month === anchor.month)
  }
  return true
}

function periodMatches(rule: RecurrenceRule, date: LocalDate, anchor: LocalDate) {
  if (rule.interval === 1) return true
  if (rule.frequency === 'DAILY') return daysBetween(anchor, date) % rule.interval === 0
  if (rule.frequency === 'WEEKLY') return weeksBetween(anchor, date) % rule.interval === 0
  if (rule.frequency === 'MONTHLY') return monthsBetween(anchor, date) % rule.interval === 0
  if (rule.frequency === 'YEARLY') return (date.year - anchor.year) % rule.interval === 0
  return true
}

function dayMatches(rule: RecurrenceRule, date: LocalDate, anchor: LocalDate) {
  if (daysBetween(anchor, date) < 0) return false
  if (!periodMatches(rule, date, anchor)) return false
  if (rule.byMonth && !rule.byMonth.includes(date.month)) return false
  return (
    weekdayMatches(rule, date) &&
    monthDayMatches(rule, date) &&
    defaultDayMatches(rule, date, anchor)
  )
}

function hourlyMatches(rule: RecurrenceRule, candidate: number, anchorEpoch: number) {
  if (rule.interval === 1) return true
  const anchorHour = Math.floor(anchorEpoch / HOUR_MS)
  return (Math.floor(candidate / HOUR_MS) - anchorHour) % rule.interval === 0
}

/** Wall-clock times of one matching day, for frequencies of a day or longer, and HOURLY. */
function dayTimes(rule: RecurrenceRule, anchorTime: { hour: number; minute: number }) {
  const hours =
    rule.byHour ??
    (rule.frequency === 'HOURLY'
      ? Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour)
      : [anchorTime.hour])
  const minutes = rule.byMinute ?? [anchorTime.minute]
  return hours.flatMap((hour) => minutes.map((minute) => ({ hour, minute })))
}

function nextCalendarOccurrence(
  rule: RecurrenceRule,
  timeZone: string,
  anchorEpoch: number,
  after: number,
) {
  const anchorZoned = zonedDateTime(anchorEpoch, timeZone)
  const anchor: LocalDate = anchorZoned
  const start =
    daysBetween(anchor, localDateOf(after, timeZone)) < 0 ? anchor : localDateOf(after, timeZone)
  // A wall-clock time can belong to the previous local date's zone offset; start a day early.
  const first = addDays(start, -1)
  const times = dayTimes(rule, anchorZoned)
  for (let offset = 0; offset <= MAX_SCAN_DAYS; offset += 1) {
    const date = addDays(first, offset)
    if (!dayMatches(rule, date, anchor)) continue
    let best: number | null = null
    for (const time of times) {
      const candidate = zonedEpoch(date, time.hour, time.minute, timeZone)
      if (candidate <= after || candidate < anchorEpoch) continue
      if (rule.frequency === 'HOURLY' && !hourlyMatches(rule, candidate, anchorEpoch)) continue
      if (best === null || candidate < best) best = candidate
    }
    if (best !== null) return best
  }
  return null
}

function nextElapsedOccurrence(
  rule: RecurrenceRule,
  timeZone: string,
  anchorEpoch: number,
  after: number,
) {
  const step = rule.interval * MINUTE_MS
  const startStep = after < anchorEpoch ? 0 : Math.floor((after - anchorEpoch) / step) + 1
  for (let index = 0; index < MAX_ELAPSED_STEPS; index += 1) {
    const candidate = anchorEpoch + (startStep + index) * step
    const zoned = zonedDateTime(candidate, timeZone)
    if (rule.byHour && !rule.byHour.includes(zoned.hour)) continue
    if (rule.byMonth && !rule.byMonth.includes(zoned.month)) continue
    if (rule.byWeekday && !rule.byWeekday.some((weekday) => weekday.weekday === zoned.weekday)) {
      continue
    }
    return candidate
  }
  return null
}

/**
 * The first occurrence strictly after `after`. The anchor is the rule's start: occurrences are
 * counted from it, and none is earlier.
 */
export function nextRecurrence(
  rule: RecurrenceRule,
  timeZone: string,
  anchorEpoch: number,
  after: number,
): number | null {
  return rule.frequency === 'MINUTELY'
    ? nextElapsedOccurrence(rule, timeZone, anchorEpoch, after)
    : nextCalendarOccurrence(rule, timeZone, anchorEpoch, after)
}
