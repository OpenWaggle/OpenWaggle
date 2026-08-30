import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueuedMessages } from '../QueuedMessages'

const CONV_A = SessionId('session-a')
const noOpSteer = vi.fn().mockResolvedValue(undefined)
const noOpToast = vi.fn()
interface QueuedMessageFixture {
  readonly id: string
  readonly text: string
  readonly attachmentCount: number
  readonly createdAt: number
  readonly deliveryState: 'pending' | 'needs_attention'
  readonly attentionReason?:
    | 'authorization_ceiling_changed'
    | 'profile_revoked'
    | 'authority_changed'
}

const queueMock = vi.hoisted(() => {
  const items: QueuedMessageFixture[] = []
  return {
    snapshot: { state: 'running', revision: 0, activeRunId: 'run-1', items },
    withdraw: vi.fn().mockResolvedValue(undefined),
    resubmitWithCurrentAccess: vi.fn().mockResolvedValue(undefined),
    setPaused: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', () => ({
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    withdraw: queueMock.withdraw,
    resubmitWithCurrentAccess: queueMock.resubmitWithCurrentAccess,
    setPaused: queueMock.setPaused,
  }),
}))

function queue(
  ...items: {
    id: string
    text: string
    attachmentCount?: number
    deliveryState?: 'pending' | 'needs_attention'
    attentionReason?: 'authorization_ceiling_changed' | 'profile_revoked' | 'authority_changed'
  }[]
) {
  queueMock.snapshot.items = items.map((item, index) => ({
    attachmentCount: 0,
    createdAt: index + 1,
    deliveryState: 'pending' as const,
    ...item,
  }))
}

describe('QueuedMessages', () => {
  beforeEach(() => {
    queue()
    queueMock.snapshot.state = 'running'
    noOpSteer.mockClear()
    queueMock.withdraw.mockClear()
    queueMock.resubmitWithCurrentAccess.mockClear()
    queueMock.setPaused.mockClear()
    noOpToast.mockClear()
  })

  it('renders nothing when the queue is empty or no Session is selected', () => {
    const empty = render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )
    expect(empty.container.firstChild).toBeNull()
    queue({ id: 'follow-up-1', text: 'test' })
    empty.rerender(
      <QueuedMessages
        sessionId={null}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )
    expect(empty.container.firstChild).toBeNull()
  })

  it('renders the durable Follow-up count and bodies', () => {
    queue(
      { id: 'follow-up-1', text: 'first message' },
      { id: 'follow-up-2', text: 'second message' },
    )
    render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('first message')).toBeInTheDocument()
    expect(screen.getByText('second message')).toBeInTheDocument()
  })

  it('offers promotion to steering only while a Run can accept it', () => {
    queue({ id: 'follow-up-1', text: 'steer me' })
    const view = render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )
    expect(screen.queryByText('Steer')).not.toBeInTheDocument()
    view.rerender(
      <QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming onToast={noOpToast} />,
    )
    fireEvent.click(screen.getByText('Steer'))
    expect(noOpSteer).toHaveBeenCalledWith('follow-up-1')
  })

  it('uses compaction copy and hides steering during compaction', () => {
    queue({ id: 'follow-up-1', text: 'wait for compact' })
    render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={true}
        isCompacting={true}
        onToast={noOpToast}
      />,
    )
    expect(screen.getByText('Queued until compaction finishes')).toBeInTheDocument()
    expect(screen.queryByText('Steer')).not.toBeInTheDocument()
  })

  it('makes a paused queue visible and resumes it through the revision-aware hook', () => {
    queue({ id: 'follow-up-1', text: 'continue after recovery' })
    queueMock.snapshot.state = 'paused'
    render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )

    expect(screen.getByText('Queue paused')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(queueMock.setPaused).toHaveBeenCalledWith(false)
  })

  it('explains blocked delivery and disables steering until attention is resolved', () => {
    queue({
      id: 'follow-up-1',
      text: 'requires current authority',
      deliveryState: 'needs_attention',
      attentionReason: 'authority_changed',
    })
    render(
      <QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming onToast={noOpToast} />,
    )

    expect(
      screen.getByText(
        'Session authority changed. Re-submit with current access or dismiss this Follow-up.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Steer' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
    expect(noOpSteer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Re-submit' }))
    expect(queueMock.resubmitWithCurrentAccess).toHaveBeenCalledWith('follow-up-1')
  })

  it('withdraws by durable Follow-up identity and displays attachment-only intent', () => {
    queue({ id: 'follow-up-1', text: '', attachmentCount: 2 })
    render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )
    expect(screen.getByText('2 attachment(s)')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Dismiss'))
    expect(queueMock.withdraw).toHaveBeenCalledWith('follow-up-1')
  })

  it('shows failed remediation through the existing toast channel', async () => {
    queue({
      id: 'follow-up-1',
      text: 'requires current authority',
      deliveryState: 'needs_attention',
      attentionReason: 'authorization_ceiling_changed',
    })
    queueMock.resubmitWithCurrentAccess.mockRejectedValueOnce(new Error('Access changed again.'))
    render(
      <QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming onToast={noOpToast} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use current access' }))
    await waitFor(() => expect(noOpToast).toHaveBeenCalledWith('Access changed again.'))
  })
})
