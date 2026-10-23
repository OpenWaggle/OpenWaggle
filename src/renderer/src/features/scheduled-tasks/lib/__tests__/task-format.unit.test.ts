import { describe, expect, it } from 'vitest'
import { heartbeatTask, scheduledTaskRun } from '@/test-utils/scheduled-task-fixtures'
import { formatAbsoluteTime, formatRelativeTime, nextRunText, runSummaryText } from '../task-format'

const NOW = Date.parse('2026-03-02T12:00:00Z')
const MINUTE = 60_000

describe('task format', () => {
  it('names the zone of a time kept on another clock', () => {
    const zoned = formatAbsoluteTime(NOW, 'Asia/Tokyo')
    expect(zoned).toMatch(/9:00/)
    expect(zoned).toMatch(/GMT\+9|JST/)
    expect(formatAbsoluteTime(NOW)).not.toMatch(/GMT|JST/)
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
