import { zonedDateTime, zonedEpoch } from '@shared/utils/zoned-time'
import { describe, expect, it } from 'vitest'
import { nextRecurrence } from '../recurrence-evaluation'
import { parseRecurrenceRule } from '../recurrence-rule'
import {
  jitterMs,
  MISSED_FIRING_COUNT_LIMIT,
  missedOccurrences,
  nextNominalAt,
  planNextFiring,
  SCHEDULED_TASK_JITTER_MS,
  type ScheduleDefinition,
  validateTaskSchedule,
} from '../task-schedule'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function definition(overrides: Partial<ScheduleDefinition>): ScheduleDefinition {
  return {
    taskId: 'task-1',
    schedule: { kind: 'interval', everyMinutes: 30 },
    timeZone: 'UTC',
    anchorAt: Date.UTC(2026, 0, 5, 8, 0),
    endsAt: null,
    ...overrides,
  }
}

function rule(text: string) {
  const parsed = parseRecurrenceRule(text)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.rule
}

describe('time zones', () => {
  it('reads a wall-clock time in the stored zone', () => {
    const epoch = zonedEpoch({ year: 2026, month: 7, day: 1 }, 9, 0, 'Europe/Madrid')
    expect(new Date(epoch).toISOString()).toBe('2026-07-01T07:00:00.000Z')
    expect(zonedDateTime(epoch, 'Europe/Madrid')).toMatchObject({ hour: 9, minute: 0, weekday: 3 })
  })

  it('fires a time skipped by clocks going forward once, after the gap', () => {
    // 2026-03-08 02:30 does not exist in New York.
    const epoch = zonedEpoch({ year: 2026, month: 3, day: 8 }, 2, 30, 'America/New_York')
    expect(zonedDateTime(epoch, 'America/New_York')).toMatchObject({ day: 8, hour: 3, minute: 30 })
  })

  it('fires a time repeated by clocks going back only the first time', () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4).
    const epoch = zonedEpoch({ year: 2026, month: 11, day: 1 }, 1, 30, 'America/New_York')
    expect(new Date(epoch).toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })
})

describe('recurrence rules', () => {
  it('refuses DTSTART, UNTIL and COUNT', () => {
    for (const text of [
      'FREQ=DAILY;DTSTART=20260101T000000',
      'FREQ=DAILY;UNTIL=20260101',
      'FREQ=DAILY;COUNT=3',
    ]) {
      expect(parseRecurrenceRule(text).ok).toBe(false)
    }
  })

  it('needs a monthly or yearly frequency for numbered weekdays', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=2TU').ok).toBe(false)
    expect(parseRecurrenceRule('RRULE:FREQ=MONTHLY;BYDAY=2TU;BYHOUR=10;BYMINUTE=0').ok).toBe(true)
  })

  it('finds the second Tuesday of the month', () => {
    const anchor = Date.UTC(2026, 0, 1)
    const next = nextRecurrence(
      rule('FREQ=MONTHLY;BYDAY=2TU;BYHOUR=10;BYMINUTE=0'),
      'UTC',
      anchor,
      anchor,
    )
    expect(new Date(next ?? 0).toISOString()).toBe('2026-01-13T10:00:00.000Z')
  })

  it('finds the last day of the month', () => {
    const anchor = Date.UTC(2026, 1, 1)
    const next = nextRecurrence(
      rule('FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=18;BYMINUTE=0'),
      'UTC',
      anchor,
      anchor,
    )
    expect(new Date(next ?? 0).toISOString()).toBe('2026-02-28T18:00:00.000Z')
  })

  it('keeps weekly intervals relative to the anchor week', () => {
    const anchor = Date.UTC(2026, 0, 5, 7) // Monday
    const parsed = rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0')
    const first = nextRecurrence(parsed, 'UTC', anchor, anchor)
    const second = nextRecurrence(parsed, 'UTC', anchor, first ?? 0)
    expect(new Date(first ?? 0).toISOString()).toBe('2026-01-05T09:00:00.000Z')
    expect(new Date(second ?? 0).toISOString()).toBe('2026-01-19T09:00:00.000Z')
  })
})

