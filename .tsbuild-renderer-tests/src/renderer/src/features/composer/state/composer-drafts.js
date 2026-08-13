export function normalizeScopedDraft(draft) {
    return {
        input: draft.input,
        attachments: [...draft.attachments],
    };
}
export function removeScopedDraft(drafts, contextKey) {
    const nextDrafts = { ...drafts };
    delete nextDrafts[contextKey];
    return nextDrafts;
}
export function createScopedDraftActions(set, get) {
    return {
        setActiveDraftContextKey(contextKey) {
            set({ activeDraftContextKey: contextKey });
        },
        switchScopedDraftContext(contextKey, fallbackDraft, currentDraftOverride) {
            const state = get();
            if (state.activeDraftContextKey === contextKey) {
                return normalizeScopedDraft({ input: state.input, attachments: state.attachments });
            }
            const currentDraft = currentDraftOverride ?? normalizeScopedDraft(state);
            const scopedDrafts = state.activeDraftContextKey
                ? upsertScopedDraft(state.scopedDrafts, state.activeDraftContextKey, currentDraft)
                : state.scopedDrafts;
            const nextDraft = normalizeScopedDraft(scopedDrafts[contextKey] ?? fallbackDraft ?? { input: '', attachments: [] });
            set(buildDraftContextState(contextKey, scopedDrafts, nextDraft, state.promptHistory.length));
            return nextDraft;
        },
        saveScopedDraft(contextKey, draft) {
            set((state) => ({ scopedDrafts: upsertScopedDraft(state.scopedDrafts, contextKey, draft) }));
        },
        getScopedDraft(contextKey) {
            return get().scopedDrafts[contextKey] ?? null;
        },
        clearScopedDraft(contextKey) {
            set((state) => ({ scopedDrafts: removeScopedDraft(state.scopedDrafts, contextKey) }));
        },
        clearScopedDraftsForSession(sessionId) {
            set((state) => clearMatchingScopedDrafts(state, (contextKey) => contextMatchesSession(contextKey, sessionId)));
        },
        clearScopedDraftsForBranch(sessionId, branchId) {
            set((state) => clearMatchingScopedDrafts(state, (contextKey) => contextMatchesBranch(contextKey, sessionId, branchId)));
        },
    };
}
function isEmptyScopedDraft(draft) {
    return draft.input.trim().length === 0 && draft.attachments.length === 0;
}
function upsertScopedDraft(drafts, contextKey, draft) {
    const nextDrafts = { ...drafts };
    if (isEmptyScopedDraft(draft)) {
        delete nextDrafts[contextKey];
    }
    else {
        nextDrafts[contextKey] = normalizeScopedDraft(draft);
    }
    return nextDrafts;
}
function buildDraftContextState(contextKey, scopedDrafts, nextDraft, promptHistoryLength) {
    return {
        activeDraftContextKey: contextKey,
        scopedDrafts,
        input: nextDraft.input,
        cursorIndex: nextDraft.input.length,
        attachments: [...nextDraft.attachments],
        attachmentError: null,
        dismissedSlashToken: null,
        slashHighlightIndex: 0,
        historyIndex: promptHistoryLength,
        draftInput: '',
    };
}
function clearMatchingScopedDrafts(state, matchesContext) {
    const nextDrafts = { ...state.scopedDrafts };
    for (const contextKey of Object.keys(nextDrafts)) {
        if (matchesContext(contextKey))
            delete nextDrafts[contextKey];
    }
    return {
        scopedDrafts: nextDrafts,
        ...(state.activeDraftContextKey && matchesContext(state.activeDraftContextKey)
            ? clearActiveDraftContextState()
            : {}),
    };
}
function contextMatchesSession(contextKey, sessionId) {
    return contextKey.includes(`session:${sessionId}:`);
}
function contextMatchesBranch(contextKey, sessionId, branchId) {
    return contextKey.includes(`session:${sessionId}:branch:${branchId}`);
}
function clearActiveDraftContextState() {
    return {
        activeDraftContextKey: null,
        input: '',
        cursorIndex: 0,
        attachments: [],
        attachmentError: null,
    };
}
