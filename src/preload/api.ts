import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import type { ActiveRunInfo, BackgroundRunSnapshot } from '@shared/types/background-run'
import type { ConversationId, McpServerId, TeamConfigId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { DevtoolsEventBusConfig } from '@shared/types/devtools'
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
} from '@shared/types/git'
import type { OpenWaggleApi } from '@shared/types/ipc'
import type { ModelDisplayInfo, ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { McpServerConfig, McpServerStatus } from '@shared/types/mcp'
import type { OrchestrationEventPayload, OrchestrationRunRecord } from '@shared/types/orchestration'
import type { AgentPhaseEventPayload, AgentPhaseState } from '@shared/types/phase'
import type { PlanPayload, PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer, QuestionPayload } from '@shared/types/question'
import type { Provider, Settings } from '@shared/types/settings'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from '@shared/types/standards'
import type { SubAgentEventPayload, TeamEventPayload } from '@shared/types/sub-agent'
import type { VoiceTranscriptionRequest, VoiceTranscriptionResult } from '@shared/types/voice'
import type {
  WaggleConfig,
  WaggleStreamMetadata,
  WaggleTeamPreset,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import type { StreamChunk } from '@tanstack/ai'
import { ipcRenderer } from 'electron'

type PrepareAttachmentFromTextProgressPayload = Parameters<
  OpenWaggleApi['onPrepareAttachmentFromTextProgress']
>[0] extends (payload: infer T) => void
  ? T
  : never

/**
 * Typed API exposed to the renderer via contextBridge.
 * Every method maps to a specific IPC channel with strict types.
 */
export const api: OpenWaggleApi = {
  // ─── Agent ───────────────────────────────────────────
  sendMessage(
    conversationId: ConversationId,
    payload: AgentSendPayload,
    model: SupportedModelId,
  ): Promise<void> {
    return ipcRenderer.invoke('agent:send-message', conversationId, payload, model)
  },

  cancelAgent(conversationId?: ConversationId): void {
    ipcRenderer.send('agent:cancel', conversationId)
  },

  steerAgent(conversationId: ConversationId): Promise<{ preserved: boolean }> {
    return ipcRenderer.invoke('agent:steer', conversationId)
  },

  onStreamChunk(
    callback: (payload: { conversationId: ConversationId; chunk: StreamChunk }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { conversationId: ConversationId; chunk: StreamChunk },
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:stream-chunk', handler)
    return () => ipcRenderer.removeListener('agent:stream-chunk', handler)
  },

  // ─── Context Injection ───────────────────────────────
  injectContext(conversationId: ConversationId, text: string): void {
    ipcRenderer.send('agent:inject-context', conversationId, text)
  },

  onContextInjected(
    callback: (payload: {
      conversationId: ConversationId
      text: string
      timestamp: number
    }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { conversationId: ConversationId; text: string; timestamp: number },
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:context-injected', handler)
    return () => ipcRenderer.removeListener('agent:context-injected', handler)
  },

  // ─── Agent Questions ─────────────────────────────────
  answerQuestion(conversationId: ConversationId, answers: QuestionAnswer[]): Promise<void> {
    return ipcRenderer.invoke('agent:answer-question', conversationId, answers)
  },

  getAgentPhase(conversationId: ConversationId): Promise<AgentPhaseState | null> {
    return ipcRenderer.invoke('agent:get-phase', conversationId)
  },

  getBackgroundRun(conversationId: ConversationId): Promise<BackgroundRunSnapshot | null> {
    return ipcRenderer.invoke('agent:get-background-run', conversationId)
  },

  listActiveRuns(): Promise<ActiveRunInfo[]> {
    return ipcRenderer.invoke('agent:list-active-runs')
  },

  onRunCompleted(callback: (payload: { conversationId: ConversationId }) => void): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { conversationId: ConversationId },
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:run-completed', handler)
    return () => ipcRenderer.removeListener('agent:run-completed', handler)
  },

  onQuestion(callback: (payload: QuestionPayload) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: QuestionPayload): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:question', handler)
    return () => ipcRenderer.removeListener('agent:question', handler)
  },

  onAgentPhase(callback: (payload: AgentPhaseEventPayload) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentPhaseEventPayload): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:phase', handler)
    return () => ipcRenderer.removeListener('agent:phase', handler)
  },

  // ─── Plan Proposals ────────────────────────────────
  respondToPlan(conversationId: ConversationId, response: PlanResponse): Promise<void> {
    return ipcRenderer.invoke('agent:respond-to-plan', conversationId, response)
  },

  onPlanProposal(callback: (payload: PlanPayload) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: PlanPayload): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:plan-proposal', handler)
    return () => ipcRenderer.removeListener('agent:plan-proposal', handler)
  },

  // ─── Settings ────────────────────────────────────────
  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke('settings:get')
  },

  updateSettings(
    settings: Partial<Settings>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return ipcRenderer.invoke('settings:update', settings)
  },

  testApiKey(
    provider: string,
    apiKey: string,
    baseUrl?: string,
  ): Promise<{ success: boolean; error?: string }> {
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
  listConversations(limit?: number): Promise<ConversationSummary[]> {
    return ipcRenderer.invoke('conversations:list', limit)
  },

  getConversation(id: ConversationId): Promise<Conversation | null> {
    return ipcRenderer.invoke('conversations:get', id)
  },

  createConversation(projectPath: string | null): Promise<Conversation> {
    return ipcRenderer.invoke('conversations:create', projectPath)
  },

  deleteConversation(id: ConversationId): Promise<void> {
    return ipcRenderer.invoke('conversations:delete', id)
  },

  archiveConversation(id: ConversationId): Promise<void> {
    return ipcRenderer.invoke('conversations:archive', id)
  },

  unarchiveConversation(id: ConversationId): Promise<void> {
    return ipcRenderer.invoke('conversations:unarchive', id)
  },

  listArchivedConversations(): Promise<ConversationSummary[]> {
    return ipcRenderer.invoke('conversations:list-archived')
  },

  updateConversationTitle(id: ConversationId, title: string): Promise<void> {
    return ipcRenderer.invoke('conversations:update-title', id, title)
  },

  updateConversationProjectPath(
    id: ConversationId,
    projectPath: string | null,
  ): Promise<Conversation | null> {
    return ipcRenderer.invoke('conversations:update-project-path', id, projectPath)
  },

  getDevtoolsEventBusConfig(): Promise<DevtoolsEventBusConfig> {
    return ipcRenderer.invoke('devtools:get-event-bus-config')
  },

  // ─── Terminal ──────────────────────────────────────────
  createTerminal(projectPath: string): Promise<string> {
    return ipcRenderer.invoke('terminal:create', projectPath)
  },

  closeTerminal(terminalId: string): Promise<void> {
    return ipcRenderer.invoke('terminal:close', terminalId)
  },

  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void> {
    return ipcRenderer.invoke('terminal:resize', terminalId, cols, rows)
  },

  writeTerminal(terminalId: string, data: string): void {
    ipcRenderer.send('terminal:write', terminalId, data)
  },

  onTerminalData(callback: (payload: { terminalId: string; data: string }) => void): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { terminalId: string; data: string },
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },

  // ─── Window ──────────────────────────────────────────
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: boolean): void => {
      callback(payload)
    }
    ipcRenderer.on('window:fullscreen-changed', handler)
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler)
  },

  // ─── Git ─────────────────────────────────────────────
  getGitStatus(projectPath: string): Promise<GitStatusSummary> {
    return ipcRenderer.invoke('git:status', projectPath)
  },

  commitGit(projectPath: string, payload: GitCommitPayload): Promise<GitCommitResult> {
    return ipcRenderer.invoke('git:commit', projectPath, payload)
  },

  getGitDiff(projectPath: string): Promise<GitFileDiff[]> {
    return ipcRenderer.invoke('git:diff', projectPath)
  },

  listGitBranches(projectPath: string): Promise<GitBranchListResult> {
    return ipcRenderer.invoke('git:branches:list', projectPath)
  },

  checkoutGitBranch(
    projectPath: string,
    payload: GitBranchCheckoutPayload,
  ): Promise<GitBranchMutationResult> {
    return ipcRenderer.invoke('git:branches:checkout', projectPath, payload)
  },

  createGitBranch(
    projectPath: string,
    payload: GitBranchCreatePayload,
  ): Promise<GitBranchMutationResult> {
    return ipcRenderer.invoke('git:branches:create', projectPath, payload)
  },

  renameGitBranch(
    projectPath: string,
    payload: GitBranchRenamePayload,
  ): Promise<GitBranchMutationResult> {
    return ipcRenderer.invoke('git:branches:rename', projectPath, payload)
  },

  deleteGitBranch(
    projectPath: string,
    payload: GitBranchDeletePayload,
  ): Promise<GitBranchMutationResult> {
    return ipcRenderer.invoke('git:branches:delete', projectPath, payload)
  },

  setGitBranchUpstream(
    projectPath: string,
    payload: GitBranchSetUpstreamPayload,
  ): Promise<GitBranchMutationResult> {
    return ipcRenderer.invoke('git:branches:set-upstream', projectPath, payload)
  },

  prepareAttachments(projectPath: string, paths: string[]): Promise<PreparedAttachment[]> {
    return ipcRenderer.invoke('attachments:prepare', projectPath, paths)
  },

  prepareAttachmentFromText(text: string, operationId: string): Promise<PreparedAttachment> {
    return ipcRenderer.invoke('attachments:prepare-from-text', text, operationId)
  },

  onPrepareAttachmentFromTextProgress(
    callback: (payload: PrepareAttachmentFromTextProgressPayload) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: PrepareAttachmentFromTextProgressPayload,
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('attachments:prepare-from-text-progress', handler)
    return () => ipcRenderer.removeListener('attachments:prepare-from-text-progress', handler)
  },

  transcribeVoiceLocal(payload: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult> {
    return ipcRenderer.invoke('voice:transcribe-local', payload)
  },

  getStandardsStatus(
    projectPath: string,
  ): Promise<{ agents: AgentsInstructionStatus; agentsPath: string; error?: string }> {
    return ipcRenderer.invoke('standards:get-status', projectPath)
  },

  getEffectiveAgents(projectPath: string, targetPath?: string): Promise<AgentsResolutionResult> {
    return ipcRenderer.invoke('standards:get-effective-agents', projectPath, targetPath)
  },

  listSkills(projectPath: string): Promise<SkillCatalogResult> {
    return ipcRenderer.invoke('skills:list', projectPath)
  },

  setSkillEnabled(projectPath: string, skillId: string, enabled: boolean): Promise<void> {
    return ipcRenderer.invoke('skills:set-enabled', projectPath, skillId, enabled)
  },

  getSkillPreview(projectPath: string, skillId: string): Promise<{ markdown: string }> {
    return ipcRenderer.invoke('skills:get-preview', projectPath, skillId)
  },

  // ─── Shell / App ────────────────────────────────────
  copyToClipboard(text: string): void {
    ipcRenderer.send('clipboard:write-text', text)
  },

  openLogsDir(): Promise<void> {
    return ipcRenderer.invoke('app:open-logs-dir')
  },

  getLogsPath(): Promise<string> {
    return ipcRenderer.invoke('app:get-logs-path')
  },

  // ─── Dialog ─────────────────────────────────────────
  showConfirm(message: string, detail?: string): Promise<boolean> {
    return ipcRenderer.invoke('dialog:confirm', message, detail)
  },

  getOrchestrationRun(runId: string): Promise<OrchestrationRunRecord | null> {
    return ipcRenderer.invoke('orchestration:get-run', runId)
  },

  listOrchestrationRuns(conversationId?: ConversationId): Promise<OrchestrationRunRecord[]> {
    return ipcRenderer.invoke('orchestration:list-runs', conversationId)
  },

  cancelOrchestrationRun(runId: string): Promise<void> {
    return ipcRenderer.invoke('orchestration:cancel-run', runId)
  },

  onOrchestrationEvent(callback: (payload: OrchestrationEventPayload) => void): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: OrchestrationEventPayload,
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('orchestration:event', handler)
    return () => ipcRenderer.removeListener('orchestration:event', handler)
  },

  // ─── Waggle Mode ──────────────────────────────────────
  sendWaggleMessage(
    conversationId: ConversationId,
    payload: AgentSendPayload,
    config: WaggleConfig,
  ): Promise<void> {
    return ipcRenderer.invoke('agent:send-waggle-message', conversationId, payload, config)
  },

  cancelWaggle(conversationId: ConversationId): void {
    ipcRenderer.send('agent:cancel-waggle', conversationId)
  },

  onWaggleStreamChunk(
    callback: (payload: {
      conversationId: ConversationId
      chunk: StreamChunk
      meta: WaggleStreamMetadata
    }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        conversationId: ConversationId
        chunk: StreamChunk
        meta: WaggleStreamMetadata
      },
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('waggle:stream-chunk', handler)
    return () => ipcRenderer.removeListener('waggle:stream-chunk', handler)
  },

  onWaggleTurnEvent(
    callback: (payload: { conversationId: ConversationId; event: WaggleTurnEvent }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { conversationId: ConversationId; event: WaggleTurnEvent },
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('waggle:turn-event', handler)
    return () => ipcRenderer.removeListener('waggle:turn-event', handler)
  },

  // ─── Auth ─────────────────────────────────────────────
  startOAuth(provider: SubscriptionProvider): Promise<void> {
    return ipcRenderer.invoke('auth:start-oauth', provider)
  },

  submitAuthCode(provider: SubscriptionProvider, code: string): Promise<void> {
    return ipcRenderer.invoke('auth:submit-code', provider, code)
  },

  disconnectAuth(provider: SubscriptionProvider): Promise<void> {
    return ipcRenderer.invoke('auth:disconnect', provider)
  },

  getAuthAccountInfo(provider: SubscriptionProvider): Promise<SubscriptionAccountInfo> {
    return ipcRenderer.invoke('auth:get-account-info', provider)
  },

  onOAuthStatus(callback: (status: OAuthFlowStatus) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, status: OAuthFlowStatus): void => {
      callback(status)
    }
    ipcRenderer.on('auth:oauth-status', handler)
    return () => ipcRenderer.removeListener('auth:oauth-status', handler)
  },

  // ─── MCP ──────────────────────────────────────────────
  listMcpServers(): Promise<McpServerStatus[]> {
    return ipcRenderer.invoke('mcp:list-servers')
  },

  addMcpServer(
    config: Omit<McpServerConfig, 'id'>,
  ): Promise<{ ok: true; id: McpServerId } | { ok: false; error: string }> {
    return ipcRenderer.invoke('mcp:add-server', config)
  },

  removeMcpServer(id: McpServerId): Promise<{ ok: true } | { ok: false; error: string }> {
    return ipcRenderer.invoke('mcp:remove-server', id)
  },

  toggleMcpServer(
    id: McpServerId,
    enabled: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return ipcRenderer.invoke('mcp:toggle-server', id, enabled)
  },

  updateMcpServer(
    id: McpServerId,
    updates: Partial<Omit<McpServerConfig, 'id'>>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return ipcRenderer.invoke('mcp:update-server', id, updates)
  },

  onMcpStatusChanged(callback: (payload: McpServerStatus) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: McpServerStatus): void => {
      callback(payload)
    }
    ipcRenderer.on('mcp:status-changed', handler)
    return () => ipcRenderer.removeListener('mcp:status-changed', handler)
  },

  // ─── Teams ────────────────────────────────────────────
  listTeams(): Promise<WaggleTeamPreset[]> {
    return ipcRenderer.invoke('teams:list')
  },

  saveTeam(preset: WaggleTeamPreset): Promise<WaggleTeamPreset> {
    return ipcRenderer.invoke('teams:save', preset)
  },

  deleteTeam(id: TeamConfigId): Promise<void> {
    return ipcRenderer.invoke('teams:delete', id)
  },

  // ─── Sub-Agents ──────────────────────────────────────
  onSubAgentEvent(callback: (payload: SubAgentEventPayload) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: SubAgentEventPayload): void => {
      callback(payload)
    }
    ipcRenderer.on('sub-agent:event', handler)
    return () => ipcRenderer.removeListener('sub-agent:event', handler)
  },

  onTeamEvent(callback: (payload: TeamEventPayload) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: TeamEventPayload): void => {
      callback(payload)
    }
    ipcRenderer.on('team:event', handler)
    return () => ipcRenderer.removeListener('team:event', handler)
  },
}
