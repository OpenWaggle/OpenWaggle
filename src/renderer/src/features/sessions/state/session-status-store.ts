import type { SessionId } from '@shared/types/brand'
import type { AgentPhaseLabel } from '@shared/types/phase'
import { type SessionStatus, TERMINAL_STATUSES } from '@shared/types/session-status'
import { create } from 'zustand'

interface SessionStatusState {
  statuses: Map<SessionId, SessionStatus>
  /** When a terminal status (completed/error) was recorded */
  completedAt: Map<SessionId, number>
  /** When the user last visited (navigated to) a session */
  lastVisitedAt: Map<SessionId, number>
  /**
   * What the agent is doing right now, per session.
   *
   * The `agent:phase` event already crossed IPC and was used only as a liveness signal,
   * then discarded. Keeping it lets a sidebar row say "Refactoring" instead of repeating
   * "Working", which is the difference between knowing a session is alive and knowing what
   * it is alive doing. Cleared whenever a run reaches a terminal status.
   */
  phases: Map<SessionId, AgentPhaseLabel>

  setStatus: (id: SessionId, status: SessionStatus) => void
  clearStatus: (id: SessionId) => void
  getStatus: (id: SessionId) => SessionStatus
  setPhase: (id: SessionId, phase: AgentPhaseLabel | null) => void
  getPhase: (id: SessionId) => AgentPhaseLabel | null
  markVisited: (id: SessionId) => void
  markUnread: (id: SessionId) => void
}

export const useSessionStatusStore = create<SessionStatusState>((set, get) => ({
  statuses: new Map<SessionId, SessionStatus>(),
  completedAt: new Map<SessionId, number>(),
  lastVisitedAt: new Map<SessionId, number>(),
  phases: new Map<SessionId, AgentPhaseLabel>(),

  setStatus(id: SessionId, status: SessionStatus) {
    set((state) => {
      const next: Partial<SessionStatusState> = {}

      // Update statuses map
      if (state.statuses.get(id) !== status) {
        const nextStatuses = new Map(state.statuses)
        if (status === 'idle') {
          nextStatuses.delete(id)
        } else {
          nextStatuses.set(id, status)
        }
        next.statuses = nextStatuses
      }

      // Update completedAt based on status category
      const isTerminal = TERMINAL_STATUSES.has(status)
      if (isTerminal) {
        // Terminal -> record completion time
        const nextCompleted = new Map(state.completedAt)
        nextCompleted.set(id, Date.now())
        next.completedAt = nextCompleted
      }
      if (!isTerminal && state.completedAt.has(id)) {
        // Live or idle -> clear completion (session is active again or reset)
        const nextCompleted = new Map(state.completedAt)
        nextCompleted.delete(id)
        next.completedAt = nextCompleted
      }

      // A finished run has no current phase, so a stale label never outlives it.
      if (isTerminal && state.phases.has(id)) {
        const nextPhases = new Map(state.phases)
        nextPhases.delete(id)
        next.phases = nextPhases
      }

      // If nothing changed, bail
      if (Object.keys(next).length === 0) return state
      return { ...state, ...next }
    })
  },

  clearStatus(id: SessionId) {
    set((state) => {
      if (!state.statuses.has(id) && !state.phases.has(id)) return state
      const next = new Map(state.statuses)
      next.delete(id)
      const nextCompleted = new Map(state.completedAt)
      nextCompleted.delete(id)
      const nextPhases = new Map(state.phases)
      nextPhases.delete(id)
      return { statuses: next, completedAt: nextCompleted, phases: nextPhases }
    })
  },

  getStatus(id: SessionId) {
    return get().statuses.get(id) ?? 'idle'
  },

  setPhase(id: SessionId, phase: AgentPhaseLabel | null) {
    set((state) => {
      const current = state.phases.get(id) ?? null
      if (current === phase) return state
      const nextPhases = new Map(state.phases)
      if (phase === null) nextPhases.delete(id)
      else nextPhases.set(id, phase)
      return { phases: nextPhases }
    })
  },

  getPhase(id: SessionId) {
    return get().phases.get(id) ?? null
  },

  markVisited(id: SessionId) {
    set((state) => {
      const nextVisited = new Map(state.lastVisitedAt)
      nextVisited.set(id, Date.now())
      return { lastVisitedAt: nextVisited }
    })
  },

  markUnread(id: SessionId) {
    set((state) => {
      const completed = state.completedAt.get(id) ?? Date.now()
      const nextVisited = new Map(state.lastVisitedAt)
      nextVisited.set(id, completed - 1)
      return { lastVisitedAt: nextVisited }
    })
  },
}))
