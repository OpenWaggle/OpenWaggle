import type { AgentSendPayload } from './agent'
import type { SessionBranchId, SessionId, SessionNodeId } from './brand'
import type { ContextCompactionResult, ContextUsageSnapshot } from './context-usage'
import type { ProviderInfo, SupportedModelId } from './llm'
import type { McpSetServerEnabledInput, McpSettingsView, McpWriteSourceConfigInput } from './mcp'
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

// ─── IPC Channel Map ─────────────────────────────────────────
// Single source of truth for every IPC channel.
// Each entry defines: [channel name, args tuple, return type]

export interface IpcCoreInvokeChannelMap {
  'agent:send-message': {
    args: [sessionId: SessionId, payload: AgentSendPayload, model: SupportedModelId]
    return: undefined
  }
  'agent:cancel': {
    args: [sessionId?: SessionId]
    return: undefined
  }
  'agent:steer': {
    args: [sessionId: SessionId]
    return: { preserved: boolean }
  }
  'agent:get-context-usage': {
    args: [sessionId: SessionId, model: SupportedModelId]
    return: ContextUsageSnapshot | null
  }
  'agent:compact-session': {
    args: [sessionId: SessionId, model: SupportedModelId, customInstructions?: string]
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
  'pi-settings:get-tree-filter-mode': {
    args: [projectPath?: string | null]
    return: SessionTreeFilterMode
  }
  'pi-settings:set-tree-filter-mode': {
    args: [mode: SessionTreeFilterMode, projectPath?: string | null]
    return: undefined
  }
  'pi-settings:get-branch-summary-skip-prompt': {
    args: [projectPath?: string | null]
    return: boolean
  }
  'settings:test-api-key': {
    args: [provider: string, apiKey: string, projectPath?: string | null]
    return: { success: boolean; error?: string }
  }
  'mcp:get-settings': {
    args: [projectPath?: string | null]
    return: McpSettingsView
  }
  'mcp:set-adapter-enabled': {
    args: [enabled: boolean, projectPath?: string | null]
    return: McpSettingsView
  }
  'mcp:set-server-enabled': {
    args: [input: McpSetServerEnabledInput]
    return: McpSettingsView
  }
  'mcp:write-source-config': {
    args: [input: McpWriteSourceConfigInput]
    return: McpSettingsView
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
  'sessions:list-details': {
    args: [limit?: number]
    return: SessionDetail[]
  }
  'sessions:get-detail': {
    args: [id: SessionId]
    return: SessionDetail | null
  }
  'sessions:create': {
    args: [projectPath: string]
    return: SessionDetail
  }
  'sessions:fork-to-new': {
    args: [sessionId: SessionId, model: SupportedModelId, targetNodeId: SessionNodeId]
    return: SessionCopyToNewResult
  }
  'sessions:clone-to-new': {
    args: [sessionId: SessionId, model: SupportedModelId, targetNodeId: SessionNodeId]
    return: SessionCopyToNewResult
  }
  'sessions:dismiss-interrupted-run': {
    args: [sessionId: SessionId, runId: string]
    return: undefined
  }
  'sessions:delete': {
    args: [id: SessionId]
    return: undefined
  }
  'sessions:archive': {
    args: [id: SessionId]
    return: undefined
  }
  'sessions:unarchive': {
    args: [id: SessionId]
    return: undefined
  }
  'sessions:list-archived': {
    args: []
    return: SessionSummary[]
  }
  'sessions:update-title': {
    args: [id: SessionId, title: string]
    return: undefined
  }
  'sessions:list': {
    args: [limit?: number]
    return: SessionSummary[]
  }
  'sessions:list-archived-branches': {
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
  'sessions:rename-branch': {
    args: [sessionId: SessionId, branchId: SessionBranchId, name: string]
    return: undefined
  }
  'sessions:archive-branch': {
    args: [sessionId: SessionId, branchId: SessionBranchId]
    return: undefined
  }
  'sessions:restore-branch': {
    args: [sessionId: SessionId, branchId: SessionBranchId]
    return: undefined
  }
  'sessions:update-tree-ui-state': {
    args: [sessionId: SessionId, patch: SessionTreeUiStatePatch]
    return: undefined
  }
  'providers:get-models': {
    args: [projectPath?: string | null]
    return: ProviderInfo[]
  }
}
