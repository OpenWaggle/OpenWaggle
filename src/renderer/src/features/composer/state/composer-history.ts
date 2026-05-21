import type { ComposerGet, ComposerSet } from './composer-store-types'

const PROMPT_HISTORY_KEY = 'openwaggle:prompt-history'
export const PROMPT_HISTORY_MAX = 100

function isPromptHistoryEntry(entry: unknown): entry is string {
  return typeof entry === 'string' && entry.trim().length > 0
}

export function loadPromptHistory(): string[] {
  try {
    const stored = getStorage()?.getItem(PROMPT_HISTORY_KEY)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPromptHistoryEntry).slice(-PROMPT_HISTORY_MAX)
  } catch {
    return []
  }
}

export function createHistoryActions(set: ComposerSet, get: ComposerGet) {
  return {
    pushHistory(text: string) {
      const trimmed = text.trim()
      if (!trimmed) return
      set((state) => pushPromptHistory(state.promptHistory, trimmed))
    },

    historyUp(currentInput: string) {
      const { promptHistory, historyIndex } = get()
      if (promptHistory.length === 0 || historyIndex <= 0) return null
      const newIndex = historyIndex - 1
      set((state) => ({
        historyIndex: newIndex,
        draftInput: historyIndex === promptHistory.length ? currentInput : state.draftInput,
      }))
      return promptHistory[newIndex] ?? null
    },

    historyDown() {
      const { promptHistory, historyIndex } = get()
      if (historyIndex >= promptHistory.length) return null
      const newIndex = historyIndex + 1
      set({ historyIndex: newIndex })
      return newIndex === promptHistory.length
        ? get().draftInput
        : (promptHistory[newIndex] ?? null)
    },
  }
}

function getStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function savePromptHistory(entries: readonly string[]) {
  try {
    getStorage()?.setItem(PROMPT_HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // Ignore localStorage quota errors or missing storage.
  }
}

function pushPromptHistory(promptHistory: readonly string[], trimmed: string) {
  const last = promptHistory[promptHistory.length - 1]
  if (last === trimmed) return { historyIndex: promptHistory.length, draftInput: '' }
  const entries = [...promptHistory, trimmed].slice(-PROMPT_HISTORY_MAX)
  savePromptHistory(entries)
  return { promptHistory: entries, historyIndex: entries.length, draftInput: '' }
}
