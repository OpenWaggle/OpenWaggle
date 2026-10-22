import type { ScheduledTasksCommand, ScheduledTasksOutcome } from '@shared/types/scheduled-task'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { heartbeatTask, scheduledTask } from '../../lib/__tests__/scheduled-task-fixtures'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: ScheduledTasksCommand) => Promise<ScheduledTasksOutcome>>(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    executeScheduledTasks: mocks.execute,
    listAgentDefinitionDisplay: async () => [],
  },
}))

import { ScheduledTaskEditorDialog } from '../ScheduledTaskEditorDialog'

function lastCommand() {
  return mocks.execute.mock.calls.at(-1)?.[0]
}

describe('ScheduledTaskEditorDialog', () => {
  beforeEach(() => {
    mocks.execute.mockReset()
    mocks.execute.mockResolvedValue({ effect: 'created', task: scheduledTask() })
  })

  it('creates a Launch schedule from the weekly preset', async () => {
    const onClose = vi.fn()
    renderWithQueryClient(
      <ScheduledTaskEditorDialog
        target={{ mode: 'create', kind: 'launch', projectPath: '/projects/alpha' }}
        onClose={onClose}
      />,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Weekly review' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Review the week.' } })
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } })
    fireEvent.click(screen.getByLabelText('Tue'))
    fireEvent.change(screen.getByLabelText('At'), { target: { value: '16:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(lastCommand()).toMatchObject({
      operation: 'create',
      input: {
        name: 'Weekly review',
        schedule: { kind: 'daily', at: '16:30', weekdays: [1, 3, 4, 5] },
        target: { kind: 'launch', projectPath: '/projects/alpha', workspace: 'new-worktree' },
        notificationPolicy: 'every-run',
      },
    })
  })

  it('shows the Host rejection inline and stays open', async () => {
    mocks.execute.mockResolvedValue({
      effect: 'rejected',
      code: 'invalid_schedule',
      message: 'BYSECOND is not supported.',
    })
    const onClose = vi.fn()
    renderWithQueryClient(
      <ScheduledTaskEditorDialog
        target={{ mode: 'edit', task: heartbeatTask() }}
        onClose={onClose}
      />,
    )

    expect(screen.getByLabelText('Session')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'rrule' } })
    fireEvent.change(screen.getByLabelText('Recurrence rule'), {
      target: { value: 'FREQ=MINUTELY;BYSECOND=1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('BYSECOND is not supported.')
    expect(onClose).not.toHaveBeenCalled()
    expect(lastCommand()).toMatchObject({
      operation: 'update',
      taskId: 'heartbeat-1',
      patch: { schedule: { kind: 'rrule', rule: 'FREQ=MINUTELY;BYSECOND=1' } },
    })
  })

  it('rejects a Heartbeat interval under five minutes before reaching the Host', () => {
    renderWithQueryClient(
      <ScheduledTaskEditorDialog
        target={{ mode: 'edit', task: heartbeatTask() }}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Every'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('A Heartbeat runs at most every 5 minutes.')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
