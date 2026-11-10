import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { useActiveParentWorkerVisit } from '../useActiveParentWorkerVisit'

const QUEEN = SessionId('queen')
const initialChat = useChatStore.getState()
const initialSessions = useSessionStore.getState()
const initialStatus = useSessionStatusStore.getState()

afterEach(() => {
  useChatStore.setState(initialChat, true)
  useSessionStore.setState(initialSessions, true)
  useSessionStatusStore.setState(initialStatus, true)
})

function queen(workersLastRunEndedAt: number | undefined) {
  return fromPartial<SessionSummary>({
    id: QUEEN,
    lineage: {
      role: 'queen',
      directWorkerCount: 1,
      ...(workersLastRunEndedAt === undefined ? {} : { workersLastRunEndedAt }),
    },
  })
}

describe('useActiveParentWorkerVisit (ADR 0065)', () => {
  it('marks the open parent visited when a Worker Run below it ends', () => {
    const markVisited = vi.fn()
    useSessionStatusStore.setState({ markVisited })
    useChatStore.setState({ activeSessionId: QUEEN })
    useSessionStore.setState({ sessions: [queen(10)] })
    renderHook(() => useActiveParentWorkerVisit())
    // Opening her is a visit already; only a later Worker Run end needs one.
    expect(markVisited).not.toHaveBeenCalled()

    act(() => useSessionStore.setState({ sessions: [queen(20)] }))
    expect(markVisited).toHaveBeenCalledWith(QUEEN)
  })

  it('leaves a parent that is not open alone', () => {
    const markVisited = vi.fn()
    useSessionStatusStore.setState({ markVisited })
    useChatStore.setState({ activeSessionId: SessionId('other') })
    useSessionStore.setState({ sessions: [queen(10)] })
    renderHook(() => useActiveParentWorkerVisit())
    act(() => useSessionStore.setState({ sessions: [queen(20)] }))
    expect(markVisited).not.toHaveBeenCalled()
  })
})
