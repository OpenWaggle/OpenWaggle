import type { StreamChunk } from '@tanstack/ai'
import type { AgentSendPayload, PreparedAttachment } from './agent'
import type { OAuthFlowStatus, SubscriptionAccountInfo, SubscriptionProvider } from './auth'
import type { ConversationId, McpServerId, TeamConfigId } from './brand'
import type { Conversation, ConversationSummary } from './conversation'
import type { DevtoolsEventBusConfig } from './devtools'
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
import type { ModelDisplayInfo, ProviderInfo, SupportedModelId } from './llm'
import type { McpServerConfig, McpServerStatus } from './mcp'
import type { OrchestrationEventPayload, OrchestrationRunRecord } from './orchestration'
import type { AgentPhaseEventPayload, AgentPhaseState } from './phase'
import type { PlanPayload, PlanResponse } from './plan'
import type { QuestionAnswer, QuestionPayload } from './question'
import type { Provider, Settings } from './settings'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from './standards'
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
  'settings:get': {
    args: []
    return: Settings
  }
  'settings:update': {
    args: [settings: Partial<Settings>]
    return: { ok: true } | { ok: false; error: string }
  }
  'settings:test-api-key': {
    args: [provider: string, apiKey: string, baseUrl?: string]
    return: { success: boolean; error?: string }
  }
  'project:select-folder': {
    args: []
    return: string | null
  }
  'conversations:list': {
    args: [limit?: number]
    return: ConversationSummary[]
  }
  'conversations:get': {
    args: [id: ConversationId]
    return: Conversation | null
  }
  'conversations:create': {
    args: [projectPath: string | null]
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
  'conversations:update-project-path': {
    args: [id: ConversationId, projectPath: string | null]
    return: Conversation | null
  }
  'devtools:get-event-bus-config': {
    args: []
    return: DevtoolsEventBusConfig
  }
  'providers:get-models': {
    args: []
    return: ProviderInfo[]
  }
  'providers:fetch-models': {
    args: [provider: Provider, baseUrl?: string, apiKey?: string]
    return: ModelDisplayInfo[]
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
  'agent:answer-question': {
    args: [conversationId: ConversationId, answers: QuestionAnswer[]]
    return: undefined
  }
  'agent:respond-to-plan': {
    args: [conversationId: ConversationId, response: PlanResponse]
    return: undefined
  }
  'agent:get-phase': {
    args: [conversationId: ConversationId]
    return: AgentPhaseState | null
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
  'orchestration:get-run': {
    args: [runId: string]
    return: OrchestrationRunRecord | null
  }
  'orchestration:list-runs': {
    args: [conversationId?: ConversationId]
    return: OrchestrationRunRecord[]
  }
  'orchestration:cancel-run': {
    args: [runId: string]
    return: undefined
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
    args: [provider: SubscriptionProvider]
    return: undefined
  }
  'auth:disconnect': {
    args: [provider: SubscriptionProvider]
    return: undefined
  }
  'auth:get-account-info': {
    args: [provider: SubscriptionProvider]
    return: SubscriptionAccountInfo
  }
  'auth:submit-code': {
    args: [provider: SubscriptionProvider, code: string]
    return: undefined
  }
  // MCP
  'mcp:list-servers': {
    args: []
    return: McpServerStatus[]
  }
  'mcp:add-server': {
    args: [config: Omit<McpServerConfig, 'id'>]
    return: { ok: true; id: McpServerId } | { ok: false; error: string }
  }
  'mcp:remove-server': {
    args: [id: McpServerId]
    return: { ok: true } | { ok: false; error: string }
  }
  'mcp:toggle-server': {
    args: [id: McpServerId, enabled: boolean]
    return: { ok: true } | { ok: false; error: string }
  }
  'mcp:update-server': {
    args: [id: McpServerId, updates: Partial<Omit<McpServerConfig, 'id'>>]
    return: { ok: true } | { ok: false; error: string }
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
  'agent:inject-context': {
    args: [conversationId: ConversationId, text: string]
  }
}

/**
 * Event channels — one-way, main → renderer
 */
interface IpcEventChannelMap {
  /** Raw StreamChunk from TanStack AI — consumed by the useChat IPC adapter */
  'agent:stream-chunk': {
    payload: { conversationId: ConversationId; chunk: StreamChunk }
  }
  'terminal:data': {
    payload: { terminalId: string; data: string }
  }
  'agent:question': {
    payload: QuestionPayload
  }
  'agent:plan-proposal': {
    payload: PlanPayload
  }
  'agent:phase': {
    payload: AgentPhaseEventPayload
  }
  'window:fullscreen-changed': {
    payload: boolean
  }
  'orchestration:event': {
    payload: OrchestrationEventPayload
  }
  'auth:oauth-status': {
    payload: OAuthFlowStatus
  }
  'waggle:stream-chunk': {
    payload: { conversationId: ConversationId; chunk: StreamChunk; meta: WaggleStreamMetadata }
  }
  'waggle:turn-event': {
    payload: { conversationId: ConversationId; event: WaggleTurnEvent }
  }
  'mcp:status-changed': {
    payload: McpServerStatus
  }
  'agent:context-injected': {
    payload: { conversationId: ConversationId; text: string; timestamp: number }
  }
}

// ─── Derived Types ───────────────────────────────────────────

export type IpcInvokeChannel = keyof IpcInvokeChannelMap
export type IpcSendChannel = keyof IpcSendChannelMap

/** Extract args for an invoke channel */
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeChannelMap[C]['args']

/** Extract return type for an invoke channel */
export type IpcInvokeReturn<C extends IpcInvokeChannel> = IpcInvokeChannelMap[C]['return']

/** Extract args for a send channel */
export type IpcSendArgs<C extends IpcSendChannel> = IpcSendChannelMap[C]['args']

/** Extract payload type for an event channel. */
type IpcEventPayload<C extends keyof IpcEventChannelMap> = IpcEventChannelMap[C]['payload']

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
  /** Subscribe to raw StreamChunks from TanStack AI — used by the IPC connection adapter */
  onStreamChunk(callback: (payload: IpcEventPayload<'agent:stream-chunk'>) => void): () => void

  // Context injection
  injectContext(conversationId: ConversationId, text: string): void
  onContextInjected(
    callback: (payload: IpcEventPayload<'agent:context-injected'>) => void,
  ): () => void

  // Agent questions
  answerQuestion(conversationId: ConversationId, answers: QuestionAnswer[]): Promise<void>
  getAgentPhase(conversationId: ConversationId): Promise<AgentPhaseState | null>
  onQuestion(callback: (payload: IpcEventPayload<'agent:question'>) => void): () => void
  onAgentPhase(callback: (payload: IpcEventPayload<'agent:phase'>) => void): () => void

  // Plan proposals
  respondToPlan(conversationId: ConversationId, response: PlanResponse): Promise<void>
  onPlanProposal(callback: (payload: IpcEventPayload<'agent:plan-proposal'>) => void): () => void

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(settings: Partial<Settings>): Promise<{ ok: true } | { ok: false; error: string }>
  testApiKey(
    provider: string,
    apiKey: string,
    baseUrl?: string,
  ): Promise<{ success: boolean; error?: string }>

  // Providers
  getProviderModels(): Promise<ProviderInfo[]>
  fetchProviderModels(
    provider: Provider,
    baseUrl?: string,
    apiKey?: string,
  ): Promise<ModelDisplayInfo[]>

  // Project
  selectProjectFolder(): Promise<string | null>

  // Conversations
  listConversations(limit?: number): Promise<ConversationSummary[]>
  getConversation(id: ConversationId): Promise<Conversation | null>
  createConversation(projectPath: string | null): Promise<Conversation>
  deleteConversation(id: ConversationId): Promise<void>
  archiveConversation(id: ConversationId): Promise<void>
  unarchiveConversation(id: ConversationId): Promise<void>
  listArchivedConversations(): Promise<ConversationSummary[]>
  updateConversationTitle(id: ConversationId, title: string): Promise<void>
  updateConversationProjectPath(
    id: ConversationId,
    projectPath: string | null,
  ): Promise<Conversation | null>
  getDevtoolsEventBusConfig(): Promise<DevtoolsEventBusConfig>

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
  prepareAttachments(projectPath: string, paths: string[]): Promise<PreparedAttachment[]>

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
  openLogsDir(): Promise<void>
  getLogsPath(): Promise<string>

  // Orchestration
  getOrchestrationRun(runId: string): Promise<OrchestrationRunRecord | null>
  listOrchestrationRuns(conversationId?: ConversationId): Promise<OrchestrationRunRecord[]>
  cancelOrchestrationRun(runId: string): Promise<void>
  onOrchestrationEvent(
    callback: (payload: IpcEventPayload<'orchestration:event'>) => void,
  ): () => void

  // Waggle mode
  sendWaggleMessage(
    conversationId: ConversationId,
    payload: AgentSendPayload,
    config: WaggleConfig,
  ): Promise<void>
  cancelWaggle(conversationId: ConversationId): void
  onWaggleStreamChunk(
    callback: (payload: IpcEventPayload<'waggle:stream-chunk'>) => void,
  ): () => void
  onWaggleTurnEvent(callback: (payload: IpcEventPayload<'waggle:turn-event'>) => void): () => void

  // Auth
  startOAuth(provider: SubscriptionProvider): Promise<void>
  submitAuthCode(provider: SubscriptionProvider, code: string): Promise<void>
  disconnectAuth(provider: SubscriptionProvider): Promise<void>
  getAuthAccountInfo(provider: SubscriptionProvider): Promise<SubscriptionAccountInfo>
  onOAuthStatus(callback: (status: IpcEventPayload<'auth:oauth-status'>) => void): () => void

  // MCP
  listMcpServers(): Promise<McpServerStatus[]>
  addMcpServer(
    config: Omit<McpServerConfig, 'id'>,
  ): Promise<{ ok: true; id: McpServerId } | { ok: false; error: string }>
  removeMcpServer(id: McpServerId): Promise<{ ok: true } | { ok: false; error: string }>
  toggleMcpServer(
    id: McpServerId,
    enabled: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  updateMcpServer(
    id: McpServerId,
    updates: Partial<Omit<McpServerConfig, 'id'>>,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  onMcpStatusChanged(callback: (payload: McpServerStatus) => void): () => void

  // Teams
  listTeams(): Promise<WaggleTeamPreset[]>
  saveTeam(preset: WaggleTeamPreset): Promise<WaggleTeamPreset>
  deleteTeam(id: TeamConfigId): Promise<void>
}
