import { create } from 'zustand';
const EMPTY_MESSAGES = [];
function getTextContent(message) {
    return message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : [])).join('\n\n');
}
function buildUserTextCounts(messages) {
    const counts = new Map();
    for (const message of messages) {
        if (message.role !== 'user') {
            continue;
        }
        const text = getTextContent(message);
        if (!text) {
            continue;
        }
        counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    return counts;
}
function removeMatchedMessages(optimisticMessages, persistedMessages) {
    const persistedCounts = buildUserTextCounts(persistedMessages);
    if (persistedCounts.size === 0) {
        return optimisticMessages;
    }
    const remaining = [];
    for (const message of optimisticMessages) {
        const text = getTextContent(message);
        const count = persistedCounts.get(text) ?? 0;
        if (count > 0) {
            persistedCounts.set(text, count - 1);
            continue;
        }
        remaining.push(message);
    }
    return remaining;
}
const nullSelector = (_state) => EMPTY_MESSAGES;
const selectorCache = new Map();
export function selectOptimisticUserMessages(sessionId) {
    if (!sessionId) {
        return nullSelector;
    }
    let selector = selectorCache.get(sessionId);
    if (!selector) {
        selector = (state) => state.messagesBySessionId.get(sessionId) ?? EMPTY_MESSAGES;
        selectorCache.set(sessionId, selector);
    }
    return selector;
}
export const useOptimisticUserMessageStore = create((set) => ({
    messagesBySessionId: new Map(),
    add(sessionId, message) {
        set((state) => {
            const existing = state.messagesBySessionId.get(sessionId) ?? EMPTY_MESSAGES;
            if (existing.some((candidate) => candidate.id === message.id)) {
                return state;
            }
            const next = new Map(state.messagesBySessionId);
            next.set(sessionId, [...existing, message]);
            return { messagesBySessionId: next };
        });
    },
    removeMatched(sessionId, persistedMessages) {
        set((state) => {
            const existing = state.messagesBySessionId.get(sessionId);
            if (!existing) {
                return state;
            }
            const remaining = removeMatchedMessages(existing, persistedMessages);
            if (remaining.length === existing.length) {
                return state;
            }
            const next = new Map(state.messagesBySessionId);
            if (remaining.length === 0) {
                next.delete(sessionId);
            }
            else {
                next.set(sessionId, remaining);
            }
            return { messagesBySessionId: next };
        });
    },
    clear(sessionId) {
        set((state) => {
            if (!state.messagesBySessionId.has(sessionId)) {
                return state;
            }
            const next = new Map(state.messagesBySessionId);
            next.delete(sessionId);
            return { messagesBySessionId: next };
        });
    },
}));
