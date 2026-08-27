import type { AgentSendPayload } from '@shared/types/agent'
import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleConfig } from '@shared/types/waggle'
import { create } from 'zustand'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { api } from '@/shared/lib/ipc'
import {
  loadRecoverableBackgroundRuns,
  persistRecoverableBackgroundRuns,
} from './background-run-recovery-storage'

interface ActiveRunRenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly updatedAt: number
}

export interface FirstSendRecovery {
  readonly payload: AgentSendPayload
  readonly waggleConfig: WaggleConfig | null
  readonly model: SupportedModelId
}

interface BackgroundRunState {
  activeRunIds: Set<SessionId>
  renderSnapshotsBySessionId: Map<SessionId, ActiveRunRenderSnapshot>
  worktreeLaunchBySessionId: Map<SessionId, WorktreeLaunchSnapshot>
  firstSendRecoveryBySessionId: Map<SessionId, FirstSendRecovery>
  addActiveRun: (id: SessionId) => void
  removeActiveRun: (id: SessionId) => void
  hasActiveRun: (id: SessionId) => boolean
  getRunRenderSnapshot: (id: SessionId) => ActiveRunRenderSnapshot | null
  setRunRenderMessages: (id: SessionId, messages: readonly UIMessage[]) => void
  applyRunRenderEvent: (id: SessionId, event: AgentTransportEvent) => void
  clearRunRenderSnapshot: (id: SessionId) => void
  getWorktreeLaunch: (id: SessionId) => WorktreeLaunchSnapshot | null
  setWorktreeLaunch: (id: SessionId, launch: WorktreeLaunchSnapshot | null) => void
  setFirstSendRecovery: (id: SessionId, recovery: FirstSendRecovery | null) => void
  initialize: () => Promise<void>
}

export const useBackgroundRunStore = create<BackgroundRunState>((set, get) => ({
  activeRunIds: new Set<SessionId>(),
  renderSnapshotsBySessionId: new Map<SessionId, ActiveRunRenderSnapshot>(),
  worktreeLaunchBySessionId: new Map<SessionId, WorktreeLaunchSnapshot>(),
  firstSendRecoveryBySessionId: new Map<SessionId, FirstSendRecovery>(),

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

  getWorktreeLaunch(id: SessionId) {
    return get().worktreeLaunchBySessionId.get(id) ?? null
  },

  setWorktreeLaunch(id: SessionId, launch: WorktreeLaunchSnapshot | null) {
    set((state) => {
      const next = new Map(state.worktreeLaunchBySessionId)
      if (launch === null) {
        next.delete(id)
      } else {
        next.set(id, launch)
      }
      persistRecoverableBackgroundRuns({
        launches: next,
        recoveries: state.firstSendRecoveryBySessionId,
      })
      return { worktreeLaunchBySessionId: next }
    })
  },

  setFirstSendRecovery(id: SessionId, recovery: FirstSendRecovery | null) {
    set((state) => {
      const next = new Map(state.firstSendRecoveryBySessionId)
      if (recovery === null) {
        next.delete(id)
      } else {
        next.set(id, recovery)
      }
      persistRecoverableBackgroundRuns({
        launches: state.worktreeLaunchBySessionId,
        recoveries: next,
      })
      return { firstSendRecoveryBySessionId: next }
    })
  },

  async initialize() {
    const persisted = loadRecoverableBackgroundRuns()
    const runs = await api.listActiveRuns()
    const ids = new Set<SessionId>(runs.map((r) => r.sessionId))
    const snapshots = await Promise.all(runs.map((run) => api.getBackgroundRun(run.sessionId)))
    const launches = new Map(persisted.launches)
    for (const snapshot of snapshots) {
      if (snapshot?.worktreeLaunch) {
        launches.set(snapshot.sessionId, snapshot.worktreeLaunch)
      }
    }
    set({
      activeRunIds: ids,
      worktreeLaunchBySessionId: launches,
      firstSendRecoveryBySessionId: persisted.recoveries,
    })
  },
}))
