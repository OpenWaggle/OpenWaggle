import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface BackgroundRunState {
  activeRunIds: Set<SessionId>
  addActiveRun: (id: SessionId) => void
  removeActiveRun: (id: SessionId) => void
  hasActiveRun: (id: SessionId) => boolean
  initialize: () => Promise<void>
}

export const useBackgroundRunStore = create<BackgroundRunState>((set, get) => ({
  activeRunIds: new Set<SessionId>(),

  addActiveRun(id: SessionId) {
    set((state) => {
      if (state.activeRunIds.has(id)) return state
      const next = new Set(state.activeRunIds)
      next.add(id)
      return { activeRunIds: next }
    })
  },

  removeActiveRun(id: SessionId) {
    set((state) => {
      if (!state.activeRunIds.has(id)) return state
      const next = new Set(state.activeRunIds)
      next.delete(id)
      return { activeRunIds: next }
    })
  },

  hasActiveRun(id: SessionId): boolean {
    return get().activeRunIds.has(id)
  },

  async initialize() {
    const runs = await api.listActiveRuns()
    const ids = new Set<SessionId>(runs.map((r) => r.sessionId))
    set({ activeRunIds: ids })
  },
}))
