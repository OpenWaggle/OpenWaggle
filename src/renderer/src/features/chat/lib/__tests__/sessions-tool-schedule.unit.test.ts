import { describe, expect, it } from 'vitest'
import { sessionsToolScheduledTask } from '../sessions-tool-schedule'
import { isHiddenSessionsToolCall } from '../sessions-tool-visibility'
import { sessionsLabel } from '../tool-labels-sessions'

const TASK = { id: 'task-1', name: 'Morning triage', kind: 'heartbeat', enabled: true }

function piResult(outcome: object, text: object = outcome) {
  return {
    content: [{ type: 'text', text: JSON.stringify(text) }],
    details: { contract: 'scheduled-tasks-v1', response: { operation: 'create', outcome } },
  }
}

describe('sessionsToolScheduledTask', () => {
  it('reads the task a create made from the Host response in its details', () => {
    expect(
      sessionsToolScheduledTask(
        { action: 'schedule_create', name: 'Requested', prompt: 'Check CI' },
        piResult({ effect: 'created', task: TASK }, { effect: 'created', task: { id: 'other' } }),
      ),
    ).toEqual({
      action: 'schedule_create',
      taskId: 'task-1',
      name: 'Morning triage',
      controlled: true,
      refusal: null,
    })
  })

  it('falls back to the compact text result when the details are missing', () => {
    expect(
      sessionsToolScheduledTask(
        { action: 'schedule_update', scheduleTaskId: 'task-1' },
        JSON.stringify({ operation: 'update', effect: 'updated', task: TASK }),
      ),
    ).toMatchObject({ taskId: 'task-1', name: 'Morning triage', controlled: true })
  })

  it('falls back to the arguments while running or inside a script', () => {
    expect(
      sessionsToolScheduledTask({ action: 'schedule_create', name: 'Morning triage' }, undefined),
    ).toMatchObject({ taskId: null, name: 'Morning triage', controlled: true })
    expect(
      sessionsToolScheduledTask({ action: 'schedule_read', scheduleTaskId: 'task-1' }, undefined),
    ).toMatchObject({ taskId: 'task-1', name: null, controlled: false })
  })

  it('keeps the id of a deleted task and the Host refusal of a refused call', () => {
    expect(
      sessionsToolScheduledTask(
        { action: 'schedule_delete', scheduleTaskId: 'task-1' },
        piResult({ effect: 'deleted', taskId: 'task-1' }),
      ),
    ).toMatchObject({ taskId: 'task-1', controlled: false, refusal: null })
    expect(
      sessionsToolScheduledTask(
        { action: 'schedule_create', name: 'Too often' },
        piResult({ effect: 'rejected', code: 'invalid_schedule', message: 'Too often.' }),
      ),
    ).toMatchObject({ taskId: null, name: 'Too often', refusal: 'Too often.' })
  })

  it('ignores a result whose shape is not a Scheduled tasks response', () => {
    expect(
      sessionsToolScheduledTask(
        { action: 'schedule_update', scheduleTaskId: 'task-1' },
        { content: [], details: { contract: 'other', response: { outcome: { task: 3 } } } },
      ),
    ).toMatchObject({ taskId: 'task-1', name: null })
  })

  it('is null for any other hive-tool action', () => {
    expect(sessionsToolScheduledTask({ action: 'spawn', objective: 'Review' }, undefined)).toBe(
      null,
    )
  })
})

describe('Scheduled task hive-tool labels', () => {
  it('names the task an action acts on, or a bare scheduled task', () => {
    expect(sessionsLabel({ action: 'schedule_create', name: 'Morning triage' }, null)).toEqual({
      running: 'Creating scheduled task · Morning triage...',
      done: 'Created scheduled task · Morning triage',
      requested: 'Requested: creating scheduled task · Morning triage',
    })
    expect(
      sessionsLabel(
        { action: 'schedule_run_now', scheduleTaskId: 'task-1' },
        { title: 'Renamed', agentName: null, isWorker: false },
      ).done,
    ).toBe('Ran scheduled task · Renamed')
    expect(sessionsLabel({ action: 'schedule_delete', scheduleTaskId: 'task-1' }, null).done).toBe(
      'Deleted scheduled task',
    )
    expect(sessionsLabel({ action: 'schedule_list' }, null).done).toBe('Listed scheduled tasks')
  })

  it('shows a streaming Scheduled task action once its name is whole', () => {
    expect(isHiddenSessionsToolCall('hive', { action: 'schedule_run' }, 'input-streaming')).toBe(
      true,
    )
    expect(isHiddenSessionsToolCall('hive', { action: 'schedule_create' }, 'input-streaming')).toBe(
      false,
    )
  })
})
