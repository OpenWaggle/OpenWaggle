import type { RepositoryPath, WorkingPath } from './brand'
import type {
  ChangeRequestCheckoutResult,
  ChangeRequestListResult,
  ChangeRequestPreflightResult,
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchListResult,
  GitBranchMutationResult,
  GitCommitPayload,
  GitCommitResult,
  GitDiffResult,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStatusSummary,
  GitWorkingTreeMutationResult,
  GitWorktreeCreatePayload,
  GitWorktreeListResult,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
  LocalVcsStatusResult,
  OpenChangeRequestPayload,
  RemoteVcsStatusResult,
  SessionWorktreeCheck,
} from './git'
import type { IpcEventPayload } from './ipc'
import type { ChangeRequestAdoption } from './ipc-invoke-git'

export interface OpenWaggleGitApi {
  onGitWorkingTreeChanged(
    callback: (payload: IpcEventPayload<'git:working-tree-changed'>) => void,
  ): () => void
  getGitStatus(workingPath: WorkingPath): Promise<GitStatusSummary>
  commitGit(workingPath: WorkingPath, payload: GitCommitPayload): Promise<GitCommitResult>
  getGitDiff(workingPath: WorkingPath): Promise<GitDiffResult>
  getGitBranchDiff(workingPath: WorkingPath, baseRef: string): Promise<GitDiffResult>
  stageAllGitChanges(workingPath: WorkingPath): Promise<GitWorkingTreeMutationResult>
  revertAllGitChanges(workingPath: WorkingPath): Promise<GitWorkingTreeMutationResult>
  listGitBranches(repositoryPath: RepositoryPath): Promise<GitBranchListResult>
  checkoutGitBranch(
    workingPath: WorkingPath,
    payload: GitBranchCheckoutPayload,
  ): Promise<GitBranchMutationResult>
  createGitBranch(
    workingPath: WorkingPath,
    payload: GitBranchCreatePayload,
  ): Promise<GitBranchMutationResult>
  checkSessionWorktree(worktreePath: string | null): Promise<SessionWorktreeCheck>
  listGitWorktrees(repositoryPath: RepositoryPath): Promise<GitWorktreeListResult>
  createGitWorktree(
    repositoryPath: RepositoryPath,
    payload: GitWorktreeCreatePayload,
  ): Promise<GitWorktreeMutationResult>
  removeGitWorktree(
    repositoryPath: RepositoryPath,
    payload: GitWorktreeRemovePayload,
  ): Promise<GitWorktreeMutationResult>
  getLocalVcsStatus(workingPath: WorkingPath): Promise<LocalVcsStatusResult>
  getRemoteVcsStatus(workingPath: WorkingPath): Promise<RemoteVcsStatusResult>
  runStackedGitAction(
    workingPath: WorkingPath,
    options: GitRunStackedActionOptions,
  ): Promise<GitRunStackedActionResult>
  preflightChangeRequest(
    workingPath: WorkingPath,
    payload: OpenChangeRequestPayload,
  ): Promise<ChangeRequestPreflightResult>
  listChangeRequests(repositoryPath: RepositoryPath): Promise<ChangeRequestListResult>
  checkoutChangeRequest(
    repositoryPath: RepositoryPath,
    reference: string,
    adoption: ChangeRequestAdoption,
  ): Promise<ChangeRequestCheckoutResult>
}
