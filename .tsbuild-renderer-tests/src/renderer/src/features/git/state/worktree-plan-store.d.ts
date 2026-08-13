import type { SessionEnvironmentMode } from '@shared/types/git';
/** User overrides for a session's worktree plan, layered over the session defaults. */
export interface WorktreePlanOverride {
    readonly envMode?: SessionEnvironmentMode;
    readonly baseRef?: string | null;
    readonly startFromOrigin?: boolean;
}
interface WorktreePlanState {
    readonly bySessionId: Record<string, WorktreePlanOverride>;
    readonly setOverride: (sessionId: string, patch: WorktreePlanOverride) => void;
    readonly takeOverride: (key: string) => WorktreePlanOverride | undefined;
}
/** Store key for a not-yet-created session's plan, keyed by the opened project. */
export declare function draftWorktreePlanKey(projectPath: string): string;
/**
 * Per-session composer-strip plan overrides (WS1b). Holding these in a store
 * (rather than syncing session props into component state) keeps the strip's
 * editable selections free of a derived-state effect.
 */
export declare const useWorktreePlanStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<WorktreePlanState>>;
export {};
