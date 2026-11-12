import type { OpenWaggleWorktreesApi } from './openwaggle-api-worktrees'
import type { IpcEventMethod, IpcInvokeMethod } from './ipc-api-methods'

/** Git, source control, and the worktrees Settings manages (OpenWaggleWorktreesApi). */
export interface OpenWaggleGitApi extends OpenWaggleWorktreesApi {
  onGitWorkingTreeChanged: IpcEventMethod<'git:working-tree-changed'>
  onGitStackedActionProgress: IpcEventMethod<'git:stacked-action:progress'>
  getGitStatus: IpcInvokeMethod<'git:status'>
  commitGit: IpcInvokeMethod<'git:commit'>
  getGitDiff: IpcInvokeMethod<'git:diff'>
  getGitBranchDiff: IpcInvokeMethod<'git:branch-diff'>
  stageAllGitChanges: IpcInvokeMethod<'git:working-tree:stage-all'>
  revertAllGitChanges: IpcInvokeMethod<'git:working-tree:revert-all'>
  listGitBranches: IpcInvokeMethod<'git:branches:list'>
  checkoutGitBranch: IpcInvokeMethod<'git:branches:checkout'>
  createGitBranch: IpcInvokeMethod<'git:branches:create'>
  validateGitBranchName: IpcInvokeMethod<'git:branches:validate-name'>
  checkSessionWorktree: IpcInvokeMethod<'git:worktrees:check'>
  listGitWorktrees: IpcInvokeMethod<'git:worktrees:list'>
  createGitWorktree: IpcInvokeMethod<'git:worktrees:create'>
  removeGitWorktree: IpcInvokeMethod<'git:worktrees:remove'>
  getLocalVcsStatus: IpcInvokeMethod<'git:vcs-status:local'>
  getRemoteVcsStatus: IpcInvokeMethod<'git:vcs-status:remote'>
  runStackedGitAction: IpcInvokeMethod<'git:stacked-action:run'>
  cancelStackedGitAction: IpcInvokeMethod<'git:stacked-action:cancel'>
  preflightChangeRequest: IpcInvokeMethod<'git:change-request:preflight'>
  listChangeRequests: IpcInvokeMethod<'git:change-request:list'>
  checkoutChangeRequest: IpcInvokeMethod<'git:change-request:checkout'>
  getChangeRequestPanel: IpcInvokeMethod<'git:change-request:panel'>
  mergeChangeRequest: IpcInvokeMethod<'git:change-request:merge'>
  /** Source control hosts OpenWaggle knows, with CLI install and Provider account state. */
  getSourceControlHosts: IpcInvokeMethod<'source-control:hosts'>
  /** The effective Change request open destination for a project (or user-wide for null). */
  getChangeRequestOpenDestination: IpcInvokeMethod<'source-control:open-destination'>
  configureSourceControl: IpcInvokeMethod<'source-control:configure'>
  /** Forget cached VCS status for a working path, e.g. after a CLI sign-in finishes. */
  refreshSourceControlStatus: IpcInvokeMethod<'source-control:refresh-status'>
}
