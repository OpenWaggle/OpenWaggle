import type { SessionId, WorkingPath } from '@shared/types/brand'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { useDiffPanelDiffs } from './useDiffPanelDiffs'
import { useTurnDiffFiles } from './useSessionTurns'

/**
 * The diff currently on screen, whichever scope is active.
 *
 * Both loaders always run - their inputs decide which one has anything to say - and this picks the
 * one the active scope refers to. Kept together because the choice has to be made consistently for
 * the files, the loading state and the failure: presenting a turn whose checkpoint could not be read
 * as an empty diff told the user a past turn changed nothing.
 */
/** Reload the branch or working-tree diff, when there is a tree to reload. */
function refreshCurrentTree(
  workingPath: WorkingPath | null,
  refreshDiff: (workingPath: WorkingPath) => Promise<void>,
) {
  if (workingPath) void refreshDiff(workingPath)
}

export function useDisplayedDiff(input: {
  readonly sessionId: SessionId | null
  readonly workingPath: WorkingPath | null
  readonly selection: DiffScopeSelection
  readonly refreshToken: number
}) {
  const branchOrTreeDiffs = useDiffPanelDiffs(
    input.workingPath,
    input.selection,
    input.refreshToken,
  )
  const turnFiles = useTurnDiffFiles(input.sessionId, input.selection)
  const isTurnScope = input.selection.kind === 'turn'

  return {
    fileDiffs: isTurnScope ? turnFiles.files : branchOrTreeDiffs.fileDiffs,
    isLoading: isTurnScope ? turnFiles.isLoading : branchOrTreeDiffs.isLoading,
    loadError: isTurnScope ? turnFiles.error : branchOrTreeDiffs.error,
    refreshDiff: branchOrTreeDiffs.refreshDiff,
    /**
     * Retry whichever loader owns the active scope.
     *
     * "Try again" on a failed turn diff went to the diff loader, which does not own turn scopes: it first
     * ran a working-tree `git diff` and replaced the failure with the wrong files, then - once that was
     * stopped - did nothing at all.
     */
    retryLoad: isTurnScope
      ? turnFiles.retry
      : () => refreshCurrentTree(input.workingPath, branchOrTreeDiffs.refreshDiff),
    /** What "Automatic" resolved to, for the base-ref control to report. */
    resolvedAutomaticBaseRef: branchOrTreeDiffs.resolvedBaseRef,
    /** True when Automatic resolved nothing and this is really the working-tree diff. */
    automaticFellBackToWorkingTree:
      input.selection.kind === 'branch' && branchOrTreeDiffs.automaticFellBackToWorkingTree,
  }
}
