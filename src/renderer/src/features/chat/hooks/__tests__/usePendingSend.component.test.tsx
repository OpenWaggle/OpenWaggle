import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePendingSend } from '../usePendingSend'

const SEND = { afterUserMessageId: 'u1' }

describe('usePendingSend', () => {
  it("carries a draft's first send into the Session it creates", () => {
    const initialProps: { sessionId: SessionId | null } = { sessionId: null }
    const { result, rerender } = renderHook(({ sessionId }) => usePendingSend(sessionId), {
      initialProps,
    })
    act(() => result.current[1](SEND))

    rerender({ sessionId: SessionId('created') })
    expect(result.current[0]).toEqual(SEND)
  })

  it('drops a send left pending when another Session opens', () => {
    const { result, rerender } = renderHook(({ sessionId }) => usePendingSend(sessionId), {
      initialProps: { sessionId: SessionId('a') },
    })
    act(() => result.current[1](SEND))

    rerender({ sessionId: SessionId('b') })
    expect(result.current[0]).toBeNull()
  })
})
