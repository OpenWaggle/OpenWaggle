import type { MessageScheduledTaskOrigin } from '@shared/types/agent'
import type { UIMessage } from '@shared/types/chat-ui'
import { CalendarClock, HeartPulse } from 'lucide-react'
import type { ReactNode } from 'react'

function timeLabel(createdAt: Date) {
  return createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * The muted line above a user message a Scheduled task run delivered, so it never reads as the
 * user's own (CONTEXT.md: Scheduled task run). The Host recorded the origin with the message.
 */
function ScheduledMessageProvenance({
  origin,
  createdAt,
}: {
  readonly origin: MessageScheduledTaskOrigin
  readonly createdAt: Date | undefined
}) {
  const Icon = origin.kind === 'heartbeat' ? HeartPulse : CalendarClock
  const valid = createdAt !== undefined && Number.isFinite(createdAt.getTime())
  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-1 text-xs text-text-tertiary"
      data-scheduled-task-provenance={origin.kind ?? 'unknown'}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">Scheduled · {origin.name}</span>
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

/** A user message row, with its Scheduled task provenance above it when a task delivered it. */
export function ScheduledMessageFrame({
  message,
  children,
}: {
  readonly message: UIMessage
  readonly children: ReactNode
}) {
  const origin = message.metadata?.scheduledTask
  if (!origin) return children
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <ScheduledMessageProvenance origin={origin} createdAt={message.createdAt} />
      {children}
    </div>
  )
}
