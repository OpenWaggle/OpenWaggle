import type { SessionId } from '@shared/types/brand'
import { useRef, useState } from 'react'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { dropAnchor, type QueuedMessageAnchor } from '../lib/queued-message-order'
import { useQueuedMessageReorder } from './useQueuedMessageReorder'

const GRIP_SELECTOR = '[data-qa="queued-message-grip"]'

/** Keyboard focus follows the moved message, so Move up / Move down can be repeated. */
function focusGrip(list: HTMLElement | null, followUpId: string) {
  const rows = list?.querySelectorAll<HTMLElement>('[data-qa="queued-message-row"]') ?? []
  const row = [...rows].find((element) => element.dataset.followUpId === followUpId)
  row?.querySelector<HTMLElement>(GRIP_SELECTOR)?.focus()
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
  const [announcement, setAnnouncement] = useState('')
  const visibleIds = visible.map((item) => item.id)

  async function moveAndFocus(followUpId: string, anchor: QueuedMessageAnchor) {
    const moved = await move(followUpId, anchor)
    if (!moved) return
    setAnnouncement(`Moved to position ${String(moved.position)} of ${String(moved.count)}.`)
    focusGrip(listRef.current, followUpId)
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
