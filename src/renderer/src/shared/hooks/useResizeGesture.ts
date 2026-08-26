import type { KeyboardEvent, PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

const DEFAULT_MOVE_THRESHOLD_PX = 0

type ResizeGrowDirection = 'left' | 'right'
type ResizeFinishReason = 'cancel' | 'lost-capture' | 'pointer-cancel' | 'pointer-up'

interface ResizeFinishContext {
  readonly moved: boolean
  readonly reason: ResizeFinishReason
  readonly width: number
}

interface ResizeGestureOptions {
  readonly getWidth: () => number
  readonly growDirection: ResizeGrowDirection
  readonly keyboardStep?: number
  readonly maxWidth: number
  readonly minWidth: number
  readonly moveThreshold?: number
  readonly onCommit: (width: number) => void
  readonly onFinish?: (context: ResizeFinishContext) => void
  readonly onPreview: (width: number) => void
  readonly shouldAcceptWidth?: (width: number) => boolean
}

interface ActiveResize<T extends HTMLElement> {
  readonly growDirection: ResizeGrowDirection
  readonly maxWidth: number
  readonly minWidth: number
  readonly moveThreshold: number
  readonly onCommit: (width: number) => void
  readonly onFinish?: (context: ResizeFinishContext) => void
  readonly onPreview: (width: number) => void
  readonly pointerId: number
  readonly shouldAcceptWidth?: (width: number) => boolean
  readonly startWidth: number
  readonly startX: number
  readonly target: T
  moved: boolean
  pendingWidth: number
  rafId: number | null
  width: number
}

function clampWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.max(minWidth, Math.min(width, maxWidth))
}

function widthDelta(pointerDelta: number, growDirection: ResizeGrowDirection) {
  return growDirection === 'left' ? -pointerDelta : pointerDelta
}

export function useResizeGesture<T extends HTMLElement>(options: ResizeGestureOptions) {
  const activeResizeRef = useRef<ActiveResize<T> | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  function applyPendingResize(activeResize: ActiveResize<T>) {
    if (activeResizeRef.current !== activeResize) return

    activeResize.rafId = null
    const nextWidth = activeResize.pendingWidth
    if (activeResize.shouldAcceptWidth?.(nextWidth) === false) return

    activeResize.width = nextWidth
    activeResize.onPreview(nextWidth)
  }

  function finishResize(activeResize: ActiveResize<T>, reason: ResizeFinishReason) {
    if (activeResizeRef.current !== activeResize) return

    if (activeResize.rafId !== null) {
      window.cancelAnimationFrame(activeResize.rafId)
      activeResize.rafId = null
      applyPendingResize(activeResize)
    }

    activeResizeRef.current = null
    setIsResizing(false)
    activeResize.onFinish?.({
      moved: activeResize.moved,
      reason,
      width: activeResize.width,
    })

    if (activeResize.target.hasPointerCapture(activeResize.pointerId)) {
      activeResize.target.releasePointerCapture(activeResize.pointerId)
    }
    if (activeResize.moved) activeResize.onCommit(activeResize.width)
  }

  function startResize(event: PointerEvent<T>, startWidth: number) {
    if (activeResizeRef.current) return

    event.preventDefault()
    activeResizeRef.current = {
      growDirection: options.growDirection,
      maxWidth: options.maxWidth,
      minWidth: options.minWidth,
      moveThreshold: options.moveThreshold ?? DEFAULT_MOVE_THRESHOLD_PX,
      moved: false,
      onCommit: options.onCommit,
      onFinish: options.onFinish,
      onPreview: options.onPreview,
      pendingWidth: startWidth,
      pointerId: event.pointerId,
      rafId: null,
      shouldAcceptWidth: options.shouldAcceptWidth,
      startWidth,
      startX: event.clientX,
      target: event.currentTarget,
      width: startWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  function handlePointerMove(event: PointerEvent<T>) {
    const activeResize = activeResizeRef.current
    if (!activeResize || activeResize.pointerId !== event.pointerId) return

    event.preventDefault()
    const pointerDelta = event.clientX - activeResize.startX
    if (Math.abs(pointerDelta) > activeResize.moveThreshold) activeResize.moved = true
    activeResize.pendingWidth = clampWidth(
      activeResize.startWidth + widthDelta(pointerDelta, activeResize.growDirection),
      activeResize.minWidth,
      activeResize.maxWidth,
    )
    if (activeResize.rafId !== null) return

    activeResize.rafId = window.requestAnimationFrame(() => applyPendingResize(activeResize))
  }

  function handlePointerEnd(
    event: PointerEvent<T>,
    reason: Extract<ResizeFinishReason, 'pointer-cancel' | 'pointer-up'>,
  ) {
    const activeResize = activeResizeRef.current
    if (!activeResize || activeResize.pointerId !== event.pointerId) return

    event.preventDefault()
    finishResize(activeResize, reason)
  }

  function handleKeyDown(event: KeyboardEvent<T>) {
    const keyboardStep = options.keyboardStep
    if (keyboardStep === undefined || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
      return
    }

    event.preventDefault()
    const pointerDelta = event.key === 'ArrowLeft' ? -keyboardStep : keyboardStep
    const currentWidth = options.getWidth()
    const nextWidth = clampWidth(
      currentWidth + widthDelta(pointerDelta, options.growDirection),
      options.minWidth,
      options.maxWidth,
    )
    if (nextWidth === currentWidth || options.shouldAcceptWidth?.(nextWidth) === false) return

    options.onPreview(nextWidth)
    options.onCommit(nextWidth)
  }

  useEffect(() => {
    return () => {
      const activeResize = activeResizeRef.current
      if (!activeResize) return

      activeResizeRef.current = null
      if (activeResize.rafId !== null) window.cancelAnimationFrame(activeResize.rafId)
      activeResize.onFinish?.({
        moved: activeResize.moved,
        reason: 'cancel',
        width: activeResize.width,
      })
      if (activeResize.target.hasPointerCapture(activeResize.pointerId)) {
        activeResize.target.releasePointerCapture(activeResize.pointerId)
      }
    }
  }, [])

  return {
    handleKeyDown,
    handleLostPointerCapture(event: PointerEvent<T>) {
      const activeResize = activeResizeRef.current
      if (!activeResize || activeResize.pointerId !== event.pointerId) return
      finishResize(activeResize, 'lost-capture')
    },
    handlePointerCancel(event: PointerEvent<T>) {
      handlePointerEnd(event, 'pointer-cancel')
    },
    handlePointerMove,
    handlePointerUp(event: PointerEvent<T>) {
      handlePointerEnd(event, 'pointer-up')
    },
    isResizing,
    startResize,
  }
}
