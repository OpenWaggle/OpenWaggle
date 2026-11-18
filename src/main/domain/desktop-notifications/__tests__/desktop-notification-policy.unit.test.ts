import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import { describe, expect, it } from 'vitest'
import {
  desktopNotificationOriginOfCaller,
  desktopNotificationOriginPermits,
  desktopNotificationPermitted,
  desktopNotificationReplaces,
  readyToReadHiveSettled,
  readyToReadTiming,
  runSettlementCandidate,
} from '../desktop-notification-policy'

const READY = { category: 'ready-to-read', reason: 'completed' } as const
const NEEDS_YOU = { category: 'needs-you', reason: 'awaiting-answer' } as const

describe('Desktop notification policy', () => {
  it('maps settled Runs to their category, and a Run the person interrupted to none', () => {
    expect(runSettlementCandidate('completed')).toEqual(READY)
    expect(runSettlementCandidate('interrupted-by-interaction-timeout')).toEqual({
      category: 'failed-or-interrupted',
      reason: 'interaction-timeout',
    })
    expect(runSettlementCandidate('interrupted')).toBeNull()
  })

  it('treats the desktop app and the local user as the person, anything else as an agent', () => {
    expect(desktopNotificationOriginOfCaller('gui:local-user')).toEqual({ kind: 'person' })
    expect(desktopNotificationOriginOfCaller('local-user:machine')).toEqual({ kind: 'person' })
    expect(desktopNotificationOriginOfCaller('session-agent:a:run-1')).toEqual({ kind: 'agent' })
    expect(desktopNotificationOriginOfCaller('mcp:client')).toEqual({ kind: 'agent' })
  })

  it('lets only Needs you through for a Run another agent started', () => {
    expect(desktopNotificationOriginPermits({ kind: 'agent' }, READY)).toBe(false)
    expect(desktopNotificationOriginPermits({ kind: 'agent' }, NEEDS_YOU)).toBe(true)
    expect(
      desktopNotificationOriginPermits({ kind: 'scheduled-task', policy: 'every-run' }, READY),
    ).toBe(true)
  })

  it('mutes everything but Needs you', () => {
    const settings = { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, mutedProjectPaths: ['/work'] }
    const subject = { sessionId: 'a', projectPath: '/work' }
    expect(desktopNotificationPermitted(settings, READY, subject)).toBe(false)
    expect(desktopNotificationPermitted(settings, NEEDS_YOU, subject)).toBe(true)
  })

  it('never lets a less urgent notification displace Needs you', () => {
    expect(desktopNotificationReplaces('needs-you', 'ready-to-read')).toBe(false)
    expect(desktopNotificationReplaces('needs-you', 'needs-you')).toBe(true)
    expect(desktopNotificationReplaces('ready-to-read', 'agent-errors')).toBe(true)
  })

  it('holds Ready to read until the Hive settles, except for a question asked mid-work', () => {
    const idle = {
      rootRunning: false,
      workersRunning: false,
      wakeComing: false,
      runStartedWhileWorkersRan: false,
    }
    const person = { hiveWake: false }
    expect(readyToReadHiveSettled(idle)).toBe(true)
    expect(readyToReadTiming(idle, person)).toBe('now')
    expect(readyToReadTiming(idle, { hiveWake: true })).toBe('now')
    expect(readyToReadTiming({ ...idle, workersRunning: true }, person)).toBe('after-workers')
    expect(readyToReadTiming({ ...idle, wakeComing: true }, person)).toBe('after-workers')
    expect(readyToReadTiming({ ...idle, rootRunning: true }, person)).toBe('after-workers')
    const midWork = { ...idle, workersRunning: true, runStartedWhileWorkersRan: true }
    expect(readyToReadTiming(midWork, person)).toBe('mid-work-answer')
    // A Hive wake never notifies on its own.
    expect(readyToReadTiming(midWork, { hiveWake: true })).toBe('after-workers')
  })
})
