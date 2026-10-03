import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'

/**
 * Sessions with a composer send in flight: from the moment the send waits on pending setting writes
 * until the Host's report settles, and through a delivered Run. The Host starts the Run during this
 * window, so the Session's settings (its model and thinking level) must not change here even before
 * the Run reports `agent_start`. Counted, because a second send can begin before the first settles.
 */
interface ForegroundSendState {
  readonly counts: ReadonlyMap<SessionId, number>
  readonly begin: (id: SessionId) => void
  readonly end: (id: SessionId) => void
}

export const useForegroundSendStore = create<ForegroundSendState>((set) => ({
  counts: new Map(),
  begin: (id) =>
    set((state) => ({ counts: new Map(state.counts).set(id, (state.counts.get(id) ?? 0) + 1) })),
  end: (id) =>
    set((state) => {
      const count = state.counts.get(id)
      if (count === undefined) return state
      const counts = new Map(state.counts)
      if (count <= 1) counts.delete(id)
      else counts.set(id, count - 1)
      return { counts }
    }),
}))

/** Runs `send` with the Session marked as starting a Run until the send settles. */
export async function withForegroundSend<T>(id: SessionId, send: () => Promise<T>): Promise<T> {
  useForegroundSendStore.getState().begin(id)
  try {
    return await send()
  } finally {
    useForegroundSendStore.getState().end(id)
  }
}

export function resetForegroundSendsForTests() {
  useForegroundSendStore.setState({ counts: new Map() })
}
