import type {
  ScheduledTask,
  ScheduledTasksCommand,
  ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => {
  const tasks: ScheduledTask[] = []
  return {
    tasks,
    deleteOutcome: vi.fn<(taskId: string) => ScheduledTasksOutcome>(),
    openTask: vi.fn(),
    show: vi.fn(),
    runNow: vi.fn(),
    setEnabled: vi.fn(),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    executeScheduledTasks: async (command: ScheduledTasksCommand) =>
      command.operation === 'delete'
        ? mocks.deleteOutcome(command.taskId)
        : { effect: 'listed', tasks: mocks.tasks },
  },
}))
vi.mock('@/features/scheduled-tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/scheduled-tasks')>()
  return {
    ...actual,
    useOpenScheduledTask: () => mocks.openTask,
    useShowScheduledTasks: () => mocks.show,
    useRunScheduledTaskNow: () => ({ mutate: mocks.runNow }),
    useSetScheduledTaskEnabled: () => ({ setEnabled: mocks.setEnabled, pendingTaskId: null }),
  }
})

import { heartbeatTask, scheduledTask } from '@/test-utils/scheduled-task-fixtures'
import { ScheduledSummarySection } from '../ScheduledSummarySection'

describe('Session Summary › Scheduled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tasks.splice(
      0,
      mocks.tasks.length,
      heartbeatTask(),
      heartbeatTask({ id: 'heartbeat-2', name: 'Review comments', enabled: false }),
      scheduledTask({ recentSessionIds: ['session-launched'] }),
    )
  })

  it('lists the Heartbeats that run in this Session and opens one where the user is', async () => {
    renderWithQueryClient(<ScheduledSummarySection sessionId="session-1" />)

    const row = await screen.findByRole('button', { name: 'Open CI watch' })
    // Seconds and the UTC offset, as everywhere a next run shows; a 30-minute Heartbeat is exact.
    expect(row).toHaveAttribute(
      'title',
      expect.stringMatching(/^Next run: .*:\d\d:\d\d.*GMT[^±]*$/),
    )
    expect(screen.getByRole('button', { name: 'Open Review comments' })).toHaveAttribute(
      'title',
      'Paused',
    )
    expect(screen.queryByText(/Started by/)).toBeNull()
    fireEvent.click(row)
    expect(mocks.openTask).toHaveBeenCalledWith('heartbeat-1')
  })

  it('says a daily Heartbeat’s next run may be up to 5 minutes off', async () => {
    mocks.tasks.splice(
      0,
      mocks.tasks.length,
      heartbeatTask({ schedule: { kind: 'daily', at: '09:00' } }),
    )
    renderWithQueryClient(<ScheduledSummarySection sessionId="session-1" />)

    const row = await screen.findByRole('button', { name: 'Open CI watch' })
    expect(row).toHaveAttribute('title', expect.stringMatching(/^Next run: .*GMT.* ± up to 5 min$/))
  })

  it('shows a Heartbeat’s next run on its own clock, as the task detail does', async () => {
    mocks.tasks.splice(0, mocks.tasks.length, heartbeatTask({ timeZone: 'Asia/Tokyo' }))
    renderWithQueryClient(<ScheduledSummarySection sessionId="session-1" />)

    const row = await screen.findByRole('button', { name: 'Open CI watch' })
    expect(row).toHaveAttribute('title', expect.stringMatching(/^Next run: .*6:00:00 PM GMT\+9$/))
  })

  it('names the Launch schedule that started this Session', async () => {
    renderWithQueryClient(<ScheduledSummarySection sessionId="session-launched" />)

    expect(await screen.findByRole('button', { name: 'Open Morning triage' })).toHaveTextContent(
      'Started by Morning triage',
    )
  })

  it('offers the quick actions in the row menu and a new Heartbeat for this Session', async () => {
    renderWithQueryClient(<ScheduledSummarySection sessionId="session-1" />)

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Open CI watch' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }))
    expect(mocks.setEnabled).toHaveBeenCalledWith('heartbeat-1', false)

    fireEvent.click(screen.getByRole('button', { name: 'CI watch actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Run now' }))
    expect(mocks.runNow).toHaveBeenCalledWith('heartbeat-1')

    fireEvent.click(screen.getByRole('button', { name: 'CI watch actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(mocks.show).toHaveBeenCalledWith({ kind: 'edit', taskId: 'heartbeat-1' })

    fireEvent.click(screen.getByRole('button', { name: 'New Heartbeat for this Session' }))
    expect(mocks.show).toHaveBeenCalledWith({
      kind: 'new',
      defaults: { kind: 'heartbeat', sessionId: 'session-1' },
    })
  })

  it('confirms a delete under its row and keeps it open with the reason when it fails', async () => {
    mocks.deleteOutcome.mockReturnValue({
      effect: 'rejected',
      code: 'scheduler_unavailable',
      message: 'The Session Host is not running.',
    })
    renderWithQueryClient(<ScheduledSummarySection sessionId="session-1" />)

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Open Review comments' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
    const confirmation = screen.getByRole('alert')
    expect(confirmation).toHaveTextContent('Delete Review comments?')
    expect(
      screen.getByRole('button', { name: 'Open Review comments' }).parentElement
        ?.nextElementSibling,
    ).toBe(confirmation)

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }))
    expect(
      await within(confirmation).findByText('The Session Host is not running.'),
    ).toBeInTheDocument()
    expect(mocks.deleteOutcome).toHaveBeenCalledWith('heartbeat-2')

    mocks.deleteOutcome.mockReturnValue({ effect: 'deleted', taskId: 'heartbeat-2' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('renders nothing for a Session no task touches', async () => {
    const { container } = renderWithQueryClient(<ScheduledSummarySection sessionId="other" />)
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
