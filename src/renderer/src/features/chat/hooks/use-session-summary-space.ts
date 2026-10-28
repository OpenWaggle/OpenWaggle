import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CHAT_CONTENT_MAX_WIDTH_PX } from '../lib/chat-content-layout'

const SESSION_SUMMARY_WIDTH_PX = 300
const SESSION_SUMMARY_RIGHT_INSET_PX = 16
const SESSION_SUMMARY_CONTENT_GAP_PX = 16
const SESSION_SUMMARY_AUTO_OPEN_FALLBACK_WIDTH_PX =
  CHAT_CONTENT_MAX_WIDTH_PX +
  2 * (SESSION_SUMMARY_WIDTH_PX + SESSION_SUMMARY_RIGHT_INSET_PX + SESSION_SUMMARY_CONTENT_GAP_PX)

/**
 * Whether the chat panel has room to dock the Session Summary beside the conversation, measured
 * before the first paint of each size.
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

    const contentFrame = container.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
    const containerRect = container.getBoundingClientRect()
    const contentRect = contentFrame?.getBoundingClientRect()
    const hasMeasuredGeometry =
      containerRect.width > 0 && contentRect !== undefined && contentRect.width > 0
    const roomForSummary = hasMeasuredGeometry
      ? containerRect.right - contentRect.right >=
        SESSION_SUMMARY_WIDTH_PX + SESSION_SUMMARY_RIGHT_INSET_PX + SESSION_SUMMARY_CONTENT_GAP_PX
      : width >= SESSION_SUMMARY_AUTO_OPEN_FALLBACK_WIDTH_PX
    setHasSpace(roomForSummary)
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
    const contentFrame = element.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
    if (contentFrame) observer.observe(contentFrame)
    return () => observer.disconnect()
  }, [measure])

  return { panelRef, hasSpace }
}
