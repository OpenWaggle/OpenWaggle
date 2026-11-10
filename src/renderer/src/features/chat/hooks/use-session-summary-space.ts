import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CHAT_MIN_WIDTH } from '@/shell'
import {
  SESSION_SUMMARY_FOOTPRINT_PX,
  SESSION_SUMMARY_RESERVE_PROPERTY,
  sessionSummaryReservePx,
} from '../lib/chat-content-layout'

/**
 * Whether the chat panel can dock the Session Summary, measured before the first paint of each
 * size: the panel must keep the chat's minimum width (the one the right sidebar keeps) beside the
 * Summary's footprint (ADR 0026 amendment). It also sets the reserve the conversation frames move
 * by while a Summary is docked.
 *
 * The measurement reads the panel's border box. Moving the frames does not change it, so docking
 * never feeds back into this decision.
 */
export function useSessionSummarySpace(rightSidebarOpen: boolean) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [hasSpace, setHasSpace] = useState(true)

  const measure = useCallback(() => {
    if (rightSidebarOpen) return
    const container = panelRef.current
    if (!container) return
    const width = container.clientWidth
    if (width === 0) {
      setHasSpace(true)
      return
    }
    // Set on the element, not through state: a resize moves the frames without rendering the chat.
    container.style.setProperty(
      SESSION_SUMMARY_RESERVE_PROPERTY,
      `${String(sessionSummaryReservePx(width))}px`,
    )
    setHasSpace(width - SESSION_SUMMARY_FOOTPRINT_PX >= CHAT_MIN_WIDTH)
  }, [rightSidebarOpen])

  useLayoutEffect(() => {
    const element = panelRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    /*
     * A ResizeObserver reports each observed element once when it starts, after layout, so the
     * first measurement needs no read in a layout effect: that read forced the shell's first layout
     * inside its commit (B12). Attaching it forces no layout, and attached in a layout effect it
     * reports in the rendering steps of the frame the panel first paints in, so the update renders
     * before that paint. Attached in a passive effect, which React may run after paint, a narrow
     * window painted the docked Summary for a frame (PR 391 review R2 P3-3).
     */
    const observer = new ResizeObserver(() => flushSync(measure))
    observer.observe(element, { box: 'border-box' })
    return () => observer.disconnect()
  }, [measure])

  return { panelRef, hasSpace }
}
