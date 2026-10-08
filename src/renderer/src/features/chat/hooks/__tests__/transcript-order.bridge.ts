import type { AgentTransportEvent } from '@shared/types/stream'
import { settlingRunId } from '../../lib/run-ids'
import type { HostModel } from './transcript-order.host-model'
import type { RunCompletedPayload } from './transcript-order.ipc-mock'
import { MODEL } from './transcript-order.persisted'

/*
 * The renderer bridge in the main process (`session-host-renderer-bridge.ts`): the Run it last
 * relayed for the Session (its stream buffer replica's), and the one whose hand-off to a queued
 * Follow-up it relayed. A resync compares them with the Host's active Run and relays the
 * settlement the renderer missed, naming the Run, before it announces the Run the Host went on to.
 */
export function createBridgeModel() {
  let relayed: string | null = null
  let handedOff: string | null = null
  return {
    /** An `agent_start` the bridge relayed; it keeps Runs by their durable id (`settlingRunId`). */
    started(runId: string) {
      relayed = settlingRunId(runId)
    },
    /** A settlement the bridge relayed; an earlier Run's, late, leaves the buffer to the next. */
    settled(payload: Omit<RunCompletedPayload, 'sessionId'>) {
      if (payload.continues) {
        handedOff = payload.runId ?? null
        return
      }
      const named = payload.runId
      if (named !== undefined && relayed !== null && named !== relayed) return
      relayed = null
      handedOff = null
    },
    /** What a resync relays, given the Run the Host runs now (`null`: none). */
    resync(hostRunId: string | null) {
      const active = hostRunId === null ? null : settlingRunId(hostRunId)
      const missed = relayed !== null && relayed !== active
      const settlement = missed
        ? missedSettlement(relayed === handedOff ? null : relayed, active)
        : null
      const start = active !== null && active !== relayed ? hostRunId : null
      relayed = active
      handedOff = null
      return { settlement, start }
    },
    /** A resync's relays: the missed settlement, then the start of the Run the Host runs now. */
    async relayResync(
      host: HostModel,
      notifySettled: (payload: Omit<RunCompletedPayload, 'sessionId'>) => Promise<void>,
      deliver: (event: AgentTransportEvent) => void,
    ) {
      const { settlement, start } = this.resync(host.activeRunId())
      if (settlement) await notifySettled(settlement)
      const buffer = host.buffer()
      if (start === null || !buffer) return
      deliver({ type: 'agent_start', runId: start, model: MODEL, timestamp: buffer.startedAt })
    },
  }
}

/** The settlement a resync relays: naming the Run unless relayed before, `continues` if running. */
function missedSettlement(runId: string | null, active: string | null) {
  if (active === null) return runId === null ? {} : { runId }
  return runId === null ? null : { runId, continues: true as const }
}
