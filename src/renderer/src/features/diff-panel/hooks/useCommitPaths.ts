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
export function useCommitPaths(workingPath: WorkingPath | null, refreshToken = 0) {
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

  return (workingTreeStatus.status?.changedFiles ?? []).map((file) => file.path)
}
