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
  return (...args: IpcInvokeArgs<C>) => ipcRenderer.invoke(channel, ...args)
}

function send<C extends IpcSendChannel>(channel: C): (...args: IpcSendArgs<C>) => void {
  return (...args: IpcSendArgs<C>) => {
    ipcRenderer.send(channel, ...args)
  }
}

function on<C extends IpcEventChannel>(
  channel: C,
): (callback: (payload: IpcEventPayload<C>) => void) => () => void {
  return (callback: (payload: IpcEventPayload<C>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: IpcEventPayload<C>) => {
      callback(payload)
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

const invokePrepareAttachments = invoke('attachments:prepare')

function prepareSelectedAttachments(projectPath: string, files: readonly File[]) {
  const paths: string[] = []
  for (const file of files) {
    const filePath = webUtils.getPathForFile(file)
    if (filePath.length > 0) paths.push(filePath)
  }

  if (paths.length === 0) {
    return Promise.resolve([])
  }

  return invokePrepareAttachments(projectPath, paths)
}

/**
 * Typed API exposed to the renderer via contextBridge.
 * Every method maps to a specific IPC channel with strict types.
 */
export const api: OpenWaggleApi = {
  // Agent
  sendMessage: invoke('agent:send-message'),
  cancelAgent: invoke('agent:cancel'),
  steerAgent: invoke('agent:steer'),
  respondAgentInteraction: invoke('agent:respond-interaction'),
  onAgentEvent: on('agent:event'),

  getAgentPhase: invoke('agent:get-phase'),
  getBackgroundRun: invoke('agent:get-background-run'),
  listActiveRuns: invoke('agent:list-active-runs'),
  getContextUsage: invoke('agent:get-context-usage'),
  compactSession: invoke('agent:compact-session'),
  onRunCompleted: on('agent:run-completed'),
  onAgentPhase: on('agent:phase'),
  onWorktreeLaunch: on('agent:worktree-launch'),

  // Settings
  getSettings: invoke('settings:get'),
  updateSettings: invoke('settings:update'),
  setEnabledModels: invoke('settings:set-enabled-models'),
  getPiTreeFilterMode: invoke('pi-settings:get-tree-filter-mode'),
  setPiTreeFilterMode: invoke('pi-settings:set-tree-filter-mode'),
  getPiBranchSummarySkipPrompt: invoke('pi-settings:get-branch-summary-skip-prompt'),
  testApiKey: invoke('settings:test-api-key'),
  getMcpSettings: invoke('mcp:get-settings'),
  setMcpScopeState: invoke('mcp:set-scope-state'),
  setMcpServerEnabled: invoke('mcp:set-server-enabled'),
  setMcpProjectServerEnabled: invoke('mcp:set-project-server-enabled'),
  setMcpServerTrust: invoke('mcp:set-server-trust'),
  writeMcpSourceConfig: invoke('mcp:write-source-config'),
  removeMcpServer: invoke('mcp:remove-server'),
  authorizeMcpServer: invoke('mcp:authorize-server'),
  logoutMcpServer: invoke('mcp:logout-server'),
  addMcpServer: invoke('mcp:add-server'),
  previewMcpImports: invoke('mcp:preview-imports'),
  applyMcpImports: invoke('mcp:apply-imports'),
  doctorMcp: invoke('mcp:doctor'),
  listMcpSecrets: invoke('mcp:list-secrets'),
  setMcpSecret: invoke('mcp:set-secret'),
  removeMcpSecret: invoke('mcp:remove-secret'),
  listMcpCapabilities: invoke('mcp:list-capabilities'),
  getMcpPrompt: invoke('mcp:get-prompt'),
  readMcpResource: invoke('mcp:read-resource'),
  reviewMcpRemoteSkill: invoke('mcp:review-remote-skill'),
  operateMcpTask: invoke('mcp:operate-task'),
  callMcpAppTool: invoke('mcp:call-app-tool'),
  setMcpEventSubscription: invoke('mcp:set-event-subscription'),
  listMcpEvents: invoke('mcp:list-events'),
  listMcpEventSubscriptions: invoke('mcp:list-event-subscriptions'),
  listExtensionPackages: invoke('extensions:list-packages'),
  listExtensionContributions: invoke('extensions:list-contributions'),
  proposeExtensionPackageWrite: invoke('extensions:propose-package-write'),
  applyExtensionPackageWrite: invoke('extensions:apply-package-write'),
  proposeExtensionPackageRemove: invoke('extensions:propose-package-remove'),
  applyExtensionPackageRemove: invoke('extensions:apply-package-remove'),
  invokeExtension: invoke('extensions:invoke'),
  registerExtensionFrame: invoke('extensions:register-frame'),
  unregisterExtensionFrame: invoke('extensions:unregister-frame'),
  registerInlineVisualizationFrame: invoke('visualizations:register-frame'),
  unregisterInlineVisualizationFrame: invoke('visualizations:unregister-frame'),
  saveInlineVisualizationDownload: invoke('visualizations:save-download'),
  setExtensionTrusted: invoke('extensions:set-trusted'),
  setExtensionEnabled: invoke('extensions:set-enabled'),
  setExtensionProjectDisabled: invoke('extensions:set-project-disabled'),
  acceptExtensionUpdate: invoke('extensions:accept-update'),
  approveExtensionBuild: invoke('extensions:approve-build'),
  reloadExtension: invoke('extensions:reload'),
  discoverDocs: invoke('docs:discover'),
  resolveDocsTopic: invoke('docs:resolve-topic'),

  // Providers
  getProviderModels: invoke('providers:get-models'),

  // Project
  selectProjectFolder: invoke('project:select-folder'),
  getProjectPreferences: invoke('project-config:get-preferences'),
  setProjectPreferences: invoke('project-config:set-preferences'),
  listAuthorizationGrants: invoke('authorization-grants:list'),
  grantAuthorization: invoke('authorization-grants:grant'),
  revokeAuthorization: invoke('authorization-grants:revoke'),

  // Sessions
  listSessions: invoke('sessions:list'),
  listSessionDetails: invoke('sessions:list-details'),
  getSessionDetail: invoke('sessions:get-detail'),
  listTurnCheckpoints: invoke('sessions:turn-checkpoints:list'),
  getTurnDiff: invoke('sessions:turn-diff:get'),
  listPinnedSessions: invoke('sessions:pins:list'),
  pinSession: invoke('sessions:pins:pin'),
  unpinSession: invoke('sessions:pins:unpin'),
  movePinnedSession: invoke('sessions:pins:move'),
  createSession: invoke('sessions:create'),
  forkSessionToNew: invoke('sessions:fork-to-new'),
  cloneSessionToNew: invoke('sessions:clone-to-new'),
  dismissInterruptedSessionRun: invoke('sessions:dismiss-interrupted-run'),
  deleteSession: invoke('sessions:delete'),
  archiveSession: invoke('sessions:archive'),
  unarchiveSession: invoke('sessions:unarchive'),
  listArchivedSessions: invoke('sessions:list-archived'),
  updateSessionTitle: invoke('sessions:update-title'),
  setSessionWorktreePlan: invoke('sessions:set-worktree-plan'),
  setSessionAuthorizationMode: invoke('sessions:set-authorization-mode'),
  listArchivedSessionBranches: invoke('sessions:list-archived-branches'),
  getSessionTree: invoke('sessions:get-tree'),
  getSessionWorkspace: invoke('sessions:get-workspace'),
  navigateSessionTree: invoke('sessions:navigate-tree'),
  renameSessionBranch: invoke('sessions:rename-branch'),
  archiveSessionBranch: invoke('sessions:archive-branch'),
  restoreSessionBranch: invoke('sessions:restore-branch'),
  updateSessionTreeUiState: invoke('sessions:update-tree-ui-state'),
  onSessionTitleUpdated: on('sessions:title-updated'),
  onGitWorkingTreeChanged: on('git:working-tree-changed'),

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
  getGitBranchDiff: invoke('git:branch-diff'),
  stageAllGitChanges: invoke('git:working-tree:stage-all'),
  revertAllGitChanges: invoke('git:working-tree:revert-all'),
  listGitBranches: invoke('git:branches:list'),
  checkoutGitBranch: invoke('git:branches:checkout'),
  createGitBranch: invoke('git:branches:create'),
  listGitWorktrees: invoke('git:worktrees:list'),
  createGitWorktree: invoke('git:worktrees:create'),
  removeGitWorktree: invoke('git:worktrees:remove'),
  checkSessionWorktree: invoke('git:worktrees:check'),
  getLocalVcsStatus: invoke('git:vcs-status:local'),
  getRemoteVcsStatus: invoke('git:vcs-status:remote'),
  runStackedGitAction: invoke('git:stacked-action:run'),
  listChangeRequests: invoke('git:change-request:list'),
  checkoutChangeRequest: invoke('git:change-request:checkout'),

  // Attachments
  prepareAttachments: prepareSelectedAttachments,
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
  openPath: invoke('shell:open-path'),

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

  // Workspace files
  listSyntaxThemes: invoke('syntax-themes:list'),
  selectSyntaxThemeImport: invoke('syntax-themes:select-import'),
  applySyntaxThemeImport: invoke('syntax-themes:apply-import'),
  removeSyntaxTheme: invoke('syntax-themes:remove'),
  searchWorkspaceFiles: invoke('workspace-files:search'),
  searchWorkspaceContent: invoke('workspace-files:search-content'),
  cancelWorkspaceContentSearch: invoke('workspace-files:cancel-content-search'),
  readWorkspaceFile: invoke('workspace-files:read'),
  readWorkspaceFileWithEncoding: invoke('workspace-files:read-with-encoding'),
  writeWorkspaceFile: invoke('workspace-files:write'),
  applyWorkspaceDocumentEdits: invoke('workspace-files:apply-document-edits'),
  listWorkspaceExternalEditors: invoke('workspace-files:list-external-editors'),
  openWorkspaceFileExternal: invoke('workspace-files:open-external'),
  createWorkspaceEntry: invoke('workspace-files:create-entry'),
  moveWorkspaceEntry: invoke('workspace-files:move-entry'),
  duplicateWorkspaceEntry: invoke('workspace-files:duplicate-entry'),
  trashWorkspaceEntry: invoke('workspace-files:trash-entry'),
  revealWorkspaceEntry: invoke('workspace-files:reveal-entry'),
  watchWorkspaceFiles: invoke('workspace-files:watch'),
  unwatchWorkspaceFiles: invoke('workspace-files:unwatch'),
  onWorkspaceFilesChanged: on('workspace-files:changed'),
  readWorkspaceFilePage: invoke('workspace-files:read-page'),

  // Auto-updater
  checkForUpdates: invoke('updater:check'),
  installUpdate: invoke('updater:install'),
  getUpdateStatus: invoke('updater:get-status'),
  getAppVersion: invoke('app:get-version'),
  onUpdateStatus: on('updater:status-changed'),
}
