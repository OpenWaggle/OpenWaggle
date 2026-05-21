// @vitest-environment jsdom

import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createDeferred,
  createSession,
  createSessionWithMessages,
  emitAgentEvent,
  hasActiveRunMock,
  installUseAgentChatTestLifecycle,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat background reconnect', () => {
  installUseAgentChatTestLifecycle()

  it('reconnects to an active background run snapshot', async () => {
    hasActiveRunMock.mockReturnValue(true)
    apiMock.getBackgroundRun.mockResolvedValue({
      sessionId: SessionId('session-1'),
      model: SupportedModelId('claude-sonnet-4-5'),
      mode: 'agent',
      startedAt: 1,
      parts: [{ type: 'text', text: 'Partial answer' }],
    })

    const session = createSession()
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        session,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.backgroundStreaming).toBe(true)
      expect(result.current.messages.at(-1)).toEqual(
        expect.objectContaining({
          role: 'assistant',
          parts: [{ type: 'text', content: 'Partial answer' }],
        }),
      )
    })
  })

  it('merges background reconnect snapshots when stream events arrive before reconnect completes', async () => {
    hasActiveRunMock.mockReturnValue(true)
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    apiMock.getSessionDetail.mockResolvedValue(
      createSessionWithMessages(1, [
        {
          id: MessageId('user-1'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Draft a summary' }],
        },
      ]),
    )
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, [
          {
            id: MessageId('user-1'),
            role: 'user',
            createdAt: 1,
            parts: [{ type: 'text', text: 'Draft a summary' }],
          },
        ]),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.backgroundStreaming).toBe(true)
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: ' later',
          },
          timestamp: 3,
        },
      })
    })

    await act(async () => {
      backgroundRun.resolve({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('claude-sonnet-4-5'),
        mode: 'classic',
        startedAt: 1,
        messageId: 'assistant-1',
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-1'),
              name: 'read',
              args: { path: 'src/app.ts' },
              state: 'input-complete',
            },
          },
          {
            type: 'text',
            text: 'Earlier',
          },
        ],
      })
      await backgroundRun.promise
    })

    await waitFor(() => {
      const assistant = result.current.messages.find((message) => message.id === 'assistant-1')
      expect(assistant).toEqual(
        expect.objectContaining({
          role: 'assistant',
          parts: [
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'read',
              arguments: '{"path":"src/app.ts"}',
              state: 'input-complete',
            },
            {
              type: 'text',
              content: 'Earlier later',
            },
          ],
        }),
      )
    })
  })
})
