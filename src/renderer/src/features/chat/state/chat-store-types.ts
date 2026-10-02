import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail, SessionSummary, SessionWorktreePlan } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'

export interface DraftSessionState {
  readonly projectPath: string | null
  readonly selectedModel?: SupportedModelId
  readonly isMaterializing?: boolean
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
  /** `thinkingLevel` is the level the new Session starts at; Pi's global default when omitted. */
  createSession: (
    projectPath: string,
    worktreePlan?: SessionWorktreePlan,
    thinkingLevel?: ThinkingLevel,
  ) => Promise<SessionId>
  startDraftSession: (projectPath?: string | null) => void
  setDraftSelectedModel: (model: SupportedModelId) => void
  setActiveSessionId: (id: SessionId | null) => void
  setActiveSession: (id: SessionId | null) => void
  refreshSession: (id: SessionId) => Promise<void>
  /** `null` clears the session override so the session inherits again. */
  setSessionAuthorizationMode: (
    id: SessionId,
    authorizationMode: AgentAuthorizationMode | null,
  ) => Promise<void>
  /**
   * Switches the model the Session's next Run uses. A Run that is already streaming keeps its model;
   * the pick is durable at once and applies to the next prompt, including queued follow-ups.
   */
  setSessionModel: (id: SessionId, model: SupportedModelId) => Promise<void>
  upsertSession: (session: SessionDetail) => void
  deleteSession: (id: SessionId) => Promise<void>
  /** Patch the title locally without reloading, so an optimistic rename can be reverted. */
  applySessionTitle: (id: SessionId, title: string) => void
  /** Apply a committed title, then refresh the Session catalog from the Host. */
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
