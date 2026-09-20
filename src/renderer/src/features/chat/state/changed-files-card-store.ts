import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

interface ChangedFilesCardState {
  /** Persisted per session+turn (ADR 0033); absent = apply the auto-expand rule. */
  readonly expandedByCardKey: Record<string, boolean>
  readonly setExpanded: (cardKey: string, expanded: boolean) => void
}

/** Memory-backed storage so the store is safe to construct without a DOM (tests). */
function resolveStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  const memory = new Map<string, string>()
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value)
    },
    removeItem: (key) => {
      memory.delete(key)
    },
  }
}

export function changedFilesCardKey(sessionId: string | null, turnId: string) {
  return `${sessionId ?? 'sessionless'}:${turnId}`
}

export const useChangedFilesCardStore = create<ChangedFilesCardState>()(
  persist(
    (set) => ({
      expandedByCardKey: {},
      setExpanded: (cardKey, expanded) =>
        set((state) => ({
          expandedByCardKey: { ...state.expandedByCardKey, [cardKey]: expanded },
        })),
    }),
    { name: 'openwaggle:changed-files-card:v1', storage: createJSONStorage(resolveStorage) },
  ),
)
