import type { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
import { useChatStore } from '@/stores/chat-store'

interface ChatReturn {
  sessions: SessionSummary[]
  activeSession: SessionDetail | null
  activeSessionId: SessionId | null
  createSession: (projectPath: string) => Promise<SessionId>
  startDraftSession: () => void
  setActiveSession: (id: SessionId | null) => void
  refreshSession: (id: SessionId) => Promise<void>
  deleteSession: (id: SessionId) => Promise<void>
  updateSessionTitle: (id: SessionId, title: string) => void
  loadSessions: () => Promise<void>
}

/**
 * Renderer read model for session navigation.
 *
 * Session switching must be synchronous: the sidebar click only changes the
 * active ID and reads the full session from the local store. Persistence
 * still belongs to main; this store is the renderer-side snapshot/cache.
 */
export function useChat(): ChatReturn {
  const sessions = useChatStore((s) => s.sessions)
  const activeSession = useChatStore((s) => s.activeSession)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const createSession = useChatStore((s) => s.createSession)
  const startDraftSession = useChatStore((s) => s.startDraftSession)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const refreshSession = useChatStore((s) => s.refreshSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const updateSessionTitle = useChatStore((s) => s.updateSessionTitle)
  const loadSessions = useChatStore((s) => s.loadSessions)

  return {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    startDraftSession,
    setActiveSession,
    refreshSession,
    deleteSession,
    updateSessionTitle,
    loadSessions,
  }
}
