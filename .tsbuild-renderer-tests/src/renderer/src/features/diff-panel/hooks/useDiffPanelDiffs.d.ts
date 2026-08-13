import type { GitFileDiff } from '@shared/types/git';
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store';
/**
 * Load and refresh diffs for the active scope (working tree or branch-vs-base).
 *
 * The path is a **working path**, not a project path: for a worktree-mode session it is
 * the Session worktree. Naming it precisely matters here because reading the project
 * path instead is exactly the defect ADR 0016 fixed.
 */
export declare function useDiffPanelDiffs(workingPath: string | null, selection: DiffScopeSelection): {
    refreshDiff: (projectPathToRefresh: string) => Promise<void>;
    fileDiffs: readonly GitFileDiff[];
    isLoading: boolean;
    error: string | null;
};
