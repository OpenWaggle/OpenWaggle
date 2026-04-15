import type { ConversationId } from '@shared/types/brand'
import type { ContextHealthStatus, ContextSnapshot } from '@shared/types/context'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('context-store')

// ─── State ──────────────────────────────────────────────────

// Monotonically increasing request counter to prevent stale responses
let requestGeneration = 0

interface ContextState {
  readonly snapshot: ContextSnapshot | null
  readonly isCompacting: boolean
  readonly activeConversationId: ConversationId | null

  // Actions
  readonly setSnapshot: (snapshot: ContextSnapshot) => void
  readonly clearSnapshot: () => void
  readonly setCompacting: (compacting: boolean) => void
  readonly setActiveConversation: (conversationId: ConversationId | null) => void
}

export const useContextStore = create<ContextState>()((set) => ({
  snapshot: null,
  isCompacting: false,
  activeConversationId: null,

  setSnapshot: (snapshot) => set({ snapshot }),
  clearSnapshot: () => set({ snapshot: null }),
  setCompacting: (compacting) => set({ isCompacting: compacting }),

  setActiveConversation: (conversationId) => {
    const generation = ++requestGeneration
    set({ activeConversationId: conversationId })

    if (conversationId) {
      void api
        .getContextSnapshot(conversationId)
        .then((result) => {
          // Only apply if this is still the latest request
          if (generation === requestGeneration && result) {
            set({ snapshot: result })
          }
        })
        .catch((err) => logger.warn('Failed to fetch context snapshot', { error: err }))
    } else {
      void api
        .getBaselineSnapshot()
        .then((result) => {
          if (generation === requestGeneration) {
            set({ snapshot: result })
          }
        })
        .catch((err) => logger.warn('Failed to fetch baseline snapshot', { error: err }))
    }
  },
}))

// ─── Selectors ──────────────────────────────────────────────

const PERCENT_MULTIPLIER = 100

export function selectPercentUsed(state: ContextState): number {
  if (!state.snapshot || state.snapshot.contextWindow === 0) return 0
  return Math.round((state.snapshot.usedTokens / state.snapshot.contextWindow) * PERCENT_MULTIPLIER)
}

export function selectHealthStatus(state: ContextState): ContextHealthStatus | null {
  return state.snapshot?.healthStatus ?? null
}

// ─── IPC Subscription ───────────────────────────────────────

/**
 * Initialize the context snapshot system:
 * - Subscribe to main-process push events
 * - Fetch initial baseline snapshot (system prompt + tools)
 * Returns cleanup function.
 */
export function initContextSnapshotListener(): () => void {
  const unsubscribe = api.onContextSnapshot((payload) => {
    const { activeConversationId } = useContextStore.getState()
    if (activeConversationId && payload.conversationId === activeConversationId) {
      useContextStore.getState().setSnapshot(payload.snapshot)
    }
  })

  // Fetch baseline immediately so the meter shows a real value from startup
  void api
    .getBaselineSnapshot()
    .then((result) => {
      // Only apply if no conversation-specific snapshot has arrived yet
      if (useContextStore.getState().snapshot === null) {
        useContextStore.getState().setSnapshot(result)
      }
    })
    .catch((err) => logger.warn('Failed to fetch initial baseline', { error: err }))

  return unsubscribe
}
