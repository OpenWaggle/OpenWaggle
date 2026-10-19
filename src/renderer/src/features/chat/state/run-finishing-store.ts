import { TIME_UNIT } from '@shared/constants/time'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { create } from 'zustand'

/**
 * How long the agent may keep working after its terminal `agent_end` before Stop is offered.
 * Pi's post-loop work usually settles within milliseconds, and a Stop that flashes up at the end of
 * every Run would invite a click on nothing; a slow `agent_before_settle` gate takes far longer.
 */
export const FINISHING_STOP_OFFER_DELAY_MS = TIME_UNIT.MILLISECONDS_PER_SECOND

/**
 * Sessions whose agent has ended its Run while the Host still owns it.
 *
 * Pi's terminal `agent_end` arrives before the Run settles. Pi itself may still be working: it runs
 * `agent_before_settle` handlers, which can run a lint or test gate for minutes, and only then
 * reports `agent_settled`. After that the Host saves the turn, captures its checkpoint and releases
 * resources, and only then reports `run-completed`. Showing that gap as idle invited a message the
 * Host could only queue. A Session is finishing from its terminal `agent_end` until the Run
 * settles, or until another Run starts in it.
 *
 * Stop: while Pi has not settled the agent's work, the Session is `stoppable` once that has taken
 * longer than `FINISHING_STOP_OFFER_DELAY_MS`, since Pi aborts the handlers' `ctx.signal` on Stop.
 * Once Pi settled, nothing is left that Stop could stop.
 */
interface RunFinishingState {
  readonly ids: ReadonlySet<SessionId>
  /** Finishing Sessions whose agent is still working past the delay: Stop is offered. */
  readonly stoppableIds: ReadonlySet<SessionId>
  readonly mark: (id: SessionId) => void
  /** Pi settled the agent's work, or the user already pressed Stop: no Stop any more. */
  readonly endStopOffer: (id: SessionId) => void
  readonly clear: (id: SessionId) => void
}

/** Finishing Sessions whose agent has not settled yet, each with the timer that offers Stop. */
const stopOfferTimers = new Map<SessionId, ReturnType<typeof setTimeout>>()

function cancelStopOffer(id: SessionId) {
  const timer = stopOfferTimers.get(id)
  if (timer === undefined) return
  clearTimeout(timer)
  stopOfferTimers.delete(id)
}

function without(ids: ReadonlySet<SessionId>, id: SessionId) {
  if (!ids.has(id)) return ids
  const next = new Set(ids)
  next.delete(id)
  return next
}

export const useRunFinishingStore = create<RunFinishingState>((set, get) => ({
  ids: new Set(),
  stoppableIds: new Set(),
  mark: (id) => {
    if (get().ids.has(id)) return
    set((state) => ({ ids: new Set([...state.ids, id]) }))
    cancelStopOffer(id)
    stopOfferTimers.set(
      id,
      setTimeout(() => {
        stopOfferTimers.delete(id)
        set((state) =>
          state.ids.has(id) ? { stoppableIds: new Set([...state.stoppableIds, id]) } : state,
        )
      }, FINISHING_STOP_OFFER_DELAY_MS),
    )
  },
  endStopOffer: (id) => {
    cancelStopOffer(id)
    set((state) => {
      const stoppableIds = without(state.stoppableIds, id)
      return stoppableIds === state.stoppableIds ? state : { stoppableIds }
    })
  },
  clear: (id) => {
    cancelStopOffer(id)
    set((state) => {
      const ids = without(state.ids, id)
      const stoppableIds = without(state.stoppableIds, id)
      return ids === state.ids && stoppableIds === state.stoppableIds
        ? state
        : { ids, stoppableIds }
    })
  },
}))

/**
 * Whether an event ends the agent's work in a Run, as opposed to a turn or a retried attempt. A
 * stopped or exhausted retry wait (`auto_retry_end` without success) ends it with no further
 * `agent_end`, and the Host still settles the Run after it.
 */
function endsAgentRun(event: AgentTransportEvent) {
  if (event.type === 'auto_retry_end') return !event.success
  return event.type === 'agent_end' && event.reason !== 'toolUse' && event.willRetry !== true
}

export function trackRunFinishing(sessionId: SessionId, event: AgentTransportEvent) {
  const store = useRunFinishingStore.getState()
  if (event.type === 'agent_start') {
    store.clear(sessionId)
    return
  }
  if (event.type === 'agent_settled') {
    store.endStopOffer(sessionId)
    return
  }
  if (endsAgentRun(event)) store.mark(sessionId)
}

/** Whether the Session's agent has ended its Run while the Host still settles it. */
export function useIsRunFinishing(sessionId: SessionId | null) {
  return useRunFinishingStore((state) => (sessionId ? state.ids.has(sessionId) : false))
}

/** Whether the Session is finishing while its agent still works on, so Stop is offered. */
export function useIsFinishingRunStoppable(sessionId: SessionId | null) {
  return useRunFinishingStore((state) => (sessionId ? state.stoppableIds.has(sessionId) : false))
}
