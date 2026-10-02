import { type PointerEvent, useRef, useState } from 'react'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import type { RailMove } from './right-panel-rail-order'

/** How long a press must last before an icon is picked up; a shorter press is a click. */
const HOLD_TO_DRAG_MS = 350
/** Moving further than this before the hold completes cancels the pick-up. */
const HOLD_SLOP_PX = 6
const RAIL_ITEM_SELECTOR = '[data-rail-surface]'
const HALF = 2

export interface RailDropTarget {
  readonly target: RightPanelSurfaceId
  readonly after: boolean
}

interface PendingHold {
  readonly id: RightPanelSurfaceId
  readonly pointerId: number
  readonly startY: number
  readonly element: HTMLElement
  readonly timer: ReturnType<typeof setTimeout>
}

function railItemAt(rail: HTMLElement, clientY: number) {
  for (const element of rail.querySelectorAll<HTMLElement>(RAIL_ITEM_SELECTOR)) {
    const rect = element.getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return { element, after: clientY >= rect.top + rect.height / HALF }
    }
  }
  return null
}

/**
 * Press and hold a rail icon to pick it up, then drag it to reorder (ADR 0043). A plain click
 * only opens the surface, so the pointer stays an arrow until the hold completes.
 */
export function usePanelRailDrag(
  railIds: readonly RightPanelSurfaceId[],
  onMove: (id: RightPanelSurfaceId, move: RailMove) => void,
) {
  const pending = useRef<PendingHold | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState<RightPanelSurfaceId | null>(null)
  const [drop, setDrop] = useState<RailDropTarget | null>(null)

  function cancelHold() {
    if (pending.current !== null) clearTimeout(pending.current.timer)
    pending.current = null
  }

  function finish() {
    cancelHold()
    setDragging(null)
    setDrop(null)
  }

  function onPointerDown(event: PointerEvent<HTMLElement>, id: RightPanelSurfaceId) {
    if (event.button !== 0) return
    cancelHold()
    const element = event.currentTarget
    const pointerId = event.pointerId
    const timer = setTimeout(() => {
      pending.current = null
      element.setPointerCapture(pointerId)
      suppressClick.current = true
      setDragging(id)
    }, HOLD_TO_DRAG_MS)
    pending.current = { id, pointerId, startY: event.clientY, element, timer }
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const hold = pending.current
    if (hold !== null && Math.abs(event.clientY - hold.startY) > HOLD_SLOP_PX) cancelHold()
    if (dragging === null) return
    const rail = event.currentTarget.closest<HTMLElement>('[data-panel-rail]')
    const hit = rail === null ? null : railItemAt(rail, event.clientY)
    const target = hit?.element.dataset.railSurface
    const surface = railIds.find((id) => id === target)
    setDrop(
      surface === undefined || surface === dragging || hit === null
        ? null
        : { target: surface, after: hit.after },
    )
  }

  function onPointerUp() {
    if (dragging !== null && drop !== null) {
      onMove(dragging, { type: drop.after ? 'after' : 'before', target: drop.target })
    }
    finish()
  }

  /** Swallows the click that ends a drag so dropping an icon does not also open it. */
  function consumeClick() {
    if (!suppressClick.current) return false
    suppressClick.current = false
    return true
  }

  return {
    dragging,
    drop,
    cancel: finish,
    consumeClick,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: finish },
  }
}
