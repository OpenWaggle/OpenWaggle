/**
 * The working tree the active session's git status and mutations target.
 *
 * Delegates to the shared `resolveSessionWorkingDir` rather than re-deriving the
 * rule. A second resolver is what caused the defect this fixes: the diff section
 * resolved the session's worktree while the git store refreshed the project path,
 * so the two halves of the UI reported on different trees.
 *
 * Repository-level data (branch list, worktree list, remotes) must use
 * `useRepositoryPath` instead: a linked worktree shares `refs/` with the primary
 * checkout, so that data is per-repository, not per session.
 */
export declare function useActiveWorkingPath(): string | null;
/** The repository a session belongs to. Keys branch lists, worktree lists and remotes. */
export declare function useRepositoryPath(): string | null;
