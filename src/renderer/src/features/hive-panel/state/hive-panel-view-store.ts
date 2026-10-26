import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

/** The Hive panel's two views (#377): the tree by parent, or the groups by Delegation state. */
export type HivePanelView = 'tree' | 'by-state'

interface HivePanelViewState {
  readonly view: HivePanelView
  /** Archived Workers shown in place, dimmed, in the tree. */
  readonly showArchived: boolean
  /** Collapsed tree rows, by Session id; every row starts expanded. */
  readonly collapsed: Readonly<Record<string, true>>
  readonly setView: (view: HivePanelView) => void
  readonly setShowArchived: (showArchived: boolean) => void
  readonly setCollapsed: (sessionId: string, collapsed: boolean) => void
}

/** Collapsed rows remembered; the oldest choice is forgotten first, so the store stays small. */
const MAX_REMEMBERED_COLLAPSED = 500

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

export const useHivePanelViewStore = create<HivePanelViewState>()(
  persist(
    (set) => ({
      view: 'tree',
      showArchived: false,
      collapsed: {},
      setView: (view) => set({ view }),
      setShowArchived: (showArchived) => set({ showArchived }),
      setCollapsed: (sessionId, collapsed) =>
        set((state) => {
          const { [sessionId]: _removed, ...rest } = state.collapsed
          if (!collapsed) return { collapsed: rest }
          const kept = Object.keys(rest).slice(-(MAX_REMEMBERED_COLLAPSED - 1))
          return {
            collapsed: Object.fromEntries([...kept, sessionId].map((id) => [id, true] as const)),
          }
        }),
    }),
    { name: 'openwaggle:hive-panel:v1', storage: createJSONStorage(resolveStorage) },
  ),
)
