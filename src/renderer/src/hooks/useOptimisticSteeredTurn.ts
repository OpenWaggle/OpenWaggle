import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@tanstack/ai-react'
import { useEffect, useRef, useState } from 'react'

interface OptimisticSteeredUserTurn {
  readonly id: string
  readonly content: string
  readonly baselineLength: number
  readonly message: UIMessage
}

interface OptimisticSteeredTurnReturn {
  readonly visibleMessages: UIMessage[]
  readonly previewSteeredUserTurn: (payload: AgentSendPayload) => () => void
}

/**
 * Manages the optimistic steered user turn — an immediate preview
 * of the user's steered message before the server confirms it.
 * Auto-clears when the real message appears in the hydrated messages.
 */
export function useOptimisticSteeredTurn(
  hydratedMessages: UIMessage[],
  conversationId: ConversationId | null,
  isConversationIdle: boolean,
  buildClientUserMessage: (payload: AgentSendPayload) => string,
  messagesRef: React.RefObject<UIMessage[]>,
): OptimisticSteeredTurnReturn {
  const [optimisticSteeredUserTurn, setOptimisticSteeredUserTurn] =
    useState<OptimisticSteeredUserTurn | null>(null)

  const previousConversationIdRef = useRef(conversationId)

  // Clear optimistic turn on conversation switch
  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) {
      return
    }
    previousConversationIdRef.current = conversationId
    setOptimisticSteeredUserTurn(null)
  }, [conversationId])

  // Clear optimistic turn when real message arrives
  useEffect(() => {
    if (!optimisticSteeredUserTurn) {
      return
    }
    if (!isConversationIdle) {
      return
    }
    if (hasMatchingSteeredUserTurn(hydratedMessages, optimisticSteeredUserTurn)) {
      setOptimisticSteeredUserTurn(null)
    }
  }, [hydratedMessages, isConversationIdle, optimisticSteeredUserTurn])

  const visibleMessages = insertOptimisticSteeredUserTurn(
    hydratedMessages,
    optimisticSteeredUserTurn,
  )

  return {
    visibleMessages,
    previewSteeredUserTurn: (payload: AgentSendPayload) => {
      const content = buildClientUserMessage(payload)
      const optimisticTurnId = createOptimisticTurnId()
      setOptimisticSteeredUserTurn({
        id: optimisticTurnId,
        content,
        baselineLength: messagesRef.current.length,
        message: createOptimisticUserMessage(content, optimisticTurnId),
      })
      return () => {
        setOptimisticSteeredUserTurn((current) =>
          current?.id === optimisticTurnId ? null : current,
        )
      }
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function createOptimisticTurnId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') {
    return randomUUID.call(globalThis.crypto)
  }
  return `optimistic-steer-${Date.now()}`
}

function createOptimisticUserMessage(content: string, id: string): UIMessage {
  return {
    id: `optimistic-steer-${id}`,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(),
  }
}

function getUIMessageText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.content)
    .join('\n\n')
}

function hasMatchingSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurn: OptimisticSteeredUserTurn,
): boolean {
  const suffix = messages.slice(optimisticSteeredUserTurn.baselineLength)
  return suffix.some(
    (message) =>
      message.role === 'user' && getUIMessageText(message) === optimisticSteeredUserTurn.content,
  )
}

function insertOptimisticSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurn: OptimisticSteeredUserTurn | null,
): UIMessage[] {
  if (!optimisticSteeredUserTurn) {
    return messages
  }
  if (hasMatchingSteeredUserTurn(messages, optimisticSteeredUserTurn)) {
    return messages
  }

  const prefix = messages.slice(0, optimisticSteeredUserTurn.baselineLength)
  const suffix = messages.slice(optimisticSteeredUserTurn.baselineLength)
  return [...prefix, optimisticSteeredUserTurn.message, ...suffix]
}
