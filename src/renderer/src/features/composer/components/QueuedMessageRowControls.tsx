import { ArrowUp, Pencil, Send, Trash2 } from 'lucide-react'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { Button } from '@/shared/ui/Button'
import type { QueuedMessageRowActions, QueuedMessageRowEditState } from './queued-message-row-types'

interface QueuedMessageRowControlsProps {
  readonly item: SessionFollowUpQueueItem
  readonly label: string
  readonly isStreaming: boolean
  readonly isAdopting: boolean
  readonly edit: QueuedMessageRowEditState
  readonly actions: QueuedMessageRowActions
}

/**
 * A queued row's actions. Unavailable actions stay focusable (`aria-disabled`) so keyboard focus
 * is not dropped when a row changes state under it.
 */
export function QueuedMessageRowControls({
  item,
  label,
  isStreaming,
  isAdopting,
  edit,
  actions,
}: QueuedMessageRowControlsProps) {
  const held = item.editHold !== undefined
  const attention = item.deliveryState === 'needs_attention'
  const editUnavailable = !edit.canBegin || held
  // Withdrawing while the Host is opening, saving, or cancelling this edit would race it.
  const dismissUnavailable = edit.phase !== null && edit.phase !== 'editing'

  return (
    <div className="flex items-center gap-1">
      {/* The Host refuses to promote a message while it is being edited. */}
      {isStreaming && !held ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => actions.onSteer(item.id)}
          disabled={attention}
          title={attention ? 'Send this message as you before steering it.' : undefined}
          className="flex items-center gap-1 rounded-md bg-accent/8 px-2 py-1"
        >
          <ArrowUp className="size-3 text-accent" />
          <span className="text-xs font-semibold text-accent">Steer</span>
        </Button>
      ) : null}
      {attention ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => {
            if (!isAdopting) actions.onAdopt(item.id)
          }}
          aria-disabled={isAdopting}
          aria-label={`Send as me: ${label}`}
          title="Deliver this message under your own access. It keeps showing who queued it."
          className="flex items-center gap-1 rounded-md bg-accent/8 px-2 py-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <Send className="size-3 text-accent" />
          <span className="text-xs font-semibold text-accent">Send as me</span>
        </Button>
      ) : null}
      {item.editable ? (
        <Button
          variant="ghost"
          size="icon-xs"
          radius="md"
          type="button"
          // Still clickable when unavailable, so the user hears why (begin explains it).
          onClick={() => actions.onEdit(item.id)}
          aria-disabled={editUnavailable}
          aria-label={`Edit queued message: ${label}`}
          title={held ? 'This message is being edited' : 'Edit'}
          className="justify-center aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <Pencil className="size-3" />
        </Button>
      ) : null}
      <Button
        variant="unstyled"
        type="button"
        onClick={() => {
          if (!dismissUnavailable) actions.onDismiss(item.id)
        }}
        aria-disabled={dismissUnavailable}
        className="rounded-md px-1.5 py-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        title="Dismiss"
      >
        <Trash2 className="size-3 text-text-muted hover:text-text-primary" />
      </Button>
    </div>
  )
}
