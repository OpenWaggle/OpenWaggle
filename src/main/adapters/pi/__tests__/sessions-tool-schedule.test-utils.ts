import type {
  LocalScheduledTasksCommandResult,
  ScheduledTask,
  ScheduledTasksOperation,
  ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'

export function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Check CI',
    prompt: 'Check whether CI is green.',
    kind: 'heartbeat',
    enabled: true,
    schedule: { kind: 'daily', at: '09:00', weekdays: [1, 3] },
    timeZone: 'Europe/Madrid',
    endsAt: null,
    maxRuns: null,
    target: { kind: 'heartbeat', sessionId: 'session-self' },
    notificationPolicy: 'failures-only',
    projectPath: '/repo',
    creator: { kind: 'session-agent', label: 'Queen', sessionId: 'session-self' },
    attention: null,
    // 2025-06-02T07:00:00Z is 09:00 in Madrid (CEST).
    nextRunAt: Date.UTC(2025, 5, 2, 7, 0),
    nextNominalAt: Date.UTC(2025, 5, 2, 7, 0),
    waitingSince: null,
    runCount: 0,
    lastRun: null,
    recentSessionIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

export function result(
  outcome: ScheduledTasksOutcome,
  operation: ScheduledTasksOperation = 'list',
) {
  return {
    contract: 'scheduled-tasks-v1',
    response: { contractVersion: 1, requestId: 'request', operation, outcome },
  } satisfies LocalScheduledTasksCommandResult
}
