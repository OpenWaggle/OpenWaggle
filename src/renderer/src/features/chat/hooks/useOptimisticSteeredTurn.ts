import type { AgentSendPayload, AgentSteerDeliveryReceipt } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage, UIMessageMetadata } from '@shared/types/chat-ui'
import { buildAgentPromptText } from '@shared/utils/agent-prompt-text'
import { useEffect } from 'react'
import {
  type SteerIncorporatedContent,
  selectOptimisticSteerPreviews,
  useOptimisticSteerStore,
} from '@/features/chat/state'
import {
  insertOptimisticSteeredUserTurn,
  matchSteeredUserTurns,
} from '../lib/steer-preview-matching'
import { useSteerReceiptReconciliation } from './useSteerReceiptReconciliation'

export type SteerDeliveryState = NonNullable<UIMessageMetadata['steerDelivery']>

export interface OptimisticSteerPreviewController {
  readonly clear: () => void
  readonly setDurableContent: (content: string) => void
  readonly setReceipt: (
    receipt: Extract<AgentSteerDeliveryReceipt, { delivery: 'queued' }> | null,
  ) => void
  readonly setDeliveryState: (state: SteerDeliveryState) => void
}

export interface OptimisticSteeredTurnReturn {
  readonly visibleMessages: UIMessage[]
  readonly previewSteeredUserTurn: (
    payload: AgentSendPayload,
    deliveryState: SteerDeliveryState,
    incorporatedContent?: SteerIncorporatedContent,
  ) => OptimisticSteerPreviewController
}

/**
 * Manages the optimistic steered user turn — an immediate preview
 * of the user's steered message before the server confirms it.
 * Auto-clears when the real message appears in the hydrated messages.
 */
export function useOptimisticSteeredTurn(
  hydratedMessages: UIMessage[],
  sessionId: SessionId | null,
  buildClientUserMessage: (payload: AgentSendPayload) => string,
  messagesRef: React.RefObject<UIMessage[]>,
  isSessionIdle: boolean,
): OptimisticSteeredTurnReturn {
  const optimisticSteeredUserTurns = useOptimisticSteerStore(
    selectOptimisticSteerPreviews(sessionId),
  )
  useSteerReceiptReconciliation(sessionId, hydratedMessages, optimisticSteeredUserTurns)

  // Clear optimistic turns as their real steered user messages arrive during
  // the active turn. Native steering does not wait for the session to become idle.
  const matchedOptimisticTurns = matchSteeredUserTurns(hydratedMessages, optimisticSteeredUserTurns)
  const reconciledOptimisticTurns = optimisticSteeredUserTurns.map((turn) => {
    const match = matchedOptimisticTurns.get(turn.id)
    if (!match || match.provisional || turn.durableMessageId) return turn
    return {
      ...turn,
      durableMessageId: match.messageId,
      ...(match.createdOrder === undefined
        ? {}
        : { durableMessageCreatedOrder: match.createdOrder }),
    }
  })
  const allOptimisticTurnsAreDurable =
    reconciledOptimisticTurns.length > 0 &&
    reconciledOptimisticTurns.every((turn) => turn.durableMessageId !== undefined)
  const hasNewDurableMatch = reconciledOptimisticTurns.some(
    (turn, index) => turn !== optimisticSteeredUserTurns[index],
  )
  useEffect(() => {
    if (!sessionId) return
    if (!allOptimisticTurnsAreDurable && !hasNewDurableMatch) return
    useOptimisticSteerStore
      .getState()
      .reconcile(sessionId, reconciledOptimisticTurns, allOptimisticTurnsAreDurable)
  }, [allOptimisticTurnsAreDurable, hasNewDurableMatch, reconciledOptimisticTurns, sessionId])

  // A steer preview only represents delivery within the active run. A steer that run never
  // incorporated returns to the Follow-up queue when it settles, so any preview that did not
  // project into the transcript must disappear then. The store is session-scoped, which preserves
  // previews across navigation.
  useEffect(() => {
    if (!sessionId || !isSessionIdle) return
    useOptimisticSteerStore.getState().clearSession(sessionId)
  }, [isSessionIdle, sessionId])

  const visibleMessages = insertOptimisticSteeredUserTurn(
    hydratedMessages,
    optimisticSteeredUserTurns,
  )

  return {
    visibleMessages,
    previewSteeredUserTurn: (
      payload: AgentSendPayload,
      deliveryState: SteerDeliveryState,
      incorporatedContent: SteerIncorporatedContent = {
        text: payload.text.trim(),
        attachmentCount: payload.attachments.length,
      },
    ) => {
      const content = buildClientUserMessage(payload)
      const optimisticTurnId = createOptimisticTurnId()
      if (!sessionId) {
        return {
          clear: () => undefined,
          setDurableContent: () => undefined,
          setReceipt: () => undefined,
          setDeliveryState: () => undefined,
        }
      }
      useOptimisticSteerStore.getState().add(sessionId, {
        id: optimisticTurnId,
        content,
        incorporatedContent,
        durableContent: buildAgentPromptText(payload),
        baselineLength: messagesRef.current.length,
        baselineMaxCreatedOrder: Math.max(
          -1,
          ...messagesRef.current.flatMap(
            (message) => message.metadata?.sessionNodeCreatedOrder ?? [],
          ),
        ),
        baselineUserMessageIds: new Set(
          messagesRef.current.flatMap((message) => (message.role === 'user' ? [message.id] : [])),
        ),
        message: createOptimisticUserMessage(content, optimisticTurnId, deliveryState),
      })
      return {
        clear: () => {
          useOptimisticSteerStore.getState().remove(sessionId, optimisticTurnId)
        },
        setDurableContent: (durableContent: string) => {
          useOptimisticSteerStore.getState().update(sessionId, optimisticTurnId, (turn) => ({
            ...turn,
            durableContent,
          }))
        },
        setReceipt: (receipt) => {
          useOptimisticSteerStore.getState().update(sessionId, optimisticTurnId, (turn) => ({
            ...turn,
            receipt,
          }))
        },
        setDeliveryState: (state: SteerDeliveryState) => {
          useOptimisticSteerStore.getState().update(sessionId, optimisticTurnId, (turn) => ({
            ...turn,
            message: { ...turn.message, metadata: { steerDelivery: state } },
          }))
        },
      }
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function createOptimisticTurnId() {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') {
    return randomUUID.call(globalThis.crypto)
  }
  return `optimistic-steer-${Date.now()}`
}

function createOptimisticUserMessage(
  content: string,
  id: string,
  deliveryState: SteerDeliveryState,
): UIMessage {
  return {
    id: `optimistic-steer-${id}`,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(),
    metadata: { steerDelivery: deliveryState },
  }
}
