import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromAny } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { assertSessionsToolActionArguments } from '../sessions-tool-flat-schema'
import type { SessionsToolParameters } from '../sessions-tool-parameters'
import { buildSessionsToolPayload } from '../sessions-tool-payload'
import {
  executeSessionsToolSchedule,
  type SessionsToolScheduleInput,
} from '../sessions-tool-schedule-payload'

import { result, task } from './sessions-tool-schedule.test-utils'

const source = { sessionId: 'session-self', runId: 'run-current', projectPath: '/repo' }

function scheduledCommand(input: SessionsToolParameters, from: typeof source | object = source) {
  const payload = buildSessionsToolPayload(input, {
    sessionId: 'session-self',
    runId: 'run-current',
    ...from,
  })
  if (payload.contract !== 'scheduled-tasks-v1')
    throw new Error('expected a Scheduled task payload')
  return payload.request
}

describe('Hive tool Scheduled task payloads', () => {
  it('creates a Heartbeat for the calling Session by default', () => {
    const request = scheduledCommand({
      action: 'schedule_create',
      name: 'Watch the deploy',
      prompt: 'Check the deploy and report.',
      scheduleKind: 'heartbeat',
      schedule: { kind: 'interval', everyMinutes: 10 },
    })

    expect(request).toMatchObject({
      contractVersion: 1,
      idempotencyKey: expect.any(String),
      command: {
        operation: 'create',
        input: {
          name: 'Watch the deploy',
          prompt: 'Check the deploy and report.',
          enabled: true,
          schedule: { kind: 'interval', everyMinutes: 10 },
          target: { kind: 'heartbeat', sessionId: 'session-self' },
        },
      },
    })
  })

  it('creates a Launch schedule in the current project with explicit settings', () => {
    const request = scheduledCommand({
      action: 'schedule_create',
      name: 'Nightly triage',
      prompt: 'Triage new issues.',
      scheduleKind: 'launch',
      schedule: { kind: 'daily', at: '07:30', weekdays: [1, 2, 3, 4, 5] },
      timeZone: 'Europe/Madrid',
      endsAt: '2030-01-01T00:00:00Z',
      maxRuns: 20,
      enabled: false,
      notificationPolicy: 'failures-only',
      model: 'anthropic/claude',
      thinking: 'high',
      agent: 'triager',
      archiveFinishedSessions: true,
    })

    expect(request.command).toEqual({
      operation: 'create',
      input: {
        name: 'Nightly triage',
        prompt: 'Triage new issues.',
        enabled: false,
        schedule: { kind: 'daily', at: '07:30', weekdays: [1, 2, 3, 4, 5] },
        timeZone: 'Europe/Madrid',
        endsAt: Date.UTC(2030, 0, 1),
        maxRuns: 20,
        notificationPolicy: 'failures-only',
        target: {
          kind: 'launch',
          projectPath: '/repo',
          workspace: 'new-worktree',
          modelId: 'anthropic/claude',
          thinkingLevel: 'high',
          agentDefinitionName: 'triager',
          archiveFinishedSessions: true,
        },
      },
    })
  })

  it('refuses mismatched or incomplete targets with actionable errors', () => {
    const base = {
      action: 'schedule_create' as const,
      name: 'Task',
      prompt: 'Do it.',
      schedule: { kind: 'interval' as const, everyMinutes: 30 },
    }
    expect(() =>
      scheduledCommand({ ...base, scheduleKind: 'heartbeat', projectPath: '/repo' }),
    ).toThrow('projectPath apply only to a Launch schedule')
    expect(() =>
      scheduledCommand({ ...base, scheduleKind: 'launch', sessionId: 'session-other' }),
    ).toThrow('sessionId applies only to a Heartbeat')
    expect(() =>
      scheduledCommand({ ...base, scheduleKind: 'launch' }, { projectPath: undefined }),
    ).toThrow('A Launch schedule requires projectPath.')
    expect(() =>
      scheduledCommand({ ...base, scheduleKind: 'launch', thinking: 'impossible' }),
    ).toThrow('Unsupported thinking level')
    expect(() =>
      scheduledCommand({ ...base, scheduleKind: 'heartbeat', endsAt: 'next tuesday' }),
    ).toThrow('endsAt must be an ISO date-time or epoch milliseconds.')
  })

  it('rejects malformed schedules before they reach the Host', () => {
    expect(() =>
      assertSessionsToolActionArguments(
        fromAny({
          action: 'schedule_create',
          name: 'Task',
          prompt: 'Do it.',
          scheduleKind: 'heartbeat',
          schedule: { kind: 'daily', at: '25:00' },
        }),
      ),
    ).toThrow('Invalid arguments for hive action "schedule_create"')
    expect(() =>
      assertSessionsToolActionArguments(
        fromAny({
          action: 'schedule_create',
          name: 'Task',
          prompt: 'Do it.',
          scheduleKind: 'heartbeat',
        }),
      ),
    ).toThrow('Invalid arguments for hive action "schedule_create"')
    expect(() => assertSessionsToolActionArguments(fromAny({ action: 'schedule_read' }))).toThrow(
      'Invalid arguments for hive action "schedule_read"',
    )
  })

  it('maps reads, run pages, deletes, and run-now requests by task id', () => {
    expect(scheduledCommand({ action: 'schedule_list', projectPath: '/repo' }).command).toEqual({
      operation: 'list',
      projectPath: '/repo',
    })
    expect(scheduledCommand({ action: 'schedule_read', scheduleTaskId: 'task-1' }).command).toEqual(
      { operation: 'read', taskId: 'task-1' },
    )
    expect(
      scheduledCommand({
        action: 'schedule_runs',
        scheduleTaskId: 'task-1',
        limit: 5,
        before: '2025-06-01T00:00:00Z',
      }).command,
    ).toEqual({ operation: 'runs', taskId: 'task-1', limit: 5, before: Date.UTC(2025, 5, 1) })
    expect(
      scheduledCommand({ action: 'schedule_delete', scheduleTaskId: 'task-1' }).command,
    ).toEqual({ operation: 'delete', taskId: 'task-1' })
    const runNow = scheduledCommand({ action: 'schedule_run_now', scheduleTaskId: 'task-1' })
    expect(runNow.command).toEqual({ operation: 'run-now', taskId: 'task-1' })
    expect(runNow.idempotencyKey).toBeUndefined()
  })

  it('pauses a Heartbeat with a minimal patch and refuses empty or kind-changing updates', () => {
    expect(
      scheduledCommand({ action: 'schedule_update', scheduleTaskId: 'task-1', enabled: false })
        .command,
    ).toEqual({ operation: 'update', taskId: 'task-1', patch: { enabled: false } })
    expect(
      scheduledCommand({
        action: 'schedule_update',
        scheduleTaskId: 'task-1',
        maxRuns: null,
        endsAt: null,
      }).command,
    ).toEqual({ operation: 'update', taskId: 'task-1', patch: { endsAt: null, maxRuns: null } })
    expect(() => scheduledCommand({ action: 'schedule_update', scheduleTaskId: 'task-1' })).toThrow(
      'needs at least one field',
    )
    expect(() =>
      scheduledCommand(
        fromAny({ action: 'schedule_update', scheduleTaskId: 'task-1', scheduleKind: 'launch' }),
      ),
    ).toThrow('cannot change kind')
  })

  it('reads the current Launch target before changing only some of its fields', async () => {
    const launchTarget = {
      kind: 'launch' as const,
      projectPath: '/repo',
      workspace: 'local' as const,
      modelId: 'old/model',
      agentDefinitionName: 'triager',
      archiveFinishedSessions: true,
    }
    const sent: LocalSessionCommandPayload[] = []
    const execute = vi.fn(async (payload: LocalSessionCommandPayload) => {
      sent.push(payload)
      return result(
        sent.length === 1
          ? { effect: 'read', task: task({ kind: 'launch', target: launchTarget }), runs: [] }
          : { effect: 'updated', task: task({ kind: 'launch', target: launchTarget }) },
        sent.length === 1 ? 'read' : 'update',
      )
    })
    const input: SessionsToolScheduleInput = {
      action: 'schedule_update',
      scheduleTaskId: 'task-1',
      model: 'new/model',
    }

    await executeSessionsToolSchedule(input, source, execute)

    expect(
      sent.map((payload) => payload.contract === 'scheduled-tasks-v1' && payload.request.command),
    ).toEqual([
      { operation: 'read', taskId: 'task-1' },
      {
        operation: 'update',
        taskId: 'task-1',
        patch: { target: { ...launchTarget, modelId: 'new/model' } },
      },
    ])
  })

  it('returns a refused read instead of updating a Launch target it could not see', async () => {
    const refused = result(
      { effect: 'rejected', code: 'task_not_found', message: 'No such Scheduled task.' },
      'read',
    )
    const execute = vi.fn(async () => refused)

    await expect(
      executeSessionsToolSchedule(
        { action: 'schedule_update', scheduleTaskId: 'task-1', workspace: 'local' },
        source,
        execute,
      ),
    ).resolves.toBe(refused)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
