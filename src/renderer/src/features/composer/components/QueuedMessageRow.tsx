import { AlertTriangle, ArrowUp, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { QUEUED_MESSAGE_DRAG_TYPE, QueuedMessageReorderHandle } from './QueuedMessageReorderHandle'
import { QueueIntentBadges } from './QueueIntentBadges'

const ATTENTION_REASON_COPY = {
  authorization_ceiling_changed:
    "Authorization changed. Update this Follow-up's authorization or dismiss it.",
  profile_revoked:
    'The submitting access profile was revoked. Restore access or dismiss this Follow-up.',
  authority_changed:
    'Session authority changed. Re-submit with current access or dismiss this Follow-up.',
} as const

function attentionCopy(item: SessionFollowUpQueueItem) {
  if (item.deliveryState !== 'needs_attention') return undefined
  return item.attentionReason
    ? ATTENTION_REASON_COPY[item.attentionReason]
    : 'This Follow-up cannot be delivered. Review Session access or dismiss it.'
}

export interface QueuedMessageRowActions {
  readonly onDismiss: (followUpId: string) => void
  readonly onResolve: (item: SessionFollowUpQueueItem) => void
  readonly onSteer: (followUpId: string) => void
  readonly onEdit: (followUpId: string) => void
  readonly onMove: (followUpId: string, targetIndex: number) => void
}

interface QueuedMessageRowProps {
  readonly item: SessionFollowUpQueueItem
  /** Where the row sits among the rows the dock shows, and how many there are. */
  readonly place: { readonly index: number; readonly count: number }
  readonly isStreaming: boolean
  readonly isResolving: boolean
  /** False while another edit is open or starting in this Session. */
  readonly canBeginEdit: boolean
  readonly actions: QueuedMessageRowActions
}

const ACCESSIBLE_LABEL_LENGTH = 60

function itemLabel(item: SessionFollowUpQueueItem) {
  return item.text || `${String(item.attachmentCount)} attachment(s)`
}

/** A short name for the row's controls; the full message is already on screen. */
function accessibleLabel(label: string) {
  const line = label.split('\n')[0]?.trim() ?? ''
  return line.length > ACCESSIBLE_LABEL_LENGTH ? `${line.slice(0, ACCESSIBLE_LABEL_LENGTH)}…` : line
}

function BeingEditedMarker() {
  return (
    <span className="flex items-center gap-1 text-xs text-info-text">
      <Pencil aria-hidden="true" className="size-3" />
      Being edited
    </span>
  )
}

/**
 * One queued message. The whole row is a drop target; only its grip starts a drag. Drag feedback
 * lives on the DOM node, not in state, because re-rendering mid-gesture cancels the drag.
 */
export function QueuedMessageRow({
  item,
  place,
  isStreaming,
  isResolving,
  canBeginEdit,
  actions,
}: QueuedMessageRowProps) {
  const attention = attentionCopy(item)
  const held = item.editHold !== undefined
  const reorderable = place.count > 1
  const label = itemLabel(item)
  const shortLabel = accessibleLabel(label)

  return (
    <li
      data-qa="queued-message-row"
      data-follow-up-id={item.id}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(QUEUED_MESSAGE_DRAG_TYPE)) return
        event.preventDefault()
        event.currentTarget.dataset.dropTarget = 'true'
      }}
      onDragLeave={(event) => event.currentTarget.removeAttribute('data-drop-target')}
      onDrop={(event) => {
        event.currentTarget.removeAttribute('data-drop-target')
        const draggedId = event.dataTransfer.getData(QUEUED_MESSAGE_DRAG_TYPE)
        if (!draggedId) return
        event.preventDefault()
        if (draggedId !== item.id) actions.onMove(draggedId, place.index)
      }}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2.5 py-2',
        'data-[drop-target=true]:shadow-[inset_0_2px_0_var(--color-accent)]',
        attention ? 'border border-warning/20 bg-warning/5' : 'bg-bg/50',
      )}
    >
      {reorderable ? (
        <QueuedMessageReorderHandle
          followUpId={item.id}
          label={shortLabel}
          onMoveUp={place.index > 0 ? () => actions.onMove(item.id, place.index - 1) : null}
          onMoveDown={
            place.index < place.count - 1 ? () => actions.onMove(item.id, place.index + 1) : null
          }
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="whitespace-pre-wrap text-xs leading-normal text-text-muted">{label}</div>
        <QueueIntentBadges item={item} />
        {held ? <BeingEditedMarker /> : null}
        {attention && (
          <div className="flex items-start gap-1 text-xs leading-normal text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{attention}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {attention ? (
          <Button
            variant="unstyled"
            type="button"
            onClick={() => {
              if (!isResolving) actions.onResolve(item)
            }}
            aria-disabled={isResolving}
            className="flex items-center gap-1 rounded-md border border-warning/30 bg-warning/8 px-2 py-1 text-warning hover:bg-warning/15 aria-disabled:opacity-50"
          >
            <RotateCcw className="size-3" />
            <span className="text-xs font-semibold">
              {item.attentionReason === 'authorization_ceiling_changed'
                ? 'Use current access'
                : 'Re-submit'}
            </span>
          </Button>
        ) : null}
        {/* The Host refuses to promote a message while it is being edited. */}
        {isStreaming && !held && (
          <Button
            variant="unstyled"
            type="button"
            onClick={() => actions.onSteer(item.id)}
            disabled={item.deliveryState === 'needs_attention'}
            title={attention ? 'Resolve this Follow-up before steering it.' : undefined}
            className="flex items-center gap-1 rounded-md bg-accent/8 px-2 py-1"
          >
            <ArrowUp className="size-3 text-accent" />
            <span className="text-xs font-semibold text-accent">Steer</span>
          </Button>
        )}
        {item.editable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            radius="md"
            type="button"
            onClick={() => actions.onEdit(item.id)}
            disabled={!canBeginEdit || held}
            aria-label={`Edit queued message: ${shortLabel}`}
            title={held ? 'This message is being edited' : 'Edit'}
            className="justify-center"
          >
            <Pencil className="size-3" />
          </Button>
        ) : null}
        <Button
          variant="unstyled"
          type="button"
          onClick={() => actions.onDismiss(item.id)}
          className="rounded-md px-1.5 py-1"
          title="Dismiss"
        >
          <Trash2 className="size-3 text-text-muted hover:text-text-primary" />
        </Button>
      </div>
    </li>
  )
}
