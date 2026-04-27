import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { create } from 'zustand'

const EMPTY_MESSAGES: readonly UIMessage[] = []

interface OptimisticUserMessageState {
  readonly messagesByConversationId: Map<ConversationId, readonly UIMessage[]>
  readonly add: (conversationId: ConversationId, message: UIMessage) => void
  readonly removeMatched: (
    conversationId: ConversationId,
    persistedMessages: readonly UIMessage[],
  ) => void
  readonly clear: (conversationId: ConversationId) => void
}

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.content)
    .join('\n\n')
}

function buildUserTextCounts(messages: readonly UIMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }
    const text = getTextContent(message)
    if (!text) {
      continue
    }
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  return counts
}

function removeMatchedMessages(
  optimisticMessages: readonly UIMessage[],
  persistedMessages: readonly UIMessage[],
): readonly UIMessage[] {
  const persistedCounts = buildUserTextCounts(persistedMessages)
  if (persistedCounts.size === 0) {
    return optimisticMessages
  }

  const remaining: UIMessage[] = []
  for (const message of optimisticMessages) {
    const text = getTextContent(message)
    const count = persistedCounts.get(text) ?? 0
    if (count > 0) {
      persistedCounts.set(text, count - 1)
      continue
    }
    remaining.push(message)
  }
  return remaining
}

const nullSelector = (_state: OptimisticUserMessageState): readonly UIMessage[] => EMPTY_MESSAGES
const selectorCache = new Map<
  ConversationId,
  (state: OptimisticUserMessageState) => readonly UIMessage[]
>()

export function selectOptimisticUserMessages(conversationId: ConversationId | null) {
  if (!conversationId) {
    return nullSelector
  }

  let selector = selectorCache.get(conversationId)
  if (!selector) {
    selector = (state: OptimisticUserMessageState): readonly UIMessage[] =>
      state.messagesByConversationId.get(conversationId) ?? EMPTY_MESSAGES
    selectorCache.set(conversationId, selector)
  }
  return selector
}

export const useOptimisticUserMessageStore = create<OptimisticUserMessageState>((set) => ({
  messagesByConversationId: new Map(),

  add(conversationId, message) {
    set((state) => {
      const existing = state.messagesByConversationId.get(conversationId) ?? EMPTY_MESSAGES
      if (existing.some((candidate) => candidate.id === message.id)) {
        return state
      }

      const next = new Map(state.messagesByConversationId)
      next.set(conversationId, [...existing, message])
      return { messagesByConversationId: next }
    })
  },

  removeMatched(conversationId, persistedMessages) {
    set((state) => {
      const existing = state.messagesByConversationId.get(conversationId)
      if (!existing) {
        return state
      }

      const remaining = removeMatchedMessages(existing, persistedMessages)
      if (remaining.length === existing.length) {
        return state
      }

      const next = new Map(state.messagesByConversationId)
      if (remaining.length === 0) {
        next.delete(conversationId)
      } else {
        next.set(conversationId, remaining)
      }
      return { messagesByConversationId: next }
    })
  },

  clear(conversationId) {
    set((state) => {
      if (!state.messagesByConversationId.has(conversationId)) {
        return state
      }
      const next = new Map(state.messagesByConversationId)
      next.delete(conversationId)
      return { messagesByConversationId: next }
    })
  },
}))
