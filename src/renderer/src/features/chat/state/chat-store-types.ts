import type { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'

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
