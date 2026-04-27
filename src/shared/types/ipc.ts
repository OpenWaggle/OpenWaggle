import type { AgentSendPayload, PreparedAttachment } from './agent'
import type { OAuthAccountInfo, OAuthFlowStatus, OAuthProvider } from './auth'
import type { ActiveRunInfo, BackgroundRunSnapshot } from './background-run'
import type { ConversationId, SessionId, SessionNodeId, TeamConfigId } from './brand'
import type { FileSuggestion } from './composer'
import type { ContextCompactionResult, ContextUsageSnapshot } from './context-usage'
import type { Conversation, ConversationSummary } from './conversation'
import type {
  DiagnosticsInfo,
  FeedbackPayload,
  FeedbackSubmitResult,
  GhCliStatus,
} from './feedback'
import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchListResult,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
  GitCommitPayload,
  GitCommitResult,
  GitFileDiff,
  GitStatusSummary,
} from './git'
import type { ProviderInfo, SupportedModelId } from './llm'
import type { AgentPhaseEventPayload, AgentPhaseState } from './phase'
import type {
  SessionNavigateTreeOptions,
  SessionSummary,
  SessionTree,
  SessionWorkspace,
  SessionWorkspaceSelection,
} from './session'
import type { Settings } from './settings'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from './standards'
import type { AgentTransportEvent } from './stream'
import type { UpdateStatus } from './updater'
import type { VoiceTranscriptionRequest, VoiceTranscriptionResult } from './voice'
import type {
  WaggleConfig,
  WaggleStreamMetadata,
  WaggleTeamPreset,
  WaggleTurnEvent,
} from './waggle'

// ─── IPC Channel Map ─────────────────────────────────────────
// Single source of truth for every IPC channel.
// Each entry defines: [channel name, args tuple, return type]
// The preload, main handlers, and renderer all derive types from this.

/**
 * Invoke channels — renderer calls main, main responds.
 * Pattern: renderer.invoke(channel, ...args) → Promise<ReturnType>
 */
