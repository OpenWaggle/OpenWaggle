import type { PreparedAttachment } from '@shared/types/agent'
import type { LexicalEditor } from 'lexical'
import { create } from 'zustand'

export type { ComposerActionDialogKind } from './composer-action-store'

type MenuKind = 'thinking' | 'execution' | 'branch' | null

export interface ComposerScopedDraft {
  readonly input: string
  readonly attachments: readonly PreparedAttachment[]
}

const PROMPT_HISTORY_KEY = 'openwaggle:prompt-history'
const PROMPT_HISTORY_MAX = 100

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function loadPromptHistory(): string[] {
  try {
    const stored = getStorage()?.getItem(PROMPT_HISTORY_KEY)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .slice(-PROMPT_HISTORY_MAX)
  } catch {
    return []
  }
}

function savePromptHistory(entries: readonly string[]): void {
  try {
    getStorage()?.setItem(PROMPT_HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // Ignore localStorage quota errors or missing storage
  }
}

interface ComposerState {
  // Text input
  input: string
  cursorIndex: number
  setInput: (value: string) => void
  setCursorIndex: (index: number) => void

  // Prompt history (ArrowUp/ArrowDown navigation)
  promptHistory: readonly string[]
  historyIndex: number
  draftInput: string
  pushHistory: (text: string) => void
  /** Navigate to previous prompt. Returns the text to display, or null if at boundary. */
  historyUp: (currentInput: string) => string | null
  /** Navigate to next prompt (or draft). Returns the text to display, or null if at boundary. */
  historyDown: () => string | null

  // Attachments
  attachments: PreparedAttachment[]
  attachmentError: string | null
  addAttachments: (files: PreparedAttachment[]) => void
  replaceAttachments: (files: readonly PreparedAttachment[]) => void
  removeAttachment: (id: string) => void
  setAttachmentError: (error: string | null) => void

  // Scoped drafts
  activeDraftContextKey: string | null
  scopedDrafts: Readonly<Record<string, ComposerScopedDraft>>
  setActiveDraftContextKey: (contextKey: string | null) => void
  switchScopedDraftContext: (
    contextKey: string,
    fallbackDraft?: ComposerScopedDraft,
    currentDraftOverride?: ComposerScopedDraft,
  ) => ComposerScopedDraft
  saveScopedDraft: (contextKey: string, draft: ComposerScopedDraft) => void
  getScopedDraft: (contextKey: string) => ComposerScopedDraft | null
  clearScopedDraft: (contextKey: string) => void
  clearScopedDraftsForSession: (sessionId: string) => void
  clearScopedDraftsForBranch: (sessionId: string, branchId: string) => void

  // Menu toggles (only one open at a time)
  thinkingMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  openMenu: (menu: MenuKind) => void

  // Slash skills
  slashHighlightIndex: number
  dismissedSlashToken: string | null
  setSlashHighlightIndex: (index: number) => void
  setDismissedSlashToken: (token: string | null) => void

  // Lexical editor ref (set by EditorRefPlugin, consumed by skill selection)
  lexicalEditor: LexicalEditor | null
  setLexicalEditor: (editor: LexicalEditor | null) => void

  // Reset (on conversation switch or after send)
  reset: () => void
}

interface InitialComposerState {
  input: string
  cursorIndex: number
  promptHistory: readonly string[]
  historyIndex: number
  draftInput: string
  attachments: PreparedAttachment[]
  attachmentError: string | null
  activeDraftContextKey: string | null
  scopedDrafts: Readonly<Record<string, ComposerScopedDraft>>
  thinkingMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  slashHighlightIndex: number
  dismissedSlashToken: string | null
}

function buildInitialState(): InitialComposerState {
  const loaded = loadPromptHistory()
  return {
    input: '',
    cursorIndex: 0,
    promptHistory: loaded,
    historyIndex: loaded.length,
    draftInput: '',
    attachments: [],
    attachmentError: null,
    activeDraftContextKey: null,
    scopedDrafts: {},
    thinkingMenuOpen: false,
    executionMenuOpen: false,
    branchMenuOpen: false,
    slashHighlightIndex: 0,
    dismissedSlashToken: null,
  }
}

const INITIAL_STATE: InitialComposerState = buildInitialState()

function isEmptyScopedDraft(draft: ComposerScopedDraft): boolean {
  return draft.input.trim().length === 0 && draft.attachments.length === 0
}

function normalizeScopedDraft(draft: ComposerScopedDraft): ComposerScopedDraft {
  return {
    input: draft.input,
    attachments: [...draft.attachments],
  }
}

function upsertScopedDraft(
  drafts: Readonly<Record<string, ComposerScopedDraft>>,
  contextKey: string,
  draft: ComposerScopedDraft,
): Readonly<Record<string, ComposerScopedDraft>> {
  const nextDrafts = { ...drafts }
  if (isEmptyScopedDraft(draft)) {
    delete nextDrafts[contextKey]
  } else {
    nextDrafts[contextKey] = normalizeScopedDraft(draft)
  }
  return nextDrafts
}

function removeScopedDraft(
  drafts: Readonly<Record<string, ComposerScopedDraft>>,
  contextKey: string,
): Readonly<Record<string, ComposerScopedDraft>> {
  const nextDrafts = { ...drafts }
  delete nextDrafts[contextKey]
  return nextDrafts
}

function contextMatchesSession(contextKey: string, sessionId: string): boolean {
  return contextKey.includes(`session:${sessionId}:`)
}

function contextMatchesBranch(contextKey: string, sessionId: string, branchId: string): boolean {
  return contextKey.includes(`session:${sessionId}:branch:${branchId}`)
}

function clearActiveDraftContextState() {
  return {
    activeDraftContextKey: null,
    input: '',
    cursorIndex: 0,
    attachments: [],
    attachmentError: null,
  }
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  ...INITIAL_STATE,

  setInput(value: string) {
    set({ input: value })
  },

  setCursorIndex(index: number) {
    set({ cursorIndex: index })
  },

  pushHistory(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    set((s) => {
      // Deduplicate if same as the most recent entry
      const last = s.promptHistory[s.promptHistory.length - 1]
      if (last === trimmed) {
        return { historyIndex: s.promptHistory.length, draftInput: '' }
      }
      const entries = [...s.promptHistory, trimmed].slice(-PROMPT_HISTORY_MAX)
      savePromptHistory(entries)
      return { promptHistory: entries, historyIndex: entries.length, draftInput: '' }
    })
  },

  historyUp(currentInput: string): string | null {
    const { promptHistory, historyIndex } = get()
    if (promptHistory.length === 0 || historyIndex <= 0) return null
    const isAtDraft = historyIndex === promptHistory.length
    const newIndex = historyIndex - 1
    set((s) => ({
      historyIndex: newIndex,
      draftInput: isAtDraft ? currentInput : s.draftInput,
    }))
    return promptHistory[newIndex] ?? null
  },

  historyDown(): string | null {
    const { promptHistory, historyIndex } = get()
    if (historyIndex >= promptHistory.length) return null
    const newIndex = historyIndex + 1
    set(() => ({ historyIndex: newIndex }))
    if (newIndex === promptHistory.length) return get().draftInput
    return promptHistory[newIndex] ?? null
  },

  addAttachments(files: PreparedAttachment[]) {
    set((s) => ({ attachments: [...s.attachments, ...files] }))
  },

  replaceAttachments(files: readonly PreparedAttachment[]) {
    set({ attachments: [...files] })
  },

  setActiveDraftContextKey(contextKey: string | null) {
    set({ activeDraftContextKey: contextKey })
  },

  switchScopedDraftContext(contextKey, fallbackDraft, currentDraftOverride) {
    const state = get()
    if (state.activeDraftContextKey === contextKey) {
      return normalizeScopedDraft({ input: state.input, attachments: state.attachments })
    }

    const currentDraft =
      currentDraftOverride ??
      normalizeScopedDraft({
        input: state.input,
        attachments: state.attachments,
      })
    const scopedDrafts = state.activeDraftContextKey
      ? upsertScopedDraft(state.scopedDrafts, state.activeDraftContextKey, currentDraft)
      : state.scopedDrafts
    const nextDraft = normalizeScopedDraft(
      scopedDrafts[contextKey] ?? fallbackDraft ?? { input: '', attachments: [] },
    )

    set({
      activeDraftContextKey: contextKey,
      scopedDrafts,
      input: nextDraft.input,
      cursorIndex: nextDraft.input.length,
      attachments: [...nextDraft.attachments],
      attachmentError: null,
      dismissedSlashToken: null,
      slashHighlightIndex: 0,
      historyIndex: state.promptHistory.length,
      draftInput: '',
    })

    return nextDraft
  },

  saveScopedDraft(contextKey, draft) {
    set((state) => ({
      scopedDrafts: upsertScopedDraft(state.scopedDrafts, contextKey, draft),
    }))
  },

  getScopedDraft(contextKey) {
    return get().scopedDrafts[contextKey] ?? null
  },

  clearScopedDraft(contextKey) {
    set((state) => ({
      scopedDrafts: removeScopedDraft(state.scopedDrafts, contextKey),
    }))
  },

  clearScopedDraftsForSession(sessionId) {
    set((state) => {
      const nextDrafts = { ...state.scopedDrafts }
      for (const contextKey of Object.keys(nextDrafts)) {
        if (contextMatchesSession(contextKey, sessionId)) {
          delete nextDrafts[contextKey]
        }
      }
      return {
        scopedDrafts: nextDrafts,
        ...(state.activeDraftContextKey &&
        contextMatchesSession(state.activeDraftContextKey, sessionId)
          ? clearActiveDraftContextState()
          : {}),
      }
    })
  },

  clearScopedDraftsForBranch(sessionId, branchId) {
    set((state) => {
      const nextDrafts = { ...state.scopedDrafts }
      for (const contextKey of Object.keys(nextDrafts)) {
        if (contextMatchesBranch(contextKey, sessionId, branchId)) {
          delete nextDrafts[contextKey]
        }
      }
      return {
        scopedDrafts: nextDrafts,
        ...(state.activeDraftContextKey &&
        contextMatchesBranch(state.activeDraftContextKey, sessionId, branchId)
          ? clearActiveDraftContextState()
          : {}),
      }
    })
  },

  removeAttachment(id: string) {
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }))
  },

  setAttachmentError(error: string | null) {
    set({ attachmentError: error })
  },

  openMenu(menu: MenuKind) {
    set({
      thinkingMenuOpen: menu === 'thinking',
      executionMenuOpen: menu === 'execution',
      branchMenuOpen: menu === 'branch',
    })
  },

  setSlashHighlightIndex(index: number) {
    set({ slashHighlightIndex: index })
  },

  setDismissedSlashToken(token: string | null) {
    set({ dismissedSlashToken: token })
  },

  lexicalEditor: null,
  setLexicalEditor(editor: LexicalEditor | null) {
    set({ lexicalEditor: editor })
  },

  reset() {
    const { activeDraftContextKey, promptHistory, scopedDrafts } = get()
    set({
      input: '',
      cursorIndex: 0,
      historyIndex: promptHistory.length,
      draftInput: '',
      attachments: [],
      attachmentError: null,
      dismissedSlashToken: null,
      slashHighlightIndex: 0,
      thinkingMenuOpen: false,
      executionMenuOpen: false,
      branchMenuOpen: false,
      scopedDrafts: activeDraftContextKey
        ? removeScopedDraft(scopedDrafts, activeDraftContextKey)
        : scopedDrafts,
    })
  },
}))
