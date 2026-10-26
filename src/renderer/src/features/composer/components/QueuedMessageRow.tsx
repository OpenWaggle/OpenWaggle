import { AlertTriangle, Paperclip, Pencil } from 'lucide-react'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { cn } from '@/shared/lib/cn'
import { QueuedMessageReorderHandle } from './QueuedMessageReorderHandle'
import { QueuedMessageRowControls } from './QueuedMessageRowControls'
import { QueueIntentBadges } from './QueueIntentBadges'
import type { QueuedMessageRowActions, QueuedMessageRowEditState } from './queued-message-row-types'

const ATTENTION_REASON_COPY = {
  profile_revoked: 'The access profile that queued this message was revoked.',
  authority_changed: 'The access that queued this message no longer covers this Session.',
} as const

const UNKNOWN_ATTENTION_COPY = 'This message cannot be delivered under the access that queued it.'

/*
 * "Send as me" resumes a queue that paused for the message and delivers it under the user's
 * access, so on the first message of an idle Session it sends now; otherwise it sends in turn.
 */
const SEND_AS_ME_COPY = {
  now: 'Send it as you to send it now, or dismiss it.',
  inTurn: 'Send it as you to send it in its turn, or dismiss it.',
} as const

function attentionCopy(item: SessionFollowUpQueueItem, sendsNow: boolean) {
  if (item.deliveryState !== 'needs_attention') return undefined
  const reason = item.attentionReason
    ? ATTENTION_REASON_COPY[item.attentionReason]
    : UNKNOWN_ATTENTION_COPY
  return `${reason} ${sendsNow ? SEND_AS_ME_COPY.now : SEND_AS_ME_COPY.inTurn}`
}

const ACCESSIBLE_LABEL_LENGTH = 60

function attachmentsLabel(count: number) {
  return count === 1 ? '1 attachment' : `${String(count)} attachments`
}

function itemLabel(item: SessionFollowUpQueueItem) {
  return item.text || attachmentsLabel(item.attachmentCount)
}

/*
 * Drag feedback, driven by attributes `queued-message-drag.ts` sets on the row. The source row
 * stays in place dimmed, with a dashed outline, as a placeholder. The drop line sits in the gap on
 * the side where the message will land (gap-1 between rows, so 3px out centres the 2px line),
 * which puts it above the first row or below the last at the ends. Outlines and pseudo-elements
 * never shift layout; forced colors repaint backgrounds, so the line uses `Highlight` there.
 */
const DRAG_FEEDBACK_CLASS = [
  'data-[drag-source=true]:opacity-40 data-[drag-source=true]:outline-1 data-[drag-source=true]:outline-dashed data-[drag-source=true]:-outline-offset-1 data-[drag-source=true]:outline-text-tertiary',
  'data-[drop-target]:before:pointer-events-none data-[drop-target]:before:absolute data-[drop-target]:before:inset-x-1 data-[drop-target]:before:h-0.5 data-[drop-target]:before:rounded-full data-[drop-target]:before:bg-accent forced-colors:data-[drop-target]:before:bg-[Highlight]',
  'data-[drop-target=before]:before:-top-0.75 data-[drop-target=after]:before:-bottom-0.75',
].join(' ')

function AttachmentsIndicator({ count }: { readonly count: number }) {
  return (
    <span className="flex items-center gap-1 text-xs text-text-tertiary">
      <Paperclip aria-hidden="true" className="size-3 shrink-0" />
      {attachmentsLabel(count)}
    </span>
  )
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
  /**
   * "Send as me": `inFlight` while it runs for this row; `headSendsNow` when the queue would
   * deliver its first message at once once that message no longer needs attention.
   */
  readonly sendAsMe: { readonly inFlight: boolean; readonly headSendsNow: boolean }
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

/**
 * One queued message. Only its grip starts a drag, which leaves the row's buttons and text
 * selection alone; the list handles the drop. Drag feedback lives on the DOM node, not in state,
 * because re-rendering mid-gesture cancels the drag.
 */
export function QueuedMessageRow({
  item,
  neighbours,
  reorderable,
  isStreaming,
  sendAsMe,
  edit,
  actions,
}: QueuedMessageRowProps) {
  const { previousId, nextId } = neighbours
  const sendsNow = previousId === null && sendAsMe.headSendsNow
  const attention = attentionCopy(item, sendsNow)
  const label = itemLabel(item)
  const shortLabel = accessibleLabel(label)

  return (
    <li
      data-qa="queued-message-row"
      data-follow-up-id={item.id}
      className={cn(
        'relative flex items-center gap-2 rounded-lg px-2.5 py-2',
        DRAG_FEEDBACK_CLASS,
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
          onDragStart={(event) => actions.onDragStart(item.id, event)}
          onDragEnd={actions.onDragEnd}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          data-qa="queued-message-text"
          className="whitespace-pre-wrap text-xs leading-normal text-text-muted"
        >
          {label}
        </div>
        {item.text && item.attachmentCount > 0 ? (
          <AttachmentsIndicator count={item.attachmentCount} />
        ) : null}
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
        isAdopting={sendAsMe.inFlight}
        sendsNow={sendsNow}
        edit={edit}
        actions={actions}
      />
    </li>
  )
}
