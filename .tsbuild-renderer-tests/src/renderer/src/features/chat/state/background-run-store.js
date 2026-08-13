import { create } from 'zustand';
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state';
import { api } from '@/shared/lib/ipc';
export const useBackgroundRunStore = create((set, get) => ({
    activeRunIds: new Set(),
    renderSnapshotsBySessionId: new Map(),
    addActiveRun(id) {
        set((state) => {
            if (state.activeRunIds.has(id))
                return state;
            const next = new Set(state.activeRunIds);
            next.add(id);
            return { activeRunIds: next };
        });
    },
    removeActiveRun(id) {
        set((state) => {
            if (!state.activeRunIds.has(id))
                return state;
            const next = new Set(state.activeRunIds);
            next.delete(id);
            return { activeRunIds: next };
        });
    },
    hasActiveRun(id) {
        return get().activeRunIds.has(id);
    },
    getRunRenderSnapshot(id) {
        return get().renderSnapshotsBySessionId.get(id) ?? null;
    },
    setRunRenderMessages(id, messages) {
        set((state) => {
            const next = new Map(state.renderSnapshotsBySessionId);
            next.set(id, {
                messages: [...messages],
                updatedAt: Date.now(),
            });
            return { renderSnapshotsBySessionId: next };
        });
    },
    applyRunRenderEvent(id, event) {
        set((state) => {
            const existing = state.renderSnapshotsBySessionId.get(id);
            if (!existing) {
                return state;
            }
            const next = new Map(state.renderSnapshotsBySessionId);
            next.set(id, {
                messages: applyAgentTransportEvent([...existing.messages], event),
                updatedAt: Date.now(),
            });
            return { renderSnapshotsBySessionId: next };
        });
    },
    clearRunRenderSnapshot(id) {
        set((state) => {
            if (!state.renderSnapshotsBySessionId.has(id))
                return state;
            const next = new Map(state.renderSnapshotsBySessionId);
            next.delete(id);
            return { renderSnapshotsBySessionId: next };
        });
    },
    async initialize() {
        const runs = await api.listActiveRuns();
        const ids = new Set(runs.map((r) => r.sessionId));
        set({ activeRunIds: ids });
    },
}));
