import type { SessionId } from '@shared/types/brand';
import type { SessionEnvironmentMode, VcsChangeRequest } from '@shared/types/git';
import type { SessionDetail } from '@shared/types/session';
import { type WorktreeSendPlan } from '@/features/git/lib/worktree-send-plan';
interface UseSessionContextRowInput {
    readonly sessionId: SessionId | null;
    readonly projectPath: string | null;
    readonly isFirstMessage: boolean;
    readonly session: Pick<SessionDetail, 'environmentMode' | 'worktreePath' | 'worktreeBaseRef' | 'worktreeStartFromOrigin'> | null;
    readonly defaultEnvironmentMode: SessionEnvironmentMode;
}
export interface SessionContextRowState {
    readonly visible: boolean;
    readonly envMode: SessionEnvironmentMode;
    readonly baseRef: string | null;
    /** The Session worktree path once it exists, so the run target can show its branch. */
    readonly worktreePath: string | null;
    readonly startFromOrigin: boolean;
    readonly branchNames: readonly string[];
    readonly changeRequests: readonly VcsChangeRequest[];
    readonly sendPlan: WorktreeSendPlan;
    readonly setEnvMode: (mode: SessionEnvironmentMode) => void;
    readonly setBaseRef: (baseRef: string) => void;
    readonly setStartFromOrigin: (startFromOrigin: boolean) => void;
    readonly loadChangeRequests: () => Promise<void>;
    readonly checkoutChangeRequest: (headRef: string) => Promise<boolean>;
    /** Recreate a vanished Session worktree from its recorded base ref. */
    readonly recreateWorktree: () => Promise<boolean>;
    /** Abandon the vanished worktree and run this session in the opened checkout. */
    readonly switchToLocalMode: () => void;
}
/**
 * Controller for the composer context strip (WS1b). Effective plan values are
 * computed from per-session overrides layered over the session defaults (no
 * props-into-state sync), and persisted to the backend so worktree birth uses
 * them.
 */
export declare function useSessionContextRow(input: UseSessionContextRowInput): SessionContextRowState;
export {};
