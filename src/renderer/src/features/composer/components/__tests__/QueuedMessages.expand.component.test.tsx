import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import { queueItem, snapshotOf } from '../../hooks/__tests__/queued-message-edit.test-support'
import { QueuedMessages } from '../QueuedMessages'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
  }
  return mock
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: null,
    refresh: vi.fn(),
    withdraw: vi.fn(),
  }),
}))

const SESSION = SessionId('session-a')
const FIRST = queueItem({ id: 'follow-up-1', text: '\nFirst brief\n\nfirst detail' })
const SECOND = queueItem({ id: 'follow-up-2', text: 'Second brief\nsecond detail' })

function dock() {
  return <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />
}

describe('QueuedMessages open and closed rows', () => {
  // A long prompt rendered in full covered the conversation and made the Session unusable.
  it('shows each message as its first line and opens one message at a time', () => {
    queueMock.snapshot = snapshotOf([FIRST, SECOND])
    const view = render(dock())

    const first = screen.getByRole('button', { name: 'First brief…' })
    const second = screen.getByRole('button', { name: 'Second brief…' })
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/first detail/)).not.toBeInTheDocument()

    fireEvent.click(first)
    // The name still says which message the button opens; aria-expanded carries the state.
    expect(first).toHaveAccessibleName('First brief…')
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/first detail/)).toHaveAttribute(
      'id',
      first.getAttribute('aria-controls'),
    )

    // Rows are keyed by message, so the open one stays open when the queue is reordered.
    queueMock.snapshot = snapshotOf([SECOND, FIRST], 2)
    view.rerender(dock())
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/first detail/)).toBeInTheDocument()

    fireEvent.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/first detail/)).not.toBeInTheDocument()
    expect(screen.getByText(/second detail/)).toBeInTheDocument()

    fireEvent.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/second detail/)).not.toBeInTheDocument()
  })

  it('ends the first line in an ellipsis only when more lines follow it', () => {
    queueMock.snapshot = snapshotOf([
      queueItem({ id: 'follow-up-1', text: 'Only line.\n' }),
      queueItem({ id: 'follow-up-2', text: 'Fix the tests.\nThen push.' }),
    ])
    render(dock())

    expect(screen.getByRole('button', { name: 'Only line.' })).toBeInTheDocument()
    // The closing full stop goes, or the ellipsis after it reads as four dots.
    expect(screen.getByRole('button', { name: 'Fix the tests…' })).toBeInTheDocument()
  })
})
