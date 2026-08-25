import type { WorkingPath } from '@shared/types/brand'
import { useEffect } from 'react'
import { selectWorkingTreeStatus, useGitStore } from '@/features/git'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-commit-paths')

/**
 * The repo-relative paths a commit from this panel should stage.
 *
 * Always the working tree's changed files, never the scope on display. Derived from the rendered
 * diff, a commit-bearing quick action pressed while the Branch or Turn tab was selected staged the
 * *current* content of files belonging to past commits or a past turn, and silently omitted the
 * files that were actually dirty. Revert all and Stage all were already scope-gated; commit was not.
 *
 * The panel loads that status itself rather than relying on someone else having done it. Nothing in
 * the diff panel populated it: the entry appears as a side effect of the sidebar's per-session
 * indicators, which iterate the session *list* - so for a draft session, or before the sidebar has
 * caught up, the panel read an empty slice and dispatched a commit with no paths at all.
 */
export interface CommitPaths {
  readonly paths: readonly string[]
  /**
   * Why the working tree could not be read, when it could not.
   *
   * An empty path list must not stand in for this. Treating a failed read as a clean tree told the
   * user "no changes to commit" while the diff body could be showing dirty files - the same
   * failure-as-emptiness defect this panel has now had fixed three times over.
   */
  readonly error: string | null
  /**
   * True while the working tree is being read.
   *
   * "Not read yet" is not "clean". Without this the panel answered a commit pressed during the first load
   * with "no changes in this working tree to commit" - the same failure-as-emptiness mistake, one state
   * further along.
   */
  readonly isLoading: boolean
  /**
   * How many files the user changed.
   *
   * Not `paths.length`: a rename contributes two pathspec entries so the commit covers the deletion, but it
   * is one changed file, and the dialog was promising two.
   */
  readonly changedFileCount: number
}

export function useCommitPaths(workingPath: WorkingPath | null, refreshToken = 0): CommitPaths {
  const refreshStatus = useGitStore((state) => state.refreshStatus)
  const workingTreeStatus = useGitStore((state) => selectWorkingTreeStatus(state, workingPath))

  useEffect(() => {
    /*
     * Re-read on every refresh so the commit set cannot go stale against the diff on screen.
     * `refreshToken` is referenced here as well as in the dependency list: its value carries no
     * meaning beyond "a refresh happened", and the same pattern is used by `useSessionTurns`.
     */
    logger.debug('Reloading working-tree status for commit paths', { refreshToken })
    void refreshStatus(workingPath)
  }, [workingPath, refreshStatus, refreshToken])

  /*
   * A rename contributes both of its paths. `git status` reports a rename under its target only, and
   * a pathspec commit covers exactly the paths it is given - so committing a rename with just the
   * target produced a commit containing *both* files and left the staged deletion of the source
   * behind. Verified against real git.
   */
  return {
    /*
     * Target paths only. Expanding a rename's source belongs to `commitGit`, which does it conditionally -
     * skipping a source that something now occupies, because `git commit -- <paths>` commits the working-tree
     * content of the paths it is handed. Doing it here as well passed an occupied source through, and main only
     * ever adds to the caller's selection, so it could never be taken back out. The header's Commit dialog
     * already passes target paths only; this is the panel agreeing with it.
     */
    paths: (workingTreeStatus.status?.changedFiles ?? []).map((file) => file.path),
    error: workingTreeStatus.error,
    isLoading: workingTreeStatus.isLoading,
    changedFileCount: (workingTreeStatus.status?.changedFiles ?? []).length,
  }
}
