import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isRightPanelSurfaceId, type RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import {
  fullRailOrder,
  moveRailSurface,
  type RailMove,
  visibleRailOrder,
} from './right-panel-rail-order'

export const RIGHT_PANEL_RAIL_STORAGE_KEY = 'openwaggle:right-panel-rail:v1'
/** Sessions whose Right panel memory is kept; older entries are dropped first. */
const MAX_REMEMBERED_SESSIONS = 200

export interface SessionRightPanelMemory {
  readonly surface: RightPanelSurfaceId | null
  readonly open: boolean
  readonly lastFilePath: string | null
  /** The panel last showed a side Terminal, which has no rail icon. */
  readonly terminal: boolean
}

const EMPTY_SESSION_MEMORY: SessionRightPanelMemory = {
  surface: null,
  open: false,
  lastFilePath: null,
  terminal: false,
}

interface RightPanelRailPersistedState {
  /** The user's order, or null while they have never customised it. */
  readonly order: readonly RightPanelSurfaceId[] | null
  readonly hidden: readonly RightPanelSurfaceId[]
  /** Extension panels the user has already been shown, so New appears once per user. */
  readonly acknowledged: readonly RightPanelSurfaceId[]
  /** False until the first extension listing, which is acknowledged silently. */
  readonly extensionsInitialized: boolean
  readonly lastSurface: RightPanelSurfaceId | null
  readonly sessions: Readonly<Record<string, SessionRightPanelMemory>>
}

interface RightPanelRailState extends RightPanelRailPersistedState {
  /** Rail surfaces the rail currently has no room for (not persisted). */
  readonly overflowing: readonly RightPanelSurfaceId[]
  readonly setOverflowing: (surfaces: readonly RightPanelSurfaceId[]) => void
  readonly move: (
    surface: RightPanelSurfaceId,
    move: RailMove,
    known: readonly RightPanelSurfaceId[],
    /** Also listed but not on the rail now (needs trust or an update); they keep their slot. */
    listed?: readonly RightPanelSurfaceId[],
  ) => void
  readonly setPinned: (surface: RightPanelSurfaceId, pinned: boolean) => void
  readonly reset: () => void
  readonly acknowledge: (surfaces: readonly RightPanelSurfaceId[]) => void
  readonly initializeExtensions: (surfaces: readonly RightPanelSurfaceId[]) => void
  readonly rememberSession: (sessionKey: string, memory: Partial<SessionRightPanelMemory>) => void
}

const INITIAL_STATE: RightPanelRailPersistedState = {
  order: null,
  hidden: [],
  acknowledged: [],
  extensionsInitialized: false,
  lastSurface: null,
  sessions: {},
}

function uniqueSurfaces(values: readonly RightPanelSurfaceId[]) {
  return [...new Set(values)]
}

function boundedSessions(
  sessions: Readonly<Record<string, SessionRightPanelMemory>>,
  sessionKey: string,
  memory: SessionRightPanelMemory,
) {
  const entries = Object.entries(sessions).filter(([key]) => key !== sessionKey)
  entries.push([sessionKey, memory])
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_SESSIONS))
}

function surfaceList(value: unknown): RightPanelSurfaceId[] {
  if (!Array.isArray(value)) return []
  return uniqueSurfaces(
    value.filter(
      (entry): entry is RightPanelSurfaceId =>
        typeof entry === 'string' && isRightPanelSurfaceId(entry),
    ),
  )
}

function surfaceOrNull(value: unknown): RightPanelSurfaceId | null {
  return typeof value === 'string' && isRightPanelSurfaceId(value) ? value : null
}

function sanitizeSessions(value: unknown): Record<string, SessionRightPanelMemory> {
  if (value === null || typeof value !== 'object') return {}
  const sessions: Record<string, SessionRightPanelMemory> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (key.length === 0 || raw === null || typeof raw !== 'object') continue
    const open: unknown = Reflect.get(raw, 'open')
    const lastFilePath: unknown = Reflect.get(raw, 'lastFilePath')
    sessions[key] = {
      surface: surfaceOrNull(Reflect.get(raw, 'surface')),
      open: open === true,
      lastFilePath:
        typeof lastFilePath === 'string' && lastFilePath.length > 0 ? lastFilePath : null,
      terminal: Reflect.get(raw, 'terminal') === true,
    }
  }
  return Object.fromEntries(Object.entries(sessions).slice(-MAX_REMEMBERED_SESSIONS))
}