export interface IpcInvokeChannelMap {
  'agent:send-message': {
    args: [conversationId: ConversationId, payload: AgentSendPayload, model: SupportedModelId]
    return: undefined
  }
  'agent:steer': {
    args: [conversationId: ConversationId]
    return: { preserved: boolean }
  }
  'agent:get-context-usage': {
    args: [conversationId: ConversationId, model: SupportedModelId]
    return: ContextUsageSnapshot | null
  }
  'agent:compact-session': {
    args: [conversationId: ConversationId, model: SupportedModelId, customInstructions?: string]
    return: ContextCompactionResult
  }
  'settings:get': {
    args: []
    return: Settings
  }
  'settings:update': {
    args: [settings: Partial<Settings>]
    return: { ok: true } | { ok: false; error: string }
  }
  'settings:set-enabled-models': {
    args: [models: string[]]
    return: undefined
  }
  'settings:test-api-key': {
    args: [provider: string, apiKey: string, projectPath?: string | null]
    return: { success: boolean; error?: string }
  }
  'project:select-folder': {
    args: []
    return: string | null
  }
  'project-config:get-preferences': {
    args: [projectPath: string]
    return: { model?: string; thinkingLevel?: string } | null
  }
  'project-config:set-preferences': {
    args: [projectPath: string, preferences: { model?: string; thinkingLevel?: string }]
    return: undefined
  }
  'conversations:list': {
    args: [limit?: number]
    return: ConversationSummary[]
  }
  'conversations:list-full': {
    args: [limit?: number]
    return: Conversation[]
  }
  'conversations:get': {
    args: [id: ConversationId]
    return: Conversation | null
  }
  'conversations:create': {
    args: [projectPath: string]
    return: Conversation
  }
  'conversations:delete': {
    args: [id: ConversationId]
    return: undefined
  }
  'conversations:archive': {
    args: [id: ConversationId]
    return: undefined
  }
  'conversations:unarchive': {
    args: [id: ConversationId]
    return: undefined
  }
  'conversations:list-archived': {
    args: []
    return: ConversationSummary[]
  }
  'conversations:update-title': {
    args: [id: ConversationId, title: string]
    return: undefined
  }
  'sessions:list': {
    args: [limit?: number]
    return: SessionSummary[]
  }
  'sessions:get-tree': {
    args: [sessionId: SessionId]
    return: SessionTree | null
  }
  'sessions:get-workspace': {
    args: [sessionId: SessionId, selection?: SessionWorkspaceSelection]
    return: SessionWorkspace | null
  }
  'sessions:navigate-tree': {
    args: [
      sessionId: SessionId,
      model: SupportedModelId,
      targetNodeId: SessionNodeId,
      options?: SessionNavigateTreeOptions,
    ]
    return: { editorText?: string; cancelled: boolean }
  }
  'providers:get-models': {
    args: [projectPath?: string | null]
    return: ProviderInfo[]
  }
  'terminal:create': {
    args: [projectPath: string]
    return: string
  }
  'terminal:close': {
    args: [terminalId: string]
    return: undefined
  }
  'terminal:resize': {
    args: [terminalId: string, cols: number, rows: number]
    return: undefined
  }
  'git:status': {
    args: [projectPath: string]
    return: GitStatusSummary
  }
  'git:commit': {
    args: [projectPath: string, payload: GitCommitPayload]
    return: GitCommitResult
  }
  'git:diff': {
    args: [projectPath: string]
    return: GitFileDiff[]
  }
  'git:branches:list': {
    args: [projectPath: string]
    return: GitBranchListResult
  }
  'git:branches:checkout': {
    args: [projectPath: string, payload: GitBranchCheckoutPayload]
    return: GitBranchMutationResult
  }
  'git:branches:create': {
    args: [projectPath: string, payload: GitBranchCreatePayload]
    return: GitBranchMutationResult
  }
  'git:branches:rename': {
    args: [projectPath: string, payload: GitBranchRenamePayload]
    return: GitBranchMutationResult
  }
  'git:branches:delete': {
    args: [projectPath: string, payload: GitBranchDeletePayload]
    return: GitBranchMutationResult
  }
  'git:branches:set-upstream': {
    args: [projectPath: string, payload: GitBranchSetUpstreamPayload]
    return: GitBranchMutationResult
  }
  'attachments:prepare': {
    args: [projectPath: string, paths: string[]]
    return: PreparedAttachment[]
  }
  'attachments:prepare-from-text': {
    args: [text: string, operationId: string]
    return: PreparedAttachment
  }
  'agent:get-phase': {
    args: [conversationId: ConversationId]
    return: AgentPhaseState | null
  }
  'agent:get-background-run': {
    args: [conversationId: ConversationId]
    return: BackgroundRunSnapshot | null
  }
  'agent:list-active-runs': {
    args: []
    return: ActiveRunInfo[]
  }
  'voice:transcribe-local': {
    args: [payload: VoiceTranscriptionRequest]
    return: VoiceTranscriptionResult
  }
  'standards:get-status': {
    args: [projectPath: string]
    return: { agents: AgentsInstructionStatus; agentsPath: string; error?: string }
  }
  'standards:get-effective-agents': {
    args: [projectPath: string, targetPath?: string]
    return: AgentsResolutionResult
  }
  'skills:list': {
    args: [projectPath: string]
    return: SkillCatalogResult
  }
  'skills:set-enabled': {
    args: [projectPath: string, skillId: string, enabled: boolean]
    return: undefined
  }
  'skills:get-preview': {
    args: [projectPath: string, skillId: string]
    return: { markdown: string }
  }
  'dialog:confirm': {
    args: [message: string, detail?: string]
    return: boolean
  }
  'app:open-logs-dir': {
    args: []
    return: undefined
  }
  'app:get-logs-path': {
    args: []
    return: string
  }
  // Waggle mode
  'agent:send-waggle-message': {
    args: [conversationId: ConversationId, payload: AgentSendPayload, config: WaggleConfig]
    return: undefined
  }
  // Auth
  'auth:start-oauth': {
    args: [provider: OAuthProvider]
    return: undefined
  }
  'auth:disconnect': {
    args: [provider: OAuthProvider]
    return: undefined
  }
  'auth:get-account-info': {
    args: [provider: OAuthProvider]
    return: OAuthAccountInfo
  }
  'auth:submit-code': {
    args: [provider: OAuthProvider, code: string]
    return: undefined
  }
  'auth:cancel-oauth': {
    args: [provider: OAuthProvider]
    return: undefined
  }
  'auth:set-api-key': {
    args: [provider: string, apiKey: string]
    return: undefined
  }
  // Teams
  'teams:list': {
    args: []
    return: WaggleTeamPreset[]
  }
  'teams:save': {
    args: [preset: WaggleTeamPreset]
    return: WaggleTeamPreset
  }
  'teams:delete': {
    args: [id: TeamConfigId]
    return: undefined
  }
  // Feedback
  'feedback:check-gh': {
    args: []
    return: GhCliStatus
  }
  'feedback:collect-diagnostics': {
    args: []
    return: DiagnosticsInfo
  }
  'feedback:get-recent-logs': {
    args: [lineCount: number]
    return: string
  }
  'feedback:submit': {
    args: [payload: FeedbackPayload]
    return: FeedbackSubmitResult
  }
  'feedback:generate-markdown': {
    args: [payload: FeedbackPayload]
    return: string
  }
  'shell:open-external': {
    args: [url: string]
    return: undefined
  }
  // Composer
  'composer:file-suggest': {
    args: [projectPath: string, query: string]
    return: FileSuggestion[]
  }
  // Auto-updater
  'updater:check': {
    args: []
    return: undefined
  }
  'updater:install': {
    args: []
    return: undefined
  }
  'updater:get-status': {
    args: []
    return: UpdateStatus
  }
  'app:get-version': {
    args: []
    return: string
  }
}

