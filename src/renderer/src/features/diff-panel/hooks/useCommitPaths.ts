import { selectWorkingTreeStatus, useGitStore } from '@/features/git'

/**
 * The repo-relative paths a commit from this panel should stage.
 *
 * Always the working tree's changed files, never the scope on display. Derived from the rendered
 * diff, a commit-bearing quick action pressed while the Branch or Turn tab was selected staged the
 * *current* content of files belonging to past commits or a past turn, and silently omitted the
 * files that were actually dirty. Revert all and Stage all were already scope-gated; commit was
 * not.
 */
export function useCommitPaths(workingPath: string | null) {
  const workingTreeStatus = useGitStore((state) => selectWorkingTreeStatus(state, workingPath))
  return (workingTreeStatus.status?.changedFiles ?? []).map((file) => file.path)
}
