import type { AgentSendPayload, AgentSendReport, PreparedAttachment } from './agent'
import type { AgentAuthorizationMode } from './agent-authorization'
import type {
  AgentLoopInteractionResponseInput,
  AgentLoopInteractionSubmitResult,
} from './agent-loop-interaction'
import type { OAuthAccountInfo, OAuthProvider } from './auth'
import type {
  ActiveRunInfo,
  BackgroundRunSnapshot,
  WorktreeLaunchEventPayload,
} from './background-run'
import type {
  RepositoryPath,
  SessionBranchId,
  SessionId,
  SessionNodeId,
  WorkingPath,
} from './brand'
import type { FileSuggestion } from './composer'
import type { ContextCompactionResult, ContextUsageSnapshot } from './context-usage'
import type {
  DocsDiscoveryView,
  DocsListInput,
  DocsResolveTopicInput,
  FirstPartyDocsTopicSummary,
} from './docs'
import type {
  ChangeRequestCheckoutResult,
  ChangeRequestListResult,
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchListResult,
  GitBranchMutationResult,
  GitCommitPayload,
  GitCommitResult,
  GitDiffResult,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStatusSummary,
  GitWorkingTreeMutationResult,
  GitWorktreeCreatePayload,
  GitWorktreeListResult,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
  LocalVcsStatusResult,
  RemoteVcsStatusResult,
  SessionWorktreeCheck,
} from './git'
import type { IpcEventPayload } from './ipc'
import type { ChangeRequestAdoption } from './ipc-invoke-git'
import type { ProviderInfo, SupportedModelId } from './llm'
import type { OpenWaggleAuthorizationGrantApi } from './openwaggle-api-authorization-grants'
import type { OpenWaggleFeedbackApi } from './openwaggle-api-feedback'
import type { OpenWaggleProjectConfigApi } from './openwaggle-api-project'
import type { OpenWaggleSessionControlApi } from './openwaggle-api-session-control'
import type { OpenWaggleUpdaterApi } from './openwaggle-api-updater'
import type { OpenWaggleWaggleApi } from './openwaggle-api-waggle'
import type { OpenWaggleExtensionApi } from './openwaggle-extension-api'
import type { OpenWaggleMcpApi } from './openwaggle-mcp-api'
import type { OpenWaggleWorkspaceFilesApi } from './openwaggle-workspace-files-api'
import type { AgentPhaseState } from './phase'
import type {
  PinnedSession,
  PinnedSessionMove,
  SessionCopyToNewResult,
  SessionDetail,
  SessionNavigateTreeOptions,
  SessionSummary,
  SessionTree,
  SessionTreeFilterMode,
  SessionTreeUiStatePatch,
  SessionWorkspace,
  SessionWorkspaceSelection,
  SessionWorktreePlan,
} from './session'
import type { Settings } from './settings'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from './standards'
import type { TurnCheckpointSummary, TurnDiff } from './turn-diff'
import type { VoiceTranscriptionRequest, VoiceTranscriptionResult } from './voice'

