/**
 * Wall-clock arithmetic in an IANA time zone, on the platform's `Intl` time zone data. A Task
 * schedule is read in the zone stored with its task, so a 09:00 task stays 09:00 in that zone
 * however the machine's zone changes.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** Every real offset is within ±14 hours; probing either side of a guess finds both offsets. */
const OFFSET_PROBE_MS = 14 * HOUR_MS
const DAYS_PER_WEEK = 7
const SUNDAY = 0
const ISO_SUNDAY = 7
const MIDNIGHT_HOUR = 24
const SECOND_MS = 1000
const MONTHS_PER_YEAR = 12

export interface ZonedDateTime {
  readonly year: number
  /** 1 to 12. */
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  /** ISO weekday: 1 is Monday and 7 is Sunday. */
  readonly weekday: number
}

export interface LocalDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string) {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

/** Whether the platform knows `timeZone` as an IANA zone. */
/** The machine's IANA time zone, or UTC when the platform does not name one. */
export function machineTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function isValidTimeZone(timeZone: string) {
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

function numberPart(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const part = parts.find((candidate) => candidate.type === type)
  return part ? Number(part.value) : 0
}

/** The wall-clock time `epochMs` shows in `timeZone`. */
export function zonedDateTime(epochMs: number, timeZone: string): ZonedDateTime {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs))
  const year = numberPart(parts, 'year')
  const month = numberPart(parts, 'month')
  const day = numberPart(parts, 'day')
  const hour = numberPart(parts, 'hour') % MIDNIGHT_HOUR
  const minute = numberPart(parts, 'minute')
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return { year, month, day, hour, minute, weekday: weekday === SUNDAY ? ISO_SUNDAY : weekday }
}

/** `timeZone`'s offset from UTC at `epochMs`, in milliseconds. */
function offsetAt(epochMs: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs))
  const asUtc = Date.UTC(
    numberPart(parts, 'year'),
    numberPart(parts, 'month') - 1,
    numberPart(parts, 'day'),
    numberPart(parts, 'hour') % MIDNIGHT_HOUR,
    numberPart(parts, 'minute'),
    numberPart(parts, 'second'),
  )
  const flooredToSecond = epochMs - (((epochMs % SECOND_MS) + SECOND_MS) % SECOND_MS)
  return asUtc - flooredToSecond
}

function sameWallClock(
  epochMs: number,
  timeZone: string,
  local: LocalDate,
  hour: number,
  minute: number,
) {
  const zoned = zonedDateTime(epochMs, timeZone)
  return (
    zoned.year === local.year &&
    zoned.month === local.month &&
    zoned.day === local.day &&
    zoned.hour === hour &&
    zoned.minute === minute
  )
}

/**
 * The instant a wall-clock time names in `timeZone`. A time that happens twice when clocks go
 * back names its first occurrence; a time skipped when clocks go forward names the instant after
 * the gap, so a schedule set inside the gap still fires once that day.
 */
export function zonedEpoch(local: LocalDate, hour: number, minute: number, timeZone: string) {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, hour, minute)
  const earlierOffset = offsetAt(asUtc - OFFSET_PROBE_MS, timeZone)
  const laterOffset = offsetAt(asUtc + OFFSET_PROBE_MS, timeZone)
  const candidates = [asUtc - earlierOffset, asUtc - laterOffset]
    .filter((candidate) => sameWallClock(candidate, timeZone, local, hour, minute))
    .sort((left, right) => left - right)
  return candidates[0] ?? asUtc - earlierOffset
}

/** The calendar date `days` after `date` (negative goes back). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** Whole calendar days from `from` to `to`. */
export function daysBetween(from: LocalDate, to: LocalDate) {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      DAY_MS,
  )
}

/** ISO weekday of a calendar date: 1 is Monday and 7 is Sunday. */
export function isoWeekday(date: LocalDate) {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  return weekday === SUNDAY ? ISO_SUNDAY : weekday
}

/** The Monday that starts the ISO week of `date`. */
export function weekStart(date: LocalDate) {
  return addDays(date, 1 - isoWeekday(date))
}

export function weeksBetween(from: LocalDate, to: LocalDate) {
  return Math.round(daysBetween(weekStart(from), weekStart(to)) / DAYS_PER_WEEK)
}

export function monthsBetween(from: LocalDate, to: LocalDate) {
  return (to.year - from.year) * MONTHS_PER_YEAR + (to.month - from.month)
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function localDateOf(epochMs: number, timeZone: string): LocalDate {
  const zoned = zonedDateTime(epochMs, timeZone)
  return { year: zoned.year, month: zoned.month, day: zoned.day }
}
