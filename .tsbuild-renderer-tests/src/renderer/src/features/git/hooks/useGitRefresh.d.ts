import type { SessionId } from '@shared/types/brand';
interface UseGitRefreshOptions {
    /** Working tree whose status is refreshed: the active session's Session worktree in worktree mode. */
    readonly workingPath: string | null;
    /** Repository the branch list belongs to. */
    readonly repositoryPath: string | null;
    readonly activeSessionId: SessionId | null;
    readonly refreshGitStatus: (workingPath: string | null) => Promise<void>;
    readonly refreshGitBranches: (repositoryPath: string | null) => Promise<void>;
    readonly refreshSession: (id: SessionId) => Promise<void>;
}
/**
 * Subscribes to agent runtime events and window focus to trigger debounced git
 * status/branch refreshes and diff-panel re-fetches.
 *
 * This is what makes the agent's work appear without the user asking: a terminal
 * transport event means a turn finished, so whatever the agent did to the working
 * tree is now visible. Status refreshes the **working path** and the branch list the
 * repository path — refreshing status for the project would report on the primary
 * checkout while the agent was editing a Session worktree (ADR 0016).
 */
export declare function useGitRefresh({ workingPath, repositoryPath, activeSessionId, refreshGitStatus, refreshGitBranches, refreshSession, }: UseGitRefreshOptions): void;
export {};
