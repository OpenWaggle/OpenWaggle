import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../chat-store'
import { usePendingSend, usePendingSendStore } from '../pending-send-store'

const S1 = SessionId('session-1')
const S2 = SessionId('session-2')
const SEND = { afterUserMessageId: 'u1' }

/** How the chat panel reads, begins and ends pending sends (ADR 0036). */
describe('usePendingSend', () => {
  beforeEach(() => {
    usePendingSendStore.setState({ bySession: new Map() })
    useChatStore.setState({ activeSessionId: null })
  })

  it("begins a send for its own Session, visible to that Session's transcript only", () => {
    const own = renderHook(() => usePendingSend(S1))
    const other = renderHook(() => usePendingSend(S2))
    const draft = renderHook(() => usePendingSend(null))

    act(() => own.result.current.begin(SEND))

    expect(own.result.current.pendingSend).toBe(SEND)
    expect(other.result.current.pendingSend).toBeNull()
    expect(draft.result.current.pendingSend).toBeNull()
  })

  it('ends the send once the transcript has held it', () => {
    const { result } = renderHook(() => usePendingSend(S1))
    act(() => result.current.begin(SEND))
    act(() => result.current.consume())
    expect(result.current.pendingSend).toBeNull()
  })

  it("shows a draft's send to the Session it created", () => {
    const draft = renderHook(() => usePendingSend(null))
    act(() => draft.result.current.begin(SEND))
    act(() => usePendingSendStore.getState().adoptDraft(S1))

    expect(renderHook(() => usePendingSend(S1)).result.current.pendingSend).toBe(SEND)
  })

  it("ends a Session's send when the reader leaves it, but not a draft send it creates", () => {
    act(() => usePendingSendStore.getState().begin(null, SEND))
    act(() => useChatStore.setState({ activeSessionId: S1 }))
    act(() => usePendingSendStore.getState().adoptDraft(S1))
    expect(usePendingSendStore.getState().bySession.get(String(S1))).toBe(SEND)

    act(() => useChatStore.setState({ activeSessionId: S2 }))
    expect(usePendingSendStore.getState().bySession.get(String(S1))).toBeUndefined()
  })
})
