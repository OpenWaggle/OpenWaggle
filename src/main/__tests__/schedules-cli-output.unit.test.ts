import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTasksOutcome,
  ScheduledTasksResponse,
} from '@shared/types/scheduled-task'
import { describe, expect, it } from 'vitest'
import { formatSchedulesCliResponse } from '../schedules-cli-output'

const RUN_NOW: ScheduledTaskRun = {
  id: 'run-1',
  taskId: 'task-1',
  trigger: 'run-now',
  // 2026-06-01 13:17:42 in Madrid (CEST), a manual run at no scheduled time.
  nominalAt: Date.UTC(2026, 5, 1, 11, 17, 42),
  firedAt: Date.UTC(2026, 5, 1, 11, 17, 42),
  missedCount: 0,
  status: 'started',
  sessionId: 'session-1',
}

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Morning triage',
    prompt: 'Triage new issues.',
    kind: 'launch',
    enabled: true,
    schedule: { kind: 'daily', at: '10:00' },
    timeZone: 'Europe/Madrid',
    endsAt: null,
    maxRuns: null,
    target: {
      kind: 'launch',
      projectPath: '/repo',
      workspace: 'new-worktree',
      archiveFinishedSessions: false,
    },
    notificationPolicy: 'every-run',
    projectPath: '/repo',
    creator: { kind: 'local-user', label: 'You' },
    attention: null,
    // 08:58:59Z is 09:58:59 in Madrid on 2026-10-26: jittered from 10:00.
    nextRunAt: Date.UTC(2026, 9, 26, 8, 58, 59),
    nextNominalAt: Date.UTC(2026, 9, 26, 9, 0),
    waitingSince: null,
    runCount: 1,
    lastRun: RUN_NOW,
    heartbeat: null,
    recentSessionIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function response(outcome: ScheduledTasksOutcome): ScheduledTasksResponse {
  return { contractVersion: 1, requestId: 'request', operation: 'list', outcome }
}

describe('openwaggle schedules output', () => {
  it('shows the next run to the second with its offset, the jitter, and the last run trigger', () => {
    expect(formatSchedulesCliResponse(response({ effect: 'listed', tasks: [task()] }))).toBe(
      'task-1  Morning triage  [on]  daily at 10:00 (Europe/Madrid)  next 2026-10-26 09:58:59 +01:00 Europe/Madrid (±5 min)  last 2026-06-01 13:17:42 +02:00 Europe/Madrid run-now started',
    )
  })

  it('says nothing about jitter for a sub-hourly schedule or a task with no runs', () => {
    const line = formatSchedulesCliResponse(
      response({
        effect: 'listed',
        tasks: [
          task({
            schedule: { kind: 'interval', everyMinutes: 15 },
            nextRunAt: Date.UTC(2026, 9, 26, 9, 0),
            nextNominalAt: Date.UTC(2026, 9, 26, 9, 0),
            lastRun: null,
          }),
        ],
      }),
    )
    expect(line).toBe(
      'task-1  Morning triage  [on]  every 15m (Europe/Madrid)  next 2026-10-26 10:00:00 +01:00 Europe/Madrid',
    )
  })

  it('shows a task’s runs on its own clock with their triggers', () => {
    const text = formatSchedulesCliResponse(
      response({
        effect: 'read',
        task: task(),
        runs: [
          RUN_NOW,
          {
            ...RUN_NOW,
            id: 'run-0',
            trigger: 'catch-up',
            missedCount: 2,
            status: 'skipped',
            reason: 'session-busy',
            nominalAt: Date.UTC(2026, 4, 31, 8, 0),
            firedAt: Date.UTC(2026, 4, 31, 8, 2, 3),
          },
        ],
      }),
    )
    expect(text).toContain(
      '  Last run: 2026-06-01 13:17:42 +02:00 Europe/Madrid run-now started → session-1',
    )
    expect(text).toContain(
      '  2026-06-01 13:17:42 +02:00 Europe/Madrid  run-now  started → session-1',
    )
    expect(text).toContain(
      '  2026-05-31 10:02:03 +02:00 Europe/Madrid  catch-up +2 missed  skipped (session-busy) → session-1',
    )
  })
})
