import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { HostModel } from './transcript-order.host-model'
import { entryKey } from './transcript-order.persisted'

/*
 * What the renderer must show: every message it has been told about. A message streamed while the
 * renderer tracked the Run (a render snapshot held it); a user message of the active Run (its
 * reconnect buffer retains them) or of the detail the chat shows; and any other message of that
 * detail once the renderer learned its Run settled (a Run the chat follows keeps its live
 * transcript until then, as through a Follow-up chain). A message lost in a stall can be missing
 * until then, and a settled Run the chat never showed until the chat store refetches; a message it
 * showed must never disappear.
 */
export function createTranscriptKnowledge(host: HostModel) {
  const received = new Set<string>()
  const receivedUnseen = new Set<string>()
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
    /**
     * An event the renderer received; `tracked` when a render snapshot was there to hold it, and
     * `shown` when the chat showed the Session. An unseen Session's snapshot holds only its active
     * Run: a settled one is the detail's to show, once the chat store refetches it.
     */
    noteDelivered(event: AgentTransportEvent, tracked: boolean, shown: boolean) {
      if (event.type !== 'message_start' || !tracked) return
      ;(shown ? received : receivedUnseen).add(event.messageId)
    },
    /** The message ids the chat shows: a message it showed, live or saved, must stay shown. */
    noteShown(messageIds: readonly string[]) {
      const shown = new Set(messageIds)
      for (const entry of host.entries()) {
        if (shown.has(entry.liveId) || shown.has(entry.piId)) received.add(entry.liveId)
      }
    },
    /** A renderer reload forgets what it received. */
    forget() {
      received.clear()
      receivedUnseen.clear()
    },
    /** The messages the chat must show now, in log order. */
    /**
     * `stalled`: the active Run's user messages since the stall cannot be known yet; nor can they
     * when its buffer retains none.
     */
    requiredKeys(detail: SessionDetail | null, stalled = false) {
      const shownNodeIds = new Set(detail?.messages.map((message) => String(message.id)) ?? [])
      return host
        .entries()
        .filter(
          (entry) =>
            received.has(entry.liveId) ||
            (receivedUnseen.has(entry.liveId) && entry.runId === host.activeRunId()) ||
            (entry.role === 'user' &&
              ((!stalled && host.retainsUsers() && entry.runId === host.activeRunId()) ||
                shownNodeIds.has(entry.piId))) ||
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
