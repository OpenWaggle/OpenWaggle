import type { ScheduledTask, ScheduledTaskRun } from '@shared/types/scheduled-task'

const WEEKDAYS = [1, 2, 3, 4, 5] as const
const HEARTBEAT_EVERY_MINUTES = 30

export function scheduledTaskRun(patch: Partial<ScheduledTaskRun> = {}): ScheduledTaskRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    trigger: 'schedule',
    nominalAt: Date.parse('2026-03-02T09:00:00Z'),
    firedAt: Date.parse('2026-03-02T09:01:30Z'),
    missedCount: 0,
    status: 'started',
    ...patch,
  }
}

export function scheduledTask(patch: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Morning triage',
    prompt: 'Triage new issues.',
    kind: 'launch',
    enabled: true,
    schedule: { kind: 'daily', at: '09:00', weekdays: [...WEEKDAYS] },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    endsAt: null,
    maxRuns: null,
    target: {
      kind: 'launch',
      projectPath: '/projects/alpha',
      workspace: 'new-worktree',
      archiveFinishedSessions: false,
    },
    notificationPolicy: 'every-run',
    projectPath: '/projects/alpha',
    creator: { kind: 'local-user', label: 'You' },
    attention: null,
    nextRunAt: Date.parse('2026-03-03T09:00:00Z'),
    nextNominalAt: Date.parse('2026-03-03T09:00:00Z'),
    waitingSince: null,
    runCount: 1,
    lastRun: null,
    recentSessionIds: [],
    createdAt: Date.parse('2026-03-01T09:00:00Z'),
    updatedAt: Date.parse('2026-03-01T09:00:00Z'),
    ...patch,
  }
}

export function heartbeatTask(patch: Partial<ScheduledTask> = {}): ScheduledTask {
  return scheduledTask({
    id: 'heartbeat-1',
    name: 'CI watch',
    kind: 'heartbeat',
    schedule: { kind: 'interval', everyMinutes: HEARTBEAT_EVERY_MINUTES },
    target: { kind: 'heartbeat', sessionId: 'session-1' },
    notificationPolicy: 'failures-only',
    ...patch,
  })
}
