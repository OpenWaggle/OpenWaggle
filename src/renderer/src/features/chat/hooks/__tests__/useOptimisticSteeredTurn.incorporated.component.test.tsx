// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useOptimisticSteerStore } from '@/features/chat/state'
import { useOptimisticSteeredTurn } from '../useOptimisticSteeredTurn'

const SESSION_ID = SessionId('session-1')
const ATTACHED_NOTES = '[Attachment] notes.txt\nnotes body'
const FIRST_PAYLOAD: AgentSendPayload = {
  text: 'continue',
  thinkingLevel: 'medium',
  attachments: [],
}

function userMessage(id: string, content: string, createdOrder?: number): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(),
    ...(createdOrder !== undefined ? { metadata: { sessionNodeCreatedOrder: createdOrder } } : {}),
  }
}

/** Steer previews meet the user row the Run published the moment it incorporated the steer. */
describe('useOptimisticSteeredTurn with incorporated user messages', () => {
  beforeEach(() => {
    useOptimisticSteerStore.setState({ previews: new Map() })
  })

  it('flips a queued steer to delivered in the render the Run incorporates it', () => {
    const digest = 'a'.repeat(64)
    const initialMessages = [userMessage('initial', 'start', 0)]
    const messagesRef = { current: initialMessages }
    const { result, rerender } = renderHook(
      ({ hydratedMessages }) =>
        useOptimisticSteeredTurn(
          hydratedMessages,
          SESSION_ID,
          (payload) => payload.text,
          messagesRef,
          false,
        ),
      { initialProps: { hydratedMessages: initialMessages } },
    )
    act(() => {
      result.current
        .previewSteeredUserTurn({ ...FIRST_PAYLOAD, text: 'Use the other API' }, 'sending')
        .setReceipt({ delivery: 'queued', minimumCreatedOrder: 1, durableTextSha256: digest })
    })
    // An earlier row with the same text but before the receipt boundary is not the steer.
    const sameTextBefore = {
      ...userMessage('before-boundary', 'Use the other API', 0),
      metadata: { sessionNodeCreatedOrder: 0, durableTextSha256: digest },
    }
    const incorporated: UIMessage = {
      ...userMessage('live-user', 'Use the other API'),
      metadata: { sessionNodeCreatedOrder: 3, durableTextSha256: digest },
    }
    const delivered = [sameTextBefore, incorporated]
    rerender({ hydratedMessages: delivered })

    expect(result.current.visibleMessages).toEqual(delivered)
    expect(useOptimisticSteerStore.getState().previews.get(SESSION_ID) ?? []).toEqual([])
  })

  it('stands an incorporated row in for a promotion still awaiting its receipt', () => {
    const initialMessages = [userMessage('initial', 'start', 0)]
    const messagesRef = { current: initialMessages }
    const { result, rerender } = renderHook(
      ({ hydratedMessages }) =>
        useOptimisticSteeredTurn(
          hydratedMessages,
          SESSION_ID,
          (payload) => payload.text,
          messagesRef,
          false,
        ),
      { initialProps: { hydratedMessages: initialMessages } },
    )
    let preview: ReturnType<typeof result.current.previewSteeredUserTurn> | undefined
    act(() => {
      preview = result.current.previewSteeredUserTurn(
        { ...FIRST_PAYLOAD, text: 'Use the other API' },
        'sending',
      )
      preview.setReceipt(null)
    })
    const incorporated: UIMessage = {
      ...userMessage('live-user', 'Use the other API'),
      metadata: { sessionNodeCreatedOrder: 3, durableTextSha256: 'b'.repeat(64) },
    }
    const delivered = [...initialMessages, incorporated]
    rerender({ hydratedMessages: delivered })

    expect(result.current.visibleMessages).toEqual(delivered)
    // Not recorded: only the receipt can confirm which row the steer became.
    expect(useOptimisticSteerStore.getState().previews.get(SESSION_ID)).toHaveLength(1)

    act(() => {
      preview?.setReceipt({
        delivery: 'queued',
        minimumCreatedOrder: 1,
        durableTextSha256: 'c'.repeat(64),
      })
    })
    expect(
      result.current.visibleMessages.filter((message) => message.metadata?.steerDelivery),
    ).toHaveLength(1)
  })

  it.each([
    ['text and attachments', 'Compare these', [ATTACHED_NOTES]],
    ['only attachments', '', [ATTACHED_NOTES]],
  ])('stands in for a promoted Follow-up with %s', (_case, text, attachments) => {
    const initialMessages = [userMessage('initial', 'start', 0)]
    const { result, rerender } = renderHook(
      ({ hydratedMessages }) =>
        useOptimisticSteeredTurn(
          hydratedMessages,
          SESSION_ID,
          (payload) => payload.text,
          { current: initialMessages },
          false,
        ),
      { initialProps: { hydratedMessages: initialMessages } },
    )
    act(() => {
      // The queue preview summarizes attachments, so its own text cannot match the delivered row.
      result.current
        .previewSteeredUserTurn(
          { ...FIRST_PAYLOAD, text: [text, '[1 attachments]'].filter(Boolean).join('\n\n') },
          'sending',
          { text, attachmentCount: attachments.length },
        )
        .setReceipt(null)
    })
    const incorporated: UIMessage = {
      id: 'live-user',
      role: 'user',
      parts: [
        ...(text ? [{ type: 'text' as const, content: text }] : []),
        ...attachments.map((content) => ({ type: 'text' as const, content })),
      ],
      metadata: { sessionNodeCreatedOrder: 3 },
    }
    const delivered = [...initialMessages, incorporated]
    rerender({ hydratedMessages: delivered })

    expect(result.current.visibleMessages).toEqual(delivered)
  })
})
