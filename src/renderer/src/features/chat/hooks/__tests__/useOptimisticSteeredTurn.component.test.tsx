// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptimisticSteerStore } from '@/features/chat/state'
import { buildClientUserMessage } from '../../lib/chat-attachment-preview'
import { useOptimisticSteeredTurn } from '../useOptimisticSteeredTurn'

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')

const SESSION_ID = SessionId('session-1')
const FIRST_PAYLOAD: AgentSendPayload = {
  text: 'continue',
  thinkingLevel: 'medium',
  attachments: [],
}
const SECOND_PAYLOAD = { ...FIRST_PAYLOAD }

function userMessage(id: string, content: string, createdOrder?: number): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(),
    ...(createdOrder !== undefined ? { metadata: { sessionNodeCreatedOrder: createdOrder } } : {}),
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
    vi.stubGlobal('crypto', webcrypto)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retains a queued receipt until the exact transformed user text arrives', async () => {
    const initialMessages = [userMessage('initial', 'start')]
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
    const expanded = `Transformed prompt\n\n[Attachment: notes.txt]\n${'全文 '.repeat(5000)}`
    act(() => {
      const preview = result.current.previewSteeredUserTurn(FIRST_PAYLOAD, 'waiting-for-compaction')
      preview.setReceipt(null)
      preview.setReceipt({
        delivery: 'queued',
        minimumCreatedOrder: 1,
        durableTextSha256: 'fb982b915f13dfcb231f0ee8b8c27471d8c9e0a46437be220cbba7eb63c631b2',
      })
      preview.setDeliveryState('sending')
    })
    const unrelated = [...initialMessages, userMessage('unrelated', FIRST_PAYLOAD.text, 1)]
    messagesRef.current = unrelated
    rerender({ hydratedMessages: unrelated })
    expect(
      result.current.visibleMessages.filter((message) => message.metadata?.steerDelivery),
    ).toHaveLength(1)
    const projected = userMessage('durable', expanded, 2)
    const durableMessages = [
      ...unrelated,
      {
        ...projected,
        parts: [...projected.parts, { type: 'text' as const, content: '[Image input: image/png]' }],
      },
    ]
    messagesRef.current = durableMessages
    rerender({ hydratedMessages: durableMessages })
    await waitFor(() => expect(result.current.visibleMessages).toEqual(durableMessages))
    expect(useOptimisticSteerStore.getState().previews.has(SESSION_ID)).toBe(false)
  })

  it('consumes identical digest receipts once per later durable user node', async () => {
    const initialMessages = [userMessage('old-same-text', 'continue')]
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
      for (const payload of [FIRST_PAYLOAD, SECOND_PAYLOAD]) {
        result.current.previewSteeredUserTurn(payload, 'sending').setReceipt({
          delivery: 'queued',
          minimumCreatedOrder: 1,
          durableTextSha256: 'e256ee8e7aff6957a781d8328f0f68e26996564c81fa458da59fbca2305138ad',
        })
      }
    })
    const one = [...initialMessages, userMessage('new-first', 'continue', 1)]
    rerender({ hydratedMessages: one })
    await waitFor(() =>
      expect(
        result.current.visibleMessages.filter((message) => message.metadata?.steerDelivery),
      ).toHaveLength(1),
    )
    const two = [...one, userMessage('new-second', 'continue', 2)]
    rerender({ hydratedMessages: two })
    await waitFor(() => expect(result.current.visibleMessages).toEqual(two))
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
          false,
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
          false,
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
        useOptimisticSteeredTurn(
          hydratedMessages,
          SESSION_ID,
          buildClientUserMessage,
          messagesRef,
          false,
        ),
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

  it('reconciles a slash-command preview with the canonical expanded Pi message', () => {
    const initialMessages = [userMessage('initial', 'start')]
    const messagesRef = { current: initialMessages }
    const slashPayload = { ...FIRST_PAYLOAD, text: '/skill:review-pr' }
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
      const preview = result.current.previewSteeredUserTurn(slashPayload, 'sending')
      preview.setDurableContent('Expanded review skill')
    })

    const durableMessages = [
      ...initialMessages,
      userMessage('durable-expanded-skill', 'Expanded review skill'),
    ]
    messagesRef.current = durableMessages
    rerender({ hydratedMessages: durableMessages })

    expect(result.current.visibleMessages).toEqual(durableMessages)
  })

  it('clears an accepted steer preview when the run ends without projecting it', async () => {
    const initialMessages = [userMessage('initial', 'start')]
    const messagesRef = { current: initialMessages }
    const { result, rerender } = renderHook(
      ({ isSessionIdle }) =>
        useOptimisticSteeredTurn(
          initialMessages,
          SESSION_ID,
          (payload) => payload.text,
          messagesRef,
          isSessionIdle,
        ),
      { initialProps: { isSessionIdle: false } },
    )

    act(() => {
      result.current.previewSteeredUserTurn(FIRST_PAYLOAD, 'sending')
    })
    expect(result.current.visibleMessages.map(messageText)).toEqual(['start', 'continue'])

    rerender({ isSessionIdle: true })

    await waitFor(() => expect(result.current.visibleMessages.map(messageText)).toEqual(['start']))
    expect(useOptimisticSteerStore.getState().previews.has(SESSION_ID)).toBe(false)
  })
})
