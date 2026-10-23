import { describe, expect, it } from 'vitest'
import { heartbeatTask } from '@/test-utils/scheduled-task-fixtures'
import { previewSchedule } from '../schedule-preview'

const MINUTE = 60_000
const NOW = Date.UTC(2026, 9, 22, 18, 35)
const EVERY_30 = { kind: 'interval', everyMinutes: 30 } as const

describe('schedule preview', () => {
  it('counts a new interval from now and says when firings are spread', () => {
    expect(
      previewSchedule({
        kind: 'heartbeat',
        schedule: EVERY_30,
        timeZone: 'UTC',
        endsAt: null,
        now: NOW,
      }),
    ).toEqual({
      ok: true,
      times: [NOW + 30 * MINUTE, NOW + 60 * MINUTE, NOW + 90 * MINUTE],
      jittered: false,
    })
    const daily = previewSchedule({
      kind: 'launch',
      schedule: { kind: 'daily', at: '09:00' },
      timeZone: 'UTC',
      endsAt: null,
      now: NOW,
    })
    expect(daily).toMatchObject({ ok: true, jittered: true })
    expect(daily.ok && daily.times[0]).toBe(Date.UTC(2026, 9, 23, 9))
  })

  it('keeps an edited task’s own next run while its schedule is unchanged', () => {
    const nextNominalAt = NOW + 12 * MINUTE
    const stored = heartbeatTask({ timeZone: 'UTC', nextNominalAt })
    const preview = previewSchedule({
      kind: 'heartbeat',
      schedule: EVERY_30,
      timeZone: 'UTC',
      endsAt: null,
      now: NOW,
      stored,
    })
    expect(preview.ok && preview.times).toEqual([
      nextNominalAt,
      nextNominalAt + 30 * MINUTE,
      nextNominalAt + 60 * MINUTE,
    ])
    const changed = previewSchedule({
      kind: 'heartbeat',
      schedule: { kind: 'interval', everyMinutes: 15 },
      timeZone: 'UTC',
      endsAt: null,
      now: NOW,
      stored,
    })
    expect(changed.ok && changed.times[0]).toBe(NOW + 15 * MINUTE)
  })

  it('keeps a daily time on the wall clock across a daylight-saving change', () => {
    // Saturday 7 March 2026, noon in New York; clocks spring forward early on Sunday 8 March.
    const beforeChange = Date.UTC(2026, 2, 7, 17)
    const preview = previewSchedule({
      kind: 'launch',
      schedule: { kind: 'daily', at: '09:00' },
      timeZone: 'America/New_York',
      endsAt: null,
      now: beforeChange,
    })
    // 09:00 EST is 14:00 UTC; from Sunday on, 09:00 EDT is 13:00 UTC.
    expect(preview.ok && preview.times).toEqual([
      Date.UTC(2026, 2, 8, 13),
      Date.UTC(2026, 2, 9, 13),
      Date.UTC(2026, 2, 10, 13),
    ])
  })

  it('reports the Host’s own refusal for a schedule that fires too often', () => {
    expect(
      previewSchedule({
        kind: 'launch',
        schedule: { kind: 'interval', everyMinutes: 5 },
        timeZone: 'UTC',
        endsAt: null,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: 'A Launch schedule fires at most every 15 minutes.' })
  })
})
