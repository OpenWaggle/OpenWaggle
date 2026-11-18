import { describe, expect, it } from 'vitest'
import {
  heartbeatSettings,
  heartbeatTask,
  scheduledTaskRun,
} from '@/test-utils/scheduled-task-fixtures'
import {
  heartbeatHasNoEnd,
  heartbeatSummaryText,
  lastCheckText,
  nextRunText,
  runOutcomeText,
  runReasonText,
} from '../task-format'

const NOW = new Date(2026, 2, 2, 7, 10).getTime()
const GATED = heartbeatSettings({
  wakeCheck: { command: 'true', onFailure: 'wake', approval: 'approved', pendingSince: null },
})

describe('Heartbeat presentation', () => {
  it('says when the last check found nothing to do, and when the next one is', () => {
    const task = heartbeatTask({
      heartbeat: GATED,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nextRunAt: new Date(2026, 2, 2, 7, 34).getTime(),
      lastRun: scheduledTaskRun({
        status: 'skipped',
        reason: 'wake-check-idle',
        wakeCheck: 'idle',
        firedAt: new Date(2026, 2, 2, 7, 4).getTime(),
      }),
    })
    expect(lastCheckText(task, NOW)).toMatch(/^Last check 0?7:04.* · nothing to do · next 0?7:34/)
    expect(heartbeatSummaryText(task)).toBe('Nothing to do')
    expect(runReasonText(task.lastRun ?? {})).toBe('Nothing to do')
  })

  it('shows an Auto-pause, a held approval, and a Heartbeat with no end', () => {
    const paused = heartbeatTask({
      enabled: false,
      heartbeat: heartbeatSettings({
        autoPause: { reason: 'idle', message: 'auto-paused: 3 idle runs', since: 1 },
      }),
    })
    expect(nextRunText(paused, NOW)).toBe('auto-paused: 3 idle runs')
    expect(heartbeatSummaryText(paused)).toBe('Auto-paused')
    const held = heartbeatTask({
      heartbeat: heartbeatSettings({
        wakeCheck: { command: 'true', onFailure: 'wake', approval: 'pending', pendingSince: 1 },
      }),
    })
    expect(nextRunText(held, NOW)).toBe('Waiting for you to approve its wake check')
    expect(
      heartbeatHasNoEnd(
        heartbeatTask({ heartbeat: heartbeatSettings({ stopWhen: null, indefinite: true }) }),
      ),
    ).toBe(true)
    expect(heartbeatHasNoEnd(heartbeatTask())).toBe(false)
  })

  it('names a Run outcome and where it came from', () => {
    expect(runOutcomeText({ outcome: { value: 'done', source: 'reported', note: 'merged' } })).toBe(
      'Done: merged',
    )
    expect(runOutcomeText({ outcome: { value: 'idle', source: 'inferred' } })).toBe(
      'Idle (inferred from the tools it used)',
    )
  })
})
