import { useEffect, useLayoutEffect, useState } from 'react'
import { TranscriptViewportSession } from '../lib/transcript-viewport-session'

/**
 * Connects one transcript viewport to React (ADR 0036).
 *
 * The session object is created once per mount; the component that uses this hook is keyed by
 * Session and branch, so each reading position gets its own instance.
 */
export function useTranscriptViewport(positionKey: string, hasRows: boolean) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [showScrollbar, setShowScrollbar] = useState(false)
  const [session] = useState(
    () => new TranscriptViewportSession(positionKey, { setShowScrollToBottom, setShowScrollbar }),
  )

  useLayoutEffect(() => {
    if (hasRows) session.armRestore()
  }, [hasRows, session])

  useLayoutEffect(() => {
    const { scroller, content } = session
    if (!scroller || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => session.resized())
    observer.observe(content)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [session])

  useEffect(() => () => session.dispose(), [session])

  return { session, showScrollToBottom, showScrollbar }
}
