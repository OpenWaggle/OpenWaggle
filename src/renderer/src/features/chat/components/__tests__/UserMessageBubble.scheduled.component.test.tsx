import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSessionMessageImageResources = vi.fn()

vi.mock('@/shared/lib/ipc', () => ({ api: { copyToClipboard: vi.fn() } }))
vi.mock('@/features/workspace-files/hooks', () => ({ useOpenWorkspaceFile: () => vi.fn() }))
vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => null,
  useSessionMessageImageResources: (...args: unknown[]) =>
    mockSessionMessageImageResources(...args),
}))

import { UserMessageBubble } from '../UserMessageBubble'

const CREATED_AT = new Date(Date.UTC(2026, 9, 22, 7, 3))

function scheduledMessage(metadata: UIMessage['metadata']): UIMessage {
  return {
    id: 'u-scheduled',
    role: 'user',
    parts: [{ type: 'text', content: 'Check the overnight CI runs' }],
    createdAt: CREATED_AT,
    metadata,
  }
}

describe('UserMessageBubble Scheduled task provenance', () => {
  beforeEach(() => {
    mockSessionMessageImageResources.mockReturnValue([])
  })

  it('labels a Heartbeat delivery above the bubble with its task and time', () => {
    const { container } = render(
      <UserMessageBubble
        message={scheduledMessage({
          scheduledTask: { taskId: 'task-1', name: 'Morning triage', kind: 'heartbeat' },
        })}
      />,
    )

    expect(screen.getByText('Scheduled · Morning triage')).toBeInTheDocument()
    const line = container.querySelector('[data-scheduled-task-provenance]')
    expect(line).toHaveAttribute('data-scheduled-task-provenance', 'heartbeat')
    expect(line?.querySelector('time')).toHaveAttribute('dateTime', CREATED_AT.toISOString())
    expect(line?.querySelector('svg.lucide-heart-pulse')).toBeTruthy()
    expect(screen.getByText('Check the overnight CI runs')).toBeInTheDocument()
  })

  it('marks a Launch schedule delivery with its calendar icon', () => {
    const { container } = render(
      <UserMessageBubble
        message={scheduledMessage({
          scheduledTask: { taskId: 'task-2', name: 'Weekly deps', kind: 'launch' },
        })}
      />,
    )

    expect(screen.getByText('Scheduled · Weekly deps')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-calendar-clock')).toBeTruthy()
  })

  it('shows no provenance for a message a person typed', () => {
    const { container } = render(<UserMessageBubble message={scheduledMessage(undefined)} />)

    expect(container.querySelector('[data-scheduled-task-provenance]')).toBeNull()
    expect(screen.queryByText(/^Scheduled · /)).toBeNull()
  })
})
