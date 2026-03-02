import type { ConversationId } from '@shared/types/brand'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface BackgroundRunState {
  activeRunIds: Set<ConversationId>
  addActiveRun: (id: ConversationId) => void
  removeActiveRun: (id: ConversationId) => void
  hasActiveRun: (id: ConversationId) => boolean
  initialize: () => Promise<void>
}

export const useBackgroundRunStore = create<BackgroundRunState>((set, get) => ({
  activeRunIds: new Set<ConversationId>(),

  addActiveRun(id: ConversationId) {
    set((state) => {
      if (state.activeRunIds.has(id)) return state
      const next = new Set(state.activeRunIds)
      next.add(id)
      return { activeRunIds: next }
    })
  },

  removeActiveRun(id: ConversationId) {
    set((state) => {
      if (!state.activeRunIds.has(id)) return state
      const next = new Set(state.activeRunIds)
      next.delete(id)
      return { activeRunIds: next }
    })
  },

  hasActiveRun(id: ConversationId): boolean {
    return get().activeRunIds.has(id)
  },

  async initialize() {
    const runs = await api.listActiveRuns()
    const ids = new Set<ConversationId>(runs.map((r) => r.conversationId))
    set({ activeRunIds: ids })
  },
}))
