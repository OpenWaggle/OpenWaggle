import type {
  ComposerGet,
  ComposerScopedDraft,
  ComposerSet,
  ComposerState,
} from './composer-store-types'

export function normalizeScopedDraft(draft: ComposerScopedDraft) {
  return {
    input: draft.input,
    attachments: [...draft.attachments],
    wagglePreset: draft.wagglePreset ?? null,
  }
}

export function removeScopedDraft(
  drafts: Readonly<Record<string, ComposerScopedDraft>>,
  contextKey: string,
) {
  const nextDrafts = { ...drafts }
  delete nextDrafts[contextKey]
  return nextDrafts
}

export function createScopedDraftActions(set: ComposerSet, get: ComposerGet) {
  return {
    setActiveDraftContextKey(contextKey: string | null) {
      set({ activeDraftContextKey: contextKey })
    },

    switchScopedDraftContext(
      contextKey: string,
      fallbackDraft?: ComposerScopedDraft,
      currentDraftOverride?: ComposerScopedDraft,
    ) {
      const state = get()
      if (state.activeDraftContextKey === contextKey) {
        return normalizeScopedDraft({
          input: state.input,
          attachments: state.attachments,
          wagglePreset: state.selectedWagglePreset,
        })
      }
      const currentDraft =
        currentDraftOverride ??
        normalizeScopedDraft({
          input: state.input,
          attachments: state.attachments,
          wagglePreset: state.selectedWagglePreset,
        })
      const scopedDrafts = state.activeDraftContextKey
        ? upsertScopedDraft(state.scopedDrafts, state.activeDraftContextKey, currentDraft)
        : state.scopedDrafts
      const nextDraft = normalizeScopedDraft(
        scopedDrafts[contextKey] ??
          fallbackDraft ?? { input: '', attachments: [], wagglePreset: null },
      )
      set(buildDraftContextState(contextKey, scopedDrafts, nextDraft, state.promptHistory.length))
      return nextDraft
    },

    saveScopedDraft(contextKey: string, draft: ComposerScopedDraft) {
      set((state) => ({ scopedDrafts: upsertScopedDraft(state.scopedDrafts, contextKey, draft) }))
    },

    getScopedDraft(contextKey: string) {
      return get().scopedDrafts[contextKey] ?? null
    },

    clearScopedDraft(contextKey: string) {
      set((state) => ({ scopedDrafts: removeScopedDraft(state.scopedDrafts, contextKey) }))
    },

    clearScopedDraftsForSession(sessionId: string) {
      set((state) =>
        clearMatchingScopedDrafts(state, (contextKey) =>
          contextMatchesSession(contextKey, sessionId),
        ),
      )
    },

    clearScopedDraftsForBranch(sessionId: string, branchId: string) {
      set((state) =>
        clearMatchingScopedDrafts(state, (contextKey) =>
          contextMatchesBranch(contextKey, sessionId, branchId),
        ),
      )
    },
  }
}

function isEmptyScopedDraft(draft: ComposerScopedDraft) {
  return draft.input.trim().length === 0 && draft.attachments.length === 0 && !draft.wagglePreset
}

function upsertScopedDraft(
  drafts: Readonly<Record<string, ComposerScopedDraft>>,
  contextKey: string,
  draft: ComposerScopedDraft,
) {
  const nextDrafts = { ...drafts }
  if (isEmptyScopedDraft(draft)) {
    delete nextDrafts[contextKey]
  } else {
    nextDrafts[contextKey] = normalizeScopedDraft(draft)
  }
  return nextDrafts
}

function buildDraftContextState(
  contextKey: string,
  scopedDrafts: Readonly<Record<string, ComposerScopedDraft>>,
  nextDraft: ComposerScopedDraft,
  promptHistoryLength: number,
) {
  return {
    activeDraftContextKey: contextKey,
    scopedDrafts,
    input: nextDraft.input,
    cursorIndex: nextDraft.input.length,
    attachments: [...nextDraft.attachments],
    selectedWagglePreset: nextDraft.wagglePreset ?? null,
    attachmentError: null,
    dismissedSlashToken: null,
    slashHighlightIndex: 0,
    activeSlashCommand: null,
    historyIndex: promptHistoryLength,
    draftInput: '',
  }
}

function clearMatchingScopedDrafts(
  state: ComposerState,
  matchesContext: (contextKey: string) => boolean,
) {
  const nextDrafts = { ...state.scopedDrafts }
  for (const contextKey of Object.keys(nextDrafts)) {
    if (matchesContext(contextKey)) delete nextDrafts[contextKey]
  }
  return {
    scopedDrafts: nextDrafts,
    ...(state.activeDraftContextKey && matchesContext(state.activeDraftContextKey)
      ? clearActiveDraftContextState()
      : {}),
  }
}

function contextMatchesSession(contextKey: string, sessionId: string) {
  return contextKey.includes(`session:${sessionId}:`)
}

function contextMatchesBranch(contextKey: string, sessionId: string, branchId: string) {
  return contextKey.includes(`session:${sessionId}:branch:${branchId}`)
}

function clearActiveDraftContextState() {
  return {
    activeDraftContextKey: null,
    input: '',
    cursorIndex: 0,
    attachments: [],
    selectedWagglePreset: null,
    attachmentError: null,
  }
}
