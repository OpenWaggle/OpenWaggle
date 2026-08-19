import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { SidebarSessionSortMode } from '../lib/sidebar-project-groups'

const STORAGE_KEY = 'openwaggle:sidebar-view:v1'
const WRITE_DELAY_MS = 500

const SORT_MODES: readonly SidebarSessionSortMode[] = ['recent', 'oldest', 'name']

export const DEFAULT_SESSION_SORT_MODE: SidebarSessionSortMode = 'recent'

/**
 * Sidebar view state that outlives a launch.
 *
 * Only preferences the user authored by hand live here. Collapsing nine projects to focus
 * on one is work, and losing it on restart threw that work away. The chip filter is
 * deliberately absent: a filter subtracts sessions, so one left over from three days ago
 * would open the app showing a near-empty list with no memory of why. Sorting and
 * collapsing rearrange, and rearrangement is safe to remember.
 */
interface SidebarViewState {
  readonly sessionSortMode: SidebarSessionSortMode
  /**
   * Expansion by project path, not a set of collapsed paths.
   *
   * A record makes an unknown project `undefined`, so a default can apply, and it holds
   * one fact per project. Two sets, one collapsed and one expanded, can disagree about
   * the same project and there is no correct way to resolve that.
   */
  readonly projectExpandedByPath: Readonly<Record<string, boolean>>
  readonly setSessionSortMode: (mode: SidebarSessionSortMode) => void
  readonly setProjectExpanded: (projectPath: string, expanded: boolean) => void
  readonly toggleProjectExpanded: (projectPath: string) => void
  readonly forgetProject: (projectPath: string) => void
}

/** Projects are expanded until the user collapses one. */
export function isProjectExpanded(
  projectExpandedByPath: Readonly<Record<string, boolean>>,
  projectPath: string,
): boolean {
  return projectExpandedByPath[projectPath] ?? true
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

/**
 * Defer writes, coalesce them, and skip writes that would not change anything.
 *
 * `localStorage.setItem` is synchronous and serialising runs on the renderer thread, so
 * writing on every click puts JSON work directly in the interaction path. Collapsing four
 * projects quickly should cost one write, not four. Pending writes flush on `pagehide` so
 * quitting the app does not discard the last change.
 *
 * The value check matters because zustand's persist middleware writes after every
 * `setState`, including calls where a mutator returned the identical state. Comparing the
 * serialised payload is what makes a no-op click cost no disk write at all.
 */
function debouncedStorage(inner: StateStorage, delayMs = WRITE_DELAY_MS): StateStorage {
  const pending = new Map<string, string>()
  const lastWritten = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    for (const [key, value] of pending) {
      if (lastWritten.get(key) === value) continue
      inner.setItem(key, value)
      lastWritten.set(key, value)
    }
    pending.clear()
  }

  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)

  return {
    getItem: (key) => {
      const queued = pending.get(key)
      if (queued !== undefined) return queued
      const stored = inner.getItem(key)
      if (typeof stored === 'string') lastWritten.set(key, stored)
      return stored
    },
    setItem: (key, value) => {
      if (lastWritten.get(key) === value && !pending.has(key)) return
      pending.set(key, value)
      if (timer === null) timer = setTimeout(flush, delayMs)
    },
    removeItem: (key) => {
      pending.delete(key)
      lastWritten.delete(key)
      inner.removeItem(key)
    },
  }
}

function sanitizeSortMode(value: unknown): SidebarSessionSortMode {
  return SORT_MODES.find((mode) => mode === value) ?? DEFAULT_SESSION_SORT_MODE
}

/** Read one property off an unknown payload without asserting its shape. */
function readField(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') return undefined
  return Reflect.get(source, key)
}

/** Keep only string keys mapped to booleans, so a corrupt entry cannot poison the rest. */
function sanitizeExpandedByPath(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  if (value === null || typeof value !== 'object') return result
  for (const path of Object.keys(value)) {
    const expanded: unknown = Reflect.get(value, path)
    if (path.length > 0 && typeof expanded === 'boolean') result[path] = expanded
  }
  return result
}

export const useSidebarViewStore = create<SidebarViewState>()(
  persist(
    (set) => ({
      sessionSortMode: DEFAULT_SESSION_SORT_MODE,
      projectExpandedByPath: {},

      // Every mutator returns the identical state object when nothing changes, so an
      // unchanged click causes no re-render and no write.
      setSessionSortMode: (mode) =>
        set((state) => (state.sessionSortMode === mode ? state : { sessionSortMode: mode })),

      setProjectExpanded: (projectPath, expanded) =>
        set((state) => {
          if (isProjectExpanded(state.projectExpandedByPath, projectPath) === expanded) return state
          return {
            projectExpandedByPath: { ...state.projectExpandedByPath, [projectPath]: expanded },
          }
        }),

      toggleProjectExpanded: (projectPath) =>
        set((state) => ({
          projectExpandedByPath: {
            ...state.projectExpandedByPath,
            [projectPath]: !isProjectExpanded(state.projectExpandedByPath, projectPath),
          },
        })),

      forgetProject: (projectPath) =>
        set((state) => {
          if (!(projectPath in state.projectExpandedByPath)) return state
          const { [projectPath]: _removed, ...projectExpandedByPath } = state.projectExpandedByPath
          return { projectExpandedByPath }
        }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => debouncedStorage(resolveStorage())),
      partialize: (state) => ({
        sessionSortMode: state.sessionSortMode,
        projectExpandedByPath: state.projectExpandedByPath,
      }),
      /**
       * Validate on read rather than trusting the payload. A hand-edited or half-written
       * entry falls back to defaults instead of putting an impossible sort mode into the
       * UI, and a storage failure never blocks the sidebar from rendering.
       */
      merge: (persisted, current) => ({
        ...current,
        sessionSortMode: sanitizeSortMode(readField(persisted, 'sessionSortMode')),
        projectExpandedByPath: sanitizeExpandedByPath(
          readField(persisted, 'projectExpandedByPath'),
        ),
      }),
    },
  ),
)
