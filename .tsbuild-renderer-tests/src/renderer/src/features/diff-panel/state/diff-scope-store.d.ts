/** Diff scope shown for a thread: branch-vs-base, working tree, or a single turn. */
export type DiffScopeSelection = {
    readonly kind: 'branch';
    readonly baseRef: string | null;
} | {
    readonly kind: 'unstaged';
} | {
    readonly kind: 'turn';
    readonly turnId: string;
    readonly filePath: string | null;
    readonly revealRequestId: number;
};
interface DiffScopeState {
    byThreadKey: Record<string, DiffScopeSelection>;
    branchBaseRefByThreadKey: Record<string, string | null>;
    selectGitScope: (threadKey: string, scope: 'branch' | 'unstaged') => void;
    selectBranchBaseRef: (threadKey: string, baseRef: string | null) => void;
    selectTurn: (threadKey: string, turnId: string, filePath?: string) => void;
    reconcileTurnSelection: (threadKey: string, availableTurnIds: readonly string[]) => void;
    removeThread: (threadKey: string) => void;
}
export declare const useDiffScopeStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<Omit<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<DiffScopeState>, "setState" | "persist"> & {
    setState(partial: DiffScopeState | Partial<DiffScopeState> | ((state: DiffScopeState) => DiffScopeState | Partial<DiffScopeState>), replace?: false | undefined): unknown;
    setState(state: DiffScopeState | ((state: DiffScopeState) => DiffScopeState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("node_modules/zustand/esm/middleware.mjs").PersistOptions<DiffScopeState, unknown, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: DiffScopeState) => void) => () => void;
        onFinishHydration: (fn: (state: DiffScopeState) => void) => () => void;
        getOptions: () => Partial<import("node_modules/zustand/esm/middleware.mjs").PersistOptions<DiffScopeState, unknown, unknown>>;
    };
}>;
/** Resolve the effective diff scope for a thread, defaulting sensibly. */
export declare function selectThreadDiffScopeSelection(byThreadKey: Record<string, DiffScopeSelection>, threadKey: string | null | undefined, hasWorkingTreeChanges?: boolean): DiffScopeSelection;
export {};
