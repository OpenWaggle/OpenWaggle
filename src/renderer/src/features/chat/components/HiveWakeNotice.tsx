import type { UIMessage } from '@shared/types/chat-ui'
import { Pickaxe } from 'lucide-react'

function timeLabel(createdAt: Date) {
  return createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * The row that opens a Hive wake Run: the Host started it on this idle Session because its Workers
 * reported (a result or a request for help). It stands where a user message would, so the reply
 * folds as its own turn, and it reads as the Host's, never as something the user wrote.
 */
export function HiveWakeNotice({ message }: { readonly message: UIMessage }) {
  const createdAt = message.createdAt
  const valid = createdAt !== undefined && Number.isFinite(createdAt.getTime())
  return (
    <div
      className="flex w-full min-w-0 items-center justify-end gap-1 text-xs text-text-tertiary"
      data-hive-wake-notice="true"
    >
      <Pickaxe aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">Hive · Worker updates arrived</span>
      {valid ? (
        <time
          className="shrink-0 text-text-muted"
          dateTime={createdAt.toISOString()}
          title={createdAt.toLocaleString()}
        >
          {timeLabel(createdAt)}
        </time>
      ) : null}
    </div>
  )
}
