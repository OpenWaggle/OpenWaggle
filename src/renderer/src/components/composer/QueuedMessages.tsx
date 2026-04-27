import type { ConversationId } from '@shared/types/brand'
import { ArrowUp, Timer, Trash2 } from 'lucide-react'
import { selectQueue, useMessageQueueStore } from '@/stores/message-queue-store'

interface QueuedMessagesProps {
  readonly conversationId: ConversationId | null
  readonly onSteer: (messageId: string) => Promise<void>
  readonly isStreaming: boolean
  readonly isCompacting?: boolean
}

/**
 * Queued messages panel that docks above the Composer.
 *
 * The Composer fills 100% of the parent container. The queue stays inset just
 * inside the composer's rounded shoulders so it reads like a docked tab rather
 * than a separate full-width panel.
 */
export function QueuedMessages({
  conversationId,
  onSteer,
  isStreaming,
  isCompacting = false,
}: QueuedMessagesProps) {
  const queue = useMessageQueueStore(selectQueue(conversationId))
  const dismiss = useMessageQueueStore((s) => s.dismiss)

  if (queue.length === 0 || !conversationId) return null

  return (
    <div className="mx-auto flex w-[calc(100%-28px)] flex-col gap-1.5 rounded-t-[var(--radius-panel)] border-x border-t border-border-light bg-bg-secondary p-[8px_10px_6px_10px] opacity-60">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-1">
        <Timer className="h-3 w-3 text-text-tertiary" />
        <span className="text-[11px] font-semibold text-text-tertiary">
          {isCompacting ? 'Queued until compaction finishes' : 'Queued'}
        </span>
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-text-tertiary/12 text-[10px] font-semibold text-text-tertiary">
          {queue.length}
        </span>
      </div>

      {/* Message list */}
      <div className="flex flex-col gap-1">
        {queue.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-lg bg-bg/50 p-[8px_10px]">
            <div className="flex-1 text-[12px] leading-[1.5] text-text-muted whitespace-pre-wrap">
              {item.payload.text || `${String(item.payload.attachments.length)} attachment(s)`}
            </div>
            <div className="flex items-center gap-1">
              {isStreaming && !isCompacting && (
                <button
                  type="button"
                  onClick={() => void onSteer(item.id)}
                  className="flex items-center gap-1 rounded-[5px] bg-accent/8 px-2 py-1"
                >
                  <ArrowUp className="h-[11px] w-[11px] text-accent" />
                  <span className="text-[10px] font-semibold text-accent">Steer</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(conversationId, item.id)}
                className="rounded-[5px] p-[4px_5px]"
                title="Dismiss"
              >
                <Trash2 className="h-[11px] w-[11px] text-text-muted hover:text-text-primary" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