describe('Task schedules', () => {
  it('counts intervals as elapsed time from the anchor', () => {
    const value = definition({})
    expect(nextNominalAt(value, value.anchorAt)).toBe(value.anchorAt + 30 * MINUTE)
    expect(nextNominalAt(value, value.anchorAt + 31 * MINUTE)).toBe(value.anchorAt + 60 * MINUTE)
  })

  it('fires daily at a wall-clock time on chosen weekdays', () => {
    const value = definition({
      schedule: { kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] },
      timeZone: 'Europe/Madrid',
      anchorAt: Date.UTC(2026, 0, 9, 12), // Friday after 09:00 local
    })
    const next = nextNominalAt(value, value.anchorAt)
    expect(new Date(next ?? 0).toISOString()).toBe('2026-01-12T08:00:00.000Z') // Monday 09:00 CET
  })

  it('ends at its end date', () => {
    const value = definition({ endsAt: Date.UTC(2026, 0, 5, 8, 45) })
    expect(nextNominalAt(value, value.anchorAt)).toBe(value.anchorAt + 30 * MINUTE)
    expect(nextNominalAt(value, value.anchorAt + 30 * MINUTE)).toBeNull()
  })

  it('spreads hourly-or-slower firings within five minutes, deterministically', () => {
    const value = definition({ schedule: { kind: 'daily', at: '09:00' } })
    const planned = planNextFiring(value, value.anchorAt)
    expect(planned).not.toBeNull()
    if (!planned) return
    expect(Math.abs(planned.runAt - planned.nominalAt)).toBeLessThanOrEqual(
      SCHEDULED_TASK_JITTER_MS,
    )
    expect(planNextFiring(value, value.anchorAt)).toEqual(planned)
    for (let index = 0; index < 200; index += 1) {
      expect(Math.abs(jitterMs(`task-${String(index)}`, planned.nominalAt))).toBeLessThanOrEqual(
        SCHEDULED_TASK_JITTER_MS,
      )
    }
  })

  it('does not spread sub-hourly firings', () => {
    const value = definition({})
    expect(planNextFiring(value, value.anchorAt)).toEqual({
      nominalAt: value.anchorAt + 30 * MINUTE,
      runAt: value.anchorAt + 30 * MINUTE,
    })
  })

  it('counts the firings a sleeping machine missed', () => {
    const value = definition({ schedule: { kind: 'interval', everyMinutes: 60 } })
    const missed = missedOccurrences(value, value.anchorAt, value.anchorAt + 8 * HOUR + 10 * MINUTE)
    expect(missed).toEqual({ count: 8, latest: value.anchorAt + 8 * HOUR })
  })

  it('names the true latest firing when more were missed than it counts', () => {
    const value = definition({ schedule: { kind: 'interval', everyMinutes: 5 } })
    const upTo = value.anchorAt + 7 * 24 * HOUR + 2 * MINUTE
    const missed = missedOccurrences(value, value.anchorAt, upTo)
    expect(missed).toEqual({
      count: MISSED_FIRING_COUNT_LIMIT,
      latest: value.anchorAt + 7 * 24 * HOUR,
    })
  })

  it('enforces the minimum spacing of each kind', () => {
    const now = Date.UTC(2026, 0, 5)
    expect(
      validateTaskSchedule({
        kind: 'heartbeat',
        schedule: { kind: 'interval', everyMinutes: 4 },
        timeZone: 'UTC',
        now,
      }).ok,
    ).toBe(false)
    expect(
      validateTaskSchedule({
        kind: 'heartbeat',
        schedule: { kind: 'interval', everyMinutes: 5 },
        timeZone: 'UTC',
        now,
      }).ok,
    ).toBe(true)
    expect(
      validateTaskSchedule({
        kind: 'launch',
        schedule: { kind: 'rrule', rule: 'FREQ=HOURLY;BYMINUTE=0,10,20,30,40,50' },
        timeZone: 'UTC',
        now,
      }),
    ).toMatchObject({ ok: false, code: 'invalid_schedule' })
    expect(
      validateTaskSchedule({
        kind: 'launch',
        schedule: { kind: 'daily', at: '09:00' },
        timeZone: 'Mars/Olympus',
        now,
      }),
    ).toMatchObject({ ok: false, code: 'invalid_time_zone' })
  })
})
