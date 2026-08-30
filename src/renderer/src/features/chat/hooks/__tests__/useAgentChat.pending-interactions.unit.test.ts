// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSession,
  installUseAgentChatTestLifecycle,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat pending interaction hydration', () => {
  installUseAgentChatTestLifecycle()

  it('hydrates interactions that were already pending before the renderer subscribed', async () => {
    apiMock.querySessionControl.mockResolvedValueOnce({
      contractVersion: 2,
      requestId: 'pending-request-query',
      outcome: {
        operation: 'requests-list',
        sessionId: 'session-1',
        requests: [
          {
            interactionId: 'interaction-before-renderer',
            sessionId: SessionId('session-1'),
            runId: 'run-1',
            kind: 'confirm',
            source: 'pi-ui',
            createdAt: 1,
            title: 'Continue?',
            message: 'Allow extension action?',
          },
        ],
      },
    })

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.agentInteractions).toEqual([
        expect.objectContaining({ interactionId: 'interaction-before-renderer' }),
      ])
    })
  })
})
