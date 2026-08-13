import { create } from 'zustand';
import { createChatActions } from './chat-store-actions';
export const useChatStore = create((set, get) => ({
    sessions: [],
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: null,
    activeSession: null,
    error: null,
    ...createChatActions(set, get),
}));
