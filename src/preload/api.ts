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
import { ipcRenderer, webUtils } from 'electron'

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
  onAgentEvent: on('agent:event'),

  getAgentPhase: invoke('agent:get-phase'),
  getBackgroundRun: invoke('agent:get-background-run'),
  listActiveRuns: invoke('agent:list-active-runs'),
  getContextUsage: invoke('agent:get-context-usage'),
  compactSession: invoke('agent:compact-session'),
  onRunCompleted: on('agent:run-completed'),
  onAgentPhase: on('agent:phase'),

  // Settings
  getSettings: invoke('settings:get'),
  updateSettings: invoke('settings:update'),
  setEnabledModels: invoke('settings:set-enabled-models'),
  getPiTreeFilterMode: invoke('pi-settings:get-tree-filter-mode'),
  setPiTreeFilterMode: invoke('pi-settings:set-tree-filter-mode'),
  getPiBranchSummarySkipPrompt: invoke('pi-settings:get-branch-summary-skip-prompt'),
  testApiKey: invoke('settings:test-api-key'),

  // Providers
  getProviderModels: invoke('providers:get-models'),

  // Project
  selectProjectFolder: invoke('project:select-folder'),
  getProjectPreferences: invoke('project-config:get-preferences'),
  setProjectPreferences: invoke('project-config:set-preferences'),

  // Sessions
  listSessions: invoke('sessions:list'),
  listSessionDetails: invoke('sessions:list-details'),
  getSessionDetail: invoke('sessions:get-detail'),
  createSession: invoke('sessions:create'),
  forkSessionToNew: invoke('sessions:fork-to-new'),
  cloneSessionToNew: invoke('sessions:clone-to-new'),
  dismissInterruptedSessionRun: invoke('sessions:dismiss-interrupted-run'),
  deleteSession: invoke('sessions:delete'),
  archiveSession: invoke('sessions:archive'),
  unarchiveSession: invoke('sessions:unarchive'),
  listArchivedSessions: invoke('sessions:list-archived'),
  updateSessionTitle: invoke('sessions:update-title'),
  listArchivedSessionBranches: invoke('sessions:list-archived-branches'),
  getSessionTree: invoke('sessions:get-tree'),
  getSessionWorkspace: invoke('sessions:get-workspace'),
  navigateSessionTree: invoke('sessions:navigate-tree'),
  renameSessionBranch: invoke('sessions:rename-branch'),
  archiveSessionBranch: invoke('sessions:archive-branch'),
  restoreSessionBranch: invoke('sessions:restore-branch'),
  updateSessionTreeUiState: invoke('sessions:update-tree-ui-state'),
  onSessionTitleUpdated: on('sessions:title-updated'),

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

  // File paths (preload-only, no IPC round-trip)
  getFilePath: (file: File) => webUtils.getPathForFile(file),

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

  // Waggle
  sendWaggleMessage: invoke('agent:send-waggle-message'),
  cancelWaggle: send('agent:cancel-waggle'),
  onWaggleEvent: on('waggle:event'),
  onWaggleTurnEvent: on('waggle:turn-event'),

  // Auth
  startOAuth: invoke('auth:start-oauth'),
  submitAuthCode: invoke('auth:submit-code'),
  cancelOAuth: invoke('auth:cancel-oauth'),
  setProviderApiKey: invoke('auth:set-api-key'),
  disconnectAuth: invoke('auth:disconnect'),
  getAuthAccountInfo: invoke('auth:get-account-info'),
  onOAuthStatus: on('auth:oauth-status'),

  // Waggle presets
  listWagglePresets: invoke('waggle-presets:list'),
  saveWagglePreset: invoke('waggle-presets:save'),
  deleteWagglePreset: invoke('waggle-presets:delete'),

  // Feedback
  checkGhCli: invoke('feedback:check-gh'),
  collectDiagnostics: invoke('feedback:collect-diagnostics'),
  getRecentLogs: invoke('feedback:get-recent-logs'),
  submitFeedback: invoke('feedback:submit'),
  generateFeedbackMarkdown: invoke('feedback:generate-markdown'),
  openExternal: invoke('shell:open-external'),

  // Composer
  suggestFiles: invoke('composer:file-suggest'),

  // Auto-updater
  checkForUpdates: invoke('updater:check'),
  installUpdate: invoke('updater:install'),
  getUpdateStatus: invoke('updater:get-status'),
  getAppVersion: invoke('app:get-version'),
  onUpdateStatus: on('updater:status-changed'),
}
