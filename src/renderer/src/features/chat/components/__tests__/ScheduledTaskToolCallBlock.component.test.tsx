import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ScheduledTask } from '@shared/types/scheduled-task'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererQueryClient } from '@/queries/query-client'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

type ToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>

const executeScheduledTasks = vi.hoisted(() => vi.fn())
const openTask = vi.hoisted(() => vi.fn<(taskId: string) => void>())
const setEnabled = vi.hoisted(() => vi.fn<(taskId: string, enabled: boolean) => void>())
const deleteTask = vi.hoisted(() => vi.fn<(taskId: string) => void>())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    executeScheduledTasks,
    listHiveTreeSessionCatalogPage: vi.fn().mockResolvedValue(null),
    copyToClipboard: vi.fn(),
  },
}))
vi.mock('@/features/scheduled-tasks', () => ({
  useOpenScheduledTask: () => openTask,
  useSetScheduledTaskEnabled: () => ({
    setEnabled,
    isPending: false,
    pendingTaskId: null,
    error: null,
  }),
  useDeleteScheduledTask: () => ({ mutate: deleteTask, isPending: false, error: null }),
}))

import { ToolCallRouter } from '../ToolCallRouter'

function task(overrides: Partial<ScheduledTask> = {}) {
  return fromPartial<ScheduledTask>({
    id: 'task-1',
    name: 'Morning triage',
    kind: 'heartbeat',
    enabled: true,
    ...overrides,
  })
}

function call(args: object, id = 'tc-1'): ToolCallPart {
  return {
    type: 'tool-call',
    id,
    name: 'hive',
    arguments: JSON.stringify(args),
    state: 'input-complete',
  }
}

/** A hive-tool result as Pi records it: the compact text plus the Host response as details. */
function scheduledResult(id: string, outcome: object) {
  return new Map([
    [
      id,
      {
        content: {
          content: [{ type: 'text', text: JSON.stringify(outcome) }],
          details: { contract: 'scheduled-tasks-v1', response: { operation: 'create', outcome } },
        },
        state: 'output-available',
      },
    ],
  ])
}

function renderRow(part: ToolCallPart, toolResults: ReturnType<typeof scheduledResult>) {
  return renderWithQueryClient(
    <ToolCallRouter
      part={part}
      toolResults={toolResults}
      sessionId={SessionId('caller')}
      isStreaming={false}
    />,
  )
}

function listTasks(tasks: readonly ScheduledTask[]) {
  executeScheduledTasks.mockResolvedValue({ effect: 'listed', tasks })
}

describe('Scheduled task hive-tool rows', () => {
  beforeEach(() => {
    executeScheduledTasks.mockReset()
    openTask.mockReset()
    setEnabled.mockReset()
    deleteTask.mockReset()
  })

  it('names a created task and offers Open, Pause and Delete for it', async () => {
    listTasks([task()])
    renderRow(
      call({ action: 'schedule_create', name: 'Requested name', prompt: 'Check CI' }),
      scheduledResult('tc-1', { effect: 'created', task: task() }),
    )

    expect(await screen.findByText('Created scheduled task · Morning triage')).toBeInTheDocument()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open scheduled task: Morning triage' }),
    )
    expect(openTask).toHaveBeenCalledWith('task-1')

    fireEvent.click(screen.getByRole('button', { name: 'Pause scheduled task: Morning triage' }))
    expect(setEnabled).toHaveBeenCalledWith('task-1', false)
  })

  it('reflects the live state of the task: a paused task offers Resume under its new name', async () => {
    listTasks([task({ name: 'Renamed triage', enabled: false })])
    renderRow(
      call({ action: 'schedule_update', scheduleTaskId: 'task-1', enabled: false }),
      scheduledResult('tc-1', { effect: 'updated', task: task() }),
    )

    expect(await screen.findByText('Updated scheduled task · Renamed triage')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume scheduled task: Renamed triage' }))
    expect(setEnabled).toHaveBeenCalledWith('task-1', true)
  })

  it('asks before deleting the task', async () => {
    listTasks([task()])
    renderRow(
      call({ action: 'schedule_create', name: 'Morning triage', prompt: 'Check CI' }),
      scheduledResult('tc-1', { effect: 'created', task: task() }),
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete scheduled task: Morning triage' }),
    )
    expect(deleteTask).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this task?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete this task?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete scheduled task: Morning triage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteTask).toHaveBeenCalledWith('task-1')
  })

  it('marks a task deleted since, with no controls', async () => {
    listTasks([])
    renderRow(
      call({ action: 'schedule_create', name: 'Morning triage', prompt: 'Check CI' }),
      scheduledResult('tc-1', { effect: 'created', task: task() }),
    )

    expect(await screen.findByText('deleted')).toBeInTheDocument()
    expect(screen.getByText('Created scheduled task · Morning triage')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /scheduled task: / })).toBeNull()
  })

  it('names the task a read-only action reads, without controls', async () => {
    listTasks([task()])
    renderRow(
      call({ action: 'schedule_read', scheduleTaskId: 'task-1' }),
      scheduledResult('tc-1', { effect: 'read', task: task(), runs: [] }),
    )

    expect(await screen.findByText('Read scheduled task · Morning triage')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /scheduled task: / })).toBeNull()
  })

  it('keeps a refused create to its requested name, marked refused, without controls', async () => {
    renderRow(
      call({ action: 'schedule_create', name: 'Too often', prompt: 'Check CI' }),
      scheduledResult('tc-1', {
        effect: 'rejected',
        code: 'invalid_schedule',
        message: 'A Heartbeat fires at most every 5 minutes.',
      }),
    )

    expect(await screen.findByText('Created scheduled task · Too often')).toBeInTheDocument()
    expect(screen.getByText('refused')).toHaveAttribute(
      'title',
      'A Heartbeat fires at most every 5 minutes.',
    )
    expect(screen.queryByRole('button', { name: /scheduled task: / })).toBeNull()
    expect(executeScheduledTasks).not.toHaveBeenCalled()
  })

  it('reads the tasks again when a schedule action finishes on screen, not when it is history', async () => {
    listTasks([task()])
    const part = call({ action: 'schedule_create', name: 'Morning triage', prompt: 'Check CI' })
    const finished = scheduledResult('tc-1', { effect: 'created', task: task() })
    const client = createRendererQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const row = (results: ReturnType<typeof scheduledResult>) => (
      <QueryClientProvider client={client}>
        <ToolCallRouter
          part={part}
          toolResults={results}
          sessionId={SessionId('caller')}
          isStreaming={false}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(row(new Map()))
    rerender(row(finished))
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    rerender(row(finished))
    expect(invalidate).toHaveBeenCalledTimes(1)

    invalidate.mockClear()
    renderRow(part, finished)
    await screen.findAllByText('Created scheduled task · Morning triage')
    expect(invalidate).not.toHaveBeenCalled()
  })
})
