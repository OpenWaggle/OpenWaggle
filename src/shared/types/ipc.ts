import type { StreamChunk } from '@tanstack/ai'
import type { ConversationId, ToolCallId } from './brand'
import type { Conversation, ConversationSummary } from './conversation'
import type { ModelDisplayInfo, SupportedModelId } from './llm'
import type { Settings } from './settings'
import type { ToolApprovalRequest, ToolApprovalStatus } from './tools'

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
    return: boolean
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
    args: [model: SupportedModelId, projectPath: string | null]
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
    return: Array<{ provider: string; displayName: string; models: ModelDisplayInfo[] }>
  }
}

/**
 * Send channels — one-way, renderer → main (no response)
 */
export interface IpcSendChannelMap {
  'agent:cancel': {
    args: [conversationId?: ConversationId]
  }
  'tool:approval-response': {
    args: [callId: ToolCallId, status: ToolApprovalStatus]
  }
}

/**
 * Event channels — one-way, main → renderer
 */
export interface IpcEventChannelMap {
  /** Raw StreamChunk from TanStack AI — consumed by the useChat IPC adapter */
  'agent:stream-chunk': {
    payload: StreamChunk
  }
  'tool:approval-request': {
    payload: ToolApprovalRequest
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

export interface HiveCodeApi {
  // Agent
  sendMessage(
    conversationId: ConversationId,
    content: string,
    model: SupportedModelId,
  ): Promise<void>
  cancelAgent(conversationId?: ConversationId): void
  /** Subscribe to raw StreamChunks from TanStack AI — used by the IPC connection adapter */
  onStreamChunk(callback: (chunk: StreamChunk) => void): () => void

  // Tool approval
  respondToolApproval(callId: ToolCallId, status: ToolApprovalStatus): void
  onToolApproval(callback: (request: ToolApprovalRequest) => void): () => void

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(settings: Partial<Settings>): Promise<void>
  testApiKey(provider: string, apiKey: string, baseUrl?: string): Promise<boolean>

  // Providers
  getProviderModels(): Promise<
    Array<{ provider: string; displayName: string; models: ModelDisplayInfo[] }>
  >

  // Project
  selectProjectFolder(): Promise<string | null>

  // Conversations
  listConversations(): Promise<ConversationSummary[]>
  getConversation(id: ConversationId): Promise<Conversation | null>
  createConversation(model: SupportedModelId, projectPath: string | null): Promise<Conversation>
  deleteConversation(id: ConversationId): Promise<void>
  updateConversationTitle(id: ConversationId, title: string): Promise<void>
}
