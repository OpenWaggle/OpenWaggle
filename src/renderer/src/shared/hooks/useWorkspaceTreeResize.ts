import type { PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useResizeGesture } from '@/shared/hooks/useResizeGesture'

const PARSE_RADIX = 10
const STORAGE_KEY = 'openwaggle:workspace-tree-width:v1'
const LEGACY_STORAGE_KEY = 'openwaggle:changed-file-navigator-width:v1'
const DEFAULT_WIDTH = 220
const MIN_WIDTH = 140
const MAX_WIDTH = 480
const NUDGE_STEP = 16

function parseStoredWidth(raw: string | null) {
  if (raw === null) return null
  const parsed = Number.parseInt(raw, PARSE_RADIX)
  if (Number.isNaN(parsed)) return null
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed))
}

function readStoredWidth() {
  try {
    return (
      parseStoredWidth(window.localStorage.getItem(STORAGE_KEY)) ??
      parseStoredWidth(window.localStorage.getItem(LEGACY_STORAGE_KEY)) ??
      DEFAULT_WIDTH
    )
  } catch {
    // Persistence is optional and must never block the navigator from rendering.
    return DEFAULT_WIDTH
  }
}

function persistWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // Private mode or a disabled store should only disable persistence.
  }
}

/** Shared width controller for the right-docked workspace tree in every code surface. */
export function useWorkspaceTreeResize() {
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
  }
}
