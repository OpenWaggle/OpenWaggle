import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { isAgentsScheduledTaskRunKey } from '../../domain/scheduled-tasks/scheduled-task-run-key'
import type { ScheduledTaskRecord } from '../../ports/scheduled-task-repository'
import { newRunStart } from '../scheduled-task-firing-records'

const timing = {
  trigger: 'schedule' as const,
  nominalAt: 1,
  missedCount: 0,
  supersededNominalAt: null,
}

function taskBy(kind: 'local-user' | 'profile' | 'session-agent') {
  return fromPartial<ScheduledTaskRecord>({
    id: 'task',
    name: 'Task',
    creatorCallerId: kind === 'profile' ? 'profile:ci' : 'local-user',
    creator: { kind },
  })
}

/* Whose work a firing is rides in its request key, so the Worker limits can tell (ADR 0030). */
describe('Scheduled task run keys', () => {
  it('marks a scheduled firing by who made the task', () => {
    expect(
      isAgentsScheduledTaskRunKey(
        newRunStart(taskBy('local-user'), timing, 1, null).idempotencyKey,
      ),
    ).toBe(false)
    expect(
      isAgentsScheduledTaskRunKey(
        newRunStart(taskBy('session-agent'), timing, 1, null).idempotencyKey,
      ),
    ).toBe(true)
    expect(
      isAgentsScheduledTaskRunKey(newRunStart(taskBy('profile'), timing, 1, null).idempotencyKey),
    ).toBe(true)
  })

  it('marks a Run now by who asked for it', () => {
    const runNow = { ...timing, trigger: 'run-now' as const }
    expect(
      isAgentsScheduledTaskRunKey(
        newRunStart(taskBy('session-agent'), runNow, 1, null, 'person').idempotencyKey,
      ),
    ).toBe(false)
    expect(
      isAgentsScheduledTaskRunKey(
        newRunStart(taskBy('local-user'), runNow, 1, null, 'agents').idempotencyKey,
      ),
    ).toBe(true)
  })
})
