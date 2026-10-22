import type { ScheduledTasksCommand, ScheduledTasksOutcome } from '@shared/types/scheduled-task'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { heartbeatTask, scheduledTask } from '../../lib/__tests__/scheduled-task-fixtures'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: ScheduledTasksCommand) => Promise<ScheduledTasksOutcome>>(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/shared/lib/ipc', () => ({ api: { executeScheduledTasks: mocks.execute } }))

import { HeartbeatStrip } from '../HeartbeatStrip'

function listing(...tasks: ReturnType<typeof heartbeatTask>[]) {
  mocks.execute.mockImplementation(async (command) => {
    if (command.operation === 'list') return { effect: 'listed', tasks }
    return { effect: 'updated', task: heartbeatTask() }
  })
}

describe('HeartbeatStrip', () => {
  beforeEach(() => {
    mocks.execute.mockReset()
    mocks.navigate.mockReset()
  })

  it('shows the schedule and next fire time of this Session’s Heartbeat', async () => {
    listing(heartbeatTask({ nextRunAt: Date.now() + 12 * 60_000 }), scheduledTask())
    renderWithQueryClient(<HeartbeatStrip sessionId="session-1" />)

    expect(
      await screen.findByText('Heartbeat · Every 30 minutes · next in 12 minutes'),
    ).toBeInTheDocument()
    expect(mocks.execute).toHaveBeenCalledWith(
      { operation: 'list', sessionId: 'session-1' },
      undefined,
    )
  })

  it('says when the Heartbeat is waiting for the Session to be idle', async () => {
    listing(heartbeatTask({ waitingSince: Date.now() }))
    renderWithQueryClient(<HeartbeatStrip sessionId="session-1" />)

    expect(
      await screen.findByText(/Every 30 minutes · waiting for this Session to be idle/),
    ).toBeInTheDocument()
  })

  it('pauses, resumes and opens the task', async () => {
    listing(heartbeatTask({ enabled: false }))
    renderWithQueryClient(<HeartbeatStrip sessionId="session-1" />)

    expect(await screen.findByText(/· paused/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await vi.waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        { operation: 'update', taskId: 'heartbeat-1', patch: { enabled: true } },
        undefined,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/scheduled',
      search: { task: 'heartbeat-1' },
    })
  })

  it('renders nothing for a Session no Heartbeat targets', async () => {
    listing(heartbeatTask({ target: { kind: 'heartbeat', sessionId: 'other' } }))
    const { container } = renderWithQueryClient(<HeartbeatStrip sessionId="session-1" />)

    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('does not query without a Session', () => {
    renderWithQueryClient(<HeartbeatStrip sessionId={null} />)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
