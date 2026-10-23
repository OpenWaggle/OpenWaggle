import { describe, expect, it } from 'vitest'
import {
  defaultScheduleDraft,
  describeSchedule,
  draftFromSchedule,
  type ScheduleDraft,
  scheduleFromDraft,
} from '../schedule-presets'

function draft(patch: Partial<ScheduleDraft>): ScheduleDraft {
  return { ...defaultScheduleDraft('heartbeat'), ...patch }
}

describe('scheduleFromDraft', () => {
  it('maps an interval in minutes or hours to elapsed minutes', () => {
    expect(scheduleFromDraft(draft({ intervalAmount: '30' }), 'heartbeat')).toEqual({
      ok: true,
      schedule: { kind: 'interval', everyMinutes: 30 },
    })
    expect(
      scheduleFromDraft(draft({ intervalAmount: '2', intervalUnit: 'hours' }), 'launch'),
    ).toEqual({ ok: true, schedule: { kind: 'interval', everyMinutes: 120 } })
  })

  it('enforces the 5-minute Heartbeat and 15-minute Launch schedule floors', () => {
    expect(scheduleFromDraft(draft({ intervalAmount: '5' }), 'heartbeat').ok).toBe(true)
    expect(scheduleFromDraft(draft({ intervalAmount: '4' }), 'heartbeat')).toEqual({
      ok: false,
      error: 'A Heartbeat runs at most every 5 minutes.',
    })
    expect(scheduleFromDraft(draft({ intervalAmount: '10' }), 'launch')).toEqual({
      ok: false,
      error: 'A Launch schedule runs at most every 15 minutes.',
    })
  })

  it('rejects an interval that is not a whole number', () => {
    expect(scheduleFromDraft(draft({ intervalAmount: '1.5' }), 'heartbeat').ok).toBe(false)
    expect(scheduleFromDraft(draft({ intervalAmount: '' }), 'heartbeat').ok).toBe(false)
    expect(scheduleFromDraft(draft({ intervalAmount: '0' }), 'heartbeat').ok).toBe(false)
  })

  it('maps daily, weekdays and weekly presets to a daily time', () => {
    expect(scheduleFromDraft(draft({ preset: 'daily', time: '07:30' }), 'launch')).toEqual({
      ok: true,
      schedule: { kind: 'daily', at: '07:30' },
    })
    expect(scheduleFromDraft(draft({ preset: 'weekdays', time: '09:00' }), 'launch')).toEqual({
      ok: true,
      schedule: { kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] },
    })
    expect(
      scheduleFromDraft(draft({ preset: 'weekly', time: '18:15', weekdays: [5, 1, 5] }), 'launch'),
    ).toEqual({ ok: true, schedule: { kind: 'daily', at: '18:15', weekdays: [1, 5] } })
  })

  it('requires a time and at least one weekly day', () => {
    expect(scheduleFromDraft(draft({ preset: 'daily', time: '' }), 'launch').ok).toBe(false)
    expect(scheduleFromDraft(draft({ preset: 'weekly', weekdays: [] }), 'launch')).toEqual({
      ok: false,
      error: 'Choose at least one day.',
    })
  })

  it('passes an advanced rule through without its RRULE: prefix', () => {
    expect(
      scheduleFromDraft(draft({ preset: 'rrule', rule: ' RRULE:FREQ=DAILY;BYHOUR=9 ' }), 'launch'),
    ).toEqual({ ok: true, schedule: { kind: 'rrule', rule: 'FREQ=DAILY;BYHOUR=9' } })
    expect(scheduleFromDraft(draft({ preset: 'rrule', rule: '  ' }), 'launch').ok).toBe(false)
  })
})

describe('draftFromSchedule', () => {
  it('opens each stored schedule on the matching preset', () => {
    expect(draftFromSchedule({ kind: 'interval', everyMinutes: 180 }, 'launch')).toMatchObject({
      preset: 'interval',
      intervalAmount: '3',
      intervalUnit: 'hours',
    })
    expect(draftFromSchedule({ kind: 'interval', everyMinutes: 45 }, 'heartbeat')).toMatchObject({
      intervalAmount: '45',
      intervalUnit: 'minutes',
    })
    expect(
      draftFromSchedule({ kind: 'daily', at: '09:00', weekdays: [5, 4, 3, 2, 1] }, 'launch'),
    ).toMatchObject({ preset: 'weekdays', time: '09:00' })
    expect(
      draftFromSchedule({ kind: 'daily', at: '09:00', weekdays: [2, 4] }, 'launch'),
    ).toMatchObject({ preset: 'weekly', weekdays: [2, 4] })
    expect(draftFromSchedule({ kind: 'daily', at: '06:00' }, 'launch').preset).toBe('daily')
    expect(draftFromSchedule({ kind: 'rrule', rule: 'FREQ=HOURLY' }, 'launch')).toMatchObject({
      preset: 'rrule',
      rule: 'FREQ=HOURLY',
    })
  })

  it('round-trips through scheduleFromDraft', () => {
    const schedule = { kind: 'daily', at: '10:45', weekdays: [1, 3, 6] } as const
    expect(scheduleFromDraft(draftFromSchedule(schedule, 'launch'), 'launch')).toEqual({
      ok: true,
      schedule,
    })
  })
})

describe('describeSchedule', () => {
  it('describes each schedule in words', () => {
    expect(describeSchedule({ kind: 'interval', everyMinutes: 30 })).toBe('Every 30 minutes')
    expect(describeSchedule({ kind: 'interval', everyMinutes: 60 })).toBe('Every hour')
    expect(describeSchedule({ kind: 'interval', everyMinutes: 120 })).toBe('Every 2 hours')
    expect(describeSchedule({ kind: 'interval', everyMinutes: 1440 })).toBe('Every day')
    expect(describeSchedule({ kind: 'daily', at: '09:00' })).toBe('Daily at 09:00')
    expect(describeSchedule({ kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] })).toBe(
      'Weekdays at 09:00',
    )
    expect(describeSchedule({ kind: 'daily', at: '10:00', weekdays: [6, 7] })).toBe(
      'Weekends at 10:00',
    )
    expect(describeSchedule({ kind: 'daily', at: '08:00', weekdays: [3, 1] })).toBe(
      'Weekly on Mon, Wed at 08:00',
    )
    expect(describeSchedule({ kind: 'rrule', rule: 'FREQ=MONTHLY' })).toBe('Custom rule')
  })
})
