import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { useSessionStore } from '@/features/sessions/state'
import { queuedMessageSourceLabel } from '../lib/queued-message-source'

/** The source the Host resolved, or the intent's caller from a Host that does not resolve one. */
function itemSource(item: SessionFollowUpQueueItem) {
  if (item.source) return item.source
  return item.callerId ? { callerId: item.callerId } : undefined
}

/**
 * What a queued message carries besides its text: a Waggle invocation (message content) and
 * where it came from. Thinking level and access are Session settings, not message state, and a
 * message the user sent from this composer has no source label.
 */
export function QueueIntentBadges({ item }: { readonly item: SessionFollowUpQueueItem }) {
  const source = itemSource(item)
  const sourceSessionId = source?.sessionId
  const sessionTitle = useSessionStore((state) =>
    sourceSessionId
      ? state.sessions.find((session) => String(session.id) === sourceSessionId)?.title
      : undefined,
  )
  const sourceLabel = queuedMessageSourceLabel(source, sessionTitle)
  if (!item.wagglePresetName && !sourceLabel) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {item.wagglePresetName ? (
        <span className="rounded bg-accent/8 px-1.5 py-0.5 text-xs text-accent">
          Waggle · {item.wagglePresetName}
        </span>
      ) : null}
      {sourceLabel ? (
        <span
          className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-tertiary"
          title={sourceLabel.detail}
        >
          {sourceLabel.label}
        </span>
      ) : null}
    </div>
  )
}
