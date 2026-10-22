import type { ScheduledTasksCommand, ScheduledTasksOutcome } from '@shared/types/scheduled-task'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  heartbeatTask,
  scheduledTask,
  scheduledTaskRun,
} from '../../lib/__tests__/scheduled-task-fixtures'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: ScheduledTasksCommand) => Promise<ScheduledTasksOutcome>>(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    executeScheduledTasks: mocks.execute,
    getBackgroundStart: async () => ({ supported: true, enabled: false }),
    setBackgroundStart: async () => ({ supported: true, enabled: true }),
    onFullscreenChanged: () => () => {},
  },
}))

import { useScheduledTasksPreferencesStore } from '../../state/scheduled-tasks-preferences-store'
import { ScheduledTasksPage } from '../ScheduledTasksPage'

const TASKS = [
  scheduledTask({
    lastRun: scheduledTaskRun({ status: 'failed', reason: 'model-unavailable' }),
  }),
  heartbeatTask({
    projectPath: '/projects/beta',
    timeZone: 'Pacific/Kiritimati',
    attention: {
      reason: 'target-session-archived',
      message: 'The target Session was archived.',
      since: 1,
    },
    enabled: false,
  }),
]

function renderPage(onSelectTask = vi.fn()) {
  return renderWithQueryClient(
    <ScheduledTasksPage selectedTaskId={null} onSelectTask={onSelectTask} onBack={vi.fn()} />,
  )
}

describe('ScheduledTasksPage', () => {
  beforeEach(() => {
    mocks.execute.mockReset()
    mocks.execute.mockImplementation(async (command) => {
      if (command.operation === 'list') return { effect: 'listed', tasks: TASKS }
      if (command.operation === 'update') {
        return { effect: 'updated', task: scheduledTask({ enabled: false }) }
      }
      return { effect: 'rejected', code: 'task_not_found', message: 'No such task.' }
    })
    useScheduledTasksPreferencesStore.setState({ backgroundStartOfferDismissed: false })
  })

  it('lists tasks by project with schedule, last run, zone and attention', async () => {
    renderPage()

    const alpha = await screen.findByRole('region', { name: 'alpha' })
    expect(within(alpha).getByText('Morning triage')).toBeInTheDocument()
    expect(within(alpha).getByText('Launch schedule')).toBeInTheDocument()
    expect(within(alpha).getByText('Weekdays at 09:00')).toBeInTheDocument()
    expect(within(alpha).getByText('Failed')).toBeInTheDocument()
    expect(within(alpha).getByText(/The model is unavailable/)).toBeInTheDocument()

    const beta = screen.getByRole('region', { name: 'beta' })
    expect(within(beta).getByText('Heartbeat')).toBeInTheDocument()
    expect(within(beta).getByText('Every 30 minutes')).toBeInTheDocument()
    expect(within(beta).getByText('· Pacific/Kiritimati')).toBeInTheDocument()
    expect(within(beta).getByText('Paused')).toBeInTheDocument()
    expect(within(beta).getByRole('alert')).toHaveTextContent('The target Session was archived.')
    expect(within(beta).getByText('No runs yet')).toBeInTheDocument()
  })

  it('pauses a task from its enabled switch', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('switch', { name: 'Pause Morning triage' }))

    await vi.waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        { operation: 'update', taskId: 'task-1', patch: { enabled: false } },
        undefined,
      ),
    )
  })

  it('asks before deleting and shows the Host rejection inline', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Morning triage' }))
    expect(mocks.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'delete' }),
      undefined,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('No such task.')).toBeInTheDocument()
  })

  it('opens a task detail from its name', async () => {
    const onSelectTask = vi.fn()
    renderPage(onSelectTask)

    fireEvent.click(await screen.findByRole('button', { name: 'Morning triage' }))
    expect(onSelectTask).toHaveBeenCalledWith('task-1')
  })

  it('offers Background start once tasks exist, until dismissed', async () => {
    renderPage()

    expect(await screen.findByText('Keep Scheduled tasks running after a restart')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Keep Scheduled tasks running after a restart')).toBeNull()
    expect(useScheduledTasksPreferencesStore.getState().backgroundStartOfferDismissed).toBe(true)
  })

  it('shows the empty state when nothing is scheduled', async () => {
    mocks.execute.mockResolvedValue({ effect: 'listed', tasks: [] })
    renderPage()

    expect(await screen.findByText('No Scheduled tasks yet')).toBeInTheDocument()
  })
})
