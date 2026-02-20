import type { StreamChunk } from '@tanstack/ai'
import type { AgentSendPayload, PreparedAttachment } from './agent'
import type { ConversationId } from './brand'
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
import type { OrchestrationEventPayload, OrchestrationRunRecord } from './orchestration'
import type { QuestionAnswer, QuestionPayload } from './question'
import type { Provider, Settings } from './settings'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from './standards'
import type { VoiceTranscriptionRequest, VoiceTranscriptionResult } from './voice'

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
    args: []
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
}

/**
 * Send channels — one-way, renderer → main (no response)
 */
export interface IpcSendChannelMap {
  'agent:cancel': {
    args: [conversationId?: ConversationId]
  }
  'terminal:write': {
    args: [terminalId: string, data: string]
  }
}

/**
 * Event channels — one-way, main → renderer
 */
export interface IpcEventChannelMap {
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
  'window:fullscreen-changed': {
    payload: boolean
  }
  'orchestration:event': {
    payload: OrchestrationEventPayload
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

/** Extract payload for an event channel */
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventChannelMap[C]['payload']

// ─── Typed API Surface ───────────────────────────────────────
// This is what the preload exposes to the renderer via contextBridge.

// ─── Convenience API (what we actually expose on window.api) ─

export interface OpenHiveApi {
  // Agent
  sendMessage(
    conversationId: ConversationId,
    payload: AgentSendPayload,
    model: SupportedModelId,
  ): Promise<void>
  cancelAgent(conversationId?: ConversationId): void
  /** Subscribe to raw StreamChunks from TanStack AI — used by the IPC connection adapter */
  onStreamChunk(
    callback: (payload: { conversationId: ConversationId; chunk: StreamChunk }) => void,
  ): () => void

  // Agent questions
  answerQuestion(conversationId: ConversationId, answers: QuestionAnswer[]): Promise<void>
  onQuestion(callback: (payload: QuestionPayload) => void): () => void

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
  listConversations(): Promise<ConversationSummary[]>
  getConversation(id: ConversationId): Promise<Conversation | null>
  createConversation(projectPath: string | null): Promise<Conversation>
  deleteConversation(id: ConversationId): Promise<void>
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
  onTerminalData(callback: (payload: { terminalId: string; data: string }) => void): () => void

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

  // Orchestration
  getOrchestrationRun(runId: string): Promise<OrchestrationRunRecord | null>
  listOrchestrationRuns(conversationId?: ConversationId): Promise<OrchestrationRunRecord[]>
  cancelOrchestrationRun(runId: string): Promise<void>
  onOrchestrationEvent(callback: (payload: OrchestrationEventPayload) => void): () => void
}
