import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { create } from 'zustand'

/**
 * Sessions whose agent has ended its Run while the Host still owns it.
 *
 * Pi's terminal `agent_end` arrives before the Host settles the Run: it still saves the turn,
 * captures its checkpoint and releases resources, and only then reports `run-completed`. Showing
 * that gap as idle invited a message the Host could only queue; showing it as running offered a
 * Stop with nothing left to stop. A Session is finishing from its terminal `agent_end` until the
 * Run settles, or until another Run starts in it.
 */
interface RunFinishingState {
  readonly ids: ReadonlySet<SessionId>
  readonly mark: (id: SessionId) => void
  readonly clear: (id: SessionId) => void
}

export const useRunFinishingStore = create<RunFinishingState>((set) => ({
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

/** Whether an event ends the agent's work in a Run, as opposed to a turn or a retried attempt. */
function endsAgentRun(event: AgentTransportEvent) {
  return event.type === 'agent_end' && event.reason !== 'toolUse' && event.willRetry !== true
}

export function trackRunFinishing(sessionId: SessionId, event: AgentTransportEvent) {
  const store = useRunFinishingStore.getState()
  if (event.type === 'agent_start') {
    store.clear(sessionId)
    return
  }
  if (endsAgentRun(event)) store.mark(sessionId)
}

/** Whether the Session's agent has ended its Run while the Host still settles it. */
export function useIsRunFinishing(sessionId: SessionId | null) {
  return useRunFinishingStore((state) => (sessionId ? state.ids.has(sessionId) : false))
}
