import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeBackgroundReconnectMessages } from '../../lib/chat-reconnect-merge'
import { useOptimisticSteerStore } from '../../state/optimistic-steer-store'
import { useOptimisticSteeredTurn } from '../useOptimisticSteeredTurn'

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
const SESSION_ID = SessionId('compacting-steer-session')
const PAYLOAD: AgentSendPayload = { text: 'continue', attachments: [], thinkingLevel: 'off' }
const CONTINUE_SHA256 = 'e256ee8e7aff6957a781d8328f0f68e26996564c81fa458da59fbca2305138ad'

function message(
  id: string,
  role: UIMessage['role'],
  content: string,
  sessionNodeCreatedOrder?: number,
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
    createdAt: new Date(0),
    ...(sessionNodeCreatedOrder === undefined ? {} : { metadata: { sessionNodeCreatedOrder } }),
  }
}

describe('steering receipts after working-context compaction', () => {
  beforeEach(() => {
    useOptimisticSteerStore.setState({ previews: new Map(), pendingPromotions: new Map() })
    vi.stubGlobal('crypto', webcrypto)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['continue', '/review'])(
    'does not consume the original %s user message when reconnect replaces its identity',
    async (originalText) => {
      const digest = await webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(PAYLOAD.text),
      )
      vi.spyOn(webcrypto.subtle, 'digest').mockResolvedValue(digest)
      const optimisticUser = message('optimistic-user-original', 'user', originalText)
      const assistant = message('assistant-active', 'assistant', 'Still running a tool')
      const initialMessages = [optimisticUser, assistant]
      const messagesRef = { current: initialMessages }
      const { result, rerender } = renderHook(
        ({ messages }) =>
          useOptimisticSteeredTurn(
            messages,
            SESSION_ID,
            (payload) => payload.text,
            messagesRef,
            false,
          ),
        { initialProps: { messages: initialMessages } },
      )
      act(() => {
        result.current.previewSteeredUserTurn(PAYLOAD, 'sending').setReceipt({
          delivery: 'queued',
          durableTextSha256: CONTINUE_SHA256,
          minimumCreatedOrder: 2,
        })
      })

      // Pi input hooks may have expanded the original /review text before persisting it.
      const persistedOriginal = message('persisted-user-original', 'user', PAYLOAD.text, 1)
      const reconnected = mergeBackgroundReconnectMessages([persistedOriginal], initialMessages)
      messagesRef.current = reconnected
      await act(async () => rerender({ messages: reconnected }))
      expect(
        result.current.visibleMessages.filter((item) => item.metadata?.steerDelivery),
      ).toHaveLength(1)

      const delivered = [...reconnected, message('new-steered-user', 'user', PAYLOAD.text, 2)]
      messagesRef.current = delivered
      rerender({ messages: delivered })
      await waitFor(() => expect(result.current.visibleMessages).toEqual(delivered))
    },
  )

  it('matches a new user node below the old insertion index without consuming kept historical text', async () => {
    const keptUser = message('kept-historical-user', 'user', 'continue', 9)
    const initialMessages = [
      ...Array.from({ length: 9 }, (_, index) =>
        message(`old-${index}`, 'assistant', 'Old answer'),
      ),
      keptUser,
    ]
    const messagesRef = { current: initialMessages }
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useOptimisticSteeredTurn(
          messages,
          SESSION_ID,
          (payload) => payload.text,
          messagesRef,
          false,
        ),
      { initialProps: { messages: initialMessages } },
    )
    act(() => {
      const preview = result.current.previewSteeredUserTurn(PAYLOAD, 'waiting-for-compaction')
      preview.setReceipt({
        delivery: 'queued',
        durableTextSha256: CONTINUE_SHA256,
        minimumCreatedOrder: 11,
      })
    })

    const compacted = [
      message('compaction-summary', 'assistant', 'Compacted history', 10),
      keptUser,
    ]
    messagesRef.current = compacted
    rerender({ messages: compacted })
    await act(async () => {
      await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(PAYLOAD.text))
    })
    expect(
      result.current.visibleMessages.filter((item) => item.metadata?.steerDelivery),
    ).toHaveLength(1)

    const delivered = [...compacted, message('new-steered-user', 'user', PAYLOAD.text, 11)]
    messagesRef.current = delivered
    rerender({ messages: delivered })
    await waitFor(() => expect(result.current.visibleMessages).toEqual(delivered))
    expect(useOptimisticSteerStore.getState().previews.has(SESSION_ID)).toBe(false)
  })

  it('keeps a matching text preview until the user node has canonical source order', async () => {
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(PAYLOAD.text))
    vi.spyOn(webcrypto.subtle, 'digest').mockResolvedValue(digest)
    const initialMessages = [message('initial', 'user', 'start', 0)]
    const messagesRef = { current: initialMessages }
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useOptimisticSteeredTurn(
          messages,
          SESSION_ID,
          (payload) => payload.text,
          messagesRef,
          false,
        ),
      { initialProps: { messages: initialMessages } },
    )
    act(() => {
      result.current.previewSteeredUserTurn(PAYLOAD, 'sending').setReceipt({
        delivery: 'queued',
        durableTextSha256: CONTINUE_SHA256,
        minimumCreatedOrder: 1,
      })
    })

    const unproven = [...initialMessages, message('new-steered-user', 'user', PAYLOAD.text)]
    messagesRef.current = unproven
    await act(async () => rerender({ messages: unproven }))
    expect(
      result.current.visibleMessages.filter((item) => item.metadata?.steerDelivery),
    ).toHaveLength(1)

    const delivered = [...initialMessages, message('new-steered-user', 'user', PAYLOAD.text, 1)]
    messagesRef.current = delivered
    rerender({ messages: delivered })
    await waitFor(() => expect(result.current.visibleMessages).toEqual(delivered))
  })
})
