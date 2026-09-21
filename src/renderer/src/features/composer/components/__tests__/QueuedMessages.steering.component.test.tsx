import { SessionId } from '@shared/types/brand'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptimisticSteerStore } from '@/features/chat/state'
import { QueuedMessages } from '../QueuedMessages'

const SESSION_ID = SessionId('steering-session')
const queue = vi.hoisted(() => ({
  snapshot: {
    state: 'running',
    revision: 1,
    activeRunId: 'run-1',
    items: ['first', 'second'].map((id) => ({
      id,
      text: `${id} message`,
      attachmentCount: 0,
      createdAt: 1,
      deliveryState: 'pending',
    })),
  },
  error: null,
  refresh: vi.fn(),
  withdraw: vi.fn(),
  resubmitWithCurrentAccess: vi.fn(),
  setPaused: vi.fn(),
}))

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', () => ({
  useSessionFollowUpQueue: () => queue,
}))

describe('queued message steering feedback', () => {
  beforeEach(() => {
    useOptimisticSteerStore.setState({ pendingPromotions: new Map() })
    vi.clearAllMocks()
  })

  it('hides only the local promotion while retaining and restoring the authoritative queue', () => {
    render(
      <QueuedMessages sessionId={SESSION_ID} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />,
    )
    act(() => {
      useOptimisticSteerStore.getState().beginPromotion(SESSION_ID, 'first')
    })
    expect(screen.queryByText('first message')).not.toBeInTheDocument()
    expect(screen.getByText('second message')).toBeVisible()
    expect(queue.snapshot.items).toHaveLength(2)
    expect(queue.withdraw).not.toHaveBeenCalled()
    act(() => {
      useOptimisticSteerStore.getState().finishPromotion(SESSION_ID, 'first')
    })
    expect(screen.getByText('first message')).toBeVisible()
  })

  it('keeps another Session visible and hides the dock only when all local items are pending', () => {
    render(
      <QueuedMessages sessionId={SESSION_ID} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />,
    )
    act(() => {
      useOptimisticSteerStore.getState().beginPromotion(SessionId('other'), 'first')
    })
    expect(screen.getByText('first message')).toBeVisible()
    act(() => {
      useOptimisticSteerStore.getState().beginPromotion(SESSION_ID, 'first')
      useOptimisticSteerStore.getState().beginPromotion(SESSION_ID, 'second')
    })
    expect(screen.queryByText('Queued')).not.toBeInTheDocument()
    expect(queue.snapshot.items).toHaveLength(2)
  })
})
