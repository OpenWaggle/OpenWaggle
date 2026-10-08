import type { RepositoryPath, SessionId, WorkingPath } from './brand'
import type {
  ChangeRequestCheckoutResult,
  ChangeRequestListResult,
  ChangeRequestMergeCandidateResult,
  ChangeRequestPanelResult,
  ChangeRequestPreflightPayload,
  ChangeRequestPreflightResult,
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchListResult,
  GitBranchMutationResult,
  GitBranchValidationResult,
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
  MergeChangeRequestPayload,
  MergeChangeRequestResult,
  RemoteVcsStatusResult,
  SessionGitOutputsPayload,
  SessionGitOutputsRecording,
  SessionGitWorkingPathVerification,
  SessionWorktreeCheck,
} from './git'
import type {
  ChangeRequestOpenDestinationResolution,
  SourceControlConfigureRequest,
  SourceControlConfigureResult,
  SourceControlHostsOverview,
  SourceControlSettingsPatch,
} from './source-control'

/**
 * How a selected change request should be adopted.
 *
 * `checkout` switches the repository's checkout to the change-request branch. That is only what
 * the user wants when the opened checkout is also the tree the session runs in.
 *
 * `fetch` makes the ref available locally without touching any working tree. A worktree-mode
 * session only needs the ref as a base for its own tree, and switching the user's checkout as a
 * side effect was the "surface targets the wrong tree" defect ADR 0016 exists to prevent.
 */
export type ChangeRequestAdoption = 'checkout' | 'fetch'

/**
 * Git source-control invoke channels split out of ipc-invoke-integrations to
 * keep each channel-map module under the line cap.
 *
 * Change requests are repository-level: their refs live in the repository shared by every linked
 * worktree, so these channels take a `RepositoryPath` rather than a session's `WorkingPath`.
 */
export interface IpcGitInvokeChannelMap {
  'git:status': {
    args: [workingPath: WorkingPath]
    return: GitStatusSummary
  }
  'git:commit': {
    args: [workingPath: WorkingPath, payload: GitCommitPayload]
    return: GitCommitResult
  }
  'git:diff': {
    args: [workingPath: WorkingPath]
    return: GitDiffResult
  }
  'git:branch-diff': {
    args: [workingPath: WorkingPath, baseRef: string]
    return: GitDiffResult
  }
  'git:working-tree:stage-all': {
    args: [workingPath: WorkingPath]
    return: GitWorkingTreeMutationResult
  }
  'git:working-tree:revert-all': {
    args: [workingPath: WorkingPath]
    return: GitWorkingTreeMutationResult
  }
  'git:branches:list': {
    args: [repositoryPath: RepositoryPath]
    return: GitBranchListResult
  }
  'git:branches:checkout': {
    args: [workingPath: WorkingPath, payload: GitBranchCheckoutPayload]
    return: GitBranchMutationResult
  }
  'git:branches:create': {
    args: [workingPath: WorkingPath, payload: GitBranchCreatePayload]
    return: GitBranchMutationResult
  }
  'git:branches:validate-name': {
    args: [workingPath: WorkingPath, name: string]
    return: GitBranchValidationResult
  }
  'git:worktrees:list': {
    args: [repositoryPath: RepositoryPath]
    return: GitWorktreeListResult
  }
  'git:worktrees:create': {
    args: [repositoryPath: RepositoryPath, payload: GitWorktreeCreatePayload]
    return: GitWorktreeMutationResult
  }
  'git:worktrees:remove': {
    args: [repositoryPath: RepositoryPath, payload: GitWorktreeRemovePayload]
    return: GitWorktreeMutationResult
  }
  'git:worktrees:check': {
    args: [worktreePath: string | null]
    return: SessionWorktreeCheck
  }
  'git:vcs-status:local': {
    args: [workingPath: WorkingPath]
    return: LocalVcsStatusResult
  }
  'git:vcs-status:remote': {
    args: [workingPath: WorkingPath]
    return: RemoteVcsStatusResult
  }
  'git:stacked-action:run': {
    args: [workingPath: WorkingPath, options: GitRunStackedActionOptions]
    return: GitRunStackedActionResult
  }
  'git:stacked-action:cancel': {
    args: [operationId: string]
    return: boolean
  }
  'git:change-request:preflight': {
    args: [workingPath: WorkingPath, payload: ChangeRequestPreflightPayload]
    return: ChangeRequestPreflightResult
  }
  'git:change-request:list': {
    args: [repositoryPath: RepositoryPath]
    return: ChangeRequestListResult
  }
  'git:change-request:checkout': {
    args: [repositoryPath: RepositoryPath, reference: string, adoption: ChangeRequestAdoption]
    return: ChangeRequestCheckoutResult
  }
  'git:change-request:panel': {
    args: [sessionId: SessionId, workingPath: WorkingPath, requestUrl: string]
    return: ChangeRequestPanelResult
  }
  'git:change-request:merge': {
    args: [sessionId: SessionId, workingPath: WorkingPath, payload: MergeChangeRequestPayload]
    return: MergeChangeRequestResult
  }
  /** Host-side merge validation the window confirms before `merge-confirmed` (ADR 0048). */
  'git:change-request:merge-candidate': {
    args: [sessionId: SessionId, workingPath: WorkingPath, payload: MergeChangeRequestPayload]
    return: ChangeRequestMergeCandidateResult
  }
  /** Host-side revalidation and merge after the window's confirmation. */
  'git:change-request:merge-confirmed': {
    args: [sessionId: SessionId, workingPath: WorkingPath, payload: MergeChangeRequestPayload]
    return: MergeChangeRequestResult
  }
  /** Whether a working path belongs to a Session, answered by the Session Host. */
  'git:session:verify-working-path': {
    args: [sessionId: SessionId, workingPath: WorkingPath]
    return: SessionGitWorkingPathVerification
  }
  /** Record a Session-scoped commit or change request as Session Outputs in the Session Host. */
  'git:session:record-outputs': {
    args: [sessionId: SessionId, outputs: SessionGitOutputsPayload]
    return: SessionGitOutputsRecording
  }
  'source-control:hosts': {
    args: []
    return: SourceControlHostsOverview
  }
  'source-control:open-destination': {
    args: [projectPath: string | null]
    return: ChangeRequestOpenDestinationResolution
  }
  /** Host-only: apply an atomic source-control Settings patch in the process that owns them. */
  'source-control:patch-settings': {
    args: [patch: SourceControlSettingsPatch]
    return: { readonly ok: true } | { readonly ok: false; readonly error: string }
  }
  /** Drop cached VCS status for a working path so the next read asks the CLI again. */
  'source-control:refresh-status': {
    args: [workingPath: string]
    return: undefined
  }
  'source-control:configure': {
    args: [request: SourceControlConfigureRequest]
    return: SourceControlConfigureResult
  }
}
