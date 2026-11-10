import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  SESSION_SUMMARY_FOOTPRINT_PX,
  SESSION_SUMMARY_MIN_CONVERSATION_WIDTH_PX,
} from '../lib/chat-content-layout'

/**
 * Whether the chat panel is wide enough to dock the Session Summary, measured before the first
 * paint of each size. A docked Summary moves the conversation out from under it
 * (`SESSION_SUMMARY_DOCKED_CHAT_CLASS`), so it needs room for itself and a usable conversation
 * column, not room beside the centered column: that took a chat panel of about 1,384px, more
 * than a default or laptop-width window has, and left the Summary hidden by default.
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
    setHasSpace(width - SESSION_SUMMARY_FOOTPRINT_PX >= SESSION_SUMMARY_MIN_CONVERSATION_WIDTH_PX)
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
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure])

  return { panelRef, hasSpace }
}
