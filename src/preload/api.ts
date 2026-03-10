import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeReturn,
  IpcSendArgs,
  IpcSendChannel,
  OpenWaggleApi,
} from '@shared/types/ipc'
import { ipcRenderer } from 'electron'

function invoke<C extends IpcInvokeChannel>(
  channel: C,
): (...args: IpcInvokeArgs<C>) => Promise<IpcInvokeReturn<C>> {
  return (...args) => ipcRenderer.invoke(channel, ...args)
}

function send<C extends IpcSendChannel>(channel: C): (...args: IpcSendArgs<C>) => void {
  return (...args) => {
    ipcRenderer.send(channel, ...args)
  }
}

function on<C extends IpcEventChannel>(
  channel: C,
): (callback: (payload: IpcEventPayload<C>) => void) => () => void {
  return (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: IpcEventPayload<C>): void => {
      callback(payload)
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * Typed API exposed to the renderer via contextBridge.
 * Every method maps to a specific IPC channel with strict types.
 */
export const api: OpenWaggleApi = {
  // Agent
  sendMessage: invoke('agent:send-message'),
  cancelAgent: send('agent:cancel'),
  steerAgent: invoke('agent:steer'),
  onStreamChunk: on('agent:stream-chunk'),

  // Context Injection
  injectContext: send('agent:inject-context'),
  onContextInjected: on('agent:context-injected'),

  // Agent Questions
  answerQuestion: invoke('agent:answer-question'),
  getAgentPhase: invoke('agent:get-phase'),
  getBackgroundRun: invoke('agent:get-background-run'),
  listActiveRuns: invoke('agent:list-active-runs'),
  onRunCompleted: on('agent:run-completed'),
  onQuestion: on('agent:question'),
  onAgentPhase: on('agent:phase'),

  // Plan Proposals
  respondToPlan: invoke('agent:respond-to-plan'),
  onPlanProposal: on('agent:plan-proposal'),

  // Settings
  getSettings: invoke('settings:get'),
  updateSettings: invoke('settings:update'),
  testApiKey: invoke('settings:test-api-key'),

  // Providers
  getProviderModels: invoke('providers:get-models'),
  fetchProviderModels: invoke('providers:fetch-models'),

  // Project
  selectProjectFolder: invoke('project:select-folder'),
  isProjectToolCallTrusted: invoke('project-config:is-tool-call-trusted'),
  recordProjectToolApproval: invoke('project-config:record-tool-approval'),

  // Conversations
  listConversations: invoke('conversations:list'),
  getConversation: invoke('conversations:get'),
  createConversation: invoke('conversations:create'),
  deleteConversation: invoke('conversations:delete'),
  archiveConversation: invoke('conversations:archive'),
  unarchiveConversation: invoke('conversations:unarchive'),
  listArchivedConversations: invoke('conversations:list-archived'),
  updateConversationTitle: invoke('conversations:update-title'),
  updateConversationProjectPath: invoke('conversations:update-project-path'),
  onConversationTitleUpdated: on('conversations:title-updated'),

  // Devtools
  getDevtoolsEventBusConfig: invoke('devtools:get-event-bus-config'),

  // Terminal
  createTerminal: invoke('terminal:create'),
  closeTerminal: invoke('terminal:close'),
  resizeTerminal: invoke('terminal:resize'),
  writeTerminal: send('terminal:write'),
  onTerminalData: on('terminal:data'),

  // Window
  onFullscreenChanged: on('window:fullscreen-changed'),

  // Git
  getGitStatus: invoke('git:status'),
  commitGit: invoke('git:commit'),
  getGitDiff: invoke('git:diff'),
  listGitBranches: invoke('git:branches:list'),
  checkoutGitBranch: invoke('git:branches:checkout'),
  createGitBranch: invoke('git:branches:create'),
  renameGitBranch: invoke('git:branches:rename'),
  deleteGitBranch: invoke('git:branches:delete'),
  setGitBranchUpstream: invoke('git:branches:set-upstream'),

  // Attachments
  prepareAttachments: invoke('attachments:prepare'),
  prepareAttachmentFromText: invoke('attachments:prepare-from-text'),
  onPrepareAttachmentFromTextProgress: on('attachments:prepare-from-text-progress'),

  // Voice
  transcribeVoiceLocal: invoke('voice:transcribe-local'),

  // Standards & Skills
  getStandardsStatus: invoke('standards:get-status'),
  getEffectiveAgents: invoke('standards:get-effective-agents'),
  listSkills: invoke('skills:list'),
  setSkillEnabled: invoke('skills:set-enabled'),
  getSkillPreview: invoke('skills:get-preview'),

  // Shell / App
  copyToClipboard: send('clipboard:write-text'),
  openLogsDir: invoke('app:open-logs-dir'),
  getLogsPath: invoke('app:get-logs-path'),

  // Dialog
  showConfirm: invoke('dialog:confirm'),

  // Orchestration
  getOrchestrationRun: invoke('orchestration:get-run'),
  listOrchestrationRuns: invoke('orchestration:list-runs'),
  cancelOrchestrationRun: invoke('orchestration:cancel-run'),
  onOrchestrationEvent: on('orchestration:event'),

  // Waggle
  sendWaggleMessage: invoke('agent:send-waggle-message'),
  cancelWaggle: send('agent:cancel-waggle'),
  onWaggleStreamChunk: on('waggle:stream-chunk'),
  onWaggleTurnEvent: on('waggle:turn-event'),

  // Auth
  startOAuth: invoke('auth:start-oauth'),
  submitAuthCode: invoke('auth:submit-code'),
  disconnectAuth: invoke('auth:disconnect'),
  getAuthAccountInfo: invoke('auth:get-account-info'),
  onOAuthStatus: on('auth:oauth-status'),

  // MCP
  listMcpServers: invoke('mcp:list-servers'),
  addMcpServer: invoke('mcp:add-server'),
  removeMcpServer: invoke('mcp:remove-server'),
  toggleMcpServer: invoke('mcp:toggle-server'),
  updateMcpServer: invoke('mcp:update-server'),
  onMcpStatusChanged: on('mcp:status-changed'),

  // Teams
  listTeams: invoke('teams:list'),
  saveTeam: invoke('teams:save'),
  deleteTeam: invoke('teams:delete'),

  // Sub-Agents
  onSubAgentEvent: on('sub-agent:event'),
  onTeamEvent: on('team:event'),

  // Feedback
  checkGhCli: invoke('feedback:check-gh'),
  collectDiagnostics: invoke('feedback:collect-diagnostics'),
  getRecentLogs: invoke('feedback:get-recent-logs'),
  submitFeedback: invoke('feedback:submit'),
  generateFeedbackMarkdown: invoke('feedback:generate-markdown'),
  openExternal: invoke('shell:open-external'),
}
