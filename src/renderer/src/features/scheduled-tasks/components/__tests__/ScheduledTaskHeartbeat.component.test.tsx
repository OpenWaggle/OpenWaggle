import type {
  ScheduledTask,
  ScheduledTasksCommand,
  ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  heartbeatSettings,
  heartbeatTask,
  scheduledTaskRun,
} from '@/test-utils/scheduled-task-fixtures'
import { formatAbsoluteTime } from '../../lib/task-format'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: ScheduledTasksCommand) => Promise<ScheduledTasksOutcome>>(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { executeScheduledTasks: mocks.execute, listAgentDefinitionDisplay: async () => [] },
}))
vi.mock('../../hooks/useOpenScheduledSession', () => ({ useOpenScheduledSession: () => vi.fn() }))

import { ScheduledTaskDetail } from '../ScheduledTaskDetail'
import { ScheduledTaskEditor } from '../ScheduledTaskEditor'

const SKIPPED = scheduledTaskRun({
  id: 'run-2',
  status: 'skipped',
  reason: 'wake-check-idle',
  message: 'The Wake check exited 0 and printed nothing.',
  wakeCheck: 'idle',
})

function serve(task: ScheduledTask) {
  mocks.execute.mockImplementation(async (command) => {
    if (command.operation === 'read') return { effect: 'read', task, runs: [SKIPPED] }
    if (command.operation === 'runs') return { effect: 'runs-listed', runs: [SKIPPED] }
    if (command.operation === 'approve-wake-check' || command.operation === 'update') {
      return { effect: 'updated', task }
    }
    if (command.operation === 'create') return { effect: 'created', task }
    return { effect: 'listed', tasks: [task] }
  })
}

function renderDetail(task: ScheduledTask) {
  serve(task)
  renderWithQueryClient(
    <ScheduledTaskDetail taskId={task.id} layout="wide" onEdit={vi.fn()} onDeleted={vi.fn()} />,
  )
}

const WAKE = { command: 'gh pr checks 42 | grep fail', onFailure: 'wake' as const }

describe('A gated Heartbeat in the Scheduled panel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a skipped run, its last check, and its Stop condition', async () => {
    renderDetail(
      heartbeatTask({
        timeZone: 'UTC',
        lastRun: SKIPPED,
        heartbeat: heartbeatSettings({
          consecutiveIdleRuns: 1,
          wakeCheck: { ...WAKE, approval: 'approved', pendingSince: null },
        }),
      }),
    )
    const history = await screen.findByRole('region', { name: 'Run history' })
    expect(await within(history).findByText('Skipped')).toBeInTheDocument()
    expect(within(history).getByText(/Nothing to do/)).toBeInTheDocument()
    expect(screen.getByText(/^Last check .* · nothing to do · next /)).toBeInTheDocument()
    expect(screen.getByText('Stops when').nextElementSibling?.textContent).toBe(
      'CI is green on main',
    )
    expect(screen.getByText('gh pr checks 42 | grep fail')).toBeInTheDocument()
    expect(screen.getByText('Idle runs').nextElementSibling?.textContent).toBe(
      '1 in a row · pauses itself after 3',
    )
  })

  it('approves a held Wake check, naming the exact command', async () => {
    const task = heartbeatTask({
      heartbeat: heartbeatSettings({
        wakeCheck: { ...WAKE, approval: 'pending', pendingSince: 1 },
      }),
    })
    renderDetail(task)
    const notice = await screen.findByRole('region', { name: 'Wake check approval' })
    expect(
      within(notice).getByText('Waiting for you to approve its wake check'),
    ).toBeInTheDocument()
    fireEvent.click(within(notice).getByRole('button', { name: 'Approve' }))
    await vi.waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        { operation: 'approve-wake-check', taskId: task.id, command: WAKE.command },
        undefined,
      ),
    )
  })

  it('says why it auto-paused and resumes it', async () => {
    const task = heartbeatTask({
      enabled: false,
      heartbeat: heartbeatSettings({
        consecutiveIdleRuns: 3,
        autoPause: { reason: 'idle', message: 'auto-paused: 3 idle runs', since: 5 },
      }),
    })
    renderDetail(task)
    const notice = await screen.findByRole('region', { name: 'Auto-paused' })
    expect(within(notice).getByText('auto-paused: 3 idle runs')).toBeInTheDocument()
    fireEvent.click(within(notice).getByRole('button', { name: 'Resume' }))
    await vi.waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        { operation: 'update', taskId: task.id, patch: { enabled: true } },
        undefined,
      ),
    )
  })

  it("dates the auto-pause in the task's time zone, like the rest of its detail", async () => {
    const since = Date.UTC(2026, 9, 27, 7, 4)
    const timeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Tokyo'
        ? 'America/New_York'
        : 'Asia/Tokyo'
    const task = heartbeatTask({
      enabled: false,
      timeZone,
      heartbeat: heartbeatSettings({
        consecutiveIdleRuns: 3,
        autoPause: { reason: 'idle', message: 'auto-paused: 3 idle runs', since },
      }),
    })
    renderDetail(task)
    const notice = await screen.findByRole('region', { name: 'Auto-paused' })
    expect(notice).toHaveTextContent(formatAbsoluteTime(since, timeZone))
  })

  it('tells the user a grandfathered Heartbeat has no end', async () => {
    renderDetail(
      heartbeatTask({ heartbeat: heartbeatSettings({ stopWhen: null, indefinite: true }) }),
    )
    expect(await screen.findByRole('region', { name: 'No end' })).toHaveTextContent(
      'This Heartbeat has no end.',
    )
  })
})

describe('The Heartbeat editor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('needs a Stop condition and sends the Wake check it was given', async () => {
    serve(heartbeatTask())
    renderWithQueryClient(
      <ScheduledTaskEditor
        target={{ mode: 'create', kind: 'heartbeat', sessionId: 'session-1' }}
        layout="narrow"
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'Fix failing checks.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Say how this Heartbeat finishes/)

    fireEvent.change(screen.getByRole('textbox', { name: 'Stop when…' }), {
      target: { value: 'PR 42 merged' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Wake check' }), {
      target: { value: WAKE.command },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await vi.waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create',
          input: expect.objectContaining({
            heartbeat: {
              stopWhen: 'PR 42 merged',
              indefinite: false,
              idlePauseAfter: 3,
              wakeCheck: WAKE,
            },
          }),
        }),
        expect.any(String),
      ),
    )
  })
})
