// @vitest-environment jsdom

import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import {
  apiMock,
  createDeferred,
  createSessionWithMessages,
  emitAgentEvent,
  hasActiveRunMock,
  installUseAgentChatTestLifecycle,
  runRenderSnapshots,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat reconnect', () => {
  installUseAgentChatTestLifecycle()

  it('keeps an optimistic user message when reconnecting after a route remount', async () => {
    hasActiveRunMock.mockReturnValue(true)
    apiMock.getBackgroundRun.mockResolvedValue({
      sessionId: SessionId('session-1'),
      model: SupportedModelId('claude-sonnet-4-5'),
      mode: 'agent',
      startedAt: 1,
      parts: [],
    })
    useOptimisticUserMessageStore.getState().add(SessionId('session-1'), {
      id: 'optimistic-user-1',
      role: 'user',
      parts: [{ type: 'text', content: 'First prompt survives remount' }],
      createdAt: new Date(1),
    })

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.backgroundStreaming).toBe(true)
      expect(result.current.messages[0]).toEqual(
        expect.objectContaining({
          id: 'optimistic-user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'First prompt survives remount' }],
        }),
      )
    })
  })

  it('continues streaming when agent_start arrives after a route remount', async () => {
    useOptimisticUserMessageStore.getState().add(SessionId('session-1'), {
      id: 'optimistic-user-1',
      role: 'user',
      parts: [{ type: 'text', content: 'First prompt survives remount' }],
      createdAt: new Date(1),
    })

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.messages[0]?.role).toBe('user')
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_start',
          runId: 'run-1',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_start',
          messageId: 'assistant-1',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Streaming after remount',
          },
          timestamp: 3,
        },
      })
    })

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'optimistic-user-1',
          role: 'user',
        }),
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', content: 'Streaming after remount' }],
        }),
      ]),
    )
  })

  it('uses the latest persisted session snapshot when reconnecting to a background run', async () => {
    hasActiveRunMock.mockReturnValue(true)
    apiMock.getBackgroundRun.mockResolvedValue(null)
    apiMock.getSessionDetail.mockResolvedValue(
      createSessionWithMessages(2, [
        {
          id: MessageId('user-1'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Persisted prompt' }],
        },
      ]),
    )

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.messages[0]).toEqual(
        expect.objectContaining({
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'Persisted prompt' }],
        }),
      )
    })
  })

  it('hydrates active run rendering from the renderer cache before reconnect completes', async () => {
    hasActiveRunMock.mockReturnValue(true)
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)
    runRenderSnapshots.set('session-1', {
      updatedAt: 1,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'Keep live output visible' }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'thinking', content: 'Cached reasoning is already visible' },
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'read',
              arguments: '{"path":"package.json"}',
              state: 'input-complete',
            },
          ],
          createdAt: new Date(2),
        },
      ],
    })

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.backgroundStreaming).toBe(true)
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-1',
            role: 'assistant',
            parts: [
              { type: 'thinking', content: 'Cached reasoning is already visible' },
              {
                type: 'tool-call',
                id: 'tool-1',
                name: 'read',
                arguments: '{"path":"package.json"}',
                state: 'input-complete',
              },
            ],
          }),
        ]),
      )
    })
  })
})
