import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

/** The Hive panel's two views: the tree by parent (#377), or the groups by next actor (issue 380). */
export type HivePanelView = 'tree' | 'by-next-actor'

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

/** What the panel remembers between launches. */
type PersistedHivePanelView = Pick<HivePanelViewState, 'view' | 'showArchived' | 'collapsed'>

const DEFAULT_VIEW: PersistedHivePanelView = { view: 'tree', showArchived: false, collapsed: {} }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rememberedCollapsed(value: unknown): Readonly<Record<string, true>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, collapsed]) =>
      collapsed === true ? [[id, true] as const] : [],
    ),
  )
}

/**
 * Reads a version-0 store: a remembered "By state" choice opens "By next actor", the view that
 * replaced it (issue 380). Anything unreadable starts from the defaults.
 */
export function migrateHivePanelView(persisted: unknown): PersistedHivePanelView {
  if (!isRecord(persisted)) return DEFAULT_VIEW
  return {
    view:
      persisted.view === 'by-state' || persisted.view === 'by-next-actor'
        ? 'by-next-actor'
        : 'tree',
    showArchived: persisted.showArchived === true,
    collapsed: rememberedCollapsed(persisted.collapsed),
  }
}

export const useHivePanelViewStore = create<HivePanelViewState>()(
  persist(
    (set) => ({
      ...DEFAULT_VIEW,
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
    {
      name: 'openwaggle:hive-panel:v1',
      storage: createJSONStorage(resolveStorage),
      partialize: ({ view, showArchived, collapsed }): PersistedHivePanelView => ({
        view,
        showArchived,
        collapsed,
      }),
      // Version 1 renames the grouped view: "By state" became "By next actor" (issue 380).
      version: 1,
      migrate: (persisted) => migrateHivePanelView(persisted),
    },
  ),
)
