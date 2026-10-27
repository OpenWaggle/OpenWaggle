import { describe, expect, it } from 'vitest'
import type { SessionsToolParameters } from '../sessions-tool-parameters'
import { buildSessionsToolPayload } from '../sessions-tool-payload'

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

describe('Hive tool Heartbeat payloads (#388)', () => {
  it('refuses an open-ended Heartbeat before asking the Host (#388)', () => {
    const create = {
      action: 'schedule_create',
      name: 'Watch',
      prompt: 'Check.',
      scheduleKind: 'heartbeat',
      schedule: { kind: 'interval', everyMinutes: 10 },
    } as const
    expect(() => scheduledCommand(create)).toThrow(/needs a way to finish/)
    expect(scheduledCommand({ ...create, indefinite: true }).command).toMatchObject({
      input: { heartbeat: { indefinite: true } },
    })
    expect(scheduledCommand({ ...create, maxRuns: 4 }).command).toMatchObject({
      input: { maxRuns: 4 },
    })
  })

  it('sends a Wake check, idle threshold and the Heartbeat own model', () => {
    const request = scheduledCommand({
      action: 'schedule_create',
      name: 'Babysit CI',
      prompt: 'Fix failing checks.',
      scheduleKind: 'heartbeat',
      schedule: { kind: 'interval', everyMinutes: 30 },
      stopWhen: 'PR 42 merged',
      wakeIf: 'gh pr checks 42 | grep fail',
      wakeOnFailure: 'skip',
      idlePauseAfter: 2,
      model: 'anthropic/haiku',
      thinking: 'low',
    })
    expect(request.command).toMatchObject({
      input: {
        target: {
          kind: 'heartbeat',
          sessionId: 'session-self',
          modelId: 'anthropic/haiku',
          thinkingLevel: 'low',
        },
        heartbeat: {
          stopWhen: 'PR 42 merged',
          idlePauseAfter: 2,
          wakeCheck: { command: 'gh pr checks 42 | grep fail', onFailure: 'skip' },
        },
      },
    })
    expect(() =>
      scheduledCommand({
        action: 'schedule_create',
        name: 'N',
        prompt: 'P',
        scheduleKind: 'launch',
        schedule: { kind: 'interval', everyMinutes: 30 },
        wakeIf: 'true',
      }),
    ).toThrow(/apply only to a Heartbeat/)
  })

  it('reports the calling Run outcome without naming a task', () => {
    expect(
      scheduledCommand({ action: 'schedule_outcome', outcome: 'done', note: ' merged ' }).command,
    ).toEqual({
      operation: 'report-outcome',
      runId: 'run-current',
      outcome: 'done',
      note: 'merged',
    })
  })

  it('removes a Wake check with null on update', () => {
    expect(
      scheduledCommand({ action: 'schedule_update', scheduleTaskId: 'task-1', wakeIf: null })
        .command,
    ).toEqual({ operation: 'update', taskId: 'task-1', patch: { heartbeat: { wakeCheck: null } } })
  })
})