/**
 * Send channels — one-way, renderer → main (no response)
 */
export interface IpcSendChannelMap {
  'agent:cancel': {
    args: [conversationId?: ConversationId]
  }
  'agent:cancel-waggle': {
    args: [conversationId: ConversationId]
  }
  'terminal:write': {
    args: [terminalId: string, data: string]
  }
  'clipboard:write-text': {
    args: [text: string]
  }
}

/**
 * Event channels — one-way, main → renderer
 */
interface IpcEventChannelMap {
  /** Pi-shaped runtime events for the renderer's live transcript runtime */
  'agent:event': {
    payload: { conversationId: ConversationId; event: AgentTransportEvent }
  }
  'terminal:data': {
    payload: { terminalId: string; data: string }
  }
  'agent:phase': {
    payload: AgentPhaseEventPayload
  }
  'agent:run-completed': {
    payload: { conversationId: ConversationId }
  }
  'window:fullscreen-changed': {
    payload: boolean
  }
  'auth:oauth-status': {
    payload: OAuthFlowStatus
  }
  'waggle:event': {
    payload: {
      conversationId: ConversationId
      event: AgentTransportEvent
      meta: WaggleStreamMetadata
    }
  }
  'waggle:turn-event': {
    payload: { conversationId: ConversationId; event: WaggleTurnEvent }
  }
  'attachments:prepare-from-text-progress': {
    payload: {
      operationId: string
      bytesWritten: number
      totalBytes: number
      progressPercent: number
      stage: 'writing' | 'completed'
    }
  }
  'conversations:title-updated': {
    payload: { conversationId: ConversationId; title: string }
  }
  'updater:status-changed': {
    payload: UpdateStatus
  }
}

// ─── Derived Types ───────────────────────────────────────────

export type IpcInvokeChannel = keyof IpcInvokeChannelMap
export type IpcSendChannel = keyof IpcSendChannelMap
export type IpcEventChannel = keyof IpcEventChannelMap

/** Extract args for an invoke channel */
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeChannelMap[C]['args']

/** Extract return type for an invoke channel */
export type IpcInvokeReturn<C extends IpcInvokeChannel> = IpcInvokeChannelMap[C]['return']

/** Extract args for a send channel */
export type IpcSendArgs<C extends IpcSendChannel> = IpcSendChannelMap[C]['args']

