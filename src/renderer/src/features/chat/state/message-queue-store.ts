import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'

export interface QueuedMessage {
  readonly id: string
  readonly payload: AgentSendPayload
  readonly queuedAt: number
  readonly queueOrder: number
}

export interface TakenQueuedMessage {
  readonly item: QueuedMessage
  readonly index: number
  readonly previousId: string | null
  readonly nextId: string | null
}

interface MessageQueueState {
  queues: Map<SessionId, QueuedMessage[]>
  enqueue: (sessionId: SessionId, payload: AgentSendPayload) => void
  dequeue: (sessionId: SessionId) => QueuedMessage | null
  take: (sessionId: SessionId, messageId: string) => TakenQueuedMessage | null
  restore: (sessionId: SessionId, taken: TakenQueuedMessage) => void
  dismiss: (sessionId: SessionId, messageId: string) => void
  promoteToFront: (sessionId: SessionId, messageId: string) => void
  clearQueue: (sessionId: SessionId) => void
}

const EMPTY_QUEUE: readonly QueuedMessage[] = []
let nextQueueOrder = 0

const nullSelector = (_state: MessageQueueState) => EMPTY_QUEUE
const selectorCache = new Map<SessionId, (state: MessageQueueState) => readonly QueuedMessage[]>()

export function selectQueue(sessionId: SessionId | null) {
  if (!sessionId) return nullSelector
  let selector = selectorCache.get(sessionId)
  if (!selector) {
    selector = (state: MessageQueueState) => state.queues.get(sessionId) ?? EMPTY_QUEUE
    selectorCache.set(sessionId, selector)
  }
  return selector
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queues: new Map(),

  enqueue(sessionId, payload) {
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      payload,
      queuedAt: Date.now(),
      queueOrder: nextQueueOrder++,
    }
    set((state) => {
      const next = new Map(state.queues)
      const existing = next.get(sessionId) ?? []
      next.set(sessionId, [...existing, item])
      return { queues: next }
    })
  },

  dequeue(sessionId) {
    const queue = get().queues.get(sessionId)
    if (!queue || queue.length === 0) return null
    const [first, ...rest] = queue
    set((state) => {
      const next = new Map(state.queues)
      if (rest.length === 0) {
        next.delete(sessionId)
      } else {
        next.set(sessionId, rest)
      }
      return { queues: next }
    })
    return first
  },

  take(sessionId, messageId) {
    const queue = get().queues.get(sessionId)
    if (!queue) return null
    const index = queue.findIndex((item) => item.id === messageId)
    if (index < 0) return null
    const item = queue[index]
    if (!item) return null
    set((state) => {
      const next = new Map(state.queues)
      const remaining = queue.filter((candidate) => candidate.id !== messageId)
      if (remaining.length === 0) next.delete(sessionId)
      else next.set(sessionId, remaining)
      return { queues: next }
    })
    return {
      item,
      index,
      previousId: queue[index - 1]?.id ?? null,
      nextId: queue[index + 1]?.id ?? null,
    }
  },

  restore(sessionId, taken) {
    set((state) => {
      const next = new Map(state.queues)
      const queue = next.get(sessionId) ?? []
      if (queue.some((candidate) => candidate.id === taken.item.id)) return state
      next.set(
        sessionId,
        [...queue, taken.item].sort((left, right) => left.queueOrder - right.queueOrder),
      )
      return { queues: next }
    })
  },

  dismiss(sessionId, messageId) {
    set((state) => {
      const queue = state.queues.get(sessionId)
      if (!queue) return state
      const filtered = queue.filter((item) => item.id !== messageId)
      const next = new Map(state.queues)
      if (filtered.length === 0) {
        next.delete(sessionId)
      } else {
        next.set(sessionId, filtered)
      }
      return { queues: next }
    })
  },

  promoteToFront(sessionId, messageId) {
    set((state) => {
      const queue = state.queues.get(sessionId)
      if (!queue) return state
      const index = queue.findIndex((item) => item.id === messageId)
      if (index <= 0) return state
      const item = queue[index]
      const next = new Map(state.queues)
      next.set(sessionId, [item, ...queue.slice(0, index), ...queue.slice(index + 1)])
      return { queues: next }
    })
  },

  clearQueue(sessionId) {
    set((state) => {
      const next = new Map(state.queues)
      next.delete(sessionId)
      return { queues: next }
    })
  },
}))
