import { useLayoutEffect, useRef } from 'react'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import type { RailMove } from './right-panel-rail-order'

/**
 * Moving a keyed button can blur it (the DOM node is re-inserted), so keyboard reordering puts
 * focus back on the moved icon, or on All panels once the icon no longer fits on the rail.
 */
export function usePanelRailFocus(
  railIds: readonly RightPanelSurfaceId[],
  capacity: number,
  actions: {
    readonly move: (id: RightPanelSurfaceId, move: RailMove) => void
    readonly unpin: (id: RightPanelSurfaceId) => void
    readonly reset: () => void
  },
) {
  const railKey = `${railIds.join('\n')}|${String(capacity)}`
  const navRef = useRef<HTMLElement | null>(null)
  const refocus = useRef<RightPanelSurfaceId | null>(null)
  useLayoutEffect(() => {
    const id = refocus.current
    const nav = navRef.current
    // railKey only re-runs this after the rail re-renders in a new order; it is never empty.
    if (id === null || nav === null || railKey.length === 0) return
    refocus.current = null
    // Only take focus back from the rail itself (or from nowhere), never from elsewhere.
    const active = document.activeElement
    if (active !== null && active !== document.body && !nav.contains(active)) return
    const button =
      nav.querySelector<HTMLElement>(`[data-rail-surface="${id}"]`) ??
      nav.querySelector<HTMLElement>('[data-rail-surface="all-panels"]')
    button?.focus()
  }, [railKey])

  /** Moves an icon and keeps focus on it; at either end of the rail there is nothing to move. */
  function moveWithFocus(id: RightPanelSurfaceId, direction: 'up' | 'down') {
    const index = railIds.indexOf(id)
    const movable = direction === 'up' ? index > 0 : index >= 0 && index < railIds.length - 1
    if (!movable) return
    refocus.current = id
    actions.move(id, { type: direction })
  }

  function unpinWithFocus(id: RightPanelSurfaceId) {
    // The icon leaves the rail, so focus lands on All panels.
    refocus.current = id
    actions.unpin(id)
  }

  /** Reset can move every icon, so focus goes to All panels, which never moves. */
  function resetWithFocus() {
    actions.reset()
    navRef.current?.querySelector<HTMLElement>('[data-rail-surface="all-panels"]')?.focus()
  }

  return { navRef, moveWithFocus, unpinWithFocus, resetWithFocus }
}
