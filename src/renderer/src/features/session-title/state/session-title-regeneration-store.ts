import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'

interface SessionTitleRegenerationState {
  /** Sessions with a Title regeneration request in flight. */
  readonly pending: ReadonlySet<SessionId>
  /** Claim the Session's regeneration slot; false when a request is already running. */
  readonly begin: (sessionId: SessionId) => boolean
  readonly finish: (sessionId: SessionId) => void
}

export const useSessionTitleRegenerationStore = create<SessionTitleRegenerationState>(
  (set, get) => ({
    pending: new Set(),
    begin(sessionId) {
      if (get().pending.has(sessionId)) return false
      set((state) => ({ pending: new Set(state.pending).add(sessionId) }))
      return true
    },
    finish(sessionId) {
      set((state) => {
        if (!state.pending.has(sessionId)) return state
        const pending = new Set(state.pending)
        pending.delete(sessionId)
        return { pending }
      })
    },
  }),
)
