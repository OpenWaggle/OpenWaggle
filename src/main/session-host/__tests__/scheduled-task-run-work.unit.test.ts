import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { scheduledTaskRunWork } from '../../domain/scheduled-tasks/scheduled-task-run-key'
import type { ScheduledTaskRecord } from '../../ports/scheduled-task-repository'
import { newRunStart } from '../scheduled-task-firing-records'

const timing = {
  trigger: 'schedule' as const,
  nominalAt: 1,
  missedCount: 0,
  supersededNominalAt: null,
}
const runNow = { ...timing, trigger: 'run-now' as const }

function taskBy(kind: 'local-user' | 'profile' | 'session-agent') {
  return fromPartial<ScheduledTaskRecord>({
    id: 'task',
    name: 'Task',
    creatorCallerId: kind === 'profile' ? 'profile:ci' : 'local-user',
    creator: { kind },
  })
}

function workOf(run: ReturnType<typeof newRunStart>) {
  return scheduledTaskRunWork(run.idempotencyKey)
}

/* Whose work a firing is rides in its request key, so the Worker limits can tell (ADR 0030). */
describe('Scheduled task run keys', () => {
  it('marks a scheduled firing by who made the task', () => {
    expect(workOf(newRunStart(taskBy('local-user'), timing, 1, null))).toBe('person')
    expect(workOf(newRunStart(taskBy('session-agent'), timing, 1, null))).toBe('agents')
    expect(workOf(newRunStart(taskBy('profile'), timing, 1, null))).toBe('agents')
  })

  it('marks a Run now by who asked for it', () => {
    expect(workOf(newRunStart(taskBy('session-agent'), runNow, 1, null, 'person'))).toBe('person')
    expect(workOf(newRunStart(taskBy('local-user'), runNow, 1, null, 'agents'))).toBe('agents')
  })
})
