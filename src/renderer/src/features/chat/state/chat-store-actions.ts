import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionWorktreePlan } from '@shared/types/session'
import { useComposerStore } from '@/features/composer/state'
import { useDiffScopeStore } from '@/features/diff-panel'
import { useSessionStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import {
  handleStoreError,
  isSameSessionId,
  mergeSummary,
  optionalSessionId,
  refreshSessionStoreForSession,
  removeSummary,
  toSessionId,
  toSummary,
} from './chat-store-helpers'
import type { ChatActions, ChatState } from './chat-store-types'

type ChatSet = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
type ChatGet = () => ChatState

const latestSessionRefresh = new Map<SessionId, number>()
const latestSessionMutation = new Map<SessionId, number>()
let latestSessionLoad = 0

function sessionMutationVersion(id: SessionId) {
  return latestSessionMutation.get(id) ?? 0
}

function markSessionMutation(id: SessionId) {
  latestSessionMutation.set(id, sessionMutationVersion(id) + 1)
}

function setError(set: ChatSet) {
  return (error: string) => set({ error })
}

function changedSince(id: SessionId, mutationVersions: ReadonlyMap<SessionId, number>) {
  return sessionMutationVersion(id) !== (mutationVersions.get(id) ?? 0)
}

function reconcileLoadedDetails(
  all: readonly SessionDetail[],
  current: ChatState,
  mutationVersions: ReadonlyMap<SessionId, number>,
) {
  const sessionById = new Map<SessionId, SessionDetail>()
  for (const session of all) {
    const changed = changedSince(session.id, mutationVersions)
    if (changed && current.missingSessionIds.has(session.id)) continue
    sessionById.set(
      session.id,
      changed ? (current.sessionById.get(session.id) ?? session) : session,
    )
  }
  for (const [sessionId, session] of current.sessionById) {
    if (changedSince(sessionId, mutationVersions) && !current.missingSessionIds.has(sessionId)) {
      sessionById.set(sessionId, session)
    }
  }
  return sessionById
}

function visibleSummaries(sessionById: ReadonlyMap<SessionId, SessionDetail>) {
  return [...sessionById.values()].flatMap((session) => {
    const summary = toSummary(session)
    return summary.title !== 'New session' || (summary.messageCount ?? 0) > 0 ? [summary] : []
  })
}

function reconcileMissingSessions(
  all: readonly SessionDetail[],
  current: ChatState,
  mutationVersions: ReadonlyMap<SessionId, number>,
) {
  const missingSessionIds = new Set(current.missingSessionIds)
  for (const session of all) {
    if (!changedSince(session.id, mutationVersions)) missingSessionIds.delete(session.id)
  }
  return missingSessionIds
}

async function loadSessions(set: ChatSet, get: ChatGet) {
  latestSessionLoad += 1
  const loadRequestId = latestSessionLoad
  const mutationVersions = new Map(latestSessionMutation)
  try {
    const all = await api.listSessionDetails()
    if (loadRequestId !== latestSessionLoad) return
    const current = get()
    const sessionById = reconcileLoadedDetails(all, current, mutationVersions)
    const sessions = visibleSummaries(sessionById)
    const activeSessionId = current.activeSessionId
    const activeSession = activeSessionId ? (sessionById.get(activeSessionId) ?? null) : null
    const missingSessionIds = reconcileMissingSessions(all, current, mutationVersions)
    if (activeSessionId && !activeSession) {
      missingSessionIds.add(activeSessionId)
    }

    set({
      sessions,
      sessionById,
      missingSessionIds,
      draftSession: activeSession ? null : current.draftSession,
      activeSessionId: activeSession ? activeSessionId : null,
      activeSession,
      error: null,
    })
    void useSessionStore.getState().loadSessions()
  } catch (err) {
    if (loadRequestId !== latestSessionLoad) return
    handleStoreError(err, 'load sessions', setError(set))
  }
}

async function createSession(
  projectPath: string,
  set: ChatSet,
  get: ChatGet,
  worktreePlan?: SessionWorktreePlan,
) {
  try {
    const session = worktreePlan
      ? await api.createSession(projectPath, worktreePlan)
      : await api.createSession(projectPath)
    get().upsertSession(session)
    set({
      activeSessionId: session.id,
      activeSession: session,
      draftSession: null,
      missingSessionIds: new Set(
        [...get().missingSessionIds].filter((missingId) => missingId !== session.id),
      ),
      error: null,
    })
    void useSessionStore.getState().refreshSessionsAndTree(toSessionId(session.id))
    return session.id
  } catch (err) {
    handleStoreError(err, 'create session', setError(set))
    throw err
  }
}

function setActiveSession(id: SessionId | null, set: ChatSet, get: ChatGet) {
  if (!id || get().missingSessionIds.has(id)) {
    set({ activeSessionId: null, activeSession: null, draftSession: null })
    return
  }

  const cached = get().sessionById.get(id) ?? null
  set({ activeSessionId: id, activeSession: cached, draftSession: null })

  if (!cached) {
    void get().refreshSession(id)
  }
}

async function refreshSession(id: SessionId, set: ChatSet, get: ChatGet) {
  const requestId = (latestSessionRefresh.get(id) ?? 0) + 1
  latestSessionRefresh.set(id, requestId)
  try {
    const session = await api.getSessionDetail(id)
    if (latestSessionRefresh.get(id) !== requestId) return
    const wasActiveSession = isSameSessionId(get().activeSessionId, id)
    if (!session) {
      removeMissingSession(id, set)
      refreshMissingSessionTree(wasActiveSession)
      return
    }
    get().upsertSession(session)
    refreshSessionStoreForSession(id, get().activeSessionId)
  } catch (err) {
    if (latestSessionRefresh.get(id) !== requestId) return
    handleStoreError(err, 'refresh session', setError(set))
  }
}

async function setSessionAuthorizationMode(
  id: SessionId,
  authorizationMode: AgentAuthorizationMode | null,
  set: ChatSet,
  get: ChatGet,
) {
  const previous = get().sessionById.get(id) ?? null
  if (previous) {
    // `null` clears the override, so the optimistic copy must drop the field rather than store a
    // mode. Keeping one here would show an override the session no longer has.
    const { authorizationMode: _cleared, ...withoutOverride } = previous
    upsertSession(
      authorizationMode === null ? withoutOverride : { ...previous, authorizationMode },
      set,
    )
  }

  try {
    await api.setSessionAuthorizationMode(id, authorizationMode)
    refreshSessionStoreForSession(id, get().activeSessionId)
  } catch (err) {
    if (previous) {
      upsertSession(previous, set)
    }
    handleStoreError(err, 'set session authorization mode', setError(set))
    throw err
  }
}

function removeMissingSession(id: SessionId, set: ChatSet) {
  markSessionMutation(id)
  set((state) => {
    const sessionById = new Map(state.sessionById)
    const missingSessionIds = new Set(state.missingSessionIds)
    sessionById.delete(id)
    missingSessionIds.add(id)
    return {
      sessionById,
      missingSessionIds,
      sessions: removeSummary(state.sessions, id),
      ...(state.activeSessionId === id
        ? { activeSessionId: null, activeSession: null, draftSession: null }
        : {}),
    }
  })
}

function refreshMissingSessionTree(wasActiveSession: boolean) {
  if (wasActiveSession) {
    void useSessionStore.getState().refreshSessionTree(null)
    return
  }
  void useSessionStore.getState().loadSessions()
}

function upsertSession(session: SessionDetail, set: ChatSet) {
  markSessionMutation(session.id)
  set((state) => {
    const sessionById = new Map(state.sessionById)
    const missingSessionIds = new Set(state.missingSessionIds)
    sessionById.set(session.id, session)
    missingSessionIds.delete(session.id)
    return {
      sessionById,
      missingSessionIds,
      sessions: mergeSummary(state.sessions, toSummary(session)),
      draftSession: state.activeSessionId === session.id ? null : state.draftSession,
      activeSession: state.activeSessionId === session.id ? session : state.activeSession,
      error: null,
    }
  })
}

async function deleteSession(id: SessionId, set: ChatSet, get: ChatGet) {
  const previous = get()
  removeMissingSession(id, set)

  try {
    await api.deleteSession(id)
    useComposerStore.getState().clearScopedDraftsForSession(String(id))
    useDiffScopeStore.getState().removeThread(String(id))
    void useSessionStore.getState().refreshSessionsAndTree(optionalSessionId(get().activeSessionId))
  } catch (err) {
    set({
      sessions: previous.sessions,
      sessionById: previous.sessionById,
      missingSessionIds: previous.missingSessionIds,
      draftSession: previous.draftSession,
      activeSessionId: previous.activeSessionId,
      activeSession: previous.activeSession,
    })
    handleStoreError(err, 'delete session', setError(set))
    throw err
  }
}

function updateSessionTitle(id: SessionId, title: string, set: ChatSet, get: ChatGet) {
  markSessionMutation(id)
  set((state) => {
    const existing = state.sessionById.get(id)
    if (!existing) {
      const now = Date.now()
      return {
        sessions: mergeSummary(state.sessions, {
          id,
          title,
          projectPath: null,
          messageCount: 1,
          createdAt: now,
          updatedAt: now,
        }),
      }
    }

    const session = { ...existing, title }
    const sessionById = new Map(state.sessionById)
    sessionById.set(id, session)
    return {
      sessionById,
      sessions: mergeSummary(state.sessions, toSummary(session)),
      activeSession: state.activeSessionId === id ? session : state.activeSession,
    }
  })
  refreshSessionStoreForSession(id, get().activeSessionId)
}

export function createChatActions(set: ChatSet, get: ChatGet): ChatActions {
  return {
    loadSessions: () => loadSessions(set, get),
    createSession: (projectPath, worktreePlan) =>
      createSession(projectPath, set, get, worktreePlan),
    startDraftSession: (projectPath = null) =>
      set({ activeSessionId: null, activeSession: null, draftSession: { projectPath } }),
    setActiveSessionId: (id) => get().setActiveSession(id),
    setActiveSession: (id) => setActiveSession(id, set, get),
    refreshSession: (id) => refreshSession(id, set, get),
    setSessionAuthorizationMode: (id, authorizationMode) =>
      setSessionAuthorizationMode(id, authorizationMode, set, get),
    upsertSession: (session) => upsertSession(session, set),
    deleteSession: (id) => deleteSession(id, set, get),
    updateSessionTitle: (id, title) => updateSessionTitle(id, title, set, get),
    clearError: () => set({ error: null }),
  }
}
