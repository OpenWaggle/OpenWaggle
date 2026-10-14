import { useCallback, useEffect, useState } from 'react'
import {
  pinInlineVisualizationFrame,
  unpinInlineVisualizationFrame,
} from './inline-visualization-frame-retention'

/** Whether this visualization's frame stays loaded off-screen because the user engaged it. */
export function useInlineVisualizationPin(instanceId: string) {
  const [pinned, setPinned] = useState(false)
  const pin = useCallback(() => {
    pinInlineVisualizationFrame(instanceId, () => setPinned(false))
    setPinned(true)
  }, [instanceId])
  const unpin = useCallback(() => {
    unpinInlineVisualizationFrame(instanceId)
    setPinned(false)
  }, [instanceId])
  useEffect(() => () => unpinInlineVisualizationFrame(instanceId), [instanceId])
  return { pinned, pin, unpin }
}

/** Focus moving into the cross-origin frame blurs the host window: the user is working in it. */
export function useInlineVisualizationEngagement(input: {
  readonly frameLoaded: boolean
  readonly frameRef: React.RefObject<HTMLIFrameElement | null>
  readonly onEngage: () => void
}) {
  const { frameLoaded, frameRef, onEngage } = input
  useEffect(() => {
    if (!frameLoaded) return
    let pending: number | null = null
    const handleWindowBlur = () => {
      if (pending !== null) window.clearTimeout(pending)
      // Chromium moves document.activeElement to the frame right after the window blurs.
      pending = window.setTimeout(() => {
        pending = null
        if (frameRef.current && document.activeElement === frameRef.current) onEngage()
      }, 0)
    }
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      if (pending !== null) window.clearTimeout(pending)
    }
  }, [frameLoaded, frameRef, onEngage])
}
