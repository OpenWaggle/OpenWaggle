import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { HostModel } from './transcript-order.host-model'
import { entryKey } from './transcript-order.persisted'

/*
 * What the renderer must show: every message it has been told about. A message streamed while the
 * renderer tracked the Run (a render snapshot held it); a user message of the active Run (its
 * reconnect buffer retains them) or of the detail the chat shows; and an answer of that detail
 * once its Run settled. An answer lost in a stall can be missing until the Run ends, and a settled
 * Run the renderer never received until the chat store refetches; one it received must never
 * disappear.
 */
export function createTranscriptKnowledge(host: HostModel) {
  const received = new Set<string>()
  const settledRunIds = new Set<string>()
  return {
    /**
     * The renderer was told the Session settled: it reloads every persisted Run then. A Run's
     * compaction summary is only persisted, so the chat shows it from then on.
     */
    noteSettled() {
      for (const entry of host.entries())
        if (host.isPersisted(entry)) settledRunIds.add(entry.runId)
    },
    /** An event the renderer received; `tracked` when a render snapshot was there to hold it. */
    noteDelivered(event: AgentTransportEvent, tracked: boolean) {
      if (event.type === 'message_start' && tracked) received.add(event.messageId)
    },
    /** A renderer reload forgets what it received. */
    forget() {
      received.clear()
    },
    /** The messages the chat must show now, in log order. */
    /** `stalled`: the active Run's user messages since the stall cannot be known yet. */
    requiredKeys(detail: SessionDetail | null, stalled = false) {
      const shownNodeIds = new Set(detail?.messages.map((message) => String(message.id)) ?? [])
      return host
        .entries()
        .filter(
          (entry) =>
            received.has(entry.liveId) ||
            (entry.role === 'user' &&
              ((!stalled && entry.runId === host.activeRunId()) || shownNodeIds.has(entry.piId))) ||
            (shownNodeIds.has(entry.piId) && settledRunIds.has(entry.runId)),
        )
        .map(entryKey)
    },
  }
}

/** The required messages the shown transcript lacks. */
export function missingMessages(shown: readonly string[], required: readonly string[]) {
  const shownCounts = new Map<string, number>()
  for (const key of shown) shownCounts.set(key, (shownCounts.get(key) ?? 0) + 1)
  return required.flatMap((key) => {
    const count = shownCounts.get(key) ?? 0
    shownCounts.set(key, count - 1)
    return count > 0 ? [] : [`missing: ${key}`]
  })
}
