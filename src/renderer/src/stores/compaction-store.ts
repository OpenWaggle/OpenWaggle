import type { ConversationId } from '@shared/types/brand'
import type { CompactionStage } from '@shared/types/compaction'
import { create } from 'zustand'

const AUTO_DISMISS_DELAY_MS = 3500

export interface CompactionStatus {
  readonly stage: CompactionStage
  readonly description: string
  readonly metrics?: {
    readonly tokensBefore: number
    readonly tokensAfter: number
    readonly messagesSummarized: number
  }
  readonly errorMessage?: string
  readonly updatedAt: number
}

interface CompactionState {
  statuses: Map<ConversationId, CompactionStatus>
  setStatus: (id: ConversationId, status: CompactionStatus) => void
  clearStatus: (id: ConversationId) => void
}

const autoDismissTimers = new Map<ConversationId, ReturnType<typeof setTimeout>>()

export const useCompactionStore = create<CompactionState>((set) => ({
  statuses: new Map<ConversationId, CompactionStatus>(),

  setStatus(id: ConversationId, status: CompactionStatus) {
    // Clear any existing auto-dismiss timer for this conversation
    const existing = autoDismissTimers.get(id)
    if (existing) {
      clearTimeout(existing)
      autoDismissTimers.delete(id)
    }

    set((state) => {
      const next = new Map(state.statuses)
      next.set(id, status)
      return { statuses: next }
    })

    // Auto-dismiss completed status after delay
    if (status.stage === 'completed') {
      const timer = setTimeout(() => {
        autoDismissTimers.delete(id)
        set((state) => {
          const current = state.statuses.get(id)
          // Only clear if still showing the completed state
          if (current?.stage !== 'completed') return state
          const next = new Map(state.statuses)
          next.delete(id)
          return { statuses: next }
        })
      }, AUTO_DISMISS_DELAY_MS)
      autoDismissTimers.set(id, timer)
    }
  },

  clearStatus(id: ConversationId) {
    const existing = autoDismissTimers.get(id)
    if (existing) {
      clearTimeout(existing)
      autoDismissTimers.delete(id)
    }

    set((state) => {
      if (!state.statuses.has(id)) return state
      const next = new Map(state.statuses)
      next.delete(id)
      return { statuses: next }
    })
  },
}))

/** Clear all pending auto-dismiss timers. Call on app cleanup. */
export function clearAllCompactionTimers(): void {
  for (const timer of autoDismissTimers.values()) {
    clearTimeout(timer)
  }
  autoDismissTimers.clear()
}

/** Stable selector factory — returns undefined when no active compaction. */
export function selectCompaction(conversationId: ConversationId | null) {
  return (state: CompactionState): CompactionStatus | undefined => {
    if (!conversationId) return undefined
    return state.statuses.get(conversationId)
  }
}
