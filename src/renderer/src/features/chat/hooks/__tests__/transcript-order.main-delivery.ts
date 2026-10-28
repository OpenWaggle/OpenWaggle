import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { AgentEventDelivery } from '../../../../../../main/utils/agent-event-delivery'

/*
 * The GUI main process between the Host and the window (`utils/agent-event-delivery.ts`,
 * `ipc/agent-handler.ts`), for scenarios that need it: streamed deltas coalesce there and reach the
 * window only when their flush timer fires, another event of the Session follows, or the window
 * reads the Session's stream buffer. That read answers after the events it sent, on one ordered
 * pipe, so the model sends them on a task of their own before the answer resolves.
 *
 * It runs the real delivery with its timers in the harness's hands: `flushTimers` is the 33 ms (or
 * 250 ms) beat going by.
 */

const WINDOW_ID = 1

export type MainDeliveryModel = ReturnType<typeof createMainDeliveryModel>

export function createMainDeliveryModel(
  sessionId: SessionId,
  receive: (event: AgentTransportEvent) => void,
) {
  const timers = new Set<() => void>()
  const delivery = new AgentEventDelivery((flush) => {
    const fire = () => {
      timers.delete(fire)
      flush()
    }
    timers.add(fire)
    return () => timers.delete(fire)
  })
  // Sends a read flushes travel ahead of its answer, each on its own task.
  let queued: AgentTransportEvent[] | null = null
  const window = {
    id: WINDOW_ID,
    send: (payload: { readonly event: AgentTransportEvent }) => {
      if (queued) queued.push(payload.event)
      else receive(payload.event)
    },
  }
  return {
    publish: (event: AgentTransportEvent) => delivery.deliver([window], sessionId, event),
    /** The flush timers fire: every delta still coalescing reaches the window. */
    flushTimers() {
      for (const fire of [...timers]) fire()
    },
    holdsDeltas: () => timers.size > 0,
    /** `agent:get-background-run`: the main process's read, then its answer reaching the window. */
    async readBuffer(read: () => BackgroundRunSnapshot | null) {
      queued = []
      const snapshot = delivery.readFlushed([window], sessionId, read)
      const sent = queued
      queued = null
      for (const event of sent) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        receive(event)
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      return snapshot
    },
  }
}
