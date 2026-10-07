import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { create } from 'zustand'
import { savedSendIds } from '@/features/chat/lib/chat-message-text'
import { releaseMessageImagePreviewUrls } from '@/shared/lib/attachment-preview-urls'

const EMPTY_MESSAGES: readonly UIMessage[] = []

interface OptimisticUserMessageState {
  readonly messagesBySessionId: Map<SessionId, readonly UIMessage[]>
  readonly add: (sessionId: SessionId, message: UIMessage) => void
  readonly remove: (sessionId: SessionId, messageId: UIMessage['id']) => void
  readonly removeMatched: (sessionId: SessionId, persistedMessages: readonly UIMessage[]) => void
  readonly clear: (sessionId: SessionId) => void
}

/** The sends the persisted transcript does not hold yet: one saved before a send is another. */
function removeMatchedMessages(
  optimisticMessages: readonly UIMessage[],
  persistedMessages: readonly UIMessage[],
) {
  const saved = savedSendIds(persistedMessages, optimisticMessages)
  return saved.size === 0
    ? optimisticMessages
    : optimisticMessages.filter((message) => !saved.has(message.id))
}

const nullSelector = (_state: OptimisticUserMessageState) => EMPTY_MESSAGES
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
    selector = (state: OptimisticUserMessageState) =>
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

  remove(sessionId, messageId) {
    set((state) => {
      const existing = state.messagesBySessionId.get(sessionId)
      const removed = existing?.find((message) => message.id === messageId)
      if (!existing || !removed) {
        return state
      }
      releaseMessageImagePreviewUrls(removed)
      const remaining = existing.filter((message) => message !== removed)
      const next = new Map(state.messagesBySessionId)
      if (remaining.length === 0) {
        next.delete(sessionId)
      } else {
        next.set(sessionId, remaining)
      }
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
      for (const message of state.messagesBySessionId.get(sessionId) ?? []) {
        releaseMessageImagePreviewUrls(message)
      }
      next.delete(sessionId)
      return { messagesBySessionId: next }
    })
  },
}))
