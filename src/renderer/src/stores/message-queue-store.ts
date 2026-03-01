import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import { create } from 'zustand'

export interface QueuedMessage {
  readonly id: string
  readonly payload: AgentSendPayload
  readonly queuedAt: number
}

interface MessageQueueState {
  queues: Map<ConversationId, QueuedMessage[]>
  enqueue: (conversationId: ConversationId, payload: AgentSendPayload) => void
  dequeue: (conversationId: ConversationId) => QueuedMessage | null
  dismiss: (conversationId: ConversationId, messageId: string) => void
  promoteToFront: (conversationId: ConversationId, messageId: string) => void
  clearQueue: (conversationId: ConversationId) => void
}

const EMPTY_QUEUE: readonly QueuedMessage[] = []

const nullSelector = (_state: MessageQueueState): readonly QueuedMessage[] => EMPTY_QUEUE
const selectorCache = new Map<
  ConversationId,
  (state: MessageQueueState) => readonly QueuedMessage[]
>()

export function selectQueue(conversationId: ConversationId | null) {
  if (!conversationId) return nullSelector
  let selector = selectorCache.get(conversationId)
  if (!selector) {
    selector = (state: MessageQueueState): readonly QueuedMessage[] =>
      state.queues.get(conversationId) ?? EMPTY_QUEUE
    selectorCache.set(conversationId, selector)
  }
  return selector
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queues: new Map(),

  enqueue(conversationId, payload) {
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      payload,
      queuedAt: Date.now(),
    }
    set((state) => {
      const next = new Map(state.queues)
      const existing = next.get(conversationId) ?? []
      next.set(conversationId, [...existing, item])
      return { queues: next }
    })
  },

  dequeue(conversationId) {
    const queue = get().queues.get(conversationId)
    if (!queue || queue.length === 0) return null
    const [first, ...rest] = queue
    set((state) => {
      const next = new Map(state.queues)
      if (rest.length === 0) {
        next.delete(conversationId)
      } else {
        next.set(conversationId, rest)
      }
      return { queues: next }
    })
    return first
  },

  dismiss(conversationId, messageId) {
    set((state) => {
      const queue = state.queues.get(conversationId)
      if (!queue) return state
      const filtered = queue.filter((item) => item.id !== messageId)
      const next = new Map(state.queues)
      if (filtered.length === 0) {
        next.delete(conversationId)
      } else {
        next.set(conversationId, filtered)
      }
      return { queues: next }
    })
  },

  promoteToFront(conversationId, messageId) {
    set((state) => {
      const queue = state.queues.get(conversationId)
      if (!queue) return state
      const index = queue.findIndex((item) => item.id === messageId)
      if (index <= 0) return state
      const item = queue[index]
      const next = new Map(state.queues)
      next.set(conversationId, [item, ...queue.slice(0, index), ...queue.slice(index + 1)])
      return { queues: next }
    })
  },

  clearQueue(conversationId) {
    set((state) => {
      const next = new Map(state.queues)
      next.delete(conversationId)
      return { queues: next }
    })
  },
}))
