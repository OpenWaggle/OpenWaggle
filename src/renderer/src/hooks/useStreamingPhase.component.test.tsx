import { ConversationId } from '@shared/types/brand'
import type { AgentPhaseEventPayload, AgentPhaseState } from '@shared/types/phase'
import { act, renderHook } from '@testing-library/react'
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

vi.mock('@/lib/ipc', () => ({
  api: {
    getAgentPhase: getAgentPhaseMock,
    onAgentPhase: onAgentPhaseMock,
  },
}))

import { useStreamingPhase } from './useStreamingPhase'

describe('useStreamingPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPhaseListeners()
  })

  it('computes total elapsed from the first phase start when reset was not called', () => {
    const conversationId = ConversationId('conv-phase-no-reset')
    let nowMs = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    const { result } = renderHook(() => useStreamingPhase(conversationId))

    act(() => {
      const phase: AgentPhaseState = { label: 'Thinking', startedAt: 1_000 }
      emitPhaseEvent({ conversationId, phase })
    })

    nowMs = 2_200

    act(() => {
      emitPhaseEvent({ conversationId, phase: null })
    })

    expect(result.current.totalElapsedMs).toBe(1_200)

    nowSpy.mockRestore()
  })
})