/** Extract payload type for an event channel. */
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventChannelMap[C]['payload']

// ─── Typed API Surface ───────────────────────────────────────
// This is what the preload exposes to the renderer via contextBridge.

// ─── Convenience API (what we actually expose on window.api) ─

export interface OpenWaggleApi {
  // Agent
  sendMessage(
    conversationId: ConversationId,
    payload: AgentSendPayload,
    model: SupportedModelId,
  ): Promise<void>
  cancelAgent(conversationId?: ConversationId): void
  steerAgent(conversationId: ConversationId): Promise<{ preserved: boolean }>
  /** Subscribe to live Pi-shaped runtime events from the main process */
  onAgentEvent(callback: (payload: IpcEventPayload<'agent:event'>) => void): () => void

  getAgentPhase(conversationId: ConversationId): Promise<AgentPhaseState | null>
  getBackgroundRun(conversationId: ConversationId): Promise<BackgroundRunSnapshot | null>
  listActiveRuns(): Promise<ActiveRunInfo[]>
  getContextUsage(
    conversationId: ConversationId,
    model: SupportedModelId,
  ): Promise<ContextUsageSnapshot | null>
  compactSession(
    conversationId: ConversationId,
    model: SupportedModelId,
    customInstructions?: string,
  ): Promise<ContextCompactionResult>
  onRunCompleted(callback: (payload: IpcEventPayload<'agent:run-completed'>) => void): () => void
  onAgentPhase(callback: (payload: IpcEventPayload<'agent:phase'>) => void): () => void

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(settings: Partial<Settings>): Promise<{ ok: true } | { ok: false; error: string }>
  setEnabledModels(models: string[]): Promise<void>
  testApiKey(
    provider: string,
    apiKey: string,
    projectPath?: string | null,
  ): Promise<{ success: boolean; error?: string }>

  // Providers
  getProviderModels(projectPath?: string | null): Promise<ProviderInfo[]>

  // Project
  selectProjectFolder(): Promise<string | null>
  getProjectPreferences(
    projectPath: string,
  ): Promise<{ model?: string; thinkingLevel?: string } | null>
  setProjectPreferences(
    projectPath: string,
    preferences: { model?: string; thinkingLevel?: string },
  ): Promise<void>

  // Conversations
  listConversations(limit?: number): Promise<ConversationSummary[]>
  listFullConversations(limit?: number): Promise<Conversation[]>
  getConversation(id: ConversationId): Promise<Conversation | null>
  createConversation(projectPath: string): Promise<Conversation>
  deleteConversation(id: ConversationId): Promise<void>
  archiveConversation(id: ConversationId): Promise<void>
  unarchiveConversation(id: ConversationId): Promise<void>
  listArchivedConversations(): Promise<ConversationSummary[]>
  updateConversationTitle(id: ConversationId, title: string): Promise<void>
  listSessions(limit?: number): Promise<SessionSummary[]>
  getSessionTree(sessionId: SessionId): Promise<SessionTree | null>
  getSessionWorkspace(
    sessionId: SessionId,
    selection?: SessionWorkspaceSelection,
  ): Promise<SessionWorkspace | null>
  navigateSessionTree(
    sessionId: SessionId,
    model: SupportedModelId,
    targetNodeId: SessionNodeId,
    options?: SessionNavigateTreeOptions,
  ): Promise<{ editorText?: string; cancelled: boolean }>
  onConversationTitleUpdated(
    callback: (payload: IpcEventPayload<'conversations:title-updated'>) => void,
  ): () => void

  // Terminal
  createTerminal(projectPath: string): Promise<string>
  closeTerminal(terminalId: string): Promise<void>
  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void>
  writeTerminal(terminalId: string, data: string): void
  onTerminalData(callback: (payload: IpcEventPayload<'terminal:data'>) => void): () => void

  // Window
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void

