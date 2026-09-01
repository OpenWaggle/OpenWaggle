import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage, UIMessageMetadata } from '@shared/types/chat-ui'
import { useEffect } from 'react'
import {
  type OptimisticSteerPreview,
  selectOptimisticSteerPreviews,
  useOptimisticSteerStore,
} from '@/features/chat/state'

export type SteerDeliveryState = NonNullable<UIMessageMetadata['steerDelivery']>

export interface OptimisticSteerPreviewController {
  readonly clear: () => void
  readonly setDeliveryState: (state: SteerDeliveryState) => void
}

interface OptimisticSteeredTurnReturn {
  readonly visibleMessages: UIMessage[]
  readonly previewSteeredUserTurn: (
    payload: AgentSendPayload,
    deliveryState: SteerDeliveryState,
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
): OptimisticSteeredTurnReturn {
  const optimisticSteeredUserTurns = useOptimisticSteerStore(
    selectOptimisticSteerPreviews(sessionId),
  )

  // Clear optimistic turns as their real steered user messages arrive during
  // the active turn. Native steering does not wait for the session to become idle.
  const matchedOptimisticTurns = matchSteeredUserTurns(hydratedMessages, optimisticSteeredUserTurns)
  const reconciledOptimisticTurns = optimisticSteeredUserTurns.map((turn) => {
    const match = matchedOptimisticTurns.get(turn.id)
    return match && !turn.durableMessageId ? { ...turn, durableMessageId: match.messageId } : turn
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

  const visibleMessages = insertOptimisticSteeredUserTurn(
    hydratedMessages,
    optimisticSteeredUserTurns,
  )

  return {
    visibleMessages,
    previewSteeredUserTurn: (payload: AgentSendPayload, deliveryState: SteerDeliveryState) => {
      const content = buildClientUserMessage(payload)
      const optimisticTurnId = createOptimisticTurnId()
      if (!sessionId) return { clear: () => undefined, setDeliveryState: () => undefined }
      useOptimisticSteerStore.getState().add(sessionId, {
        id: optimisticTurnId,
        content,
        baselineLength: messagesRef.current.length,
        message: createOptimisticUserMessage(content, optimisticTurnId, deliveryState),
      })
      return {
        clear: () => {
          useOptimisticSteerStore.getState().remove(sessionId, optimisticTurnId)
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

function getUIMessageText(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.content)
    .join('\n\n')
}

function indexSteerCandidateMessages(messages: UIMessage[]) {
  const messageIndexById = new Map(messages.map((message, index) => [message.id, index]))
  const userMessageIndexesByContent = new Map<string, number[]>()
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'user') continue
    const content = getUIMessageText(message)
    const indexes = userMessageIndexesByContent.get(content) ?? []
    indexes.push(index)
    userMessageIndexesByContent.set(content, indexes)
  }
  return { messageIndexById, userMessageIndexesByContent }
}

function firstAvailableMessageIndex(
  candidates: readonly number[],
  baselineLength: number,
  consumedMessageIndexes: ReadonlySet<number>,
) {
  return candidates.find(
    (candidateIndex) =>
      candidateIndex >= baselineLength && !consumedMessageIndexes.has(candidateIndex),
  )
}

function matchSteeredUserTurns(
  messages: UIMessage[],
  optimisticSteeredUserTurns: readonly OptimisticSteerPreview[],
): ReadonlyMap<string, { readonly index: number | null; readonly messageId: string }> {
  const matches = new Map<string, { readonly index: number | null; readonly messageId: string }>()
  if (optimisticSteeredUserTurns.length === 0) return matches
  const consumedMessageIndexes = new Set<number>()
  const { messageIndexById, userMessageIndexesByContent } = indexSteerCandidateMessages(messages)

  for (const turn of optimisticSteeredUserTurns) {
    if (!turn.durableMessageId) continue
    const durableIndex = messageIndexById.get(turn.durableMessageId) ?? -1
    if (durableIndex >= 0) consumedMessageIndexes.add(durableIndex)
    matches.set(turn.id, {
      index: durableIndex >= 0 ? durableIndex : null,
      messageId: turn.durableMessageId,
    })
  }

  for (const turn of optimisticSteeredUserTurns) {
    if (turn.durableMessageId) continue
    const matchingIndex = firstAvailableMessageIndex(
      userMessageIndexesByContent.get(turn.content) ?? [],
      turn.baselineLength,
      consumedMessageIndexes,
    )
    if (matchingIndex === undefined) continue
    const matchingMessage = messages[matchingIndex]
    if (!matchingMessage) continue
    matches.set(turn.id, { index: matchingIndex, messageId: matchingMessage.id })
    consumedMessageIndexes.add(matchingIndex)
  }

  return matches
}

function insertOptimisticSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurns: readonly OptimisticSteerPreview[],
): UIMessage[] {
  if (optimisticSteeredUserTurns.length === 0) {
    return messages
  }
  const matches = matchSteeredUserTurns(messages, optimisticSteeredUserTurns)
  let insertedCount = 0
  let insertionFloor = 0

  return optimisticSteeredUserTurns.reduce<UIMessage[]>((current, turn) => {
    const match = matches.get(turn.id)
    if (match) {
      if (match.index !== null) {
        insertionFloor = Math.max(insertionFloor, match.index + insertedCount + 1)
      }
      return current
    }
    const insertionIndex = Math.min(
      Math.max(insertionFloor, turn.baselineLength + insertedCount),
      current.length,
    )
    insertedCount += 1
    insertionFloor = insertionIndex + 1
    return [...current.slice(0, insertionIndex), turn.message, ...current.slice(insertionIndex)]
  }, messages)
}
