import type { ConversationId } from '@shared/types/brand'
import { ArrowUp, Timer, Trash2 } from 'lucide-react'
import { selectQueue, useMessageQueueStore } from '@/stores/message-queue-store'

interface QueuedMessagesProps {
  readonly conversationId: ConversationId | null
  readonly onSteer: (messageId: string) => Promise<void>
  readonly isStreaming: boolean
}

/**
 * Queued messages panel that docks above the Composer.
 *
 * Width ratio: 620/680 = 91.18% of the parent container, centered.
 * The Composer fills 100% of the same parent, so the queue appears as a
 * narrower "tab" sitting flush on top of the wider composer.
 */
export function QueuedMessages({
  conversationId,
  onSteer,
  isStreaming,
}: QueuedMessagesProps): React.JSX.Element | null {
  const queue = useMessageQueueStore(selectQueue(conversationId))
  const dismiss = useMessageQueueStore((s) => s.dismiss)

  if (queue.length === 0 || !conversationId) return null

  return (
    <div className="mx-auto flex w-[91.18%] flex-col gap-1.5 rounded-t-[10px] border-x border-t border-border-light bg-bg-secondary p-[8px_10px_6px_10px] opacity-60">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-1">
        <Timer className="h-3 w-3 text-text-tertiary" />
        <span className="text-[11px] font-semibold text-text-tertiary">Queued</span>
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
              {isStreaming && (
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
