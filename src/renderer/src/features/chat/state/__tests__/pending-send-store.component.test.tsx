import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../chat-store'
import { usePendingSend, usePendingSendStore } from '../pending-send-store'

const S1 = SessionId('session-1')
const S2 = SessionId('session-2')
const SEND = { afterUserMessageId: 'u1' }

/** The wiring the chat panel hands to the send workflow and the transcript (ADR 0036). */
describe('usePendingSend', () => {
  beforeEach(() => {
    usePendingSendStore.setState({ bySession: new Map() })
    useChatStore.setState({ activeSessionId: null })
  })

  it("shows a send the workflow began to that Session's transcript only", () => {
    const own = renderHook(() => usePendingSend(S1))
    const other = renderHook(() => usePendingSend(S2))
    const draft = renderHook(() => usePendingSend(null))

    act(() => own.result.current.workflow.beginPendingSend(SEND))

    expect(own.result.current.transcript.pendingSend).toBe(SEND)
    expect(other.result.current.transcript.pendingSend).toBeNull()
    expect(draft.result.current.transcript.pendingSend).toBeNull()
  })

  it('ends the send once the transcript has held it', () => {
    const { result } = renderHook(() => usePendingSend(S1))
    act(() => result.current.workflow.beginPendingSend(SEND))
    act(() => result.current.transcript.onPendingSendConsumed())
    expect(result.current.transcript.pendingSend).toBeNull()
  })

  it('ends the send when the workflow clears it after a refusal', () => {
    const { result } = renderHook(() => usePendingSend(S1))
    act(() => result.current.workflow.beginPendingSend(SEND))
    act(() => result.current.workflow.clearPendingSend(SEND))
    expect(result.current.transcript.pendingSend).toBeNull()
  })

  it("shows a draft's send to the Session it created", () => {
    const draft = renderHook(() => usePendingSend(null))
    act(() => draft.result.current.workflow.beginPendingSend(SEND))
    act(() => usePendingSendStore.getState().adoptDraft(S1))

    expect(renderHook(() => usePendingSend(S1)).result.current.transcript.pendingSend).toBe(SEND)
  })

  it("ends a Session's send when the reader leaves it, but not a draft send it creates", () => {
    act(() => usePendingSendStore.getState().begin(null, SEND))
    act(() => useChatStore.setState({ activeSessionId: S1 }))
    act(() => usePendingSendStore.getState().adoptDraft(S1))
    expect(usePendingSendStore.getState().bySession.get(String(S1))).toBe(SEND)

    // Other chat-store updates while the Session stays open are not a leave.
    act(() => useChatStore.setState({ error: null }))
    expect(usePendingSendStore.getState().bySession.get(String(S1))).toBe(SEND)

    act(() => useChatStore.setState({ activeSessionId: S2 }))
    expect(usePendingSendStore.getState().bySession.get(String(S1))).toBeUndefined()
  })
})
