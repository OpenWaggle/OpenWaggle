import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
const DEFAULT_SELECTION = { kind: 'branch', baseRef: null };
const DEFAULT_WORKING_TREE_SELECTION = { kind: 'unstaged' };
function normalizeBaseRef(baseRef) {
    const normalized = baseRef?.trim();
    return normalized ? normalized : null;
}
/** Memory-backed storage so the store is safe to construct without a DOM (tests). */
function resolveStorage() {
    if (typeof window !== 'undefined' && window.localStorage)
        return window.localStorage;
    const memory = new Map();
    return {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => {
            memory.set(key, value);
        },
        removeItem: (key) => {
            memory.delete(key);
        },
    };
}
export const useDiffScopeStore = create()(persist((set) => ({
    byThreadKey: {},
    branchBaseRefByThreadKey: {},
    selectGitScope: (threadKey, scope) => set((state) => {
        const previous = state.byThreadKey[threadKey];
        const previousBaseRef = previous?.kind === 'branch'
            ? previous.baseRef
            : (state.branchBaseRefByThreadKey[threadKey] ?? null);
        return {
            byThreadKey: {
                ...state.byThreadKey,
                [threadKey]: scope === 'branch'
                    ? { kind: 'branch', baseRef: previousBaseRef }
                    : { kind: 'unstaged' },
            },
            branchBaseRefByThreadKey: previous?.kind === 'branch'
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
        };
    }),
    selectBranchBaseRef: (threadKey, baseRef) => set((state) => {
        const normalized = normalizeBaseRef(baseRef);
        return {
            byThreadKey: {
                ...state.byThreadKey,
                [threadKey]: { kind: 'branch', baseRef: normalized },
            },
            branchBaseRefByThreadKey: {
                ...state.branchBaseRefByThreadKey,
                [threadKey]: normalized,
            },
        };
    }),
    selectTurn: (threadKey, turnId, filePath) => set((state) => {
        const previous = state.byThreadKey[threadKey];
        return {
            byThreadKey: {
                ...state.byThreadKey,
                [threadKey]: {
                    kind: 'turn',
                    turnId,
                    filePath: filePath?.trim() || null,
                    revealRequestId: previous?.kind === 'turn' ? previous.revealRequestId + 1 : 1,
                },
            },
        };
    }),
    reconcileTurnSelection: (threadKey, availableTurnIds) => set((state) => {
        const previous = state.byThreadKey[threadKey];
        const latestTurnId = availableTurnIds[0];
        if (previous?.kind !== 'turn' ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)) {
            return state;
        }
        return {
            byThreadKey: {
                ...state.byThreadKey,
                [threadKey]: { ...previous, turnId: latestTurnId },
            },
        };
    }),
    removeThread: (threadKey) => set((state) => {
        if (!(threadKey in state.byThreadKey) && !(threadKey in state.branchBaseRefByThreadKey)) {
            return state;
        }
        const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
        const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } = state.branchBaseRefByThreadKey;
        return { byThreadKey, branchBaseRefByThreadKey };
    }),
}), {
    name: 'openwaggle:diff-scope:v1',
    version: 1,
    storage: createJSONStorage(resolveStorage),
    partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
    }),
}));
/** Resolve the effective diff scope for a thread, defaulting sensibly. */
export function selectThreadDiffScopeSelection(byThreadKey, threadKey, hasWorkingTreeChanges = false) {
    if (!threadKey)
        return DEFAULT_SELECTION;
    return (byThreadKey[threadKey] ??
        (hasWorkingTreeChanges ? DEFAULT_WORKING_TREE_SELECTION : DEFAULT_SELECTION));
}
