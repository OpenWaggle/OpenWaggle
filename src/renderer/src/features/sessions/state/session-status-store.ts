import { match } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { AgentPhaseLabel } from '@shared/types/phase'
import type { SessionSummary } from '@shared/types/session'
import { type SessionStatus, TERMINAL_STATUSES } from '@shared/types/session-status'
import { create, type StateCreator } from 'zustand'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('session-status-store')

function persistLastVisitedAt(id: SessionId, lastVisitedAt: number) {
  if (typeof api.updateSessionTreeUiState !== 'function') return
  void api.updateSessionTreeUiState(id, { lastVisitedAt }).catch((error: unknown) => {
    logger.error('Failed to persist Session read receipt', {
      sessionId: String(id),
      error: String(error),
    })
  })
}

interface SessionStatusState {
  statuses: Map<SessionId, SessionStatus>
  /** When a terminal status (completed/error) was recorded */
  completedAt: Map<SessionId, number>
  /** Source timestamp of the latest status projection, used to reject stale catalog pages. */
  statusUpdatedAt: Map<SessionId, number>
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

  setStatus: (id: SessionId, status: SessionStatus, updatedAt?: number) => void
  hydratePersistedStatuses: (sessions: readonly SessionSummary[]) => void
  clearStatus: (id: SessionId) => void
  getStatus: (id: SessionId) => SessionStatus
  setPhase: (id: SessionId, phase: AgentPhaseLabel | null) => void
  getPhase: (id: SessionId) => AgentPhaseLabel | null
  markVisited: (id: SessionId) => void
  markUnread: (id: SessionId) => void
}

function updateStatusState(
  state: SessionStatusState,
  id: SessionId,
  status: SessionStatus,
  updatedAt: number,
) {
  const previousUpdatedAt = state.statusUpdatedAt.get(id)
  if (previousUpdatedAt !== undefined && previousUpdatedAt > updatedAt) return state
  const next: Partial<SessionStatusState> = {}

  if (previousUpdatedAt !== updatedAt) {
    const statusUpdatedAt = new Map(state.statusUpdatedAt)
    statusUpdatedAt.set(id, updatedAt)
    next.statusUpdatedAt = statusUpdatedAt
  }
  if (state.statuses.get(id) !== status) {
    const statuses = new Map(state.statuses)
    if (status === 'idle') statuses.delete(id)
    else statuses.set(id, status)
    next.statuses = statuses
  }

  const isTerminal = TERMINAL_STATUSES.has(status)
  if (isTerminal) {
    const completedAt = new Map(state.completedAt)
    completedAt.set(id, updatedAt)
    next.completedAt = completedAt
  }
  if (!isTerminal && state.completedAt.has(id)) {
    const completedAt = new Map(state.completedAt)
    completedAt.delete(id)
    next.completedAt = completedAt
  }
  if (isTerminal && state.phases.has(id)) {
    const phases = new Map(state.phases)
    phases.delete(id)
    next.phases = phases
  }
  return Object.keys(next).length === 0 ? state : { ...state, ...next }
}

function statusForPersistedSession(session: SessionSummary): SessionStatus {
  if (session.pendingInteractionAt !== undefined) return 'awaiting-input'
  if (!session.latestRun) return 'idle'
  return match(session.latestRun.status)
    .with('starting', () => 'connecting' as const)
    .with('active', 'stopping', () => 'working' as const)
    .with('completed', () => 'completed' as const)
    .with('failed', () => 'error' as const)
    .with(
      'interrupted',
      'interrupted-by-host-loss',
      'interrupted-by-interaction-timeout',
      () => 'idle' as const,
    )
    .exhaustive()
}

interface HydrationMaps {
  readonly statuses: Map<SessionId, SessionStatus>
  readonly completedAt: Map<SessionId, number>
  readonly statusUpdatedAt: Map<SessionId, number>
  readonly lastVisitedAt: Map<SessionId, number>
  readonly phases: Map<SessionId, AgentPhaseLabel>
}

function hydrateReceipt(maps: HydrationMaps, session: SessionSummary) {
  const persistedVisitedAt = session.treeUiState?.lastVisitedAt
  if (persistedVisitedAt === undefined || maps.lastVisitedAt.has(session.id)) return false
  maps.lastVisitedAt.set(session.id, persistedVisitedAt)
  return true
}

function updateProjectedStatus(
  maps: HydrationMaps,
  session: SessionSummary,
  status: SessionStatus,
  projectedAt: number,
) {
  let changed = false
  const currentStatus = maps.statuses.get(session.id) ?? 'idle'
  if (currentStatus !== status) {
    if (status === 'idle') maps.statuses.delete(session.id)
    else maps.statuses.set(session.id, status)
    changed = true
  }
  if (maps.statusUpdatedAt.get(session.id) !== projectedAt) {
    maps.statusUpdatedAt.set(session.id, projectedAt)
    changed = true
  }
  return changed
}

