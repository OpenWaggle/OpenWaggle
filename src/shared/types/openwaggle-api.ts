import type { AgentSendPayload, PreparedAttachment } from './agent'
import type { OAuthAccountInfo, OAuthProvider } from './auth'
import type { ActiveRunInfo, BackgroundRunSnapshot } from './background-run'
import type { SessionBranchId, SessionId, SessionNodeId, WagglePresetId } from './brand'
import type { FileSuggestion } from './composer'
import type { ContextCompactionResult, ContextUsageSnapshot } from './context-usage'
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
import type { IpcEventPayload } from './ipc'
import type { ProviderInfo, SupportedModelId } from './llm'
import type { McpSetServerEnabledInput, McpSettingsView, McpWriteSourceConfigInput } from './mcp'
import type { AgentPhaseState } from './phase'
import type {
  SessionCopyToNewResult,
  SessionDetail,
  SessionNavigateTreeOptions,
  SessionSummary,
  SessionTree,
  SessionTreeFilterMode,
  SessionTreeUiStatePatch,
  SessionWorkspace,
  SessionWorkspaceSelection,
} from './session'
import type { Settings } from './settings'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from './standards'
import type { UpdateStatus } from './updater'
import type { VoiceTranscriptionRequest, VoiceTranscriptionResult } from './voice'
import type { WaggleConfig, WagglePreset } from './waggle'

// This is what the preload exposes to the renderer via contextBridge.

// ─── Convenience API (what we actually expose on window.api) ─

export interface OpenWaggleApi {
  // Agent
  sendMessage(
    sessionId: SessionId,
    payload: AgentSendPayload,
    model: SupportedModelId,
  ): Promise<void>
  cancelAgent(sessionId?: SessionId): Promise<void>
  steerAgent(sessionId: SessionId): Promise<{ preserved: boolean }>
  /** Subscribe to live Pi-shaped runtime events from the main process */
  onAgentEvent(callback: (payload: IpcEventPayload<'agent:event'>) => void): () => void

  getAgentPhase(sessionId: SessionId): Promise<AgentPhaseState | null>
  getBackgroundRun(sessionId: SessionId): Promise<BackgroundRunSnapshot | null>
  listActiveRuns(): Promise<ActiveRunInfo[]>
  getContextUsage(
    sessionId: SessionId,
    model: SupportedModelId,
  ): Promise<ContextUsageSnapshot | null>
  compactSession(
    sessionId: SessionId,
    model: SupportedModelId,
    customInstructions?: string,
  ): Promise<ContextCompactionResult>
  onRunCompleted(callback: (payload: IpcEventPayload<'agent:run-completed'>) => void): () => void
  onAgentPhase(callback: (payload: IpcEventPayload<'agent:phase'>) => void): () => void

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(settings: Partial<Settings>): Promise<{ ok: true } | { ok: false; error: string }>
  setEnabledModels(models: string[]): Promise<void>
  getPiTreeFilterMode(projectPath?: string | null): Promise<SessionTreeFilterMode>
  setPiTreeFilterMode(mode: SessionTreeFilterMode, projectPath?: string | null): Promise<void>
  getPiBranchSummarySkipPrompt(projectPath?: string | null): Promise<boolean>
  testApiKey(
    provider: string,
    apiKey: string,
    projectPath?: string | null,
  ): Promise<{ success: boolean; error?: string }>
  getMcpSettings(projectPath?: string | null): Promise<McpSettingsView>
  setMcpAdapterEnabled(enabled: boolean, projectPath?: string | null): Promise<McpSettingsView>
  setMcpServerEnabled(input: McpSetServerEnabledInput): Promise<McpSettingsView>
  writeMcpSourceConfig(input: McpWriteSourceConfigInput): Promise<McpSettingsView>

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

  // Sessions
  listSessions(limit?: number): Promise<SessionSummary[]>
  listSessionDetails(limit?: number): Promise<SessionDetail[]>
  getSessionDetail(id: SessionId): Promise<SessionDetail | null>
  createSession(projectPath: string): Promise<SessionDetail>
  forkSessionToNew(
    sessionId: SessionId,
    model: SupportedModelId,
    targetNodeId: SessionNodeId,
  ): Promise<SessionCopyToNewResult>
  cloneSessionToNew(
    sessionId: SessionId,
    model: SupportedModelId,
    targetNodeId: SessionNodeId,
  ): Promise<SessionCopyToNewResult>
  dismissInterruptedSessionRun(sessionId: SessionId, runId: string): Promise<void>
  deleteSession(id: SessionId): Promise<void>
  archiveSession(id: SessionId): Promise<void>
  unarchiveSession(id: SessionId): Promise<void>
  listArchivedSessions(): Promise<SessionSummary[]>
  updateSessionTitle(id: SessionId, title: string): Promise<void>
  listArchivedSessionBranches(limit?: number): Promise<SessionSummary[]>
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
  renameSessionBranch(sessionId: SessionId, branchId: SessionBranchId, name: string): Promise<void>
  archiveSessionBranch(sessionId: SessionId, branchId: SessionBranchId): Promise<void>
  restoreSessionBranch(sessionId: SessionId, branchId: SessionBranchId): Promise<void>
  updateSessionTreeUiState(sessionId: SessionId, patch: SessionTreeUiStatePatch): Promise<void>
  onSessionTitleUpdated(
    callback: (payload: IpcEventPayload<'sessions:title-updated'>) => void,
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

  // Attachments
  prepareAttachments(projectPath: string, files: readonly File[]): Promise<PreparedAttachment[]>
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
  openPath(path: string): Promise<void>

  // Waggle mode
  sendWaggleMessage(
    sessionId: SessionId,
    payload: AgentSendPayload,
    model: SupportedModelId,
    config: WaggleConfig,
  ): Promise<void>
  cancelWaggle(sessionId: SessionId): void
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

  // Waggle presets
  listWagglePresets(projectPath?: string | null): Promise<WagglePreset[]>
  saveWagglePreset(preset: WagglePreset, projectPath?: string | null): Promise<WagglePreset>
  deleteWagglePreset(id: WagglePresetId, projectPath?: string | null): Promise<void>

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
