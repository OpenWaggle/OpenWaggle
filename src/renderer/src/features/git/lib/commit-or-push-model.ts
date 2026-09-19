import type {
  GitBranchInfo,
  GitChangeStats,
  GitStackedAction,
  GitStatusSummary,
  VcsStatus,
} from '@shared/types/git'

export type CommitBranchTarget = 'current' | 'new'
export type CommitRemoteState = 'loading' | 'loaded' | 'error' | 'unavailable'

export interface CommitCommandAction {
  readonly action: Extract<GitStackedAction, 'commit' | 'commit_push' | 'push'>
  readonly label: 'Commit' | 'Commit & push' | 'Push'
  readonly enabled: boolean
  readonly disabledReason: string | null
}

function fallbackStats(status: GitStatusSummary, kind: 'staged' | 'unstaged'): GitChangeStats {
  const files = status.changedFiles.filter((file) => file[kind])
  return {
    filesChanged: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

export function commitCommandStats(status: GitStatusSummary) {
  return {
    staged: status.stagedChanges ?? fallbackStats(status, 'staged'),
    unstaged: status.unstagedChanges ?? fallbackStats(status, 'unstaged'),
  }
}

export function branchInfoName(branch: GitBranchInfo) {
  return branch.localName
}

function refsConflict(first: string, second: string) {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`)
}

export function findBranchRefConflict(branches: readonly GitBranchInfo[], requested: string) {
  const normalized = requested.trim()
  if (!normalized) return null
  return branches.map(branchInfoName).find((existing) => refsConflict(existing, normalized)) ?? null
}

function remoteReason(remoteState: CommitRemoteState, vcsStatus: VcsStatus | null) {
  if (remoteState === 'loading') return 'Checking the remote before publishing.'
  if (remoteState === 'error') return 'Remote status could not be loaded. Refresh and try again.'
  if (!vcsStatus?.hasPrimaryRemote) return 'Add a Git remote before publishing this branch.'
  return null
}

function selectedCommitReason(input: {
  readonly message: string
  readonly includeUnstaged: boolean
  readonly stagedFiles: number
  readonly unstagedFiles: number
}) {
  if (input.message.trim().length === 0) return 'Enter a commit message.'
  if (input.stagedFiles > 0) return null
  if (input.includeUnstaged && input.unstagedFiles > 0) return null
  return input.unstagedFiles > 0
    ? 'Include unstaged changes or stage files before committing.'
    : 'There are no changes to commit.'
}

function selectedBranchReason(branchReady: boolean, branchReason: string | null) {
  return branchReady ? null : (branchReason ?? 'Choose a valid branch.')
}

function isDetached(input: {
  readonly status: GitStatusSummary
  readonly vcsStatus: VcsStatus | null
}) {
  if (input.vcsStatus) return input.vcsStatus.refName === null
  const branch = input.status.branch.trim()
  return branch === '' || branch === 'HEAD' || branch.startsWith('detached@')
}

export function resolveCommitCommandActions(input: {
  readonly status: GitStatusSummary
  readonly vcsStatus: VcsStatus | null
  readonly remoteState: CommitRemoteState
  readonly branchTarget: CommitBranchTarget
  readonly branchReady: boolean
  readonly branchReason: string | null
  readonly includeUnstaged: boolean
  readonly message: string
}): readonly CommitCommandAction[] {
  const stats = commitCommandStats(input.status)
  const branchReason = selectedBranchReason(input.branchReady, input.branchReason)
  const commitReason =
    branchReason ??
    selectedCommitReason({
      message: input.message,
      includeUnstaged: input.includeUnstaged,
      stagedFiles: stats.staged.filesChanged,
      unstagedFiles: stats.unstaged.filesChanged,
    })
  const publishingReason = remoteReason(input.remoteState, input.vcsStatus)
  // A fetch upstream and a push destination may intentionally differ (for example,
  // upstream/main plus fork/feature). The main-process push remains explicit and returns
  // a typed non-fast-forward failure, so a fetch-only `behind` count cannot safely disable it.
  const commitPushReason = commitReason ?? publishingReason
  const unpublishedCommits = Math.max(
    input.status.ahead,
    input.vcsStatus?.aheadCount ?? 0,
    input.vcsStatus?.aheadOfDefaultCount ?? 0,
  )
  const publishesDetachedHead = input.branchTarget === 'new' && isDetached(input)
  const pushReason =
    branchReason ??
    publishingReason ??
    (unpublishedCommits > 0 || publishesDetachedHead
      ? null
      : 'There are no local commits to publish.')

  return [
    {
      action: 'commit',
      label: 'Commit',
      enabled: commitReason === null,
      disabledReason: commitReason,
    },
    {
      action: 'commit_push',
      label: 'Commit & push',
      enabled: commitPushReason === null,
      disabledReason: commitPushReason,
    },
    {
      action: 'push',
      label: 'Push',
      enabled: pushReason === null,
      disabledReason: pushReason,
    },
  ]
}

export function primaryCommitCommandAction(actions: readonly CommitCommandAction[]) {
  return (
    actions.find((entry) => entry.action === 'commit_push' && entry.enabled) ??
    actions.find((entry) => entry.action === 'commit' && entry.enabled) ??
    actions.find((entry) => entry.action === 'push' && entry.enabled) ??
    null
  )
}
