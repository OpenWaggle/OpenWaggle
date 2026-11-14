import { useChatStore, type DraftSessionState } from '@/features/chat/state/chat-store'
import { useSessionStore } from '@/features/sessions/state'
import type { SessionWorktreePlan, SessionSummary, SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import type { SessionId } from '@shared/types/brand'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'

export interface ChatReturn {
  sessions: readonly SessionSummary[]
  activeSession: SessionDetail | null
  activeSessionId: SessionId | null
  draftSession: DraftSessionState | null
  createSession: (
    projectPath: string,
    worktreePlan?: SessionWorktreePlan,
    thinkingLevel?: ThinkingLevel,
  ) => Promise<SessionId>
  startDraftSession: (projectPath?: string | null) => void
  setActiveSession: (id: SessionId | null) => void
  refreshSession: (id: SessionId) => Promise<void>
  /** `null` clears the session override so the session inherits again. */
  setSessionAuthorizationMode: (
    id: SessionId,
    authorizationMode: AgentAuthorizationMode | null,
  ) => Promise<void>
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
export function useChat() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSession = useChatStore((s) => s.activeSession)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const draftSession = useChatStore((s) => s.draftSession)
  const createSession = useChatStore((s) => s.createSession)
  const startDraftSession = useChatStore((s) => s.startDraftSession)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const refreshSession = useChatStore((s) => s.refreshSession)
  const setSessionAuthorizationMode = useChatStore((s) => s.setSessionAuthorizationMode)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const updateSessionTitle = useChatStore((s) => s.updateSessionTitle)
  const loadSessions = useChatStore((s) => s.loadSessions)

  const result: ChatReturn = {
    sessions,
    activeSession,
    activeSessionId,
    draftSession,
    createSession,
    startDraftSession,
    setActiveSession,
    refreshSession,
    setSessionAuthorizationMode,
    deleteSession,
    updateSessionTitle,
    loadSessions,
  }
  return result
}
