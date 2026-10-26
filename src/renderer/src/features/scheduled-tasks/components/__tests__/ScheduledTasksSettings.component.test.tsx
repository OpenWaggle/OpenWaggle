import type { ScheduledTasksCommand, ScheduledTasksOutcome } from '@shared/types/scheduled-task'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  heartbeatTask,
  scheduledTask,
  scheduledTaskRun,
} from '@/test-utils/scheduled-task-fixtures'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: ScheduledTasksCommand) => Promise<ScheduledTasksOutcome>>(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    executeScheduledTasks: mocks.execute,
    getBackgroundStart: async () => ({ supported: true, enabled: false }),
    setBackgroundStart: async () => ({ supported: true, enabled: true }),
    listAgentDefinitionDisplay: async () => [],
  },
}))

import { usePreferencesStore } from '@/features/settings/state'
import { useScheduledTasksNavigationStore } from '../../state/scheduled-tasks-navigation-store'
import { ScheduledTasksSettings } from '../ScheduledTasksSettings'

const LAUNCH = scheduledTask({
  lastRun: scheduledTaskRun({ status: 'failed', reason: 'model-unavailable' }),
})
const HEARTBEAT = heartbeatTask({
  projectPath: '/projects/beta',
  attention: {
    reason: 'target-session-archived',
    message: 'The target Session was archived.',
    since: 1,
  },
  enabled: false,
})

function createCommand() {
  return mocks.execute.mock.calls.find(([command]) => command.operation === 'create')?.[0]
}

describe('Settings › Scheduled tasks', () => {
  beforeEach(() => {
    mocks.execute.mockReset()
    mocks.execute.mockImplementation(async (command) => {
      if (command.operation === 'list') return { effect: 'listed', tasks: [LAUNCH, HEARTBEAT] }
      if (command.operation === 'read') {
        return {
          effect: 'read',
          task: command.taskId === LAUNCH.id ? LAUNCH : HEARTBEAT,
          runs: [],
        }
      }
      if (command.operation === 'runs') return { effect: 'runs-listed', runs: [] }
      if (command.operation === 'create') return { effect: 'created', task: LAUNCH }
      if (command.operation === 'update') return { effect: 'updated', task: LAUNCH }
      return { effect: 'rejected', code: 'task_not_found', message: 'No such task.' }
    })
    useScheduledTasksNavigationStore.setState({ settings: { kind: 'list' } })
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, projectPath: '/projects/alpha' },
    }))
  })

  it('lists every project’s tasks and shows attention instead of the switch', async () => {
    renderWithQueryClient(<ScheduledTasksSettings />)

    const alpha = await screen.findByRole('region', { name: 'alpha' })
    expect(within(alpha).getByText('Morning triage')).toBeInTheDocument()
    expect(within(alpha).getByRole('switch', { name: 'Morning triage enabled' })).toBeChecked()
    const beta = screen.getByRole('region', { name: 'beta' })
    expect(within(beta).getByText('The target Session was archived.')).toBeInTheDocument()
    expect(within(beta).getByLabelText('Needs attention')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Background start' })).toBeInTheDocument()
  })

  it('opens a task’s detail beside the list, and its editor in the same place', async () => {
    renderWithQueryClient(<ScheduledTasksSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /Morning triage/ }))
    expect(await screen.findByRole('heading', { name: 'Morning triage' })).toBeInTheDocument()
    expect(screen.getByText('Run now')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Run history' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Morning triage' }))
    expect(await screen.findByRole('form', { name: 'Edit Morning triage' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('states the minimum interval only for interval schedules, for the kind chosen', async () => {
    renderWithQueryClient(<ScheduledTasksSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const form = await screen.findByRole('form', { name: 'New Scheduled task' })
    expect(within(form).getByLabelText('Repeat')).toHaveValue('weekdays')
    expect(within(form).queryByText(/At most every/)).toBeNull()

    fireEvent.change(within(form).getByLabelText('Repeat'), { target: { value: 'interval' } })
    expect(within(form).getByText(/At most every 15 minutes\./)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('radio', { name: 'Into a Session' }))
    expect(within(form).getByText(/At most every 5 minutes\./)).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Repeat'), { target: { value: 'rrule' } })
    expect(within(form).queryByText(/At most every/)).toBeNull()
  })

  it('creates a task in place with a name taken from its prompt and a preview of runs', async () => {
    renderWithQueryClient(<ScheduledTasksSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const form = await screen.findByRole('form', { name: 'New Scheduled task' })
    fireEvent.change(within(form).getByLabelText('Prompt'), {
      target: { value: 'Summarize open PRs and failing CI.' },
    })
    expect(within(form).getByLabelText('Name')).toHaveAttribute(
      'placeholder',
      'Summarize open PRs and failing CI',
    )
    expect(within(form).getByLabelText('Project')).toHaveValue('/projects/alpha')
    expect(within(form).getByText('Next')).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Create task' }))

    await vi.waitFor(() =>
      expect(createCommand()).toMatchObject({
        operation: 'create',
        input: {
          name: 'Summarize open PRs and failing CI',
          schedule: { kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] },
          target: { kind: 'launch', projectPath: '/projects/alpha' },
        },
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Morning triage' })).toBeInTheDocument()
  })
})
