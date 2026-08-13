import { TERMINAL_STATUSES } from '@shared/types/session-status';
import { create } from 'zustand';
export const useSessionStatusStore = create((set, get) => ({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
    setStatus(id, status) {
        set((state) => {
            const next = {};
            // Update statuses map
            if (state.statuses.get(id) !== status) {
                const nextStatuses = new Map(state.statuses);
                if (status === 'idle') {
                    nextStatuses.delete(id);
                }
                else {
                    nextStatuses.set(id, status);
                }
                next.statuses = nextStatuses;
            }
            // Update completedAt based on status category
            const isTerminal = TERMINAL_STATUSES.has(status);
            if (isTerminal) {
                // Terminal -> record completion time
                const nextCompleted = new Map(state.completedAt);
                nextCompleted.set(id, Date.now());
                next.completedAt = nextCompleted;
            }
            if (!isTerminal && state.completedAt.has(id)) {
                // Live or idle -> clear completion (session is active again or reset)
                const nextCompleted = new Map(state.completedAt);
                nextCompleted.delete(id);
                next.completedAt = nextCompleted;
            }
            // If nothing changed, bail
            if (Object.keys(next).length === 0)
                return state;
            return { ...state, ...next };
        });
    },
    clearStatus(id) {
        set((state) => {
            if (!state.statuses.has(id))
                return state;
            const next = new Map(state.statuses);
            next.delete(id);
            const nextCompleted = new Map(state.completedAt);
            nextCompleted.delete(id);
            return { statuses: next, completedAt: nextCompleted };
        });
    },
    getStatus(id) {
        return get().statuses.get(id) ?? 'idle';
    },
    markVisited(id) {
        set((state) => {
            const nextVisited = new Map(state.lastVisitedAt);
            nextVisited.set(id, Date.now());
            return { lastVisitedAt: nextVisited };
        });
    },
    markUnread(id) {
        set((state) => {
            const completed = state.completedAt.get(id) ?? Date.now();
            const nextVisited = new Map(state.lastVisitedAt);
            nextVisited.set(id, completed - 1);
            return { lastVisitedAt: nextVisited };
        });
    },
}));
