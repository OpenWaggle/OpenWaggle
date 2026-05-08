import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { create } from 'zustand'

const EMPTY_MESSAGES: readonly UIMessage[] = []

interface OptimisticUserMessageState {
  readonly messagesBySessionId: Map<SessionId, readonly UIMessage[]>
  readonly add: (sessionId: SessionId, message: UIMessage) => void
  readonly removeMatched: (sessionId: SessionId, persistedMessages: readonly UIMessage[]) => void
  readonly clear: (sessionId: SessionId) => void
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
  SessionId,
  (state: OptimisticUserMessageState) => readonly UIMessage[]
>()

export function selectOptimisticUserMessages(sessionId: SessionId | null) {
  if (!sessionId) {
    return nullSelector
  }

  let selector = selectorCache.get(sessionId)
  if (!selector) {
    selector = (state: OptimisticUserMessageState): readonly UIMessage[] =>
      state.messagesBySessionId.get(sessionId) ?? EMPTY_MESSAGES
    selectorCache.set(sessionId, selector)
  }
  return selector
}

export const useOptimisticUserMessageStore = create<OptimisticUserMessageState>((set) => ({
  messagesBySessionId: new Map(),

  add(sessionId, message) {
    set((state) => {
      const existing = state.messagesBySessionId.get(sessionId) ?? EMPTY_MESSAGES
      if (existing.some((candidate) => candidate.id === message.id)) {
        return state
      }

      const next = new Map(state.messagesBySessionId)
      next.set(sessionId, [...existing, message])
      return { messagesBySessionId: next }
    })
  },

  removeMatched(sessionId, persistedMessages) {
    set((state) => {
      const existing = state.messagesBySessionId.get(sessionId)
      if (!existing) {
        return state
      }

      const remaining = removeMatchedMessages(existing, persistedMessages)
      if (remaining.length === existing.length) {
        return state
      }

      const next = new Map(state.messagesBySessionId)
      if (remaining.length === 0) {
        next.delete(sessionId)
      } else {
        next.set(sessionId, remaining)
      }
      return { messagesBySessionId: next }
    })
  },

  clear(sessionId) {
    set((state) => {
      if (!state.messagesBySessionId.has(sessionId)) {
        return state
      }
      const next = new Map(state.messagesBySessionId)
      next.delete(sessionId)
      return { messagesBySessionId: next }
    })
  },
}))
