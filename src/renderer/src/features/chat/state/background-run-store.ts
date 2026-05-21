import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { create } from 'zustand'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { api } from '@/shared/lib/ipc'

interface ActiveRunRenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly updatedAt: number
}

interface BackgroundRunState {
  activeRunIds: Set<SessionId>
  renderSnapshotsBySessionId: Map<SessionId, ActiveRunRenderSnapshot>
  addActiveRun: (id: SessionId) => void
  removeActiveRun: (id: SessionId) => void
  hasActiveRun: (id: SessionId) => boolean
  getRunRenderSnapshot: (id: SessionId) => ActiveRunRenderSnapshot | null
  setRunRenderMessages: (id: SessionId, messages: readonly UIMessage[]) => void
  applyRunRenderEvent: (id: SessionId, event: AgentTransportEvent) => void
  clearRunRenderSnapshot: (id: SessionId) => void
  initialize: () => Promise<void>
}

export const useBackgroundRunStore = create<BackgroundRunState>((set, get) => ({
  activeRunIds: new Set<SessionId>(),
  renderSnapshotsBySessionId: new Map<SessionId, ActiveRunRenderSnapshot>(),

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

  hasActiveRun(id: SessionId) {
    return get().activeRunIds.has(id)
  },

  getRunRenderSnapshot(id: SessionId) {
    return get().renderSnapshotsBySessionId.get(id) ?? null
  },

  setRunRenderMessages(id: SessionId, messages: readonly UIMessage[]) {
    set((state) => {
      const next = new Map(state.renderSnapshotsBySessionId)
      next.set(id, {
        messages: [...messages],
        updatedAt: Date.now(),
      })
      return { renderSnapshotsBySessionId: next }
    })
  },

  applyRunRenderEvent(id: SessionId, event: AgentTransportEvent) {
    set((state) => {
      const existing = state.renderSnapshotsBySessionId.get(id)
      if (!existing) {
        return state
      }
      const next = new Map(state.renderSnapshotsBySessionId)
      next.set(id, {
        messages: applyAgentTransportEvent([...existing.messages], event),
        updatedAt: Date.now(),
      })
      return { renderSnapshotsBySessionId: next }
    })
  },

  clearRunRenderSnapshot(id: SessionId) {
    set((state) => {
      if (!state.renderSnapshotsBySessionId.has(id)) return state
      const next = new Map(state.renderSnapshotsBySessionId)
      next.delete(id)
      return { renderSnapshotsBySessionId: next }
    })
  },

  async initialize() {
    const runs = await api.listActiveRuns()
    const ids = new Set<SessionId>(runs.map((r) => r.sessionId))
    set({ activeRunIds: ids })
  },
}))
