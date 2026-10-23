import type { ScheduledTasksCommand, ScheduledTasksOutcome } from '@shared/types/scheduled-task'
import { act, fireEvent, renderHook, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { heartbeatTask, scheduledTask } from '@/test-utils/scheduled-task-fixtures'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: ScheduledTasksCommand) => Promise<ScheduledTasksOutcome>>(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    executeScheduledTasks: mocks.execute,
    getBackgroundStart: async () => ({ supported: false, enabled: false }),
    setBackgroundStart: async () => ({ supported: false, enabled: false }),
    listAgentDefinitionDisplay: async () => [],
  },
}))

import { useScheduledTasksPanelTitle } from '../../hooks/useScheduledTasksPanelTitle'
import { scheduledTaskProjects } from '../../lib/scheduled-tasks-view'
import { useScheduledTaskIndexStore } from '../../state/scheduled-task-index-store'
import { useScheduledTasksNavigationStore } from '../../state/scheduled-tasks-navigation-store'
import { ScheduledTasksPanel } from '../ScheduledTasksPanel'

const TASKS = [
  heartbeatTask(),
  heartbeatTask({
    id: 'heartbeat-2',
    name: 'Docs check',
    target: { kind: 'heartbeat', sessionId: 'session-2' },
  }),
  scheduledTask(),
  scheduledTask({ id: 'elsewhere', name: 'Other project', projectPath: '/projects/beta' }),
]

describe('Scheduled panel', () => {
  beforeEach(() => {
    mocks.execute.mockReset()
    mocks.execute.mockImplementation(async (command) => {
      if (command.operation === 'list') return { effect: 'listed', tasks: TASKS }
      if (command.operation === 'read') return { effect: 'read', task: TASKS[0] ?? heartbeatTask() }
      if (command.operation === 'runs') return { effect: 'runs-listed', runs: [] }
      return { effect: 'rejected', code: 'task_not_found', message: 'No such task.' }
    })
    useScheduledTasksNavigationStore.setState({ panel: { kind: 'list' } })
  })

  it('shows this project only: this Session’s Heartbeats, then its other tasks', async () => {
    renderWithQueryClient(
      <ScheduledTasksPanel sessionId="session-1" projectPath="/projects/alpha" />,
    )

    const session = await screen.findByRole('region', { name: 'Into this Session' })
    expect(within(session).getByText('CI watch')).toBeInTheDocument()
    const launch = screen.getByRole('region', { name: 'Launch schedules in alpha' })
    expect(within(launch).getByText('Morning triage')).toBeInTheDocument()
    const other = screen.getByRole('region', { name: 'Other Heartbeats in alpha' })
    expect(within(other).getByText('Docs check')).toBeInTheDocument()
    expect(screen.queryByText('Other project')).toBeNull()
  })

  it('replaces the list with a task, and starts a new task on this Session', async () => {
    renderWithQueryClient(
      <ScheduledTasksPanel sessionId="session-1" projectPath="/projects/alpha" />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /CI watch/ }))
    expect(useScheduledTasksNavigationStore.getState().panel).toEqual({
      kind: 'task',
      taskId: 'heartbeat-1',
    })
    expect(await screen.findByRole('region', { name: 'Run history' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit CI watch' })).toBeInTheDocument()

    useScheduledTasksNavigationStore.setState({ panel: { kind: 'list' } })
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }))
    expect(useScheduledTasksNavigationStore.getState().panel).toEqual({
      kind: 'new',
      defaults: { kind: 'heartbeat', sessionId: 'session-1' },
    })
  })

  it('sends tasks of other projects to Settings', async () => {
    renderWithQueryClient(
      <ScheduledTasksPanel sessionId="session-1" projectPath="/projects/alpha" />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Settings › Scheduled tasks' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/$tab',
      params: { tab: 'scheduled' },
    })
  })

  it('starts a fresh draft for each New task, whatever the previous one held', async () => {
    useScheduledTasksNavigationStore.setState({
      panel: { kind: 'new', defaults: { kind: 'heartbeat', sessionId: 'session-1' } },
    })
    renderWithQueryClient(
      <ScheduledTasksPanel sessionId="session-1" projectPath="/projects/alpha" />,
    )
    expect(await screen.findByRole('radio', { name: 'Into a Session' })).toBeChecked()

    act(() => {
      useScheduledTasksNavigationStore.setState({
        panel: { kind: 'new', defaults: { kind: 'launch', projectPath: '/projects/alpha' } },
      })
    })
    expect(await screen.findByRole('radio', { name: 'New Session each time' })).toBeChecked()
  })

  it('goes back to the list when the task being edited is deleted', async () => {
    useScheduledTasksNavigationStore.setState({ panel: { kind: 'edit', taskId: 'heartbeat-1' } })
    const { client } = renderWithQueryClient(
      <ScheduledTasksPanel sessionId="session-1" projectPath="/projects/alpha" />,
    )
    expect(await screen.findByRole('form', { name: 'Edit CI watch' })).toBeInTheDocument()

    mocks.execute.mockImplementation(async () => ({ effect: 'listed', tasks: TASKS.slice(1) }))
    await act(() => client.invalidateQueries())
    expect(await screen.findByRole('region', { name: 'Into this Session' })).toBeInTheDocument()
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('titles the panel for the Session it shows, not the one a task was opened from', () => {
    useScheduledTaskIndexStore.setState({
      names: { 'heartbeat-1': 'CI watch' },
      projects: scheduledTaskProjects(TASKS),
    })
    useScheduledTasksNavigationStore.setState({ panel: { kind: 'task', taskId: 'heartbeat-1' } })
    const { result, rerender } = renderHook(
      (scope: { projectPath: string; sessionId: string }) => useScheduledTasksPanelTitle(scope),
      { initialProps: { projectPath: '/projects/alpha', sessionId: 'session-1' } },
    )
    expect(result.current.label).toBe('CI watch')

    rerender({ projectPath: '/projects/beta', sessionId: 'session-9' })
    expect(result.current).toEqual({ label: 'Scheduled' })
  })
})
