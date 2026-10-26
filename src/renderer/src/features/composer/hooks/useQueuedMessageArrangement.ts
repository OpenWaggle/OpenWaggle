import type { SessionId } from '@shared/types/brand'
import type { DragEvent } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import {
  clearDragFeedback,
  clearDropLine,
  markDragSource,
  QUEUED_MESSAGE_ROW_SELECTOR,
  queuedRowAt,
  setQueuedMessageDragImage,
  showDropLine,
} from '../lib/queued-message-drag'
import { dropAnchor, type QueuedMessageAnchor } from '../lib/queued-message-order'
import { useQueuedMessageReorder } from './useQueuedMessageReorder'

const ROW_SELECTOR = QUEUED_MESSAGE_ROW_SELECTOR
const GRIP_SELECTOR = '[data-qa="queued-message-grip"]'

interface PendingFocus {
  readonly followUpId: string
  /** Zero-based place among the rendered rows where the moved message must be before focusing. */
  readonly index: number
}

/**
 * Focus is still with the dock (its grip or menu) or was dropped to the page when the row was
 * relocated. Anywhere else, the user has moved on and keeps their focus.
 */
function focusStillInDock(list: HTMLElement | null) {
  const active = document.activeElement
  return active === null || active === document.body || (list?.contains(active) ?? false)
}

/**
 * Focuses the moved message's grip once the rendered order shows it at its new place. Focusing
 * earlier lands on the row React is about to relocate, which blurs it again (Move down).
 */
function focusWhenPlaced(list: HTMLElement | null, pending: PendingFocus) {
  const rows = [...(list?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])]
  const row = rows[pending.index]
  if (row?.dataset.followUpId !== pending.followUpId) return false
  row.querySelector<HTMLElement>(GRIP_SELECTOR)?.focus()
  return true
}

/** Whether the pointer left the list, not just moved between its rows or into the gap between them. */
function leftList(list: HTMLElement | null, event: DragEvent<HTMLElement>) {
  const next = event.relatedTarget
  return !(next instanceof Node && (list?.contains(next) ?? false))
}

/**
 * Reordering in the queue dock: drag bookkeeping, moves, focus, and the move announcement.
 *
 * The dragged id and the drop the line shows are kept in refs, not state: re-rendering a row
 * mid-gesture cancels the drag. The list owns the drop: the line stays on the last row the
 * pointer was over while it crosses the gap between rows, and a drop lands where the line is.
 */
export function useQueuedMessageArrangement(
  sessionId: SessionId | null,
  visible: readonly SessionFollowUpQueueItem[],
  onToast: (message: string) => void,
) {
  const { move } = useQueuedMessageReorder(sessionId, onToast)
  const draggedIdRef = useRef<string | null>(null)
  const dropRef = useRef<QueuedMessageAnchor | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const pendingFocusRef = useRef<PendingFocus | null>(null)
  // The nonce re-keys the announcement, so the same words are read again for a second move.
  const [announcement, setAnnouncement] = useState({ text: '', nonce: 0 })
  const visibleIds = visible.map((item) => item.id)
  const renderedOrder = visibleIds.join('\n')

  // The first order change after a move settles it: focus follows the message if it landed where
  // the move put it and the user has not moved focus since; either way the pending focus ends, so
  // it can never steal focus on some later change.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    if (renderedOrder.split('\n')[pending.index] !== pending.followUpId) return
    if (focusStillInDock(listRef.current)) focusWhenPlaced(listRef.current, pending)
  }, [renderedOrder])

  // A dragged message that leaves the queue mid-drag (delivered, withdrawn elsewhere) takes its
  // grip with it, and Chromium's dragend on a detached node never reaches React: end the drag here.
  useLayoutEffect(() => {
    const draggedId = draggedIdRef.current
    if (!draggedId || renderedOrder.split('\n').includes(draggedId)) return
    draggedIdRef.current = null
    dropRef.current = null
    clearDragFeedback(listRef.current)
  }, [renderedOrder])

  async function moveAndFocus(followUpId: string, anchor: QueuedMessageAnchor) {
    const moved = await move(followUpId, anchor)
    if (!moved) return
    const pending = { followUpId, index: moved.position - 1 }
    // Focus follows only if it is still with the dock. The new order may already be on screen;
    // otherwise the layout effect focuses on the commit that shows it.
    if (focusStillInDock(listRef.current)) {
      pendingFocusRef.current = focusWhenPlaced(listRef.current, pending) ? null : pending
    }
    setAnnouncement((previous) => ({
      text: `Moved to position ${String(moved.position)} of ${String(moved.count)}.`,
      nonce: previous.nonce + 1,
    }))
  }

  function endDrag() {
    draggedIdRef.current = null
    dropRef.current = null
    clearDragFeedback(listRef.current)
  }

  /** Points the drop at the row under the pointer; over the gap between rows it stays put. */
  function aimDrop(event: DragEvent<HTMLElement>) {
    const draggedId = draggedIdRef.current
    const list = listRef.current
    const row = queuedRowAt(list, event.target)
    if (!draggedId || !list || !row) return
    const anchor = dropAnchor(visibleIds, draggedId, row.dataset.followUpId ?? '')
    dropRef.current = anchor
    if (anchor) showDropLine(list, row, anchor.position)
    else clearDropLine(list)
  }

  return {
    listRef,
    announcement,
    onMove: (followUpId: string, anchor: QueuedMessageAnchor) =>
      void moveAndFocus(followUpId, anchor),
    onDragStart: (followUpId: string, event: DragEvent<HTMLElement>) => {
      draggedIdRef.current = followUpId
      dropRef.current = null
      const row = queuedRowAt(listRef.current, event.currentTarget)
      if (!row) return
      setQueuedMessageDragImage(event.dataTransfer, row, event)
      markDragSource(row)
    },
    // Also how a drag cancelled with Escape or dropped outside the list ends: with no move.
    onDragEnd: endDrag,
    listDragHandlers: {
      onDragOver: (event: DragEvent<HTMLUListElement>) => {
        aimDrop(event)
        if (!draggedIdRef.current || !dropRef.current) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      },
      onDragLeave: (event: DragEvent<HTMLUListElement>) => {
        if (!leftList(listRef.current, event)) return
        dropRef.current = null
        clearDropLine(listRef.current)
      },
      onDrop: (event: DragEvent<HTMLUListElement>) => {
        const draggedId = draggedIdRef.current
        const anchor = dropRef.current
        if (!draggedId || !anchor) return
        event.preventDefault()
        endDrag()
        void moveAndFocus(draggedId, anchor)
      },
    },
  }
}
