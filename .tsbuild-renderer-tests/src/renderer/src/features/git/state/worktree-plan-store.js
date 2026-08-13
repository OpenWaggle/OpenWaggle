import { create } from 'zustand';
/** Store key for a not-yet-created session's plan, keyed by the opened project. */
export function draftWorktreePlanKey(projectPath) {
    return `draft:${projectPath}`;
}
/**
 * Per-session composer-strip plan overrides (WS1b). Holding these in a store
 * (rather than syncing session props into component state) keeps the strip's
 * editable selections free of a derived-state effect.
 */
export const useWorktreePlanStore = create()((set, get) => ({
    bySessionId: {},
    setOverride: (sessionId, patch) => set((state) => ({
        bySessionId: {
            ...state.bySessionId,
            [sessionId]: { ...state.bySessionId[sessionId], ...patch },
        },
    })),
    takeOverride: (key) => {
        const override = get().bySessionId[key];
        if (override) {
            set((state) => {
                const { [key]: _removed, ...rest } = state.bySessionId;
                return { bySessionId: rest };
            });
        }
        return override;
    },
}));
