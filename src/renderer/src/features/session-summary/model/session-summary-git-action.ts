import type { GitStackedAction, VcsStatus } from '@shared/types/git'

export interface SessionSummaryGitAction {
  readonly label: string
  readonly disabled: boolean
  readonly kind: 'refresh_status' | 'run_action' | 'show_hint'
  readonly action?: GitStackedAction
  readonly hint?: string
}

const unavailable = (hint: string): SessionSummaryGitAction => ({
  label: 'Commit or push',
  disabled: true,
  kind: 'show_hint',
  hint,
})

/**
 * Resolve the Environment section's Git row without absorbing PR or MR creation.
 * Codex keeps "Commit or push" and the change-request row separate. That matters
 * here too: one click must never create a remote review request as a side effect of
 * what reads like a commit or push action.
 */
export function resolveSessionSummaryGitAction(
  status: VcsStatus | null,
  isBusy: boolean,
  loadState: 'loading' | 'loaded' | 'error' | 'unavailable' = status ? 'loaded' : 'unavailable',
  localAheadCount = 0,
): SessionSummaryGitAction {
  if (isBusy) return unavailable('A Git action is already in progress.')
  if (loadState === 'error') {
    return {
      label: 'Retry Git status',
      disabled: false,
      kind: 'refresh_status',
      hint: 'Git status could not be loaded.',
    }
  }
  if (loadState === 'loading') return unavailable('Checking Git status.')
  if (!status) return unavailable('Git status is unavailable.')
  // A detached HEAD is recoverable in the command: it defaults to creating a named branch at
  // the current HEAD, so hiding the command here would strand both dirty files and detached commits.
  if (!status.refName) {
    return { label: 'Commit or push', disabled: false, kind: 'run_action' }
  }

  const unpublishedCommits = Math.max(
    status.aheadCount,
    status.aheadOfDefaultCount ?? 0,
    localAheadCount,
  )
  if (status.hasWorkingTreeChanges || unpublishedCommits > 0) {
    return { label: 'Commit or push', disabled: false, kind: 'run_action' }
  }
  if (status.behindCount > 0) {
    return unavailable('Pull the upstream changes before committing or pushing.')
  }
  return unavailable('There are no local changes or commits to publish.')
}
