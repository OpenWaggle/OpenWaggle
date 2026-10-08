// @vitest-environment jsdom

import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSessionWithIdAndMessages,
  hasActiveRunMock,
  installUseAgentChatTestLifecycle,
  runRenderSnapshots,
  useAgentChat,
} from './useAgentChat.test-utils'

/*
 * Switching back to a Session whose Run is still going: the shown transcript holds a finished
 * answer as it streamed (its thinking part has a step id), the reconnect buffer retains it as a
 * finished answer whose reasoning has none. The reasoning must show once, not again below the text.
 */

const SESSION_A = SessionId('session-a')
const SESSION_B = SessionId('session-b')
const MODEL = SupportedModelId('claude-sonnet-4-5')
const REASONING = 'Let me look at the cache first.'
const SETTLE_MS = 50

const SNAPSHOT: BackgroundRunSnapshot = {
  activity: 'agent-run',
  sessionId: SESSION_B,
  runId: 'run-b',
  model: MODEL,
  mode: 'classic',
  startedAt: 1,
  activityEvents: [],
  messageId: 'answer-2',
  messageStartedAt: 30,
  parts: [{ type: 'text', text: 'Now writing', contentIndex: 0 }],
  assistantMessages: [
    {
      messageId: 'answer-1',
      timestamp: 20,
      parts: [
        { type: 'reasoning', text: REASONING, contentIndex: 0 },
        { type: 'text', text: 'Reading the cache module.', contentIndex: 1 },
      ],
    },
  ],
}

describe('useAgentChat reconnect of a finished answer with reasoning', () => {
  installUseAgentChatTestLifecycle()

  it('shows its reasoning once after switching Session and back', async () => {
    hasActiveRunMock.mockImplementation((id: SessionId) => id === SESSION_B)
    apiMock.getBackgroundRun.mockResolvedValue(SNAPSHOT)
    const detail = createSessionWithIdAndMessages(SESSION_B, 1, [])
    apiMock.getSessionDetail.mockResolvedValue(detail)
    runRenderSnapshots.set('session-b', {
      compactionStatus: null,
      updatedAt: 1,
      messages: [
        {
          id: 'optimistic-user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'Fix it' }],
          createdAt: new Date(10),
        },
        {
          id: 'answer-1',
          role: 'assistant',
          createdAt: new Date(20),
          parts: [
            { type: 'thinking', content: REASONING, stepId: 'answer-1:thinking:0' },
            { type: 'text', content: 'Reading the cache module.' },
          ],
        },
        {
          id: 'answer-2',
          role: 'assistant',
          createdAt: new Date(30),
          parts: [{ type: 'text', content: 'Now writing' }],
        },
      ],
    })

    const { result, rerender } = renderHook(
      ({ sessionId, session }) => useAgentChat(sessionId, session, MODEL),
      {
        initialProps: {
          sessionId: SESSION_A,
          session: createSessionWithIdAndMessages(SESSION_A, 1, []),
        },
      },
    )
    await act(async () => {
      rerender({ sessionId: SESSION_B, session: detail })
      await Promise.resolve()
    })
    await waitFor(() => expect(apiMock.getBackgroundRun).toHaveBeenCalled())
    await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)))

    const answer = result.current.messages.find((message) => message.id === 'answer-1')
    expect(answer?.parts).toEqual([
      { type: 'thinking', content: REASONING, stepId: 'answer-1:thinking:0' },
      { type: 'text', content: 'Reading the cache module.' },
    ])
  })
})
