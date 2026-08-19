import type { SessionId } from '@shared/types/brand'
import type { PinnedSession } from '@shared/types/session'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import {
  DEFAULT_PINNED_SORT_MODE,
  type PinnedSortMode,
} from '@/features/sidebar/lib/pinned-sessions'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('pinned-sessions')

/**
 * Pinned sessions (issue #97).
 *
 * Two kinds of state with deliberately different homes (ADR 0019):
 *
 * - `pins` — the Pinned sessions and their Manual order. Owned by the main process and
 *   only mirrored here, so it is never persisted by this store.
 * - `sortMode` — the Pinned sort, a local view preference, persisted to localStorage.
 *   `partialize` keeps `pins` out of storage so a stale mirror can never be restored.
 */
interface PinnedSessionsState {
  readonly pins: readonly PinnedSession[]
  readonly sortMode: PinnedSortMode
  readonly loadPins: () => Promise<void>
  readonly setSortMode: (sortMode: PinnedSortMode) => void
  readonly pinSession: (sessionId: SessionId) => Promise<void>
  readonly unpinSession: (sessionId: SessionId) => Promise<void>
  readonly movePin: (
    sessionId: SessionId,
    neighbours: {
      readonly afterSessionId: SessionId | null
      readonly beforeSessionId: SessionId | null
    },
  ) => Promise<void>
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

export const usePinnedSessionsStore = create<PinnedSessionsState>()(
  persist(
    (set, get) => {
      async function mutate(operation: string, run: () => Promise<void>) {
        try {
          await run()
          await get().loadPins()
        } catch (error) {
          logger.warn(`Failed to ${operation}`, { error: String(error) })
        }
      }

      return {
        pins: [],
        sortMode: DEFAULT_PINNED_SORT_MODE,

        loadPins: async () => {
          try {
            set({ pins: await api.listPinnedSessions() })
          } catch (error) {
            logger.warn('Failed to load pinned sessions', { error: String(error) })
          }
        },

        setSortMode: (sortMode) => set({ sortMode }),

        pinSession: (sessionId) => mutate('pin session', () => api.pinSession(sessionId)),

        unpinSession: (sessionId) => mutate('unpin session', () => api.unpinSession(sessionId)),

        movePin: (sessionId, neighbours) =>
          mutate('move pinned session', () =>
            api.movePinnedSession({
              sessionId,
              afterSessionId: neighbours.afterSessionId,
              beforeSessionId: neighbours.beforeSessionId,
            }),
          ),
      }
    },
    {
      name: 'openwaggle:pinned-sessions:v1',
      version: 1,
      storage: createJSONStorage(resolveStorage),
      // Manual order lives in the database, never in localStorage.
      partialize: (state) => ({ sortMode: state.sortMode }),
    },
  ),
)
