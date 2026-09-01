// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOptimisticSteeredTurn } from '../useOptimisticSteeredTurn'

const SESSION_ID = SessionId('session-1')
const FIRST_PAYLOAD: AgentSendPayload = {
  text: 'continue',
  thinkingLevel: 'medium',
  attachments: [],
}
const SECOND_PAYLOAD = { ...FIRST_PAYLOAD }

function userMessage(id: string, content: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(),
  }
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: 'text' }> => {
      return part.type === 'text'
    })
    .map((part) => part.content)
    .join('\n\n')
}

describe('useOptimisticSteeredTurn', () => {
  it('preserves preview order and reconciles duplicate text one durable message at a time', () => {
    const initialMessages = [userMessage('initial', 'start')]
    const messagesRef = { current: initialMessages }
    const { result, rerender } = renderHook(
      ({ hydratedMessages }) =>
        useOptimisticSteeredTurn(
          hydratedMessages,
          SESSION_ID,
          (payload) => payload.text,
          messagesRef,
        ),
      { initialProps: { hydratedMessages: initialMessages } },
    )

    act(() => {
      result.current.previewSteeredUserTurn(FIRST_PAYLOAD, 'waiting-for-compaction')
      result.current.previewSteeredUserTurn(SECOND_PAYLOAD, 'waiting-for-compaction')
    })

    expect(result.current.visibleMessages.map(messageText)).toEqual([
      'start',
      'continue',
      'continue',
    ])
    expect(result.current.visibleMessages.slice(1).map((message) => message.metadata)).toEqual([
      { steerDelivery: 'waiting-for-compaction' },
      { steerDelivery: 'waiting-for-compaction' },
    ])

    const oneDurableSteer = [...initialMessages, userMessage('durable-first', 'continue')]
    messagesRef.current = oneDurableSteer
    rerender({ hydratedMessages: oneDurableSteer })

    expect(result.current.visibleMessages.map(messageText)).toEqual([
      'start',
      'continue',
      'continue',
    ])
    expect(
      result.current.visibleMessages.filter(
        (message) => message.metadata?.steerDelivery === 'waiting-for-compaction',
      ),
    ).toHaveLength(1)
  })
})
