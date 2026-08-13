import { create } from 'zustand';
const EMPTY_QUEUE = [];
const nullSelector = (_state) => EMPTY_QUEUE;
const selectorCache = new Map();
export function selectQueue(sessionId) {
    if (!sessionId)
        return nullSelector;
    let selector = selectorCache.get(sessionId);
    if (!selector) {
        selector = (state) => state.queues.get(sessionId) ?? EMPTY_QUEUE;
        selectorCache.set(sessionId, selector);
    }
    return selector;
}
export const useMessageQueueStore = create((set, get) => ({
    queues: new Map(),
    enqueue(sessionId, payload) {
        const item = {
            id: crypto.randomUUID(),
            payload,
            queuedAt: Date.now(),
        };
        set((state) => {
            const next = new Map(state.queues);
            const existing = next.get(sessionId) ?? [];
            next.set(sessionId, [...existing, item]);
            return { queues: next };
        });
    },
    dequeue(sessionId) {
        const queue = get().queues.get(sessionId);
        if (!queue || queue.length === 0)
            return null;
        const [first, ...rest] = queue;
        set((state) => {
            const next = new Map(state.queues);
            if (rest.length === 0) {
                next.delete(sessionId);
            }
            else {
                next.set(sessionId, rest);
            }
            return { queues: next };
        });
        return first;
    },
    dismiss(sessionId, messageId) {
        set((state) => {
            const queue = state.queues.get(sessionId);
            if (!queue)
                return state;
            const filtered = queue.filter((item) => item.id !== messageId);
            const next = new Map(state.queues);
            if (filtered.length === 0) {
                next.delete(sessionId);
            }
            else {
                next.set(sessionId, filtered);
            }
            return { queues: next };
        });
    },
    promoteToFront(sessionId, messageId) {
        set((state) => {
            const queue = state.queues.get(sessionId);
            if (!queue)
                return state;
            const index = queue.findIndex((item) => item.id === messageId);
            if (index <= 0)
                return state;
            const item = queue[index];
            const next = new Map(state.queues);
            next.set(sessionId, [item, ...queue.slice(0, index), ...queue.slice(index + 1)]);
            return { queues: next };
        });
    },
    clearQueue(sessionId) {
        set((state) => {
            const next = new Map(state.queues);
            next.delete(sessionId);
            return { queues: next };
        });
    },
}));
