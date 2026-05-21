import { SessionId } from '@shared/types/brand'
import type { AgentPhaseEventPayload, AgentPhaseState } from '@shared/types/phase'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { emitPhaseEvent, clearPhaseListeners, getAgentPhaseMock, onAgentPhaseMock } = vi.hoisted(
  () => {
    const phaseListeners = new Set<(payload: AgentPhaseEventPayload) => void>()

    return {
      getAgentPhaseMock: vi.fn(async () => null),
      onAgentPhaseMock: vi.fn((callback: (payload: AgentPhaseEventPayload) => void) => {
        phaseListeners.add(callback)
        return () => phaseListeners.delete(callback)
      }),
      emitPhaseEvent: (payload: AgentPhaseEventPayload) => {
        for (const callback of phaseListeners) {
          callback(payload)
        }
      },
      clearPhaseListeners: () => {
        phaseListeners.clear()
      },
    }
  },
)

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getAgentPhase: getAgentPhaseMock,
    onAgentPhase: onAgentPhaseMock,
  },
}))

import { useStreamingPhase } from '../useStreamingPhase'

describe('useStreamingPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPhaseListeners()
  })

  it('computes total elapsed from the first phase start when reset was not called', () => {
    const sessionId = SessionId('session-phase-no-reset')
    let nowMs = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    const { result } = renderHook(() => useStreamingPhase(sessionId))

    act(() => {
      const phase: AgentPhaseState = { label: 'Thinking', startedAt: 1_000 }
      emitPhaseEvent({ sessionId, phase })
    })

    nowMs = 2_200

    act(() => {
      emitPhaseEvent({ sessionId, phase: null })
    })

    expect(result.current.totalElapsedMs).toBe(1_200)

    nowSpy.mockRestore()
  })

  it('clears completed phase summaries when switching sessions', () => {
    const firstSessionId = SessionId('session-phase-first')
    const secondSessionId = SessionId('session-phase-second')
    let nowMs = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    const { result, rerender } = renderHook(
      ({ sessionId }: { readonly sessionId: SessionId }) => useStreamingPhase(sessionId),
      {
        initialProps: { sessionId: firstSessionId },
      },
    )

    act(() => {
      emitPhaseEvent({
        sessionId: firstSessionId,
        phase: { label: 'Thinking', startedAt: 1_000 },
      })
    })

    nowMs = 2_000

    act(() => {
      emitPhaseEvent({ sessionId: firstSessionId, phase: null })
    })

    expect(result.current.completed).toHaveLength(1)

    act(() => {
      rerender({ sessionId: secondSessionId })
    })

    expect(result.current.completed).toEqual([])
    expect(result.current.totalElapsedMs).toBe(0)
    expect(result.current.current).toBeNull()

    nowSpy.mockRestore()
  })

  it('bootstraps active phase elapsed time from the runtime timestamp', async () => {
    const sessionId = SessionId('session-phase-bootstrap')
    const nowMs = 3_500
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    getAgentPhaseMock.mockResolvedValueOnce({ label: 'Thinking', startedAt: 1_000 })

    const { result } = renderHook(() => useStreamingPhase(sessionId))

    await waitFor(() => {
      expect(result.current.current).toEqual({ label: 'Thinking', elapsedMs: 2_500 })
      expect(result.current.totalElapsedMs).toBe(2_500)
    })

    nowSpy.mockRestore()
  })
})
