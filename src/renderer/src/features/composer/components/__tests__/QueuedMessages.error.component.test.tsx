import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueuedMessages } from '../QueuedMessages'

const SESSION_ID = SessionId('session-queue-error')
function noQueueError(): Error | null {
  return null
}

interface QueueErrorItem {
  readonly id: string
  readonly text: string
  readonly attachmentCount: number
  readonly createdAt: number
  readonly deliveryState: 'pending'
}

const queueMock = vi.hoisted(() => {
  const items: QueueErrorItem[] = []
  return {
    snapshot: { state: 'running' as const, revision: 0, activeRunId: null, items },
    error: noQueueError(),
    refresh: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue(undefined),
    resubmitWithCurrentAccess: vi.fn().mockResolvedValue(undefined),
    setPaused: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', () => ({
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: queueMock.error,
    refresh: queueMock.refresh,
    withdraw: queueMock.withdraw,
    resubmitWithCurrentAccess: queueMock.resubmitWithCurrentAccess,
    setPaused: queueMock.setPaused,
  }),
}))

function subject() {
  return (
    <QueuedMessages
      sessionId={SESSION_ID}
      onSteer={vi.fn().mockResolvedValue(undefined)}
      isStreaming={false}
      onToast={vi.fn()}
    />
  )
}

describe('QueuedMessages unavailable state', () => {
  beforeEach(() => {
    queueMock.error = new Error('Session Host unavailable')
    queueMock.snapshot.items = []
    queueMock.refresh.mockReset().mockResolvedValue(undefined)
  })

  it('does not claim a failed initial queue read is empty', () => {
    render(subject())

    expect(screen.getByRole('status')).toHaveTextContent('Follow-up queue unavailable.')
    expect(screen.getByRole('alert')).toHaveTextContent('Follow-up queue unavailable')
    expect(screen.getByRole('alert')).toHaveTextContent('Retry before assuming the queue is empty.')
    expect(screen.queryByText('Follow-up queue empty.')).not.toBeInTheDocument()
  })

  it('retries the read and returns to the recovered queue', async () => {
    queueMock.refresh.mockImplementationOnce(async () => {
      queueMock.error = null
      queueMock.snapshot.items = [
        {
          id: 'follow-up-recovered',
          text: 'Recovered durable work',
          attachmentCount: 0,
          createdAt: 1,
          deliveryState: 'pending',
        },
      ]
    })
    const view = render(subject())

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(queueMock.refresh).toHaveBeenCalledTimes(1))
    view.rerender(subject())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Recovered durable work')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('1 Follow-up queued.')
  })
})
