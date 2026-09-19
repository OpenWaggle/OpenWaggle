import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary, SessionWorktreePlan } from '@shared/types/session'

export interface DraftSessionState {
  readonly projectPath: string | null
}

export interface ChatState {
  sessions: SessionSummary[]
  sessionById: Map<SessionId, SessionDetail>
  missingSessionIds: ReadonlySet<SessionId>
  draftSession: DraftSessionState | null
  activeSessionId: SessionId | null
  activeSession: SessionDetail | null
  error: string | null

  loadSessions: () => Promise<void>
  createSession: (projectPath: string, worktreePlan?: SessionWorktreePlan) => Promise<SessionId>
  startDraftSession: (projectPath?: string | null) => void
  setActiveSessionId: (id: SessionId | null) => void
  setActiveSession: (id: SessionId | null) => void
  refreshSession: (id: SessionId) => Promise<void>
  /** `null` clears the session override so the session inherits again. */
  setSessionAuthorizationMode: (
    id: SessionId,
    authorizationMode: AgentAuthorizationMode | null,
  ) => Promise<void>
  upsertSession: (session: SessionDetail) => void
  deleteSession: (id: SessionId) => Promise<void>
  updateSessionTitle: (id: SessionId, title: string) => void
  clearError: () => void
}

export type ChatActions = Omit<
  ChatState,
  | 'sessions'
  | 'sessionById'
  | 'missingSessionIds'
  | 'draftSession'
  | 'activeSessionId'
  | 'activeSession'
  | 'error'
>