  // Git
  getGitStatus(projectPath: string): Promise<GitStatusSummary>
  commitGit(projectPath: string, payload: GitCommitPayload): Promise<GitCommitResult>
  getGitDiff(projectPath: string): Promise<GitFileDiff[]>
  listGitBranches(projectPath: string): Promise<GitBranchListResult>
  checkoutGitBranch(
    projectPath: string,
    payload: GitBranchCheckoutPayload,
  ): Promise<GitBranchMutationResult>
  createGitBranch(
    projectPath: string,
    payload: GitBranchCreatePayload,
  ): Promise<GitBranchMutationResult>
  renameGitBranch(
    projectPath: string,
    payload: GitBranchRenamePayload,
  ): Promise<GitBranchMutationResult>
  deleteGitBranch(
    projectPath: string,
    payload: GitBranchDeletePayload,
  ): Promise<GitBranchMutationResult>
  setGitBranchUpstream(
    projectPath: string,
    payload: GitBranchSetUpstreamPayload,
  ): Promise<GitBranchMutationResult>

  // File paths (preload-only, no IPC round-trip)
  getFilePath(file: File): string

  // Attachments
  prepareAttachments(projectPath: string, paths: string[]): Promise<PreparedAttachment[]>
  prepareAttachmentFromText(text: string, operationId: string): Promise<PreparedAttachment>
  onPrepareAttachmentFromTextProgress(
    callback: (payload: IpcEventPayload<'attachments:prepare-from-text-progress'>) => void,
  ): () => void

  // Voice
  transcribeVoiceLocal(payload: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult>

  // Standards and Skills
  getStandardsStatus(
    projectPath: string,
  ): Promise<{ agents: AgentsInstructionStatus; agentsPath: string; error?: string }>
  getEffectiveAgents(projectPath: string, targetPath?: string): Promise<AgentsResolutionResult>
  listSkills(projectPath: string): Promise<SkillCatalogResult>
  setSkillEnabled(projectPath: string, skillId: string, enabled: boolean): Promise<void>
  getSkillPreview(projectPath: string, skillId: string): Promise<{ markdown: string }>

  // Dialog
  showConfirm(message: string, detail?: string): Promise<boolean>

  // Shell / App
  copyToClipboard(text: string): void
  openLogsDir(): Promise<void>
  getLogsPath(): Promise<string>

  // Waggle mode
  sendWaggleMessage(
    conversationId: ConversationId,
    payload: AgentSendPayload,
    config: WaggleConfig,
  ): Promise<void>
  cancelWaggle(conversationId: ConversationId): void
  onWaggleEvent(callback: (payload: IpcEventPayload<'waggle:event'>) => void): () => void
  onWaggleTurnEvent(callback: (payload: IpcEventPayload<'waggle:turn-event'>) => void): () => void

  // Auth
  startOAuth(provider: OAuthProvider): Promise<void>
  submitAuthCode(provider: OAuthProvider, code: string): Promise<void>
  cancelOAuth(provider: OAuthProvider): Promise<void>
  setProviderApiKey(provider: string, apiKey: string): Promise<void>
  disconnectAuth(provider: OAuthProvider): Promise<void>
  getAuthAccountInfo(provider: OAuthProvider): Promise<OAuthAccountInfo>
  onOAuthStatus(callback: (status: IpcEventPayload<'auth:oauth-status'>) => void): () => void

  // Teams
  listTeams(): Promise<WaggleTeamPreset[]>
  saveTeam(preset: WaggleTeamPreset): Promise<WaggleTeamPreset>
  deleteTeam(id: TeamConfigId): Promise<void>

  // Feedback
  checkGhCli(): Promise<GhCliStatus>
  collectDiagnostics(): Promise<DiagnosticsInfo>
  getRecentLogs(lineCount: number): Promise<string>
  submitFeedback(payload: FeedbackPayload): Promise<FeedbackSubmitResult>
  generateFeedbackMarkdown(payload: FeedbackPayload): Promise<string>
  openExternal(url: string): Promise<void>

  // Composer
  suggestFiles(projectPath: string, query: string): Promise<FileSuggestion[]>

  // Auto-updater
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  getUpdateStatus(): Promise<UpdateStatus>
  getAppVersion(): Promise<string>
  onUpdateStatus(callback: (payload: UpdateStatus) => void): () => void
}
