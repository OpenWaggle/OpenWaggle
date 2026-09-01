// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useOptimisticSteerStore } from '@/features/chat/state'
import { buildClientUserMessage } from '../../lib/chat-attachment-preview'
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
  beforeEach(() => {
    useOptimisticSteerStore.setState({ previews: new Map() })
  })

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

    const bothDurableSteers = [...oneDurableSteer, userMessage('durable-second', 'continue')]
    messagesRef.current = bothDurableSteers
    rerender({ hydratedMessages: bothDurableSteers })

    expect(result.current.visibleMessages).toEqual(bothDurableSteers)
  })

  it('keeps a pending preview scoped to its session while the user navigates away', () => {
    const initialMessages = [userMessage('initial', 'start')]
    const messagesRef = { current: initialMessages }
    const otherSessionId = SessionId('session-2')
    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useOptimisticSteeredTurn(
          initialMessages,
          sessionId,
          (payload) => payload.text,
          messagesRef,
        ),
      { initialProps: { sessionId: SESSION_ID } },
    )

    act(() => {
      result.current.previewSteeredUserTurn(FIRST_PAYLOAD, 'waiting-for-compaction')
    })
    expect(result.current.visibleMessages.map(messageText)).toEqual(['start', 'continue'])

    rerender({ sessionId: otherSessionId })
    expect(result.current.visibleMessages.map(messageText)).toEqual(['start'])

    rerender({ sessionId: SESSION_ID })
    expect(result.current.visibleMessages.map(messageText)).toEqual(['start', 'continue'])
    expect(result.current.visibleMessages.at(-1)?.metadata?.steerDelivery).toBe(
      'waiting-for-compaction',
    )
  })

  it('reconciles an attachment preview with the durable Pi prompt projection', () => {
    const extractedText = 'attachment body '.repeat(30)
    const payload: AgentSendPayload = {
      ...FIRST_PAYLOAD,
      attachments: [
        {
          id: 'attachment-1',
          kind: 'text',
          name: 'notes.txt',
          path: '/tmp/notes.txt',
          mimeType: 'text/plain',
          sizeBytes: extractedText.length,
          extractedText,
        },
      ],
    }
    const initialMessages = [userMessage('initial', 'start')]
    const messagesRef = { current: initialMessages }
    const { result, rerender } = renderHook(
      ({ hydratedMessages }) =>
        useOptimisticSteeredTurn(hydratedMessages, SESSION_ID, buildClientUserMessage, messagesRef),
      { initialProps: { hydratedMessages: initialMessages } },
    )

    act(() => {
      result.current.previewSteeredUserTurn(payload, 'waiting-for-compaction')
    })

    const durableMessages = [
      ...initialMessages,
      userMessage(
        'durable-attachment',
        `continue\n\n[Attachment: notes.txt]\n${extractedText.trim()}`,
      ),
    ]
    messagesRef.current = durableMessages
    rerender({ hydratedMessages: durableMessages })

    expect(result.current.visibleMessages).toEqual(durableMessages)
  })
})
