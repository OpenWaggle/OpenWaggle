import type { PreparedAttachment } from '@shared/types/agent'
import type { LexicalEditor } from 'lexical'
import { create } from 'zustand'

export type { ComposerActionDialogKind } from './composer-action-store'

type MenuKind = 'quality' | 'execution' | 'branch' | null

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
  removeAttachment: (id: string) => void
  setAttachmentError: (error: string | null) => void

  // Menu toggles (only one open at a time)
  qualityMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  openMenu: (menu: MenuKind) => void

  // Slash skills
  slashHighlightIndex: number
  dismissedSlashToken: string | null
  setSlashHighlightIndex: (index: number) => void
  setDismissedSlashToken: (token: string | null) => void

  // Compact command
  compactSaveForThread: boolean
  setCompactSaveForThread: (value: boolean) => void

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
  qualityMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  slashHighlightIndex: number
  dismissedSlashToken: string | null
  compactSaveForThread: boolean
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
    qualityMenuOpen: false,
    executionMenuOpen: false,
    branchMenuOpen: false,
    slashHighlightIndex: 0,
    dismissedSlashToken: null,
    compactSaveForThread: false,
  }
}

const INITIAL_STATE: InitialComposerState = buildInitialState()

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

  removeAttachment(id: string) {
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }))
  },

  setAttachmentError(error: string | null) {
    set({ attachmentError: error })
  },

  openMenu(menu: MenuKind) {
    set({
      qualityMenuOpen: menu === 'quality',
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

  setCompactSaveForThread(value: boolean) {
    set({ compactSaveForThread: value })
  },

  lexicalEditor: null,
  setLexicalEditor(editor: LexicalEditor | null) {
    set({ lexicalEditor: editor })
  },

  reset() {
    const { promptHistory } = get()
    set({
      input: '',
      cursorIndex: 0,
      historyIndex: promptHistory.length,
      draftInput: '',
      attachments: [],
      attachmentError: null,
      dismissedSlashToken: null,
      slashHighlightIndex: 0,
      qualityMenuOpen: false,
      executionMenuOpen: false,
      branchMenuOpen: false,
    })
  },
}))
