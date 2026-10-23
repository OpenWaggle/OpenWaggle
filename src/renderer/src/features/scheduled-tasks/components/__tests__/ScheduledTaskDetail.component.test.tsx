import type { ScheduledTasksCommand, ScheduledTasksOutcome } from '@shared/types/scheduled-task'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { scheduledTask, scheduledTaskRun } from '@/test-utils/scheduled-task-fixtures'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: ScheduledTasksCommand) => Promise<ScheduledTasksOutcome>>(),
  openSession: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: { executeScheduledTasks: mocks.execute } }))
vi.mock('../../hooks/useOpenScheduledSession', () => ({
  useOpenScheduledSession: () => mocks.openSession,
}))

import { ScheduledTaskDetail } from '../ScheduledTaskDetail'

const TASK = scheduledTask({ timeZone: 'UTC' })
const RUNS = [
  scheduledTaskRun({ id: 'run-3', trigger: 'run-now', sessionId: 'session-launched' }),
  scheduledTaskRun({
    id: 'run-2',
    trigger: 'catch-up',
    missedCount: 3,
    status: 'skipped',
    reason: 'session-busy',
  }),
]

function renderDetail() {
  const onDeleted = vi.fn()
  renderWithQueryClient(
    <ScheduledTaskDetail taskId={TASK.id} layout="wide" onEdit={vi.fn()} onDeleted={onDeleted} />,
  )
  return { onDeleted }
}

describe('Scheduled task detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockImplementation(async (command) => {
      if (command.operation === 'read') return { effect: 'read', task: TASK, runs: RUNS }
      if (command.operation === 'runs') return { effect: 'runs-listed', runs: RUNS }
      if (command.operation === 'run-now') return { effect: 'run-requested', task: TASK }
      if (command.operation === 'update') {
        return { effect: 'updated', task: { ...TASK, ...command.patch } }
      }
      if (command.operation === 'delete') return { effect: 'deleted', taskId: command.taskId }
      return { effect: 'listed', tasks: [TASK] }
    })
  })

  it('lists each run with its trigger, why it was skipped, and the Session it started', async () => {
    renderDetail()

    const history = await screen.findByRole('region', { name: 'Run history' })
    expect(await within(history).findByText(/Catch-up \(3 missed\)/)).toBeInTheDocument()
    expect(within(history).getByText(/Run now/)).toBeInTheDocument()
    expect(within(history).getByText('Skipped')).toBeInTheDocument()
    fireEvent.click(within(history).getByRole('button', { name: 'Open Session' }))
    expect(mocks.openSession).toHaveBeenCalledWith('session-launched')
  })

  it('runs, pauses and deletes the task from its header', async () => {
    const { onDeleted } = renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await vi.waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        { operation: 'run-now', taskId: TASK.id },
        undefined,
      ),
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Pause this task' }))
    await vi.waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        { operation: 'update', taskId: TASK.id, patch: { enabled: false } },
        undefined,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: `Delete ${TASK.name}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })
})
