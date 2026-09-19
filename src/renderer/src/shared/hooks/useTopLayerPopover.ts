import { type RefObject, useLayoutEffect } from 'react'

export type PopoverPlacement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'

const VIEWPORT_INSET_PX = 8
const VIEWPORT_TOTAL_INSET_PX = 16
const TRIGGER_GAP_PX = 4

function placePanel(panel: HTMLElement, trigger: HTMLElement, placement: PopoverPlacement) {
  const anchor = trigger.getBoundingClientRect()
  const bounds = panel.getBoundingClientRect()
  const below = anchor.bottom + TRIGGER_GAP_PX
  const above = anchor.top - bounds.height - TRIGGER_GAP_PX
  const maximumTop = Math.max(
    VIEWPORT_INSET_PX,
    window.innerHeight - bounds.height - VIEWPORT_INSET_PX,
  )
  const preferAbove = placement.startsWith('top')
  const preferredTop = preferAbove ? above : below
  const alternateTop = preferAbove ? below : above
  const top =
    preferredTop >= VIEWPORT_INSET_PX && preferredTop <= maximumTop ? preferredTop : alternateTop
  const left = placement.endsWith('end') ? anchor.right - bounds.width : anchor.left
  panel.style.top = `${String(Math.max(VIEWPORT_INSET_PX, Math.min(top, maximumTop)))}px`
  panel.style.left = `${String(Math.max(VIEWPORT_INSET_PX, Math.min(left, window.innerWidth - bounds.width - VIEWPORT_INSET_PX)))}px`
}

/** Native popovers escape clipping without moving DOM ownership away from the trigger. */
export function useTopLayerPopover(input: {
  readonly enabled: boolean
  readonly containerRef: RefObject<HTMLElement | null>
  readonly panelRef: RefObject<HTMLElement | null>
  readonly placement: PopoverPlacement
}) {
  const { enabled, containerRef, panelRef, placement } = input
  useLayoutEffect(() => {
    const container = containerRef.current
    const panel = panelRef.current
    if (!enabled || !container || !panel) return
    Object.assign(panel.style, {
      position: 'fixed',
      inset: 'auto',
      margin: '0',
      maxHeight: `calc(100vh - ${String(VIEWPORT_TOTAL_INSET_PX)}px)`,
      maxWidth: `calc(100vw - ${String(VIEWPORT_TOTAL_INSET_PX)}px)`,
      overflowY: 'auto',
    })
    // jsdom has no top layer. Real Electron supports the native popover API.
    if (typeof panel.showPopover === 'function') {
      if (!panel.matches(':popover-open')) panel.showPopover()
    } else panel.style.display = 'block'
    const reposition = () => placePanel(panel, container, placement)
    reposition()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition)
    observer?.observe(container)
    observer?.observe(panel)
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
      if (typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) {
        panel.hidePopover()
      }
    }
  }, [containerRef, enabled, panelRef, placement])
}
