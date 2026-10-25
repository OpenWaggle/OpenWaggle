import { describe, expect, it } from 'vitest'
import { heartbeatTask, scheduledTaskRun } from '@/test-utils/scheduled-task-fixtures'
import {
  formatAbsoluteTime,
  formatRelativeTime,
  nextRunAbsoluteText,
  nextRunText,
  runSummaryText,
} from '../task-format'

const NOW = Date.parse('2026-03-02T12:00:00Z')
const MINUTE = 60_000

describe('task format', () => {
  it('shows the seconds and the UTC offset of a time, on any clock', () => {
    const zoned = formatAbsoluteTime(NOW, 'Asia/Tokyo')
    expect(zoned).toMatch(/9:00:00/)
    expect(zoned).toMatch(/GMT\+9/)
    // A jittered 09:58:59 is not shown as 09:58.
    expect(formatAbsoluteTime(Date.parse('2026-10-26T08:58:59Z'), 'Europe/Madrid')).toMatch(
      /9:58:59.*GMT\+1/,
    )
    // The machine's own zone names its offset too.
    expect(formatAbsoluteTime(NOW)).toMatch(/:\d\d:00.*GMT/)
  })

  it('tells the two occurrences of an hour repeated when clocks go back apart', () => {
    const first = formatAbsoluteTime(Date.parse('2026-10-25T00:30:00Z'), 'Europe/Madrid')
    const second = formatAbsoluteTime(Date.parse('2026-10-25T01:30:00Z'), 'Europe/Madrid')
    expect(first).toMatch(/2:30:00.*GMT\+2/)
    expect(second).toMatch(/2:30:00.*GMT\+1/)
  })

  it('says a jittered next run may be up to 5 minutes off its time', () => {
    const daily = heartbeatTask({ schedule: { kind: 'daily', at: '10:00' }, timeZone: 'UTC' })
    expect(nextRunAbsoluteText(daily)).toMatch(/9:00:00.*GMT(\+0)? ± up to 5 min$/)
    expect(nextRunAbsoluteText(heartbeatTask({ timeZone: 'UTC' }))).toMatch(/9:00:00.*GMT(\+0)?$/)
    expect(nextRunAbsoluteText(heartbeatTask({ nextRunAt: null }))).toBeNull()
  })

  it('shows the next run on the task’s own clock when it keeps another zone', () => {
    // 2026-03-03 09:00Z is 18:00 in Tokyo.
    expect(nextRunAbsoluteText(heartbeatTask({ timeZone: 'Asia/Tokyo' }))).toMatch(
      /6:00:00.*PM GMT\+9$/,
    )
  })

  it('formats near times relative to now', () => {
    expect(formatRelativeTime(NOW + 10_000, NOW)).toBe('now')
    expect(formatRelativeTime(NOW + 12 * MINUTE, NOW)).toBe('in 12 minutes')
    expect(formatRelativeTime(NOW - 3 * 60 * MINUTE, NOW)).toBe('3 hours ago')
  })

  it('says why a task will not fire next', () => {
    expect(nextRunText(heartbeatTask({ enabled: false }), NOW)).toBe('Paused')
    expect(nextRunText(heartbeatTask({ waitingSince: NOW }), NOW)).toBe(
      'Waiting for the Session to be idle',
    )
    expect(nextRunText(heartbeatTask({ nextRunAt: null }), NOW)).toBe('Schedule ended')
    expect(nextRunText(heartbeatTask({ nextRunAt: NOW + 5 * MINUTE }), NOW)).toBe(
      'Next in 5 minutes',
    )
  })

  it('summarises a run with its reason and the Host message', () => {
    expect(runSummaryText(scheduledTaskRun())).toBe('Started')
    expect(
      runSummaryText(
        scheduledTaskRun({
          status: 'skipped',
          reason: 'session-busy',
          message: 'A Run was active',
        }),
      ),
    ).toBe('Skipped — The Session was busy until the next fire time: A Run was active')
  })
})
