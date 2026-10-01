import { AlertTriangle, Pencil } from 'lucide-react'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { cn } from '@/shared/lib/cn'
import { QueuedMessageReorderHandle } from './QueuedMessageReorderHandle'
import { QueuedMessageRowControls } from './QueuedMessageRowControls'
import { QueueIntentBadges } from './QueueIntentBadges'
import type { QueuedMessageRowActions, QueuedMessageRowEditState } from './queued-message-row-types'

const ATTENTION_REASON_COPY = {
  authorization_ceiling_changed:
    "Authorization changed. Update this Follow-up's authorization or dismiss it.",
  profile_revoked:
    'The submitting access profile was revoked. Restore access or dismiss this Follow-up.',
  authority_changed:
    'Session authority changed. Re-submit with current access or dismiss this Follow-up.',
} as const

const ACCESSIBLE_LABEL_LENGTH = 60

function attentionCopy(item: SessionFollowUpQueueItem) {
  if (item.deliveryState !== 'needs_attention') return undefined
  return item.attentionReason
    ? ATTENTION_REASON_COPY[item.attentionReason]
    : 'This Follow-up cannot be delivered. Review Session access or dismiss it.'
}

function itemLabel(item: SessionFollowUpQueueItem) {
  return item.text || `${String(item.attachmentCount)} attachment(s)`
}

/** A short name for the row's controls; the full message is already on screen. */
function accessibleLabel(label: string) {
  const line = label.split('\n')[0]?.trim() ?? ''
  return line.length > ACCESSIBLE_LABEL_LENGTH ? `${line.slice(0, ACCESSIBLE_LABEL_LENGTH)}…` : line
}

interface QueuedMessageRowProps {
  readonly item: SessionFollowUpQueueItem
  /** The row's visible neighbours, which Move up / Move down place it next to. */
  readonly neighbours: { readonly previousId: string | null; readonly nextId: string | null }
  readonly reorderable: boolean
  readonly isStreaming: boolean
  readonly isResolving: boolean
  readonly edit: QueuedMessageRowEditState
  readonly actions: QueuedMessageRowActions
}

function BeingEditedMarker() {
  return (
    <span className="flex items-center gap-1 text-xs text-info-text">
      <Pencil aria-hidden="true" className="size-3" />
      Being edited
    </span>
  )
}

function clearDropTarget(element: HTMLElement) {
  element.removeAttribute('data-drop-target')
}

/**
 * One queued message. The whole row is a drop target; only its grip starts a drag. The drop line
 * sits on the side where the message will land. Drag feedback lives on the DOM node, not in state,
 * because re-rendering mid-gesture cancels the drag.
 */
export function QueuedMessageRow({
  item,
  neighbours,
  reorderable,
  isStreaming,
  isResolving,
  edit,
  actions,
}: QueuedMessageRowProps) {
  const attention = attentionCopy(item)
  const label = itemLabel(item)
  const shortLabel = accessibleLabel(label)
  const { previousId, nextId } = neighbours

  return (
    <li
      data-qa="queued-message-row"
      data-follow-up-id={item.id}
      onDragOver={(event) => {
        const anchor = actions.dropAnchor(item.id)
        if (!anchor) return
        event.preventDefault()
        event.currentTarget.dataset.dropTarget = anchor.position
      }}
      onDragLeave={(event) => clearDropTarget(event.currentTarget)}
      onDrop={(event) => {
        clearDropTarget(event.currentTarget)
        if (!actions.dropAnchor(item.id)) return
        event.preventDefault()
        actions.onDropOn(item.id)
      }}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2.5 py-2',
        'data-[drop-target=before]:shadow-[inset_0_2px_0_var(--color-accent)]',
        'data-[drop-target=after]:shadow-[inset_0_-2px_0_var(--color-accent)]',
        attention ? 'border border-warning/20 bg-warning/5' : 'bg-bg/50',
      )}
    >
      {reorderable ? (
        <QueuedMessageReorderHandle
          followUpId={item.id}
          label={shortLabel}
          onMoveUp={
            previousId
              ? () => actions.onMove(item.id, { position: 'before', followUpId: previousId })
              : null
          }
          onMoveDown={
            nextId ? () => actions.onMove(item.id, { position: 'after', followUpId: nextId }) : null
          }
          onDragStart={() => actions.onDragStart(item.id)}
          onDragEnd={actions.onDragEnd}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="whitespace-pre-wrap text-xs leading-normal text-text-muted">{label}</div>
        <QueueIntentBadges item={item} />
        {item.editHold ? <BeingEditedMarker /> : null}
        {attention ? (
          <div className="flex items-start gap-1 text-xs leading-normal text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{attention}</span>
          </div>
        ) : null}
      </div>
      <QueuedMessageRowControls
        item={item}
        label={shortLabel}
        isStreaming={isStreaming}
        isResolving={isResolving}
        edit={edit}
        actions={actions}
      />
    </li>
  )
}
