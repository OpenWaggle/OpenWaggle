import { describe, expect, it } from 'vitest'
import {
  heartbeatSettings,
  heartbeatTask,
  scheduledTask,
  scheduledTaskRun,
} from '@/test-utils/scheduled-task-fixtures'
import { noticeSnapshots, scheduledTaskNotices } from '../task-notices'

describe('scheduledTaskNotices', () => {
  it('announces nothing on the first read', () => {
    const failed = heartbeatTask({ lastRun: scheduledTaskRun({ status: 'failed' }) })
    expect(scheduledTaskNotices(null, [failed])).toEqual([])
  })

  it('announces a new failed run with its reason', () => {
    const before = heartbeatTask()
    const after = heartbeatTask({
      lastRun: scheduledTaskRun({ id: 'run-2', status: 'failed', reason: 'model-unavailable' }),
    })
    expect(scheduledTaskNotices(noticeSnapshots([before]), [after])).toEqual([
      {
        taskId: 'heartbeat-1',
        variant: 'error',
        message: 'Scheduled task “CI watch” failed: The model is unavailable',
        action: 'open',
      },
    ])
  })

  it('announces started runs only under the every-run policy', () => {
    const started = scheduledTaskRun({ id: 'run-2' })
    const launch = scheduledTask()
    const heartbeat = heartbeatTask()
    const notices = scheduledTaskNotices(noticeSnapshots([launch, heartbeat]), [
      scheduledTask({ lastRun: started }),
      heartbeatTask({ lastRun: started }),
    ])
    expect(notices).toEqual([
      {
        taskId: 'task-1',
        variant: 'neutral',
        message: 'Scheduled task “Morning triage” started a Session.',
        action: 'open',
      },
    ])
  })

  it('announces attention once, when it appears', () => {
    const attention = { reason: 'target-session-archived' as const, message: 'Archived.', since: 5 }
    const before = noticeSnapshots([heartbeatTask()])
    const after = [heartbeatTask({ attention })]
    expect(scheduledTaskNotices(before, after)).toEqual([
      {
        taskId: 'heartbeat-1',
        variant: 'error',
        message: 'Scheduled task “CI watch” needs attention: Archived.',
        action: 'open',
      },
    ])
    expect(scheduledTaskNotices(noticeSnapshots(after), after)).toEqual([])
  })

  it('always announces a skip for revoked authority', () => {
    const skipped = scheduledTaskRun({
      id: 'run-2',
      status: 'skipped',
      reason: 'creator-authority-revoked',
    })
    const notices = scheduledTaskNotices(noticeSnapshots([heartbeatTask()]), [
      heartbeatTask({ lastRun: skipped }),
    ])
    expect(notices).toHaveLength(1)
    expect(notices[0]?.message).toContain('was skipped')
  })

  it('announces each Heartbeat Auto-pause once, with Resume', () => {
    const before = noticeSnapshots([heartbeatTask()])
    const after = [
      heartbeatTask({
        enabled: false,
        heartbeat: heartbeatSettings({
          consecutiveIdleRuns: 3,
          autoPause: { reason: 'idle', message: 'auto-paused: 3 idle runs', since: 9 },
        }),
      }),
    ]
    expect(scheduledTaskNotices(before, after)).toEqual([
      {
        taskId: 'heartbeat-1',
        variant: 'neutral',
        message: 'Heartbeat “CI watch” auto-paused: 3 idle runs.',
        action: 'resume',
      },
    ])
    expect(scheduledTaskNotices(noticeSnapshots(after), after)).toEqual([])
    // A task first seen already paused announces nothing.
    expect(scheduledTaskNotices(new Map(), after)).toEqual([])
  })
})
