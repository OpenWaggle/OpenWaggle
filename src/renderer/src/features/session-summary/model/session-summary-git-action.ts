import type { GitStackedAction, VcsStatus } from '@shared/types/git'

export interface SessionSummaryGitAction {
  readonly label: string
  readonly disabled: boolean
  readonly kind: 'run_action' | 'show_hint'
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
): SessionSummaryGitAction {
  if (isBusy) return unavailable('A Git action is already in progress.')
  if (!status) return unavailable('Git status is unavailable.')
  if (!status.refName) return unavailable('Create or checkout a branch before committing.')

  if (status.hasWorkingTreeChanges) {
    if (!status.hasPrimaryRemote) {
      return { label: 'Commit or push', disabled: false, kind: 'run_action', action: 'commit' }
    }
    return {
      label: 'Commit or push',
      disabled: false,
      kind: 'run_action',
      action: 'commit_push',
    }
  }

  const ahead = status.aheadCount > 0
  const behind = status.behindCount > 0
  if (ahead && behind) {
    return unavailable('The branch has diverged from its upstream. Rebase or merge first.')
  }
  if (ahead && status.hasPrimaryRemote) {
    return { label: 'Commit or push', disabled: false, kind: 'run_action', action: 'push' }
  }
  if (ahead) return unavailable('Add a remote before publishing this branch.')
  if (behind) return unavailable('Pull the upstream changes before committing or pushing.')
  return unavailable('There are no local changes or commits to publish.')
}
