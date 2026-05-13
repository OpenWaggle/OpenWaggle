import { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useComposerStore } from '@/stores/composer-store'
import { useSessionStore } from '@/stores/session-store'

const logger = createRendererLogger('chat-store')

function toSessionId(id: SessionId): SessionId {
  return SessionId(String(id))
}

function optionalSessionId(id: SessionId | null): SessionId | null {
  return id ? toSessionId(id) : null
}

function isSameSessionId(left: SessionId | null, right: SessionId): boolean {
  return left !== null && String(left) === String(right)
}

function refreshSessionStoreForSession(
  sessionId: SessionId,
  activeSessionId: SessionId | null,
): void {
  const sessionStore = useSessionStore.getState()
  if (isSameSessionId(activeSessionId, sessionId)) {
    void sessionStore.refreshSessionsAndTree(toSessionId(sessionId))
    return
  }

  void sessionStore.loadSessions()
}

function handleStoreError(err: unknown, action: string, setError: (message: string) => void): void {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`Failed to ${action}`, { message })
  setError(`Failed to ${action}: ${message}`)
}

function toSummary(session: SessionDetail): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    projectPath: session.projectPath,
    messageCount: session.messages.length,
    archived: session.archived,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function shouldShowSummary(summary: SessionSummary): boolean {
  return summary.title !== 'New session' || (summary.messageCount ?? 0) > 0
}

function mergeSummary(
  summaries: readonly SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const existingIndex = summaries.findIndex((item) => item.id === summary.id)
  if (!shouldShowSummary(summary)) {
    return existingIndex === -1
      ? [...summaries]
      : summaries.filter((item) => item.id !== summary.id)
  }

  if (existingIndex === -1) {
    return [summary, ...summaries]
  }

  return summaries.map((item) => (item.id === summary.id ? summary : item))
}

function removeSummary(summaries: readonly SessionSummary[], id: SessionId): SessionSummary[] {
  return summaries.filter((summary) => summary.id !== id)
}

interface ChatState {
  sessions: SessionSummary[]
  sessionById: Map<SessionId, SessionDetail>
  missingSessionIds: ReadonlySet<SessionId>
  draftSession: DraftSessionState | null
  activeSessionId: SessionId | null
  activeSession: SessionDetail | null
  error: string | null

  loadSessions: () => Promise<void>
  createSession: (projectPath: string) => Promise<SessionId>
  startDraftSession: (projectPath?: string | null) => void
  setActiveSessionId: (id: SessionId | null) => void
  setActiveSession: (id: SessionId | null) => void
  refreshSession: (id: SessionId) => Promise<void>
  upsertSession: (session: SessionDetail) => void
  deleteSession: (id: SessionId) => Promise<void>
  updateSessionTitle: (id: SessionId, title: string) => void
  clearError: () => void
}

export interface DraftSessionState {
  readonly projectPath: string | null
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  sessionById: new Map<SessionId, SessionDetail>(),
  missingSessionIds: new Set<SessionId>(),
  draftSession: null,
  activeSessionId: null,
  activeSession: null,
  error: null,

  async loadSessions() {
    try {
      const all = await api.listSessionDetails()
      const sessionById = new Map<SessionId, SessionDetail>()
      const sessions: SessionSummary[] = []

      for (const session of all) {
        sessionById.set(session.id, session)
        const summary = toSummary(session)
        if (shouldShowSummary(summary)) {
          sessions.push(summary)
        }
      }

      const activeSessionId = get().activeSessionId
      const activeSession = activeSessionId ? (sessionById.get(activeSessionId) ?? null) : null
      const missingSessionIds = new Set(get().missingSessionIds)
      for (const session of all) {
        missingSessionIds.delete(session.id)
      }
      if (activeSessionId && !activeSession) {
        missingSessionIds.add(activeSessionId)
      }

      set({
        sessions,
        sessionById,
        missingSessionIds,
        draftSession: activeSession ? null : get().draftSession,
        activeSessionId: activeSession ? activeSessionId : null,
        activeSession,
        error: null,
      })
      void useSessionStore.getState().loadSessions()
    } catch (err) {
      handleStoreError(err, 'load sessions', (error) => set({ error }))
    }
  },

  async createSession(projectPath: string) {
    try {
      const session = await api.createSession(projectPath)
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
      handleStoreError(err, 'create session', (error) => set({ error }))
      throw err
    }
  },

  startDraftSession(projectPath = null) {
    set({ activeSessionId: null, activeSession: null, draftSession: { projectPath } })
  },

  setActiveSessionId(id: SessionId | null) {
    get().setActiveSession(id)
  },

  setActiveSession(id: SessionId | null) {
    if (!id) {
      set({ activeSessionId: null, activeSession: null, draftSession: null })
      return
    }

    if (get().missingSessionIds.has(id)) {
      set({ activeSessionId: null, activeSession: null, draftSession: null })
      return
    }

    const cached = get().sessionById.get(id) ?? null
    set({ activeSessionId: id, activeSession: cached, draftSession: null })

    if (!cached) {
      void get().refreshSession(id)
    }
  },

  async refreshSession(id: SessionId) {
    try {
      const session = await api.getSessionDetail(id)
      const wasActiveSession = isSameSessionId(get().activeSessionId, id)
      if (!session) {
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
        if (wasActiveSession) {
          void useSessionStore.getState().refreshSessionTree(null)
        } else {
          void useSessionStore.getState().loadSessions()
        }
        return
      }
      get().upsertSession(session)
      refreshSessionStoreForSession(id, get().activeSessionId)
    } catch (err) {
      handleStoreError(err, 'refresh session', (error) => set({ error }))
    }
  },

  upsertSession(session: SessionDetail) {
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
  },

  async deleteSession(id: SessionId) {
    const previousSessions = get().sessions
    const previousSessionById = get().sessionById
    const previousMissingSessionIds = get().missingSessionIds
    const previousDraftSession = get().draftSession
    const previousActiveSessionId = get().activeSessionId
    const previousActiveSession = get().activeSession

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

    try {
      await api.deleteSession(id)
      useComposerStore.getState().clearScopedDraftsForSession(String(id))
      void useSessionStore
        .getState()
        .refreshSessionsAndTree(optionalSessionId(get().activeSessionId))
    } catch (err) {
      set({
        sessions: previousSessions,
        sessionById: previousSessionById,
        missingSessionIds: previousMissingSessionIds,
        draftSession: previousDraftSession,
        activeSessionId: previousActiveSessionId,
        activeSession: previousActiveSession,
      })
      handleStoreError(err, 'delete session', (error) => set({ error }))
      throw err
    }
  },

  updateSessionTitle(id: SessionId, title: string) {
    set((state) => {
      const existing = state.sessionById.get(id)
      if (!existing) {
        const now = Date.now()
        const fallbackSummary: SessionSummary = {
          id,
          title,
          projectPath: null,
          messageCount: 1,
          createdAt: now,
          updatedAt: now,
        }
        return {
          sessions: mergeSummary(state.sessions, fallbackSummary),
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
  },

  clearError() {
    set({ error: null })
  },
}))