function updateProjectedCompletion(
  maps: HydrationMaps,
  sessionId: SessionId,
  status: SessionStatus,
  projectedAt: number,
) {
  if (!TERMINAL_STATUSES.has(status)) return maps.completedAt.delete(sessionId)
  let changed = false
  if (maps.completedAt.get(sessionId) !== projectedAt) {
    maps.completedAt.set(sessionId, projectedAt)
    changed = true
  }
  return maps.phases.delete(sessionId) || changed
}

function hydratePersistedSession(maps: HydrationMaps, session: SessionSummary) {
  let changed = hydrateReceipt(maps, session)
  const projectedAt = Math.max(session.latestRun?.updatedAt ?? 0, session.pendingInteractionAt ?? 0)
  if (projectedAt === 0 || (maps.statusUpdatedAt.get(session.id) ?? -1) > projectedAt) {
    return changed
  }
  const status = statusForPersistedSession(session)
  changed = updateProjectedStatus(maps, session, status, projectedAt) || changed
  return updateProjectedCompletion(maps, session.id, status, projectedAt) || changed
}

function hydratePersistedState(state: SessionStatusState, sessions: readonly SessionSummary[]) {
  const maps: HydrationMaps = {
    statuses: new Map(state.statuses),
    completedAt: new Map(state.completedAt),
    statusUpdatedAt: new Map(state.statusUpdatedAt),
    lastVisitedAt: new Map(state.lastVisitedAt),
    phases: new Map(state.phases),
  }
  let changed = false
  for (const session of sessions) changed = hydratePersistedSession(maps, session) || changed
  return changed ? { ...state, ...maps } : state
}

function clearStatusState(state: SessionStatusState, id: SessionId) {
  if (
    !state.statuses.has(id) &&
    !state.completedAt.has(id) &&
    !state.statusUpdatedAt.has(id) &&
    !state.phases.has(id)
  ) {
    return state
  }
  const statuses = new Map(state.statuses)
  const completedAt = new Map(state.completedAt)
  const statusUpdatedAt = new Map(state.statusUpdatedAt)
  const phases = new Map(state.phases)
  statuses.delete(id)
  completedAt.delete(id)
  statusUpdatedAt.delete(id)
  phases.delete(id)
  return { ...state, statuses, completedAt, statusUpdatedAt, phases }
}

function updatePhaseState(state: SessionStatusState, id: SessionId, phase: AgentPhaseLabel | null) {
  if ((state.phases.get(id) ?? null) === phase) return state
  const phases = new Map(state.phases)
  if (phase === null) phases.delete(id)
  else phases.set(id, phase)
  return { ...state, phases }
}

function updateVisitedState(state: SessionStatusState, id: SessionId, visitedAt: number) {
  const lastVisitedAt = new Map(state.lastVisitedAt)
  lastVisitedAt.set(id, visitedAt)
  return { ...state, lastVisitedAt }
}

const createSessionStatusState: StateCreator<SessionStatusState> = (set, get) => ({
  statuses: new Map<SessionId, SessionStatus>(),
  completedAt: new Map<SessionId, number>(),
  statusUpdatedAt: new Map<SessionId, number>(),
  lastVisitedAt: new Map<SessionId, number>(),
  phases: new Map<SessionId, AgentPhaseLabel>(),

  setStatus(id: SessionId, status: SessionStatus, updatedAt = Date.now()) {
    set((state) => updateStatusState(state, id, status, updatedAt))
  },

  hydratePersistedStatuses(sessions) {
    set((state) => hydratePersistedState(state, sessions))
  },

  clearStatus(id: SessionId) {
    set((state) => clearStatusState(state, id))
  },

  getStatus(id: SessionId) {
    return get().statuses.get(id) ?? 'idle'
  },

  setPhase(id: SessionId, phase: AgentPhaseLabel | null) {
    set((state) => updatePhaseState(state, id, phase))
  },

  getPhase(id: SessionId) {
    return get().phases.get(id) ?? null
  },

  markVisited(id: SessionId) {
    const visitedAt = Date.now()
    set((state) => updateVisitedState(state, id, visitedAt))
    persistLastVisitedAt(id, visitedAt)
  },

  markUnread(id: SessionId) {
    const unreadAt = 0
    set((state) => updateVisitedState(state, id, unreadAt))
    persistLastVisitedAt(id, unreadAt)
  },
})

export const useSessionStatusStore = create<SessionStatusState>(createSessionStatusState)
