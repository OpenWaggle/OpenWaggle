import type { SessionSummary } from '@shared/types/session';
/**
 * Load git status for every listed session's working tree, so each row can show its
 * own state rather than the active session's.
 *
 * Fetching per session is affordable because the main process caches status behind a
 * short TTL and de-duplicates by path, so sessions sharing a working tree — every
 * local-mode session in one project — collapse to a single git invocation.
 */
export declare function useSessionGitIndicators(sessions: readonly SessionSummary[]): void;
/** The working tree a session row describes, or null when it has no project. */
export declare function sessionWorkingPath(session: SessionSummary): string | null;
/** One session's working-tree indicator, empty until its status is known. */
export declare function useSessionGitIndicator(session: SessionSummary): import("../lib/session-git-indicator").SessionGitIndicator;
