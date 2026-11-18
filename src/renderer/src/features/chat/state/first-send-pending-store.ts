import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'

/**
 * Sessions whose first message is on its way and whose run has not started or settled yet.
 *
 * This is the only thing the "Starting session" status may follow. First-send recovery state looks
 * similar but outlives the run on purpose (it keeps a replayable payload), so a spinner driven by
 * it could stay on a Session with nothing running.
 */
interface FirstSendPendingState {
  readonly ids: ReadonlySet<SessionId>
  readonly mark: (id: SessionId) => void
  readonly clear: (id: SessionId) => void
}

export const useFirstSendPendingStore = create<FirstSendPendingState>((set) => ({
  ids: new Set(),
  mark: (id) => set((state) => (state.ids.has(id) ? state : { ids: new Set([...state.ids, id]) })),
  clear: (id) =>
    set((state) => {
      if (!state.ids.has(id)) return state
      const ids = new Set(state.ids)
      ids.delete(id)
      return { ids }
    }),
}))
