import { describe, expect, it } from 'vitest'
import { heartbeatTask, scheduledTask } from '@/test-utils/scheduled-task-fixtures'
import { scheduledTaskProjects, shownScheduledTasksView } from '../scheduled-tasks-view'

const TASKS = scheduledTaskProjects([
  heartbeatTask(),
  scheduledTask({ id: 'beta', projectPath: '/projects/beta' }),
])
const ALPHA = { projectPath: '/projects/alpha', sessionId: 'session-1' }

describe('shown Scheduled tasks view', () => {
  it('keeps a task of the container’s project open', () => {
    const view = { kind: 'task', taskId: 'heartbeat-1' } as const
    expect(shownScheduledTasksView(view, TASKS, ALPHA)).toBe(view)
  })

  it('falls back to the list for a deleted task or another project’s task', () => {
    expect(shownScheduledTasksView({ kind: 'edit', taskId: 'gone' }, TASKS, ALPHA)).toEqual({
      kind: 'list',
    })
    expect(shownScheduledTasksView({ kind: 'task', taskId: 'beta' }, TASKS, ALPHA)).toEqual({
      kind: 'list',
    })
    expect(shownScheduledTasksView({ kind: 'task', taskId: 'beta' }, TASKS, null)).toEqual({
      kind: 'task',
      taskId: 'beta',
    })
  })

  it('drops a new task meant for another Session', () => {
    const view = { kind: 'new', defaults: { kind: 'heartbeat', sessionId: 'session-2' } } as const
    expect(shownScheduledTasksView(view, TASKS, ALPHA)).toEqual({ kind: 'list' })
    expect(shownScheduledTasksView(view, undefined, ALPHA)).toBe(view)
  })
})
