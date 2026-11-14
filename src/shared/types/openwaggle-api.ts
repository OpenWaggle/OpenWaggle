import type { PreparedAttachment } from './agent'
import type { OpenWaggleAuthorizationGrantApi } from './openwaggle-api-authorization-grants'
import type { OpenWaggleDesktopNotificationsApi } from './openwaggle-api-desktop-notifications'
import type { OpenWaggleFeedbackApi } from './openwaggle-api-feedback'
import type { OpenWaggleGitApi } from './openwaggle-api-git'
import type { OpenWaggleProjectConfigApi } from './openwaggle-api-project'
import type { OpenWaggleScheduledTasksApi } from './openwaggle-api-scheduled-tasks'
import type { OpenWaggleSessionCatalogApi } from './openwaggle-api-session-catalog'
import type { OpenWaggleSessionControlApi } from './openwaggle-api-session-control'
import type { OpenWaggleSessionResourceApi } from './openwaggle-api-session-resources'
import type { OpenWaggleStartupApi } from './openwaggle-api-startup'
import type { OpenWaggleUpdaterApi } from './openwaggle-api-updater'
import type { OpenWaggleWaggleApi } from './openwaggle-api-waggle'
import type { OpenWaggleBrowserPreviewApi } from './openwaggle-browser-preview-api'
import type { OpenWaggleDesktopApi } from './openwaggle-desktop-api'
import type { OpenWaggleExtensionApi } from './openwaggle-extension-api'
import type { OpenWaggleMcpApi } from './openwaggle-mcp-api'
import type { OpenWaggleTerminalApi } from './openwaggle-terminal-api'
import type { OpenWaggleWorkspaceFilesApi } from './openwaggle-workspace-files-api'
import type { IpcEventMethod, IpcInvokeMethod, IpcSendMethod } from './ipc-api-methods'

export interface PreparedSelectedAttachment {
  readonly attachment: PreparedAttachment
  readonly fileIndex: number
}

