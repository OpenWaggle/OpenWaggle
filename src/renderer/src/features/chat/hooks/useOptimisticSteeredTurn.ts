import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage, UIMessageMetadata } from '@shared/types/chat-ui'
import { useState } from 'react'

export type SteerDeliveryState = NonNullable<UIMessageMetadata['steerDelivery']>

export interface OptimisticSteerPreviewController {
  readonly clear: () => void
  readonly setDeliveryState: (state: SteerDeliveryState) => void
}

interface OptimisticSteeredUserTurn {
  readonly id: string
  readonly content: string
  readonly baselineLength: number
  readonly message: UIMessage
  readonly durableMessageId?: string
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
  const [optimisticSteeredUserTurns, setOptimisticSteeredUserTurns] = useState<
    OptimisticSteeredUserTurn[]
  >([])

  // Both clears below adjust state during render (the React-recommended
  // prev-value comparison) rather than in an effect. Routing them through an
  // effect commits one render showing the stale optimistic turn first
  // (react-doctor/no-adjust-state-on-prop-change).
  const [previousSessionId, setPreviousSessionId] = useState(sessionId)
  if (previousSessionId !== sessionId) {
    setPreviousSessionId(sessionId)
    setOptimisticSteeredUserTurns([])
  }

  // Clear optimistic turns as their real steered user messages arrive during
  // the active turn. Native steering does not wait for the session to become idle.
  const matchedOptimisticTurns = matchSteeredUserTurns(hydratedMessages, optimisticSteeredUserTurns)
  const reconciledOptimisticTurns = optimisticSteeredUserTurns.map((turn) => {
    const match = matchedOptimisticTurns.get(turn.id)
    return match && !turn.durableMessageId ? { ...turn, durableMessageId: match.messageId } : turn
  })
  if (reconciledOptimisticTurns.some((turn, index) => turn !== optimisticSteeredUserTurns[index])) {
    setOptimisticSteeredUserTurns(reconciledOptimisticTurns)
  }

  const visibleMessages = insertOptimisticSteeredUserTurn(
    hydratedMessages,
    optimisticSteeredUserTurns,
  )

  return {
    visibleMessages,
    previewSteeredUserTurn: (payload: AgentSendPayload, deliveryState: SteerDeliveryState) => {
      const content = buildClientUserMessage(payload)
      const optimisticTurnId = createOptimisticTurnId()
      setOptimisticSteeredUserTurns((current) => [
        ...current,
        {
          id: optimisticTurnId,
          content,
          baselineLength: messagesRef.current.length,
          message: createOptimisticUserMessage(content, optimisticTurnId, deliveryState),
        },
      ])
      return {
        clear: () => {
          setOptimisticSteeredUserTurns((current) =>
            current.filter((turn) => turn.id !== optimisticTurnId),
          )
        },
        setDeliveryState: (state: SteerDeliveryState) => {
          setOptimisticSteeredUserTurns((current) =>
            current.map((turn) =>
              turn.id === optimisticTurnId
                ? {
                    ...turn,
                    message: { ...turn.message, metadata: { steerDelivery: state } },
                  }
                : turn,
            ),
          )
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

function matchSteeredUserTurns(
  messages: UIMessage[],
  optimisticSteeredUserTurns: readonly OptimisticSteeredUserTurn[],
): ReadonlyMap<string, { readonly index: number | null; readonly messageId: string }> {
  const matches = new Map<string, { readonly index: number | null; readonly messageId: string }>()
  const consumedMessageIndexes = new Set<number>()

  for (const turn of optimisticSteeredUserTurns) {
    if (!turn.durableMessageId) continue
    const durableIndex = messages.findIndex((message) => message.id === turn.durableMessageId)
    if (durableIndex >= 0) consumedMessageIndexes.add(durableIndex)
    matches.set(turn.id, {
      index: durableIndex >= 0 ? durableIndex : null,
      messageId: turn.durableMessageId,
    })
  }

  for (const turn of optimisticSteeredUserTurns) {
    if (turn.durableMessageId) continue
    const matchingIndex = messages.findIndex(
      (message, index) =>
        index >= turn.baselineLength &&
        !consumedMessageIndexes.has(index) &&
        message.role === 'user' &&
        getUIMessageText(message) === turn.content,
    )
    if (matchingIndex < 0) continue
    const matchingMessage = messages[matchingIndex]
    if (!matchingMessage) continue
    matches.set(turn.id, { index: matchingIndex, messageId: matchingMessage.id })
    consumedMessageIndexes.add(matchingIndex)
  }

  return matches
}

function insertOptimisticSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurns: readonly OptimisticSteeredUserTurn[],
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
