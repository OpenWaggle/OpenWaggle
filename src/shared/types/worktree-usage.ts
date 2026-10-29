/**
 * Why Settings > Worktrees will not remove a worktree (issue #353). The Host checks the same
 * reasons again before it removes one, so a stale list cannot remove a checkout in use.
 *
 * - `open-project`: the worktree is the opened project's checkout.
 * - `app-checkout`: the running OpenWaggle app was started from it (a development build).
 * - `session`: a Session that is not archived, or that has an active Run, works in it.
 * - `action`: a Project Action is running in it.
 * - `terminal`: a terminal is open in it, or the terminals could not all be checked.
 * - `workspace`: its managed Workspace is being created, changed or removed.
 */
export type WorktreeRemovalBlockerKind =
  | 'open-project'
  | 'app-checkout'
  | 'session'
  | 'action'
  | 'terminal'
  | 'workspace'

export interface WorktreeRemovalBlocker {
  readonly kind: WorktreeRemovalBlockerKind
  readonly message: string
}

/** A Session that works in a worktree: the owner of a managed worktree, or a local Session there. */
export interface WorktreeSessionUsage {
  readonly sessionId: string
  readonly title: string
  readonly archived: boolean
  /** The Session's Archive time; null while it is not archived. */
  readonly archivedAt: number | null
  readonly running: boolean
  /** The Session's Workspace is this managed worktree (not a local Session opened in it). */
  readonly owner: boolean
}

export interface WorktreeUsage {
  readonly path: string
  readonly sessions: readonly WorktreeSessionUsage[]
  /** Empty when removal may go ahead. */
  readonly blockers: readonly WorktreeRemovalBlocker[]
}

export interface WorktreeRemovalPreview {
  readonly usage: WorktreeUsage
  readonly branch: string | null
  /** Commits on the checked-out branch that no remote-tracking ref has; null when unknown. */
  readonly unpublishedCommitCount: number | null
}
