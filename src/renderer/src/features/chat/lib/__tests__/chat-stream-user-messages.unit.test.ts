import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { applyAgentTransportEvent } from '../chat-stream-state'
import { placeReconnectedRunMessages } from '../chat-stream-user-messages'

const DIGEST = 'e'.repeat(64)

function userMessageStart(
  messageId: string,
  text: string,
  sessionNodeCreatedOrder: number,
): AgentTransportEvent {
  return {
    type: 'message_start',
    messageId,
    role: 'user',
    userMessage: {
      parts: [{ type: 'text', text }],
      sessionNodeCreatedOrder,
      durableTextSha256: DIGEST,
    },
    timestamp: 1_000,
  }
}

const answered: UIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', content: 'First question' }],
    metadata: { sessionNodeCreatedOrder: 0 },
  },
  { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', content: 'First answer' }] },
]

describe('applyAgentTransportEvent incorporated user messages', () => {
  it('shows the user message after the previous answer and before the next one', () => {
    let messages = applyAgentTransportEvent(answered, userMessageStart('live-user', 'Steer', 2))
    messages = applyAgentTransportEvent(messages, {
      type: 'message_start',
      messageId: 'assistant-2',
      role: 'assistant',
      timestamp: 1_001,
    })

    expect(messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'live-user',
      'assistant-2',
    ])
    expect(messages[2]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', content: 'Steer' }],
      metadata: { sessionNodeCreatedOrder: 2, durableTextSha256: DIGEST },
    })
  })

  it('gives an optimistic send its log identity instead of repeating it', () => {
    const optimistic: UIMessage = {
      id: 'optimistic-user-1',
      role: 'user',
      parts: [{ type: 'text', content: 'Second question' }],
    }

    const messages = applyAgentTransportEvent(
      [...answered, optimistic],
      userMessageStart('live-user', 'Second question', 2),
    )

    expect(messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'optimistic-user-1',
    ])
    expect(messages[2]?.metadata).toEqual({
      sessionNodeCreatedOrder: 2,
      durableTextSha256: DIGEST,
    })
  })

  it('does not repeat a recorded message with the same text', () => {
    const messages = applyAgentTransportEvent(
      answered,
      userMessageStart('live-user', 'First question', 2),
    )

    expect(messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'live-user'])
  })

  it('leaves a message the transcript already holds as it is', () => {
    const once = applyAgentTransportEvent(answered, userMessageStart('live-user', 'Steer', 2))
    const replayed = applyAgentTransportEvent(once, userMessageStart('live-user', 'Steer', 2))
    const snapshotted = applyAgentTransportEvent(
      answered.concat({
        id: 'node-2',
        role: 'user',
        parts: [{ type: 'text', content: 'Steer' }],
        metadata: { sessionNodeCreatedOrder: 2 },
      }),
      userMessageStart('other-live-id', 'Steer', 2),
    )

    expect(replayed).toEqual(once)
    expect(snapshotted.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'node-2'])
  })

  it('shows a different message that reuses a log order a stale row still holds', () => {
    // A branch switch or compaction can leave a row with the same order but other content.
    const stale = answered.concat({
      id: 'other-branch',
      role: 'user',
      parts: [{ type: 'text', content: 'Something else' }],
      metadata: { sessionNodeCreatedOrder: 2, durableTextSha256: 'f'.repeat(64) },
    })

    const messages = applyAgentTransportEvent(stale, userMessageStart('live-user', 'Steer', 2))

    expect(messages.map((message) => message.id)).toContain('live-user')
  })

  it('shows a Waggle request with the preset it invoked', () => {
    const waggleInvocation = {
      presetId: 'preset-1',
      presetName: 'Review pair',
      source: 'user' as const,
    }
    const messages = applyAgentTransportEvent(answered, {
      type: 'message_start',
      messageId: 'live-waggle',
      role: 'user',
      userMessage: {
        parts: [{ type: 'text', text: 'Review this' }],
        sessionNodeCreatedOrder: 2,
        waggleInvocation,
      },
      timestamp: 1_000,
    })

    expect(messages.at(-1)?.metadata).toEqual({ sessionNodeCreatedOrder: 2, waggleInvocation })
  })

  it('ignores a user message start without content', () => {
    const messages = applyAgentTransportEvent(answered, {
      type: 'message_start',
      messageId: 'live-user',
      role: 'user',
      timestamp: 1_000,
    })

    expect(messages).toEqual(answered)
  })

  it('places a reconnected Run user message after the answer it followed', () => {
    const partial: UIMessage = {
      id: 'assistant-2',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Partial answer' }],
    }
    const userMessage = (messageId: string, text: string, order: number, after?: string) => ({
      messageId,
      parts: [{ type: 'text' as const, text }],
      sessionNodeCreatedOrder: order,
      timestamp: 5_000 + order,
      ...(after ? { afterAssistantMessageId: after } : {}),
    })

    const messages = placeReconnectedRunMessages(
      answered,
      {
        messageId: 'assistant-2',
        userMessages: [
          userMessage('queued', 'Queued question', 2),
          userMessage('steer', 'Steer after the tools', 4, 'assistant-2'),
        ],
      },
      partial,
    )

    expect(messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'queued',
      'assistant-2',
      'steer',
    ])
    expect(messages[4]?.createdAt).toEqual(new Date(5_004))
  })
})
