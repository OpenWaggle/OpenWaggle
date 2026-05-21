// @vitest-environment jsdom

import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createSession,
  createSessionWithMessages,
  installUseAgentChatTestLifecycle,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat hydration', () => {
  installUseAgentChatTestLifecycle()

  it('hydrates persisted tool-call state from the session snapshot', async () => {
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
      const part = result.current.messages[0]?.parts[0]
      expect(part).toEqual({
        type: 'tool-call',
        id: 'tool-1',
        name: 'write',
        arguments: '{"path":"file.txt"}',
        state: 'input-complete',
      })
    })
  })

  it('rehydrates the same session when a newer persisted snapshot arrives', async () => {
    const initialSession = createSessionWithMessages(1, [
      {
        id: MessageId('user-1'),
        role: 'user',
        createdAt: 1,
        parts: [{ type: 'text', text: 'transport smoke test' }],
      },
    ])

    const updatedSession = createSessionWithMessages(2, [
      {
        id: MessageId('user-1'),
        role: 'user',
        createdAt: 1,
        parts: [{ type: 'text', text: 'transport smoke test' }],
      },
      {
        id: MessageId('assistant-1'),
        role: 'assistant',
        createdAt: 2,
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-1'),
              name: 'read',
              args: { path: 'src/app.ts' },
              state: 'output-available',
            },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId('tool-1'),
              result: { kind: 'text', text: 'file contents' },
              isError: false,
            },
          },
          {
            type: 'text',
            text: 'Transport looks healthy now.',
          },
        ],
      },
    ])

    const { result, rerender } = renderHook(
      ({ session }: { session: SessionDetail }) =>
        useAgentChat(
          SessionId('session-1'),
          session,
          SupportedModelId('claude-sonnet-4-5'),
          'medium',
        ),
      {
        initialProps: { session: initialSession },
      },
    )

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0]).toEqual(
        expect.objectContaining({
          role: 'user',
          parts: [{ type: 'text', content: 'transport smoke test' }],
        }),
      )
    })

    rerender({ session: updatedSession })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
      expect(result.current.messages[1]).toEqual(
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'read',
              arguments: '{"path":"src/app.ts"}',
              state: 'output-available',
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              content: { kind: 'text', text: 'file contents' },
              state: 'complete',
            },
            {
              type: 'text',
              content: 'Transport looks healthy now.',
            },
          ],
        }),
      )
    })
  })
})