export interface OpenWaggleApi
  extends OpenWaggleAuthorizationGrantApi,
    OpenWaggleFeedbackApi,
    OpenWaggleProjectConfigApi,
    OpenWaggleUpdaterApi,
    OpenWaggleExtensionApi,
    OpenWaggleMcpApi,
    OpenWaggleWaggleApi,
    OpenWaggleSessionControlApi,
    OpenWaggleWorkspaceFilesApi {
  // Agent
  sendMessage(
    sessionId: SessionId,
    payload: AgentSendPayload,
    model: SupportedModelId,
  ): Promise<AgentSendReport>
  cancelAgent(sessionId?: SessionId): Promise<void>
  respondAgentInteraction(
    input: AgentLoopInteractionResponseInput,
  ): Promise<AgentLoopInteractionSubmitResult>
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
  onSessionHostEvent(callback: (payload: IpcEventPayload<'session-host:event'>) => void): () => void
  onSessionHostResyncRequired(
    callback: (payload: IpcEventPayload<'session-host:resync-required'>) => void,
  ): () => void
  onWorktreeLaunch(callback: (payload: WorktreeLaunchEventPayload) => void): () => void

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
  discoverDocs(input?: DocsListInput): Promise<DocsDiscoveryView>
  resolveDocsTopic(input: DocsResolveTopicInput): Promise<FirstPartyDocsTopicSummary | null>

  // Providers
  getProviderModels(projectPath?: string | null): Promise<ProviderInfo[]>

  // Sessions
  listSessions(limit?: number): Promise<SessionSummary[]>
  listSessionDetails(limit?: number): Promise<SessionDetail[]>
  getSessionDetail(id: SessionId): Promise<SessionDetail | null>
  listTurnCheckpoints(id: SessionId): Promise<TurnCheckpointSummary[]>
  getTurnDiff(id: SessionId, turnId: string): Promise<TurnDiff | null>
  /** Every Pinned session in Manual order, archived ones included (issue #97). */
  listPinnedSessions(): Promise<PinnedSession[]>
  pinSession(id: SessionId): Promise<void>
  unpinSession(id: SessionId): Promise<void>
  /** Reposition one pin between the neighbours it should land between. */
  movePinnedSession(move: PinnedSessionMove): Promise<void>
  createSession(projectPath: string, worktreePlan?: SessionWorktreePlan): Promise<SessionDetail>
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
  setSessionAuthorizationMode(id: SessionId, mode: AgentAuthorizationMode | null): Promise<void>
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
  onGitWorkingTreeChanged(
    callback: (payload: IpcEventPayload<'git:working-tree-changed'>) => void,
  ): () => void
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
  getGitStatus(workingPath: WorkingPath): Promise<GitStatusSummary>
  commitGit(workingPath: WorkingPath, payload: GitCommitPayload): Promise<GitCommitResult>
  getGitDiff(workingPath: WorkingPath): Promise<GitDiffResult>
  getGitBranchDiff(workingPath: WorkingPath, baseRef: string): Promise<GitDiffResult>
  stageAllGitChanges(workingPath: WorkingPath): Promise<GitWorkingTreeMutationResult>
  revertAllGitChanges(workingPath: WorkingPath): Promise<GitWorkingTreeMutationResult>
  listGitBranches(repositoryPath: RepositoryPath): Promise<GitBranchListResult>
  checkoutGitBranch(
    workingPath: WorkingPath,
    payload: GitBranchCheckoutPayload,
  ): Promise<GitBranchMutationResult>
  createGitBranch(
    workingPath: WorkingPath,
    payload: GitBranchCreatePayload,
  ): Promise<GitBranchMutationResult>
  checkSessionWorktree(worktreePath: string | null): Promise<SessionWorktreeCheck>
  listGitWorktrees(repositoryPath: RepositoryPath): Promise<GitWorktreeListResult>
  createGitWorktree(
    repositoryPath: RepositoryPath,
    payload: GitWorktreeCreatePayload,
  ): Promise<GitWorktreeMutationResult>
  removeGitWorktree(
    repositoryPath: RepositoryPath,
    payload: GitWorktreeRemovePayload,
  ): Promise<GitWorktreeMutationResult>
  getLocalVcsStatus(workingPath: WorkingPath): Promise<LocalVcsStatusResult>
  getRemoteVcsStatus(workingPath: WorkingPath): Promise<RemoteVcsStatusResult>
  runStackedGitAction(
    workingPath: WorkingPath,
    options: GitRunStackedActionOptions,
  ): Promise<GitRunStackedActionResult>
  listChangeRequests(repositoryPath: RepositoryPath): Promise<ChangeRequestListResult>
  /**
   * Adopt a change request. `checkout` switches the repository's checkout; `fetch` only makes the
   * ref available, which is what a worktree-mode session needs - switching the user's own
   * checkout as a side effect targets a tree the session does not run in.
   */
  checkoutChangeRequest(
    repositoryPath: RepositoryPath,
    reference: string,
    adoption: ChangeRequestAdoption,
  ): Promise<ChangeRequestCheckoutResult>

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

  // Auth
  startOAuth(provider: OAuthProvider): Promise<void>
  submitAuthCode(provider: OAuthProvider, code: string): Promise<void>
  cancelOAuth(provider: OAuthProvider): Promise<void>
  setProviderApiKey(provider: string, apiKey: string): Promise<void>
  disconnectAuth(provider: OAuthProvider): Promise<void>
  getAuthAccountInfo(provider: OAuthProvider): Promise<OAuthAccountInfo>
  onOAuthStatus(callback: (status: IpcEventPayload<'auth:oauth-status'>) => void): () => void

  /*
   * Feedback moved to its own interface on main, and the Waggle presets to this branch's Waggle interface, so
   * neither side's block belongs here any more.
   */

  // Composer
  suggestFiles(projectPath: string, query: string): Promise<FileSuggestion[]>
}
