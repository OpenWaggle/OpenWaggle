import type { SessionId } from '@shared/types/brand';
import type { SessionEnvironmentMode } from '@shared/types/git';
/**
 * Stamp the resolved composer-strip plan onto the draft key so it survives the
 * lazy session creation on the send path (review renderer-B1).
 */
export declare function stashDraftWorktreePlan(projectPath: string, plan: {
    envMode: SessionEnvironmentMode;
    baseRef: string | null;
    startFromOrigin: boolean;
}): void;
/**
 * Flush a stashed draft plan onto a freshly-created session before its first run
 * births the worktree, so the user's pre-send choice is honoured.
 */
export declare function flushDraftWorktreePlanToSession(projectPath: string, sessionId: SessionId): Promise<void>;
