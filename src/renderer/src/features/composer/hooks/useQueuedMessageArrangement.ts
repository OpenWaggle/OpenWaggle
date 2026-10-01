import type { SessionId } from '@shared/types/brand'
import { useLayoutEffect, useRef, useState } from 'react'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { dropAnchor, type QueuedMessageAnchor } from '../lib/queued-message-order'
import { useQueuedMessageReorder } from './useQueuedMessageReorder'

const ROW_SELECTOR = '[data-qa="queued-message-row"]'
const GRIP_SELECTOR = '[data-qa="queued-message-grip"]'

interface PendingFocus {
  readonly followUpId: string
  /** Zero-based place among the rendered rows where the moved message must be before focusing. */
  readonly index: number
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

/**
 * Reordering in the queue dock: drag bookkeeping, moves, focus, and the move announcement.
 *
 * The dragged id is kept in a ref, not state: re-rendering a row mid-gesture cancels the drag.
 */
export function useQueuedMessageArrangement(
  sessionId: SessionId | null,
  visible: readonly SessionFollowUpQueueItem[],
  onToast: (message: string) => void,
) {
  const { move } = useQueuedMessageReorder(sessionId, onToast)
  const draggedIdRef = useRef<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const pendingFocusRef = useRef<PendingFocus | null>(null)
  // The nonce re-keys the announcement, so the same words are read again for a second move.
  const [announcement, setAnnouncement] = useState({ text: '', nonce: 0 })
  const visibleIds = visible.map((item) => item.id)
  const renderedOrder = visibleIds.join('\n')

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending || renderedOrder.split('\n')[pending.index] !== pending.followUpId) return
    if (focusWhenPlaced(listRef.current, pending)) pendingFocusRef.current = null
  }, [renderedOrder])

  async function moveAndFocus(followUpId: string, anchor: QueuedMessageAnchor) {
    const moved = await move(followUpId, anchor)
    if (!moved) return
    const pending = { followUpId, index: moved.position - 1 }
    // The new order may already be on screen; otherwise the layout effect focuses on commit.
    pendingFocusRef.current = focusWhenPlaced(listRef.current, pending) ? null : pending
    setAnnouncement((previous) => ({
      text: `Moved to position ${String(moved.position)} of ${String(moved.count)}.`,
      nonce: previous.nonce + 1,
    }))
  }

  function anchorFor(targetId: string) {
    const draggedId = draggedIdRef.current
    return draggedId ? dropAnchor(visibleIds, draggedId, targetId) : null
  }

  return {
    listRef,
    announcement,
    onMove: (followUpId: string, anchor: QueuedMessageAnchor) =>
      void moveAndFocus(followUpId, anchor),
    onDragStart: (followUpId: string) => {
      draggedIdRef.current = followUpId
    },
    onDragEnd: () => {
      draggedIdRef.current = null
    },
    dropAnchor: anchorFor,
    onDropOn: (targetId: string) => {
      const draggedId = draggedIdRef.current
      const anchor = anchorFor(targetId)
      draggedIdRef.current = null
      if (draggedId && anchor) void moveAndFocus(draggedId, anchor)
    },
  }
}
