import type { StreamChunk } from '@tanstack/ai'
import type { ConversationId } from './brand'
import type { Conversation, ConversationSummary } from './conversation'
import type { GitCommitPayload, GitCommitResult, GitStatusSummary } from './git'
import type { ModelDisplayInfo, ProviderInfo, SupportedModelId } from './llm'
import type { QuestionAnswer, QuestionPayload } from './question'
import type { Provider, Settings } from './settings'

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
    args: [conversationId: ConversationId, content: string, model: SupportedModelId]
    return: undefined
  }
  'settings:get': {
    args: []
    return: Settings
  }
  'settings:update': {
    args: [settings: Partial<Settings>]
    return: undefined
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
  'agent:answer-question': {
    args: [conversationId: ConversationId, answers: QuestionAnswer[]]
    return: void
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
    content: string,
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
  updateSettings(settings: Partial<Settings>): Promise<void>
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
}
