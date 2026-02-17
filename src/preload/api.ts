import type { ConversationId, ToolCallId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { HiveCodeApi } from '@shared/types/ipc'
import type { ModelDisplayInfo, ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import type { ToolApprovalRequest, ToolApprovalStatus } from '@shared/types/tools'
import type { StreamChunk } from '@tanstack/ai'
import { ipcRenderer } from 'electron'

/**
 * Typed API exposed to the renderer via contextBridge.
 * Every method maps to a specific IPC channel with strict types.
 */
export const api: HiveCodeApi = {
  // ─── Agent ───────────────────────────────────────────
  sendMessage(
    conversationId: ConversationId,
    content: string,
    model: SupportedModelId,
  ): Promise<void> {
    return ipcRenderer.invoke('agent:send-message', conversationId, content, model)
  },

  cancelAgent(conversationId?: ConversationId): void {
    ipcRenderer.send('agent:cancel', conversationId)
  },

  onStreamChunk(callback: (chunk: StreamChunk) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: StreamChunk): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:stream-chunk', handler)
    return () => ipcRenderer.removeListener('agent:stream-chunk', handler)
  },

  // ─── Tool Approval ──────────────────────────────────
  respondToolApproval(callId: ToolCallId, status: ToolApprovalStatus): void {
    ipcRenderer.send('tool:approval-response', callId, status)
  },

  onToolApproval(callback: (request: ToolApprovalRequest) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: ToolApprovalRequest): void => {
      callback(payload)
    }
    ipcRenderer.on('tool:approval-request', handler)
    return () => ipcRenderer.removeListener('tool:approval-request', handler)
  },

  // ─── Settings ────────────────────────────────────────
  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke('settings:get')
  },

  updateSettings(settings: Partial<Settings>): Promise<void> {
    return ipcRenderer.invoke('settings:update', settings)
  },

  testApiKey(provider: string, apiKey: string, baseUrl?: string): Promise<boolean> {
    return ipcRenderer.invoke('settings:test-api-key', provider, apiKey, baseUrl)
  },

  // ─── Providers ───────────────────────────────────────
  getProviderModels(): Promise<ProviderInfo[]> {
    return ipcRenderer.invoke('providers:get-models')
  },

  fetchProviderModels(
    provider: Provider,
    baseUrl?: string,
    apiKey?: string,
  ): Promise<ModelDisplayInfo[]> {
    return ipcRenderer.invoke('providers:fetch-models', provider, baseUrl, apiKey)
  },

  // ─── Project ─────────────────────────────────────────
  selectProjectFolder(): Promise<string | null> {
    return ipcRenderer.invoke('project:select-folder')
  },

  // ─── Conversations ──────────────────────────────────
  listConversations(): Promise<ConversationSummary[]> {
    return ipcRenderer.invoke('conversations:list')
  },

  getConversation(id: ConversationId): Promise<Conversation | null> {
    return ipcRenderer.invoke('conversations:get', id)
  },

  createConversation(model: SupportedModelId, projectPath: string | null): Promise<Conversation> {
    return ipcRenderer.invoke('conversations:create', model, projectPath)
  },

  deleteConversation(id: ConversationId): Promise<void> {
    return ipcRenderer.invoke('conversations:delete', id)
  },

  updateConversationTitle(id: ConversationId, title: string): Promise<void> {
    return ipcRenderer.invoke('conversations:update-title', id, title)
  },
}
