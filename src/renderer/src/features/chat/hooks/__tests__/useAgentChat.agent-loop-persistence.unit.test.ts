// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createSession,
  emitAgentEvent,
  installUseAgentChatTestLifecycle,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat agent-loop persistence', () => {
  installUseAgentChatTestLifecycle()

  it('retains persistent notifications when the route-level chat hook remounts', async () => {
    const sessionId = SessionId('session-1')
    const firstMount = renderHook(() =>
      useAgentChat(sessionId, createSession(), SupportedModelId('claude-sonnet-4-5'), 'medium'),
    )

    await act(async () => {
      emitAgentEvent({
        sessionId,
        event: {
          type: 'agent_interaction_request',
          timestamp: 1,
          interaction: {
            interactionId: 'persistent-error',
            sessionId,
            runId: 'run-1',
            kind: 'notify',
            source: 'pi-ui',
            createdAt: 1,
            level: 'error',
            message: 'Could not reach api.github.com',
          },
        },
      })
    })

    expect(firstMount.result.current.agentInteractionEvents).toHaveLength(1)
    firstMount.unmount()

    const secondMount = renderHook(() =>
      useAgentChat(sessionId, createSession(), SupportedModelId('claude-sonnet-4-5'), 'medium'),
    )

    expect(secondMount.result.current.agentInteractionEvents).toEqual([
      expect.objectContaining({
        type: 'agent_interaction_request',
        interaction: expect.objectContaining({ interactionId: 'persistent-error' }),
      }),
    ])
  })
})
