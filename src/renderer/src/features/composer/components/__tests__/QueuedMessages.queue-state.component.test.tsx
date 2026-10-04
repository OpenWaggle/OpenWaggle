import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionControlRejectedError,
  type SessionFollowUpQueueItem,
  type SessionFollowUpQueueSnapshot,
} from '@/features/chat/hooks'
import { QueuedMessages } from '../QueuedMessages'

const SESSION = SessionId('session-queue-state')
const onToast = vi.fn()

function item(overrides: Partial<SessionFollowUpQueueItem> = {}): SessionFollowUpQueueItem {
  return {
    id: 'follow-up-1',
    text: 'next',
    attachmentCount: 0,
    createdAt: 1,
    deliveryState: 'pending',
    attachments: [],
    editable: true,
    ...overrides,
  }
}

function snapshot(overrides: Partial<SessionFollowUpQueueSnapshot>): SessionFollowUpQueueSnapshot {
  return {
    state: 'running',
    revision: 4,
    activeRunId: 'run-1',
    items: [item()],
    waitingOnEdit: false,
    ...overrides,
  }
}

const queueMock = vi.hoisted(() => {
  const state: { current: SessionFollowUpQueueSnapshot | null } = { current: null }
  return Object.assign(state, { refresh: vi.fn(), setPaused: vi.fn() })
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', () => ({
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.current,
    error: null,
    refresh: queueMock.refresh,
    withdraw: vi.fn(),
    setPaused: queueMock.setPaused,
    adopt: vi.fn(),
  }),
}))

const STALE = new SessionControlRejectedError('queue-pause', 'queue_revision_changed')

function renderQueue() {
  return render(
    <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={onToast} />,
  )
}

describe('QueuedMessages Pause and Resume against a changed queue', () => {
  beforeEach(() => {
    onToast.mockClear()
    queueMock.current = snapshot({})
    queueMock.refresh.mockReset()
    queueMock.setPaused.mockReset().mockResolvedValue(undefined)
  })

  it('pauses with a stale revision by retrying once against the re-read queue', async () => {
    queueMock.setPaused.mockRejectedValueOnce(STALE)
    queueMock.refresh.mockResolvedValue(snapshot({ revision: 5 }))
    renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(queueMock.setPaused).toHaveBeenCalledTimes(2))
    expect(queueMock.setPaused.mock.calls).toEqual([
      [true, 4],
      [true, 5],
    ])
    expect(onToast).not.toHaveBeenCalled()
  })

  it('stops quietly when the re-read queue is already paused', async () => {
    queueMock.setPaused.mockRejectedValueOnce(STALE)
    queueMock.refresh.mockResolvedValue(snapshot({ state: 'paused', revision: 5 }))
    renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(queueMock.refresh).toHaveBeenCalled())
    expect(queueMock.setPaused).toHaveBeenCalledTimes(1)
    expect(onToast).not.toHaveBeenCalled()
  })

  it('says so in words when the queue changes again during the retry', async () => {
    queueMock.setPaused.mockRejectedValue(STALE)
    queueMock.refresh.mockResolvedValue(snapshot({ revision: 5 }))
    renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        'The queue changed before it could be paused. Check it and try again.',
      ),
    )
    expect(queueMock.setPaused).toHaveBeenCalledTimes(2)
  })

  it('does not retry a resume once the first message needs attention', async () => {
    queueMock.current = snapshot({ state: 'paused', pauseReason: 'requested' })
    queueMock.setPaused.mockRejectedValueOnce(STALE)
    queueMock.refresh.mockResolvedValue(
      snapshot({
        state: 'paused',
        revision: 5,
        items: [item({ deliveryState: 'needs_attention', attentionReason: 'authority_changed' })],
      }),
    )
    renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        'Send the first message as you or dismiss it before resuming the queue.',
      ),
    )
    expect(queueMock.setPaused).toHaveBeenCalledTimes(1)
  })

  it('retries a resume against the re-read queue', async () => {
    queueMock.current = snapshot({ state: 'paused', pauseReason: 'requested' })
    queueMock.setPaused.mockRejectedValueOnce(STALE)
    queueMock.refresh.mockResolvedValue(snapshot({ state: 'paused', revision: 6 }))
    renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    await waitFor(() => expect(queueMock.setPaused).toHaveBeenLastCalledWith(false, 6))
    expect(onToast).not.toHaveBeenCalled()
  })
})