export interface OpenWaggleApi
  extends
    OpenWaggleAuthorizationGrantApi,
    OpenWaggleDesktopApi,
    OpenWaggleStartupApi,
    OpenWaggleBrowserPreviewApi,
    OpenWaggleTerminalApi,
    OpenWaggleFeedbackApi,
    OpenWaggleGitApi,
    OpenWaggleProjectConfigApi,
    OpenWaggleScheduledTasksApi,
    OpenWaggleDesktopNotificationsApi,
    OpenWaggleUpdaterApi,
    OpenWaggleExtensionApi,
    OpenWaggleMcpApi,
    OpenWaggleSessionResourceApi,
    OpenWaggleWaggleApi,
    OpenWaggleSessionCatalogApi,
    OpenWaggleSessionControlApi,
    OpenWaggleWorkspaceFilesApi {
  // Agent
  sendMessage: IpcInvokeMethod<'agent:send-message'>
  cancelAgent: IpcInvokeMethod<'agent:cancel'>
  respondAgentInteraction: IpcInvokeMethod<'agent:respond-interaction'>
  /** Subscribe to live Pi-shaped runtime events from the main process */
  onAgentEvent: IpcEventMethod<'agent:event'>

  getAgentPhase: IpcInvokeMethod<'agent:get-phase'>
  /**
   * Names the Sessions this window shows. Their streamed deltas arrive about 30 times a second; other
   * Sessions' arrive merged on a slower beat, for activity and route-switch snapshots.
   */
  setShownSessions: IpcInvokeMethod<'agent:set-shown-sessions'>
  getBackgroundRun: IpcInvokeMethod<'agent:get-background-run'>
  listActiveRuns: IpcInvokeMethod<'agent:list-active-runs'>
  getContextUsage: IpcInvokeMethod<'agent:get-context-usage'>
  /**
   * The commands the Session's Pi extensions register, for the slash menu; with no Session, as
   * for a New session draft, those a Session in `projectPath` would have.
   */
  listExtensionCommands: IpcInvokeMethod<'agent:list-extension-commands'>
  compactSession: IpcInvokeMethod<'agent:compact-session'>
  onRunCompleted: IpcEventMethod<'agent:run-completed'>
  onAgentPhase: IpcEventMethod<'agent:phase'>
  onSessionHostEvent: IpcEventMethod<'session-host:event'>
  onSessionHostResyncRequired: IpcEventMethod<'session-host:resync-required'>
  onWorktreeLaunch: IpcEventMethod<'agent:worktree-launch'>

  // Settings
  getSettings: IpcInvokeMethod<'settings:get'>
  updateSettings: IpcInvokeMethod<'settings:update'>
  setEnabledModels: IpcInvokeMethod<'settings:set-enabled-models'>
  getPiTreeFilterMode: IpcInvokeMethod<'pi-settings:get-tree-filter-mode'>
  setPiTreeFilterMode: IpcInvokeMethod<'pi-settings:set-tree-filter-mode'>
  getPiBranchSummarySkipPrompt: IpcInvokeMethod<'pi-settings:get-branch-summary-skip-prompt'>
  testApiKey: IpcInvokeMethod<'settings:test-api-key'>
  discoverDocs: IpcInvokeMethod<'docs:discover'>
  resolveDocsTopic: IpcInvokeMethod<'docs:resolve-topic'>
  getUsageCostView: IpcInvokeMethod<'usage-cost:get-view'>
  getUsageCostSessions: IpcInvokeMethod<'usage-cost:get-sessions'>

  // Providers
  getProviderModels: IpcInvokeMethod<'providers:get-models'>

  registerInlineVisualizationFrame: IpcInvokeMethod<'visualizations:register-frame'>
  unregisterInlineVisualizationFrame: IpcInvokeMethod<'visualizations:unregister-frame'>
  saveInlineVisualizationDownload: IpcInvokeMethod<'visualizations:save-download'>

  // Sessions
  getSessionDetail: IpcInvokeMethod<'sessions:get-detail'>
  dismissInterruptedSessionRun: IpcInvokeMethod<'sessions:dismiss-interrupted-run'>
  listTurnCheckpoints: IpcInvokeMethod<'sessions:turn-checkpoints:list'>
  getTurnDiffFiles: IpcInvokeMethod<'sessions:turn-diff-files:get'>
  listTurnDiffFiles: IpcInvokeMethod<'sessions:turn-diff-files:list'>
  getTurnDiff: IpcInvokeMethod<'sessions:turn-diff:get'>
  /** Every Pinned session in Manual order, archived ones included (issue #97). */
  listPinnedSessions: IpcInvokeMethod<'sessions:pins:list'>
  pinSession: IpcInvokeMethod<'sessions:pins:pin'>
  unpinSession: IpcInvokeMethod<'sessions:pins:unpin'>
  /** Reposition one pin between the neighbours it should land between. */
  movePinnedSession: IpcInvokeMethod<'sessions:pins:move'>
  createSession: IpcInvokeMethod<'sessions:create'>
  forkSessionToNew: IpcInvokeMethod<'sessions:fork-to-new'>
  cloneSessionToNew: IpcInvokeMethod<'sessions:clone-to-new'>
  /** `removingProject` keeps a discovered Pi session listable if its folder is added back. */
  deleteSession: IpcInvokeMethod<'sessions:delete'>
  /** Stops Pi session discovery for a project the user is removing, before its Sessions are read. */
  beginProjectRemoval: IpcInvokeMethod<'sessions:begin-project-removal'>
  archiveSession: IpcInvokeMethod<'sessions:archive'>
  unarchiveSession: IpcInvokeMethod<'sessions:unarchive'>
  updateSessionTitle: IpcInvokeMethod<'sessions:update-title'>
  regenerateSessionTitle: IpcInvokeMethod<'sessions:regenerate-title'>
  setSessionAuthorizationMode: IpcInvokeMethod<'sessions:set-authorization-mode'>
  /** Switch the model the Session's next Run uses; a running Run keeps its model. */
  setSessionModel: IpcInvokeMethod<'sessions:set-model'>
  /** Refused with `session_run_active` while a Run is active; also sets Pi's global default. */
  setSessionThinkingLevel: IpcInvokeMethod<'sessions:set-thinking-level'>
  /** Pi's default thinking level, where a new Session starts. */
  getDefaultThinkingLevel: IpcInvokeMethod<'sessions:get-default-thinking-level'>
  setDefaultThinkingLevel: IpcInvokeMethod<'sessions:set-default-thinking-level'>
  listArchivedSessionBranches: IpcInvokeMethod<'sessions:list-archived-branches'>
  getSessionTree: IpcInvokeMethod<'sessions:get-tree'>
  getSessionWorkspace: IpcInvokeMethod<'sessions:get-workspace'>
  searchSessionTree: IpcInvokeMethod<'sessions:search-tree'>
  navigateSessionTree: IpcInvokeMethod<'sessions:navigate-tree'>
  renameSessionBranch: IpcInvokeMethod<'sessions:rename-branch'>
  archiveSessionBranch: IpcInvokeMethod<'sessions:archive-branch'>
  restoreSessionBranch: IpcInvokeMethod<'sessions:restore-branch'>
  updateSessionTreeUiState: IpcInvokeMethod<'sessions:update-tree-ui-state'>
  onSessionTitleUpdated: IpcEventMethod<'sessions:title-updated'>
  onSessionListInvalidated: IpcEventMethod<'sessions:list-invalidated'>

  // Window
  onFullscreenChanged: IpcEventMethod<'window:fullscreen-changed'>

  // Attachments
  prepareAttachments(
    projectPath: string,
    files: readonly File[],
  ): Promise<PreparedSelectedAttachment[]>
  prepareAttachmentFromText: IpcInvokeMethod<'attachments:prepare-from-text'>
  discardPreparedAttachment: IpcInvokeMethod<'attachments:discard'>
  onPrepareAttachmentFromTextProgress: IpcEventMethod<'attachments:prepare-from-text-progress'>

  // Voice
  transcribeVoiceLocal: IpcInvokeMethod<'voice:transcribe-local'>

  getStandardsStatus: IpcInvokeMethod<'standards:get-status'>
  getEffectiveAgents: IpcInvokeMethod<'standards:get-effective-agents'>
  listSkills: IpcInvokeMethod<'skills:list'>
  setSkillEnabled: IpcInvokeMethod<'skills:set-enabled'>
  getSkillPreview: IpcInvokeMethod<'skills:get-preview'>

  showConfirm: IpcInvokeMethod<'dialog:confirm'>

  copyToClipboard: IpcSendMethod<'clipboard:write-text'>
  readFromClipboard: IpcInvokeMethod<'clipboard:read-text'>
  openLogsDir: IpcInvokeMethod<'app:open-logs-dir'>
  getLogsPath: IpcInvokeMethod<'app:get-logs-path'>
  openPath: IpcInvokeMethod<'shell:open-path'>
  revealPath: IpcInvokeMethod<'shell:reveal-path'>

  startOAuth: IpcInvokeMethod<'auth:start-oauth'>
  submitAuthCode: IpcInvokeMethod<'auth:submit-code'>
  cancelOAuth: IpcInvokeMethod<'auth:cancel-oauth'>
  setProviderApiKey: IpcInvokeMethod<'auth:set-api-key'>
  disconnectAuth: IpcInvokeMethod<'auth:disconnect'>
  getAuthAccountInfo: IpcInvokeMethod<'auth:get-account-info'>
  getAuthAccountInfos: IpcInvokeMethod<'auth:get-account-infos'>
  onOAuthStatus: IpcEventMethod<'auth:oauth-status'>

  /*
   * Feedback moved to its own interface on main, and the Waggle presets to this branch's Waggle interface, so
   * neither side's block belongs here any more.
   */

  // Composer
  suggestFiles: IpcInvokeMethod<'composer:file-suggest'>
}
