import type { PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useResizeGesture } from '@/shared/hooks/useResizeGesture'

const PARSE_RADIX = 10
const STORAGE_KEY = 'openwaggle:changed-file-navigator-width:v1'
const DEFAULT_WIDTH = 220
const MIN_WIDTH = 140
const MAX_WIDTH = 480
const NUDGE_STEP = 16

function readStoredWidth() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_WIDTH
    const parsed = Number.parseInt(raw, PARSE_RADIX)
    if (Number.isNaN(parsed)) return DEFAULT_WIDTH
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed))
  } catch {
    // Private mode or a disabled store is not worth failing a render over.
    return DEFAULT_WIDTH
  }
}

function persistWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // Persistence is a convenience; a failure must not break resizing.
  }
}

/** Width of the Changed-file navigator, draggable and persisted. */
export function useNavigatorResize() {
  const [width, setWidth] = useState(readStoredWidth)
  const widthRef = useRef(width)

  useEffect(() => {
    persistWidth(width)
  }, [width])

  function applyWidth(nextWidth: number) {
    widthRef.current = nextWidth
    setWidth(nextWidth)
  }

  const resize = useResizeGesture<HTMLButtonElement>({
    getWidth: () => widthRef.current,
    growDirection: 'left',
    keyboardStep: NUDGE_STEP,
    maxWidth: MAX_WIDTH,
    minWidth: MIN_WIDTH,
    onCommit: persistWidth,
    onPreview: applyWidth,
  })

  return {
    width,
    handleKeyDown: resize.handleKeyDown,
    handleLostPointerCapture: resize.handleLostPointerCapture,
    handlePointerCancel: resize.handlePointerCancel,
    handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.button !== 0) return
      resize.startResize(event, widthRef.current)
    },
    handlePointerMove: resize.handlePointerMove,
    handlePointerUp: resize.handlePointerUp,
    isResizing: resize.isResizing,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
  }
}
