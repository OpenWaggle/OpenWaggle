// @vitest-environment jsdom

import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSessionWithMessages,
  hasActiveRunMock,
  installUseAgentChatTestLifecycle,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('claude-sonnet-4-5')
const STEER_DIGEST = 'a'.repeat(64)

function rows(messages: readonly UIMessage[]) {
  return messages.map((message) => {
    const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : []))
    return `${message.role}:${text.join('')}`
  })
}

/*
 * A threshold compaction in the middle of a Run persists the Session, steer included, while the
 * Run keeps streaming. A renderer reconnecting then gets the steer twice: as a persisted node and
 * as a user message the Run's snapshot retained.
 */
describe('useAgentChat reconnect after a mid-Run compaction persisted the steer', () => {
  installUseAgentChatTestLifecycle()

  it('shows the steer once, as its persisted node, before the streaming answer', async () => {
    hasActiveRunMock.mockReturnValue(true)
    const persistedMessages: SessionDetail['messages'] = [
      {
        id: MessageId('summary'),
        role: 'assistant',
        createdAt: 1,
        parts: [{ type: 'text', text: 'Compacted context' }],
        metadata: {
          compactionSummary: { summary: 'Compacted context', tokensBefore: 80 },
          sessionNodeCreatedOrder: 3,
        },
      },
      {
        id: MessageId('steer-node'),
        role: 'user',
        createdAt: 2,
        parts: [{ type: 'text', text: 'Use the other API' }],
        metadata: { sessionNodeCreatedOrder: 5, durableTextSha256: STEER_DIGEST },
      },
    ]
    const persisted = createSessionWithMessages(2, persistedMessages)
    apiMock.getSessionDetail.mockResolvedValue(persisted)
    apiMock.getBackgroundRun.mockResolvedValue({
      activity: 'agent-run',
      sessionId: SESSION_ID,
      model: MODEL,
      mode: 'classic',
      startedAt: 1,
      messageId: 'assistant-live',
      activityEvents: [],
      userMessages: [
        {
          messageId: 'stream-steer',
          parts: [{ type: 'text', text: 'Use the other API' }],
          sessionNodeCreatedOrder: 5,
          durableTextSha256: STEER_DIGEST,
          timestamp: 2,
        },
      ],
      parts: [{ type: 'text', text: 'Partial answer' }],
    })

    const { result } = renderHook(() => useAgentChat(SESSION_ID, persisted, MODEL, 'medium'))

    await waitFor(() => {
      expect(rows(result.current.messages)).toEqual([
        'assistant:Compacted context',
        'user:Use the other API',
        'assistant:Partial answer',
      ])
    })
    const steer = result.current.messages.find((message) => message.role === 'user')
    expect(steer?.id).toBe('steer-node')
    expect(steer?.metadata).not.toHaveProperty('liveIncorporated')
  })
})
