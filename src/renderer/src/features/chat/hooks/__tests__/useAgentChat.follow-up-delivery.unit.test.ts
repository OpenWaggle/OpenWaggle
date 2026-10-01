// @vitest-environment jsdom

import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSessionWithMessages,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')

function transcript(messages: readonly UIMessage[]) {
  return messages.map((message) => {
    const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : []))
    return `${message.role}:${text.join('')}`
  })
}

function streamAnswer(runId: string, messageId: string, text: string, startAt: number) {
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: { type: 'agent_start', runId, model: MODEL, timestamp: startAt },
  })
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: { type: 'message_start', messageId, role: 'assistant', timestamp: startAt + 1 },
  })
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: {
      type: 'message_update',
      messageId,
      role: 'assistant',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text },
      timestamp: startAt + 2,
    },
  })
}

const FIRST_TURN: SessionDetail['messages'] = [
  {
    id: MessageId('user-1'),
    role: 'user',
    createdAt: 1,
    parts: [{ type: 'text', text: SEND_PAYLOAD.text }],
  },
  {
    id: MessageId('assistant-1'),
    role: 'assistant',
    createdAt: 2,
    parts: [{ type: 'text', text: 'Answer 1' }],
  },
]

const QUEUED_TURN: SessionDetail['messages'] = [
  {
    id: MessageId('user-2'),
    role: 'user',
    createdAt: 3,
    parts: [{ type: 'text', text: 'Queued question' }],
  },
  {
    id: MessageId('assistant-2'),
    role: 'assistant',
    createdAt: 4,
    parts: [{ type: 'text', text: 'Answer 2' }],
  },
]

/*
 * A Follow-up queued during a Run starts as the next Run when the Run settles.
 * The renderer is told `continues: true` and keeps following the stream, but nothing ever puts the
 * Follow-up's user message into the live transcript.
 */
describe('useAgentChat Follow-up delivered at the end of a Run', () => {
  installUseAgentChatTestLifecycle()

  it('shows the queued message between the two answers while the Follow-up Run streams', async () => {
    let session = createSessionWithMessages(1, [])
    const { result, rerender } = renderHook(() =>
      useAgentChat(SESSION_ID, session, MODEL, 'medium'),
    )
    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })

    let send: Promise<void> | null = null
    await act(async () => {
      send = result.current.sendMessage(SEND_PAYLOAD)
    })
    await act(async () => {
      streamAnswer('run-1', 'assistant-1', 'Answer 1', 10)
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 20 },
      })
      emitRunCompleted({
        sessionId: SESSION_ID,
        runId: 'run-1',
        terminalStatus: 'completed',
        continues: true,
      })
      await send
    })
    // The Host persisted run-1 and its snapshot reaches the renderer.
    session = createSessionWithMessages(2, FIRST_TURN)
    rerender()
    await act(async () => {
      streamAnswer('run-2', 'assistant-2', 'Answer 2', 30)
    })

    expect(transcript(result.current.messages)).toEqual([
      `user:${SEND_PAYLOAD.text}`,
      'assistant:Answer 1',
      'user:Queued question',
      'assistant:Answer 2',
    ])
  })

  it('settles with the queued message in order once the Follow-up Run completes', async () => {
    let session = createSessionWithMessages(1, [])
    const { result, rerender } = renderHook(() =>
      useAgentChat(SESSION_ID, session, MODEL, 'medium'),
    )
    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })

    let send: Promise<void> | null = null
    await act(async () => {
      send = result.current.sendMessage(SEND_PAYLOAD)
    })
    await act(async () => {
      streamAnswer('run-1', 'assistant-1', 'Answer 1', 10)
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 20 },
      })
      emitRunCompleted({
        sessionId: SESSION_ID,
        runId: 'run-1',
        terminalStatus: 'completed',
        continues: true,
      })
      await send
    })
    await act(async () => {
      streamAnswer('run-2', 'assistant-2', 'Answer 2', 30)
    })
    const settled = createSessionWithMessages(3, [...FIRST_TURN, ...QUEUED_TURN])
    apiMock.getSessionDetail.mockResolvedValue(settled)
    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_end', runId: 'run-2', reason: 'stop', timestamp: 40 },
      })
      emitRunCompleted({ sessionId: SESSION_ID, runId: 'run-2', terminalStatus: 'completed' })
      await Promise.resolve()
    })
    session = settled
    rerender()

    expect(transcript(result.current.messages)).toEqual([
      `user:${SEND_PAYLOAD.text}`,
      'assistant:Answer 1',
      'user:Queued question',
      'assistant:Answer 2',
    ])
  })
})