/** Validates persisted rail state; anything unreadable falls back to the defaults. */
export function sanitizeRightPanelRailState(value: unknown): RightPanelRailPersistedState {
  if (value === null || typeof value !== 'object') return INITIAL_STATE
  const order: unknown = Reflect.get(value, 'order')
  return {
    order: Array.isArray(order) ? surfaceList(order) : null,
    hidden: surfaceList(Reflect.get(value, 'hidden')),
    acknowledged: surfaceList(Reflect.get(value, 'acknowledged')),
    extensionsInitialized: Reflect.get(value, 'extensionsInitialized') === true,
    lastSurface: surfaceOrNull(Reflect.get(value, 'lastSurface')),
    sessions: sanitizeSessions(Reflect.get(value, 'sessions')),
  }
}

export const useRightPanelRailStore = create<RightPanelRailState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,
      overflowing: [],
      setOverflowing: (surfaces) => {
        const current = get().overflowing
        if (
          current.length === surfaces.length &&
          current.every((id, index) => id === surfaces[index])
        ) {
          return
        }
        set({ overflowing: surfaces })
      },
      move: (surface, move, known, listed = known) => {
        const { order, hidden } = get()
        const full = fullRailOrder(order, listed)
        const visible = visibleRailOrder(order, known, hidden)
        set({ order: moveRailSurface(full, visible, surface, move) })
      },
      setPinned: (surface, pinned) => {
        const hidden = get().hidden.filter((entry) => entry !== surface)
        set({ hidden: pinned ? hidden : [...hidden, surface] })
      },
      reset: () => set({ order: null, hidden: [] }),
      acknowledge: (surfaces) => {
        const acknowledged = get().acknowledged
        const known = new Set(acknowledged)
        const missing = surfaces.filter((surface) => !known.has(surface))
        if (missing.length > 0) set({ acknowledged: [...acknowledged, ...missing] })
      },
      initializeExtensions: (surfaces) => {
        if (get().extensionsInitialized) return
        set({
          extensionsInitialized: true,
          acknowledged: uniqueSurfaces([...get().acknowledged, ...surfaces]),
        })
      },
      rememberSession: (sessionKey, memory) => {
        if (sessionKey.length === 0) return
        const previous = get().sessions[sessionKey] ?? EMPTY_SESSION_MEMORY
        const next = { ...previous, ...memory }
        if (
          previous.surface === next.surface &&
          previous.open === next.open &&
          previous.lastFilePath === next.lastFilePath &&
          get().sessions[sessionKey] !== undefined
        ) {
          return
        }
        set({
          sessions: boundedSessions(get().sessions, sessionKey, next),
          ...(next.surface !== null && next.open ? { lastSurface: next.surface } : {}),
        })
      },
    }),
    {
      name: RIGHT_PANEL_RAIL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): RightPanelRailPersistedState => ({
        order: state.order,
        hidden: state.hidden,
        acknowledged: state.acknowledged,
        extensionsInitialized: state.extensionsInitialized,
        lastSurface: state.lastSurface,
        sessions: state.sessions,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizeRightPanelRailState(persisted) }),
    },
  ),
)

/** The file a Session's Files surface showed last, kept current as the memory changes. */
export function useSessionLastFilePath(sessionKey: string | null) {
  return useRightPanelRailStore((state) =>
    sessionKey === null ? null : (state.sessions[sessionKey]?.lastFilePath ?? null),
  )
}

export function sessionRightPanelMemory(sessionKey: string | null): SessionRightPanelMemory {
  if (sessionKey === null) return EMPTY_SESSION_MEMORY
  return useRightPanelRailStore.getState().sessions[sessionKey] ?? EMPTY_SESSION_MEMORY
}
