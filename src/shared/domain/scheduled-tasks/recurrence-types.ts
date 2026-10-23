/**
 * The subset of RFC 5545 recurrence rules a Task schedule accepts. DTSTART, UNTIL and COUNT are
 * refused: the start is the task's anchor, its zone is the stored one, and a task ends through
 * its own end date or run count. Times read as wall-clock times in the task's zone.
 */
export const RECURRENCE_FREQUENCIES = [
  'MINUTELY',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
] as const
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]

export interface RecurrenceWeekday {
  /** ISO weekday: 1 is Monday. */
  readonly weekday: number
  /** The nth (or, negative, nth-from-last) such weekday of the month; MONTHLY and YEARLY only. */
  readonly ordinal?: number
}

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency
  readonly interval: number
  readonly byWeekday?: readonly RecurrenceWeekday[]
  readonly byMonthDay?: readonly number[]
  readonly byMonth?: readonly number[]
  readonly byHour?: readonly number[]
  readonly byMinute?: readonly number[]
}

export type RecurrenceRuleParse =
  | { readonly ok: true; readonly rule: RecurrenceRule }
  | { readonly ok: false; readonly message: string }
