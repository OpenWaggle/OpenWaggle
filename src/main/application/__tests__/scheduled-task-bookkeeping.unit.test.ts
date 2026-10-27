import { describe, expect, it } from 'vitest'
import type { ScheduledTaskRecord } from '../../ports/scheduled-task-repository'
import { firingTiming, SCHEDULED_TASK_CATCH_UP_GRACE_MS } from '../scheduled-task-bookkeeping'

const MINUTE = 60_000
const ANCHOR = Date.UTC(2026, 0, 5, 8)

function record(overrides: Partial<ScheduledTaskRecord> = {}): ScheduledTaskRecord {
  return {
    id: 'task',
    ownerKey: 'local-user',
    creatorCallerId: 'gui:local-user',
    creator: { kind: 'local-user', label: 'You' },
    creatorWorkingDirectory: null,
    kind: 'heartbeat',
    name: 'Task',
    prompt: 'Prompt',
    enabled: true,
    schedule: { kind: 'interval', everyMinutes: 30 },
    timeZone: 'UTC',
    anchorAt: ANCHOR,
    endsAt: null,
    maxRuns: null,
    target: { kind: 'heartbeat', sessionId: 'session' },
    projectPath: '/repo',
    notificationPolicy: 'failures-only',
    attention: null,
    nextRunAt: ANCHOR + 30 * MINUTE,
    nextNominalAt: ANCHOR + 30 * MINUTE,
    waitingSince: null,
    runCount: 0,
    stopWhen: null,
    indefinite: true,
    idlePauseAfter: 3,
    consecutiveIdleRuns: 0,
    wakeCheck: null,
    autoPause: null,
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
    ...overrides,
  }
}

describe('Scheduled task firing timing', () => {
  it('fires on time as an ordinary run', () => {
    expect(firingTiming(record(), 'schedule', ANCHOR + 30 * MINUTE + 1000)).toEqual({
      trigger: 'schedule',
      nominalAt: ANCHOR + 30 * MINUTE,
      missedCount: 0,
      supersededNominalAt: null,
    })
  })

  it('marks a late firing as a catch-up', () => {
    const late = ANCHOR + 30 * MINUTE + SCHEDULED_TASK_CATCH_UP_GRACE_MS + 1
    expect(firingTiming(record(), 'schedule', late).trigger).toBe('catch-up')
  })

  it('collapses missed firings into the latest one', () => {
    expect(firingTiming(record(), 'schedule', ANCHOR + 125 * MINUTE)).toEqual({
      trigger: 'catch-up',
      nominalAt: ANCHOR + 120 * MINUTE,
      missedCount: 3,
      supersededNominalAt: null,
    })
  })

  it('records the firing a waiting Heartbeat held as superseded at the next fire time', () => {
    const waiting = record({ waitingSince: ANCHOR + 31 * MINUTE })
    expect(firingTiming(waiting, 'schedule', ANCHOR + 61 * MINUTE)).toEqual({
      trigger: 'schedule',
      nominalAt: ANCHOR + 60 * MINUTE,
      missedCount: 0,
      supersededNominalAt: ANCHOR + 30 * MINUTE,
    })
  })

  it('leaves the schedule alone for a run-now', () => {
    expect(firingTiming(record(), 'run-now', ANCHOR)).toMatchObject({
      trigger: 'run-now',
      nominalAt: ANCHOR,
    })
  })
})
