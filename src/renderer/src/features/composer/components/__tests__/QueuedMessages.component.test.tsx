import { SessionId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
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
  readonly attentionReason?: 'profile_revoked' | 'authority_changed'
  readonly wagglePresetName?: string
  readonly waggleSource?: 'user' | 'agent'
  readonly callerId?: string
}

const queueMock = vi.hoisted(() => {
  const items: QueuedMessageFixture[] = []
  const error: Error | null = null
  const snapshot: {
    state: 'running' | 'paused'
    pauseReason?: FollowUpQueuePauseReason
    revision: number
    activeRunId: string | null
    items: QueuedMessageFixture[]
  } = { state: 'running', revision: 0, activeRunId: 'run-1', items }
  return {
    snapshot,
    error,
    refresh: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue(undefined),
    setPaused: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', () => ({
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: queueMock.error,
    refresh: queueMock.refresh,
    withdraw: queueMock.withdraw,
    setPaused: queueMock.setPaused,
  }),
}))

function queue(
  ...items: {
    id: string
    text: string
    attachmentCount?: number
    deliveryState?: 'pending' | 'needs_attention'
    attentionReason?: 'profile_revoked' | 'authority_changed'
    wagglePresetName?: string
    waggleSource?: 'user' | 'agent'
    callerId?: string
  }[]
) {
  queueMock.snapshot.items = items.map((item, index) => ({
    attachmentCount: 0,
    createdAt: index + 1,
    deliveryState: 'pending' as const,
    ...item,
  }))
}

function renderQueue() {
  return render(
    <QueuedMessages
      sessionId={CONV_A}
      onSteer={noOpSteer}
      isStreaming={false}
      onToast={noOpToast}
    />,
  )
}

describe('QueuedMessages', () => {
  beforeEach(() => {
    queue()
    queueMock.snapshot.state = 'running'
    queueMock.snapshot.activeRunId = 'run-1'
    delete queueMock.snapshot.pauseReason
    queueMock.error = null
    queueMock.refresh.mockReset().mockResolvedValue(undefined)
    noOpSteer.mockClear()
    queueMock.withdraw.mockClear()
    queueMock.setPaused.mockReset().mockResolvedValue(undefined)
    noOpToast.mockClear()
  })

  it('keeps a persistent live region while hiding an empty queue dock', () => {
    const empty = render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Follow-up queue empty.')
    expect(screen.queryByText('Queued')).not.toBeInTheDocument()
    queue({ id: 'follow-up-1', text: 'test' })
    empty.rerender(
      <QueuedMessages
        sessionId={null}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('')
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

  it('pauses a running queue through the revision-aware hook so its next Run waits', async () => {
    queue({ id: 'follow-up-1', text: 'next' })
    renderQueue()

    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    const pause = screen.getByRole('button', { name: 'Pause' })
    expect(pause).toHaveAccessibleDescription(expect.stringContaining('until you resume'))
    fireEvent.click(pause)

    expect(queueMock.setPaused).toHaveBeenCalledWith(true)
    await waitFor(() => expect(pause).toHaveAttribute('aria-disabled', 'false'))
  })

  it('shows a failed pause through the toast channel', async () => {
    queue({ id: 'follow-up-1', text: 'next' })
    queueMock.setPaused.mockRejectedValueOnce(new Error('Queue changed.'))
    renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(noOpToast).toHaveBeenCalledWith('Queue changed.'))
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

  it('keeps the queue available when its active Run accepts steering', () => {
    queue({ id: 'follow-up-1', text: 'wait for compact' })
    render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={true}
        onToast={noOpToast}
      />,
    )
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('Steer')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(queueMock.setPaused).toHaveBeenCalledWith(false)
  })

  // A bare "Queue paused" after a failed Run read as the app ignoring the messages.
  it.each([
    ['run-failed', 'Paused because the last Run failed.'],
    ['run-interrupted', 'Paused because the last Run was stopped.'],
    ['parent-limit', 'Paused because the parent Session has as many active Workers as it allows.'],
    ['requested', 'Paused on request.'],
    [undefined, 'The queue is paused.'],
  ] as const)('says the queue paused for %s', (reason, copy) => {
    queue({ id: 'follow-up-1', text: 'try again' })
    queueMock.snapshot.state = 'paused'
    if (reason) queueMock.snapshot.pauseReason = reason
    render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={false}
        onToast={noOpToast}
      />,
    )

    expect(screen.getByText((text) => text.startsWith(copy))).toBeVisible()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeVisible()
  })

  it('explains blocked delivery, disables steering, and offers no access repair', () => {
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
        'Session authority changed. Restore access and resume the queue, or dismiss this Follow-up.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Steer' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
    expect(noOpSteer).not.toHaveBeenCalled()
    // A Follow-up never carries its own access, so there is no override to repair.
    expect(screen.queryByRole('button', { name: 'Re-submit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use current access' })).not.toBeInTheDocument()
    expect(screen.getByTitle('Dismiss')).toBeVisible()
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
})
